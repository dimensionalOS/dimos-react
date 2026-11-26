// A USD layer read into the same RobotDescription (description.ts) a URDF is, so everything downstream — the robot
// model layer, the arm view, IK, mesh loading — is unaware of which one the robot sent.
//
// This reads the dialect dimos's UsdManager writes: a link is a prim carrying PhysicsRigidBodyAPI, its tf name is its
// displayName (prim names cannot hold a "/" or a "-", so the original spelling lives there), geometry is a child prim,
// a mesh is a reference to the path the description named, and joints are UsdPhysics prims under a `joints` Scope.
// A joint is authored about z with the real axis folded into its local rotations.
//
// Written rather than taken from three's bundled USDAParser because that one is line-based and decides nesting by a
// line's last character. A dimos layer keeps the URDF it could not convert in customData as a triple-quoted string,
// and that XML contains braces, so a brace-counting reader walks straight off the end of the tree.
//
// Only text layers (.usda). A crate .usdc is binary and never travels over the file bus.
import type {
    DescriptionGeometry,
    DescriptionJoint,
    DescriptionLight,
    DescriptionLink,
    DescriptionLook,
    Origin,
    RobotDescription,
} from "./description.ts"

/** One prim: its type, its name, what it says about itself, and what is inside it. */
export interface Prim {
    type: string
    name: string
    /** `displayName = "..."`, the tf name when it has one */
    displayName?: string
    /** the metadata block in `( ... )`, by key */
    meta: Record<string, string>
    /** the attributes in the body, keyed without their type (`xformOp:transform`, not `matrix4d xformOp:transform`) */
    attrs: Record<string, string>
    children: Prim[]
    parent?: Prim
    /** values read from a crate (.usdc) as they are, by attribute name: big arrays stay typed instead of becoming text */
    values?: Record<string, unknown>
    /** `variantSet "name" = { "choice" { ... } }`, each choice's body as text, until the selected one is applied */
    variantBodies?: Record<string, Record<string, string>>
}

const RIGID_BODY = "PhysicsRigidBodyAPI"
const JOINT_TYPES: Record<string, DescriptionJoint["type"]> = {
    PhysicsRevoluteJoint: "revolute",
    PhysicsPrismaticJoint: "prismatic",
    PhysicsFixedJoint: "fixed",
    // The generic joint: free in all six degrees unless something is locked, which is a URDF floating joint.
    // Locking the axes out of one plane makes it planar — see freeKind.
    PhysicsJoint: "floating",
}
/** a URDF planar joint moves in its own xy and turns about z, so a planar one has these locked */
const OUT_OF_PLANE = ["transZ", "rotX", "rotY"]

/** True for a layer this can read, by its first line rather than its name. */
export function isUsda(text: string): boolean {
    return /^\s*#usda\s/.test(text)
}

/**
 * A `.usda` layer as a RobotDescription.
 *
 * Throws when the text is not a USD layer at all. A layer with no links gives a description with none, which the
 * caller can tell apart from a failure.
 */
export function parseUsda(text: string): RobotDescription {
    if (!isUsda(text)) {
        throw new Error("not a USD layer: no #usda header")
    }
    return describe(parsePrims(text), defaultPrimName(text))
}

/** The prims of a layer (text or crate) as a RobotDescription. */
export function describe(roots: Prim[], defaultPrim: string | null): RobotDescription {
    indexMaterials(roots)
    const links: DescriptionLink[] = []
    const prims: Prim[] = []
    const sceneRoot = rootFrame(roots, defaultPrim)
    const shapes = new Map<
        Prim,
        { visuals: DescriptionGeometry[]; collisions: DescriptionGeometry[]; drawable: DescriptionGeometry[] }
    >()
    walk(roots, (prim) => {
        if (isLink(prim) || prim === sceneRoot) {
            prims.push(prim)
            shapes.set(prim, { visuals: [], collisions: [], drawable: [] })
        }
    })
    for (const { prim, owner } of geometryPrims(roots, sceneRoot)) {
        const into = shapes.get(owner)
        const geometry = into ? geometryOf(prim, owner) : null
        if (!into || !geometry) continue
        const hidden = !rendered(prim)
        if ((prim.meta["apiSchemas"] ?? "").includes("PhysicsCollisionAPI")) {
            into.collisions.push(geometry)
            if (!hidden) into.drawable.push(geometry)
        } else if (!hidden) {
            into.visuals.push(geometry)
        }
    }
    for (const prim of prims) {
        const { visuals, collisions, drawable } = shapes.get(prim)!
        links.push({
            name: frameName(prim),
            // a URDF link shows its visual; a MuJoCo geom with none is drawn as its collider, unless USD calls it a guide
            visuals: visuals.length > 0 ? visuals : drawable,
            collisions,
        })
    }
    const joints = jointsOf(roots, prims, sceneRoot)
    const childLinks = new Set(joints.map((joint) => joint.child))
    const root = links.find((link) => !childLinks.has(link.name))?.name ?? links[0]?.name ?? ""
    return {
        name: defaultPrim ?? roots[0]?.name ?? "robot",
        base_link: root,
        base_frame: root,
        base_pose: { xyz: [0, 0, 0], quat: [0, 0, 0, 1] },
        joint_names: joints.filter((joint) => joint.type !== "fixed" && !joint.mimic).map((joint) => joint.name),
        links,
        joints,
        lights: lightsOf(roots),
        look: lookOf(roots),
    }
}

/** Every mesh path the layer names, for a caller that only wants the files. */
export function usdaMeshUris(text: string): string[] {
    const uris: string[] = []
    walk(parsePrims(text), (prim) => {
        const mesh = meshPathOf(prim)
        if (mesh) uris.push(mesh)
    })
    return [...new Set(uris)]
}

/**
 * Every asset the layer gives a content hash for: the path exactly as authored, to the hash verbatim.
 *
 * dimos writes a sha256 into each mesh's standard `assetInfo` and refuses to serve a subtree whose assets are
 * unhashed, so for a dimos layer this is complete. A layer from elsewhere may hash nothing, and then it is empty
 * rather than an error — the caller simply does not cache those.
 *
 * The value is returned as written (`"sha256:<hex>"`), not parsed, so a layer using another algorithm still says
 * something a caller can compare for equality.
 */
export function usdaAssetHashes(text: string): Map<string, string> {
    const hashes = new Map<string, string>()
    walk(parsePrims(text), (prim) => {
        const path = meshPathOf(prim)
        const version = assetInfoVersion(prim)
        if (path && version) hashes.set(path, version)
    })
    return hashes
}

/** `assetInfo = { asset identifier = @...@ ... }` — the file the hash is of, when there is no reference arc. */
function assetInfoPath(prim: Prim): string | null {
    const match = (prim.meta["assetInfo"] ?? "").match(/\bidentifier\s*=\s*@([^@]+)@/)
    return match ? match[1] : null
}

/** `assetInfo = { ... string version = "sha256:..." }`, as written. */
function assetInfoVersion(prim: Prim): string | null {
    const match = (prim.meta["assetInfo"] ?? "").match(/\bversion\s*=\s*"([^"]*)"/)
    return match && match[1] ? match[1] : null
}

// ---- the layer as prims ----------------------------------------------------

/**
 * The layer's root prims.
 *
 * A hand-rolled scan rather than a regex: it has to know when it is inside a string, because `"..."`, `'''...'''` and
 * `@...@` can all hold the braces and parentheses that otherwise delimit the tree.
 */
export function parsePrims(text: string): Prim[] {
    const tokens = scan(text)
    const roots: Prim[] = []
    const stack: Prim[] = []
    let index = 0
    while (index < tokens.length) {
        const token = tokens[index]
        if (token.kind === "def") {
            const prim: Prim = {
                type: token.primType,
                name: token.name,
                meta: {},
                attrs: {},
                children: [],
                ...(stack.length ? { parent: stack[stack.length - 1] } : {}),
            }
            if (token.meta) {
                Object.assign(prim.meta, parseAssignments(token.meta))
                const display = prim.meta["displayName"]
                if (display !== undefined) prim.displayName = unquote(display)
            }
            if (stack.length) stack[stack.length - 1].children.push(prim)
            else roots.push(prim)
            stack.push(prim)
            index += 1
        } else if (token.kind === "close") {
            stack.pop()
            index += 1
        } else {
            // a body assignment: `matrix4d xformOp:transform = (...)`
            const prim = stack[stack.length - 1]
            if (prim) {
                const { key, value } = token
                const variantSet = key.match(/^variantSet\s+"([^"]*)"$/)
                if (variantSet) (prim.variantBodies ??= {})[variantSet[1]] = variantsIn(value)
                else {
                    const name = attributeName(key)
                    prim.attrs[name] = value
                    // kept as `<attribute>:<key>`, the name a crate's attribute metadata is read into (usdc.ts)
                    const meta = token.meta ? parseAssignments(token.meta) : {}
                    for (const [field, said] of Object.entries(meta)) prim.attrs[`${name}:${field}`] = said
                }
            }
            index += 1
        }
    }
    walk(roots, applyVariants)
    return roots
}

/** `{ "a" ( ... ) { body } "b" { body } }` as each choice's body. */
function variantsIn(block: string): Record<string, string> {
    const out: Record<string, string> = {}
    let at = block.indexOf("{") + 1
    while (at < block.length) {
        at = skipBlanks(block, at)
        const end = stringAt(block, at)
        if (end === -1) break
        const name = block.slice(at + 1, end - 1)
        at = skipBlanks(block, end)
        if (block[at] === "(") at = skipBlanks(block, matching(block, at, "(", ")") + 1)
        if (block[at] !== "{") break
        const close = matching(block, at, "{", "}")
        out[name] = block.slice(at + 1, close)
        at = close + 1
    }
    return out
}

/** The selected variant of each set (`variants = { string set = "choice" }`, else its first) composed into the prim. */
function applyVariants(prim: Prim): void {
    if (!prim.variantBodies) return
    const selected = parseAssignments((prim.meta["variants"] ?? "").replace(/^\s*\{|\}\s*$/g, ""))
    for (const [set, choices] of Object.entries(prim.variantBodies)) {
        const choice = selected[set] !== undefined ? unquote(selected[set]) : Object.keys(choices)[0]
        const body = choices[choice]
        if (body === undefined) continue
        const [parsed] = parsePrims(`def "variant"\n{\n${body}\n}\n`)
        for (const [name, value] of Object.entries(parsed?.attrs ?? {})) prim.attrs[name] ??= value
        for (const child of parsed?.children ?? []) {
            child.parent = prim
            prim.children.push(child)
        }
    }
    delete prim.variantBodies
}

type Token =
    | { kind: "def"; primType: string; name: string; meta?: string }
    | { kind: "assign"; key: string; value: string; meta?: string }
    | { kind: "close" }

/** The layer as a flat list of prim openings, closings and assignments, with every string skipped whole. */
function scan(text: string): Token[] {
    const tokens: Token[] = []
    let at = 0
    // the header's own ( ... ) block, which carries defaultPrim: read by defaultPrimName, skipped here
    const header = text.indexOf("(")
    if (header !== -1 && /^\s*#usda[^\n]*\n\s*$/.test(text.slice(0, header))) {
        at = matching(text, header, "(", ")") + 1
    }
    while (at < text.length) {
        const next = findPrimOrBrace(text, at)
        if (!next) break
        if (next.kind === "close") {
            tokens.push({ kind: "close" })
            at = next.end
            continue
        }
        if (next.kind === "def") {
            tokens.push({
                kind: "def",
                primType: next.primType,
                name: next.name,
                ...(next.meta ? { meta: next.meta } : {}),
            })
            // A prim written without a body has nothing inside it, so it closes at once.
            if (next.body === false) tokens.push({ kind: "close" })
            at = next.end
            continue
        }
        tokens.push({ kind: "assign", key: next.key, value: next.value, ...(next.meta ? { meta: next.meta } : {}) })
        at = next.end
    }
    return tokens
}

interface Found {
    kind: "def" | "close" | "assign"
    end: number
    /** false for a prim written with no `{ ... }`, which has no children to read */
    body?: boolean
    primType: string
    name: string
    meta?: string
    key: string
    value: string
}

/** The next prim opening, closing brace or assignment at or after `from`, with strings skipped. */
function findPrimOrBrace(text: string, from: number): Found | null {
    let at = from
    while (at < text.length) {
        const character = text[at]
        if (character === "#") {
            at = lineEnd(text, at)
            continue
        }
        const quote = stringAt(text, at)
        if (quote !== -1) {
            at = quote
            continue
        }
        if (character === "}") {
            return { kind: "close", end: at + 1, body: true, primType: "", name: "", key: "", value: "" }
        }
        if (text.startsWith("def ", at) || text.startsWith("over ", at) || text.startsWith("class ", at)) {
            return readDef(text, at)
        }
        if (character === "=") {
            return readAssignment(text, from, at)
        }
        at += 1
    }
    return null
}

/**
 * `def Xform "base" ( ... ) {` — the type, the name, the metadata block, and where the body starts.
 *
 * The metadata block is found before the body brace, never by looking for the first `{`: a prim's metadata can hold
 * `customData = { ... }`, and taking that brace as the body would put the reader inside the metadata. The body's
 * brace is also usually on the line after the metadata's `)`, so finding it means skipping blanks and comments
 * rather than stopping at the end of the line.
 */
function readDef(text: string, at: number): Found {
    // the head runs to the metadata's `(` or the body's `{`, whichever comes first
    let scanAt = at
    while (scanAt < text.length) {
        const quote = stringAt(text, scanAt)
        if (quote !== -1) {
            scanAt = quote
            continue
        }
        if (text[scanAt] === "(" || text[scanAt] === "{" || text[scanAt] === "\n") break
        scanAt += 1
    }
    const head = text.slice(at, scanAt)
    // The head stops at the newline so a def with neither metadata nor body cannot swallow the
    // line after it. But USD lets the metadata's `(` sit on its own line, and pxr writes it that
    // way whenever the head is long -- so look past blanks for it, and only commit to the jump
    // if what is there really is metadata or a body. dimos's own layers use both forms.
    const afterBlanks = skipBlanks(text, scanAt)
    if (text[afterBlanks] === "(" || text[afterBlanks] === "{") scanAt = afterBlanks
    let meta: string | undefined
    if (text[scanAt] === "(") {
        const close = matching(text, scanAt, "(", ")")
        meta = text.slice(scanAt + 1, close)
        scanAt = close + 1
    }
    scanAt = skipBlanks(text, scanAt)
    const body = text[scanAt] === "{"
    const quoted = head.match(/"([^"]*)"/)
    const words = head.slice(0, quoted ? head.indexOf('"') : head.length).trim().split(/\s+/)
    // `def Xform "name"` has a type; `def "name"` (a typeless prim) does not
    const primType = words.length > 1 ? words[1] : ""
    return {
        kind: "def",
        end: body ? scanAt + 1 : scanAt,
        body,
        primType,
        name: quoted ? quoted[1] : "",
        ...(meta !== undefined ? { meta } : {}),
        key: "",
        value: "",
    }
}

/** Past any whitespace and comments at `at`. */
function skipBlanks(text: string, at: number): number {
    let scanAt = at
    while (scanAt < text.length) {
        if (/\s/.test(text[scanAt])) scanAt += 1
        else if (text[scanAt] === "#") scanAt = lineEnd(text, scanAt)
        else break
    }
    return scanAt
}

/** `matrix4d xformOp:transform = ( ... )` — everything left of `=` is the key, the value runs to the line's end or a matching bracket. */
function readAssignment(text: string, from: number, equals: number): Found {
    const keyStart = Math.max(lineStart(text, equals), from)
    const key = text.slice(keyStart, equals).trim()
    let at = equals + 1
    while (at < text.length && (text[at] === " " || text[at] === "\t")) at += 1
    let end: number
    if (text[at] === "[") end = matching(text, at, "[", "]") + 1
    else if (text[at] === "(") end = matching(text, at, "(", ")") + 1
    else if (text[at] === "{") end = matching(text, at, "{", "}") + 1
    else {
        const stringEnd = stringAt(text, at)
        end = stringEnd !== -1 ? stringEnd : lineEnd(text, at)
        // a plain value stops at its own metadata's `(`, which no plain value holds
        const paren = text.slice(at, end).indexOf("(")
        if (stringEnd === -1 && paren !== -1) end = at + paren
    }
    const value = text.slice(at, end).trim()
    // the attribute's own metadata, `= [...] ( interpolation = "faceVarying" )`, belongs to it and not to the prim
    let after = end
    while (after < text.length && (text[after] === " " || text[after] === "\t")) after += 1
    if (text[after] !== "(") return { kind: "assign", end, body: true, primType: "", name: "", key, value }
    const close = matching(text, after, "(", ")")
    return {
        kind: "assign",
        end: close + 1,
        body: true,
        primType: "",
        name: "",
        key,
        value,
        meta: text.slice(after + 1, close),
    }
}

/** The index just past the string starting at `at`, or -1 when there is none. Handles `'''`, `"""`, `"`, `'` and `@`. */
function stringAt(text: string, at: number): number {
    for (const fence of ['"""', "'''"]) {
        if (text.startsWith(fence, at)) {
            const close = text.indexOf(fence, at + fence.length)
            return close === -1 ? text.length : close + fence.length
        }
    }
    const character = text[at]
    if (character === '"' || character === "'" || character === "@") {
        // `@@@...@@@` is USD's escape for an asset path holding an `@`
        if (character === "@" && text.startsWith("@@@", at)) {
            const close = text.indexOf("@@@", at + 3)
            return close === -1 ? text.length : close + 3
        }
        let scan = at + 1
        while (scan < text.length) {
            if (text[scan] === "\\") scan += 2
            else if (text[scan] === character) return scan + 1
            else scan += 1
        }
        return text.length
    }
    return -1
}

/** The index of the bracket closing the one at `open`, with strings skipped. */
function matching(text: string, open: number, start: string, close: string): number {
    let depth = 0
    let at = open
    while (at < text.length) {
        const quote = stringAt(text, at)
        if (quote !== -1 && at !== open) {
            at = quote
            continue
        }
        if (text[at] === "#") {
            at = lineEnd(text, at)
            continue
        }
        if (text[at] === start) depth += 1
        else if (text[at] === close) {
            depth -= 1
            if (depth === 0) return at
        }
        at += 1
    }
    return text.length
}

function lineEnd(text: string, at: number): number {
    const index = text.indexOf("\n", at)
    return index === -1 ? text.length : index + 1
}

function lineStart(text: string, at: number): number {
    const index = text.lastIndexOf("\n", at)
    return index === -1 ? 0 : index + 1
}

/** `a = 1\n b = "x"` as a record, for a metadata block. */
function parseAssignments(block: string): Record<string, string> {
    const out: Record<string, string> = {}
    let at = 0
    while (at < block.length) {
        const found = findPrimOrBrace(block, at)
        if (!found || found.kind !== "assign") break
        out[attributeName(found.key)] = found.value
        at = found.end
    }
    return out
}

/** `uniform token physics:axis` -> `physics:axis`: the declared type is not part of the name. */
function attributeName(key: string): string {
    const words = key.trim().split(/\s+/)
    return words[words.length - 1] ?? key
}

function defaultPrimName(text: string): string | null {
    const match = text.match(/\bdefaultPrim\s*=\s*["']([^"']+)["']/)
    return match ? match[1] : null
}

function walk(prims: Prim[], visit: (prim: Prim) => void): void {
    for (const prim of prims) {
        visit(prim)
        walk(prim.children, visit)
    }
}

// ---- prims as a robot -----------------------------------------------------

function isLink(prim: Prim): boolean {
    return (prim.meta["apiSchemas"] ?? "").includes(RIGID_BODY)
}

/** A prim's tf name: its displayName when it has one, since a prim name cannot hold a "/" or a "-". */
function frameName(prim: Prim): string {
    return prim.displayName ?? prim.name
}

function unquote(value: string): string {
    const match = value.trim().match(/^["'](.*)["']$/s)
    return match ? match[1] : value.trim()
}

function numbers(value: string | undefined): number[] {
    if (!value) return []
    return [...value.matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map((match) => Number(match[0]))
}

/** A prim's own transform: where it is, how it is turned, and how it is scaled, from its xformOpOrder. */
export interface Placement extends Origin {
    scale: [number, number, number]
}

const IDENTITY: Placement = { xyz: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] }

/** A prim's own transform, as the origin a URDF would state. */
function placementOf(prim: Prim): Origin {
    const { xyz, quat } = xformOf(prim)
    return { xyz, quat }
}

/** A prim's xformOps composed in xformOpOrder (first outermost), with scale kept innermost as the shape's size. */
export function xformOf(prim: Prim): Placement {
    const order = [...(prim.attrs["xformOpOrder"] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1])
    // a layer that states ops without an order (older dimos layers) is read in the usual one
    const ops = order.length > 0
        ? order
        : ["xformOp:transform", "xformOp:translate", "xformOp:orient", "xformOp:scale"].filter((op) => op in prim.attrs)
    let out: Placement = IDENTITY
    let scale: [number, number, number] = [1, 1, 1]
    for (const op of ops) {
        const inverse = op.startsWith("!invert!")
        const name = inverse ? op.slice(8) : op
        if (inverse || name === "!resetXformStack!") continue
        const placed = opPlacement(name, numbers(prim.attrs[name]))
        // a scale is the shape's size, innermost wherever it is listed: dimos lists it first, before the transform
        if (name.split(":")[1] === "scale") scale = placed.scale
        else out = composePlacement(out, placed)
    }
    return { ...out, scale: [out.scale[0] * scale[0], out.scale[1] * scale[1], out.scale[2] * scale[2]] }
}

function opPlacement(name: string, value: number[]): Placement {
    const kind = name.split(":")[1] ?? ""
    const degrees = Math.PI / 180
    const about = (axis: 0 | 1 | 2, angle: number): [number, number, number, number] => {
        const q: [number, number, number, number] = [0, 0, 0, Math.cos(angle * degrees / 2)]
        q[axis] = Math.sin(angle * degrees / 2)
        return q
    }
    if (kind === "translate" && value.length >= 3) return { ...IDENTITY, xyz: [value[0], value[1], value[2]] }
    // USD writes a quatf as (w, x, y, z); three wants (x, y, z, w).
    if (kind === "orient" && value.length >= 4) return { ...IDENTITY, quat: [value[1], value[2], value[3], value[0]] }
    if (kind === "scale") {
        return {
            ...IDENTITY,
            scale: value.length >= 3 ? [value[0], value[1], value[2]] : [value[0] ?? 1, value[0] ?? 1, value[0] ?? 1],
        }
    }
    if (kind === "rotateX" || kind === "rotateY" || kind === "rotateZ") {
        return { ...IDENTITY, quat: about("XYZ".indexOf(kind[6]) as 0 | 1 | 2, value[0] ?? 0) }
    }
    const rotation = kind.match(/^rotate([XYZ]{3})$/)
    if (rotation && value.length >= 3) {
        // rotateXYZ turns about X first, then Y, then Z: as a product the last axis is outermost
        let quat: [number, number, number, number] = [0, 0, 0, 1]
        for (const axis of rotation[1]) {
            const index = "XYZ".indexOf(axis) as 0 | 1 | 2
            quat = multiply(about(index, value[index]), quat)
        }
        return { ...IDENTITY, quat }
    }
    if (kind === "transform" && value.length >= 16) {
        // USD writes a matrix4d row by row, and the translation is its last row; each row's length is that axis' scale.
        const scale = [0, 1, 2].map((row) => Math.hypot(value[row * 4], value[row * 4 + 1], value[row * 4 + 2]) || 1)
        const unit = value.map((entry, index) =>
            index < 12 && index % 4 < 3 ? entry / scale[Math.floor(index / 4)] : entry
        )
        return {
            xyz: [value[12], value[13], value[14]],
            quat: quatFromRows(unit),
            scale: scale as [number, number, number],
        }
    }
    return IDENTITY
}

/** `parent` then `child`: the child's offset turned and scaled by the parent's, its scale times the parent's. */
function composePlacement(parent: Placement, child: Placement): Placement {
    const scaled: [number, number, number] = [
        child.xyz[0] * parent.scale[0],
        child.xyz[1] * parent.scale[1],
        child.xyz[2] * parent.scale[2],
    ]
    const turned = rotate(parent.quat, scaled)
    return {
        xyz: [parent.xyz[0] + turned[0], parent.xyz[1] + turned[1], parent.xyz[2] + turned[2]],
        quat: multiply(parent.quat, child.quat),
        scale: [parent.scale[0] * child.scale[0], parent.scale[1] * child.scale[1], parent.scale[2] * child.scale[2]],
    }
}

/** The rotation of a row-major 4x4 as (x, y, z, w). */
function quatFromRows(m: number[]): [number, number, number, number] {
    // the 3x3 in column-vector convention, which is the transpose of USD's rows
    const r = [
        [m[0], m[4], m[8]],
        [m[1], m[5], m[9]],
        [m[2], m[6], m[10]],
    ]
    const trace = r[0][0] + r[1][1] + r[2][2]
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2
        return [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, s / 4]
    }
    if (r[0][0] > r[1][1] && r[0][0] > r[2][2]) {
        const s = Math.sqrt(1 + r[0][0] - r[1][1] - r[2][2]) * 2
        return [s / 4, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s]
    }
    if (r[1][1] > r[2][2]) {
        const s = Math.sqrt(1 + r[1][1] - r[0][0] - r[2][2]) * 2
        return [(r[0][1] + r[1][0]) / s, s / 4, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s]
    }
    const s = Math.sqrt(1 + r[2][2] - r[0][0] - r[1][1]) * 2
    return [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, s / 4, (r[1][0] - r[0][1]) / s]
}

/** What a bound material says a surface looks like: UsdPreviewSurface's inputs, resolved through connections. */
interface Surface {
    color?: [number, number, number]
    /** the image its diffuseColor reads, when it reads one */
    texture?: string
    /** the primvar that image's coordinates come from (its UsdPrimvarReader_float2's varname) */
    coordinates?: string
    opacity?: number
    roughness?: number
    metallic?: number
    ior?: number
}

/** Every Material's surface by path, refilled per parse: a geom binds by absolute path from anywhere in the tree. */
const surfaces = new Map<string, Surface>()

/** Index a layer's materials for surfaceLook: the main description does it itself, a mesh layer's reader calls this. */
export function describeMaterials(roots: Prim[]): void {
    indexMaterials(roots)
}

function indexMaterials(roots: Prim[]): void {
    surfaces.clear()
    const byPath = new Map<string, Prim>()
    walk(roots, (prim) => byPath.set(pathOf(prim), prim))
    walk(roots, (prim) => {
        if (prim.type === "Material") surfaces.set(pathOf(prim), surfaceOf(prim, byPath))
    })
}

/** A material's surface: the shader its outputs:surface connects to (or the UsdPreviewSurface under it), read. */
function surfaceOf(material: Prim, byPath: Map<string, Prim>): Surface {
    const target = connectionOf(material.attrs["outputs:surface.connect"])
    let shader = target ? byPath.get(target.prim) : undefined
    walk([material], (prim) => {
        if (!shader && prim.type === "Shader" && unquote(prim.attrs["info:id"] ?? "") === "UsdPreviewSurface") {
            shader = prim
        }
    })
    if (!shader) {
        // a material with no shader states its colour on itself, as dimos's older layers do
        const own = numbers(material.attrs["inputs:color"])
        return own.length >= 3 ? { color: [own[0], own[1], own[2]] } : {}
    }
    const out: Surface = {}
    const diffuse = inputOf(shader, "inputs:diffuseColor", byPath)
    if (diffuse?.texture) {
        out.texture = diffuse.texture
        if (diffuse.coordinates) out.coordinates = diffuse.coordinates
        // the texture's scale multiplies what it reads, which is what three's colour does to a map
        const scale = diffuse.scale ?? []
        out.color = scale.length >= 3 ? [scale[0], scale[1], scale[2]] : [1, 1, 1]
    } else if (diffuse?.value && diffuse.value.length >= 3) {
        out.color = [diffuse.value[0], diffuse.value[1], diffuse.value[2]]
    }
    for (
        const [key, name] of [["opacity", "inputs:opacity"], ["roughness", "inputs:roughness"], [
            "metallic",
            "inputs:metallic",
        ], ["ior", "inputs:ior"]] as const
    ) {
        // the shader's own input, else the material's interface input of that name (MuJoCo's converter states them there)
        const value = inputOf(shader, name, byPath)?.value?.[0] ?? numbers(material.attrs[name])[0]
        if (value !== undefined && Number.isFinite(value)) out[key] = value
    }
    return out
}

/** `</a/b.inputs:color>` as the prim and the attribute it names. */
function connectionOf(value: string | undefined): { prim: string; attribute: string } | null {
    const path = (value ?? "").match(/<([^>]+)>/)?.[1]
    if (!path) return null
    const dot = path.lastIndexOf(".")
    return dot === -1 ? { prim: path, attribute: "" } : { prim: path.slice(0, dot), attribute: path.slice(dot + 1) }
}

/** A shader input's value, following its connection to a material's interface or a UsdUVTexture's file. */
function inputOf(
    prim: Prim,
    name: string,
    byPath: Map<string, Prim>,
    depth = 0,
): { value?: number[]; texture?: string; scale?: number[]; coordinates?: string } | null {
    const connection = connectionOf(prim.attrs[`${name}.connect`])
    if (connection && depth < 8) {
        const source = byPath.get(connection.prim)
        if (!source) return null
        if (unquote(source.attrs["info:id"] ?? "") === "UsdUVTexture" && connection.attribute.startsWith("outputs:")) {
            const file = (source.attrs["inputs:file"] ?? "").match(/@([^@]+)@/)?.[1]
            const coordinates = primvarRead(source, byPath)
            return file
                ? {
                    texture: file,
                    scale: numbers(source.attrs["inputs:scale"]),
                    ...(coordinates ? { coordinates } : {}),
                }
                : null
        }
        return inputOf(source, connection.attribute, byPath, depth + 1)
    }
    const value = prim.attrs[name]
    return value === undefined ? null : { value: numbers(value) }
}

/** The primvar a UsdUVTexture's `inputs:st` reads: its UsdPrimvarReader_float2's varname, through any interface input. */
function primvarRead(texture: Prim, byPath: Map<string, Prim>): string | undefined {
    const reader = connectionOf(texture.attrs["inputs:st.connect"])
    let at = reader ? byPath.get(reader.prim) : undefined
    let name = "inputs:varname"
    for (let depth = 0; at && depth < 8; depth++) {
        const next = connectionOf(at.attrs[`${name}.connect`])
        if (!next) {
            const value = at.attrs[name]
            return value === undefined ? undefined : unquote(value)
        }
        at = byPath.get(next.prim)
        name = next.attribute
    }
    return undefined
}

/** The material bound to a prim or, failing that, to the nearest ancestor that binds one. */
function boundSurface(prim: Prim): Surface | undefined {
    for (let at: Prim | undefined = prim; at; at = at.parent) {
        const bound = (at.attrs["material:binding"] ?? "").match(/<([^>]+)>/)
        if (bound) return surfaces.get(bound[1])
    }
    return undefined
}

/** The primvar a prim's bound material reads its texture's coordinates from, if it names one. */
export function textureCoordinates(prim: Prim): string | undefined {
    return boundSurface(prim)?.coordinates
}

/** How a geometry draws: its bound material wins over displayColor, as USD has it (displayColor is the no-material fallback). */
export function surfaceLook(prim: Prim): Partial<DescriptionGeometry> {
    const surface = boundSurface(prim)
    const shown = numbers(prim.attrs["primvars:displayColor"])
    const opacity = surface?.opacity ?? numbers(prim.attrs["primvars:displayOpacity"])[0] ?? 1
    const color = surface?.color ?? (shown.length >= 3 ? [shown[0], shown[1], shown[2]] : undefined)
    return {
        ...(color ? { color: [color[0], color[1], color[2], opacity] as [number, number, number, number] } : {}),
        ...(surface?.texture ? { texture: surface.texture } : {}),
        ...(surface?.roughness !== undefined ? { roughness: surface.roughness } : {}),
        ...(surface?.metallic !== undefined ? { metallic: surface.metallic } : {}),
        ...(surface?.ior !== undefined ? { ior: surface.ior } : {}),
    }
}

/**
 * The mesh file a geometry prim names, as the thing that can actually be fetched and drawn.
 *
 * `assetInfo` first, deliberately. dimos names the servable file there -- an STL or a DAE -- and
 * uses the reference arc, where it has one, for a `.usdc` sidecar carrying the same geometry so
 * the layer is valid USD for usdview, Isaac and MuJoCo. Reading the arc first asks for the
 * sidecar, which the mesh loader refuses ("unsupported mesh format .usdc") and nothing is drawn.
 * A layer with only an arc (a plain USD scene from elsewhere) still works: the arc is the
 * fallback.
 */
function meshPathOf(prim: Prim): string | null {
    return assetInfoPath(prim) ?? referenceOf(prim)
}

function referenceOf(prim: Prim): string | null {
    const value = prim.meta["references"]
    if (!value) return null
    const match = value.match(/@([^@]+)@/)
    return match ? match[1] : null
}

const SHAPES = new Set(["Mesh", "Cube", "Sphere", "Cylinder", "Plane"])

/** A prim that draws something: a gprim, or anything standing for a file of geometry (a reference arc, assetInfo). */
function isGeometry(prim: Prim): boolean {
    return SHAPES.has(prim.type) || meshPathOf(prim) !== null
}

/** Whether USD draws this prim: not invisible, and of a purpose a renderer shows (guides and proxies are not). */
export function rendered(prim: Prim): boolean {
    for (let at: Prim | undefined = prim; at; at = at.parent) {
        if (unquote(at.attrs["visibility"] ?? "") === "invisible") return false
        const purpose = unquote(at.attrs["purpose"] ?? "")
        if (purpose === "guide" || purpose === "proxy") return false
        if (purpose === "render" || purpose === "default") return true
    }
    return true
}

/** Every geometry prim and the link (or scene root) it moves with, however deep under that link it sits. */
function geometryPrims(roots: Prim[], sceneRoot: Prim | null): { prim: Prim; owner: Prim }[] {
    const out: { prim: Prim; owner: Prim }[] = []
    const visit = (prim: Prim, owner: Prim | null): void => {
        const here = isLink(prim) || prim === sceneRoot ? prim : owner
        if (prim !== here && isGeometry(prim)) {
            if (here) out.push({ prim, owner: here })
            return
        }
        if (prim.type in JOINT_TYPES || prim.type === "Material" || prim.type in LIGHT_TYPES) return
        for (const child of prim.children) visit(child, here)
    }
    for (const root of roots) visit(root, null)
    return out
}

/** The prim's placement relative to `owner`: every transform between them, composed. */
function placementUnder(prim: Prim, owner: Prim): Placement {
    const chain: Prim[] = []
    for (let at: Prim | undefined = prim; at && at !== owner; at = at.parent) chain.unshift(at)
    return chain.reduce((placed, at) => composePlacement(placed, xformOf(at)), IDENTITY)
}

function geometryOf(prim: Prim, owner: Prim): DescriptionGeometry | null {
    const { xyz, quat, scale } = placementUnder(prim, owner)
    const origin: Origin = { xyz, quat }
    const tint = surfaceLook(prim)
    const mesh = meshPathOf(prim)
    const uneven = scale.some((value) => Math.abs(value - 1) > 1e-9)
    if (prim.type === "Mesh" || mesh) {
        if (!mesh) return null
        return { type: "mesh", origin, mesh, ...(uneven ? { scale } : {}), ...tint }
    }
    // a size left unsaid is UsdGeom's schema default (pxr usdGeom/schema.usda: Cube size 2, radius 1, height 2, Plane 2 x 2)
    if (prim.type === "Cube") {
        // A Cube is a unit cube scaled to the box's extents: USD has no three-sided box.
        const size = numbers(prim.attrs["size"])[0] ?? 2
        return { type: "box", origin, size: [scale[0] * size, scale[1] * size, scale[2] * size], ...tint }
    }
    if (prim.type === "Sphere") {
        const radius = numbers(prim.attrs["radius"])[0] ?? 1
        return { type: "sphere", origin, radius: radius * scale[0], ...tint }
    }
    if (prim.type === "Cylinder") {
        const radius = numbers(prim.attrs["radius"])[0] ?? 1
        const height = numbers(prim.attrs["height"])[0] ?? 2
        return { type: "cylinder", origin, radius: radius * scale[0], length: height * scale[2], ...tint }
    }
    if (prim.type === "Plane") {
        // A Plane lies across its axis (Z unless it says otherwise): turned so its face is the shape's xy.
        const axis = unquote(prim.attrs["axis"] ?? "Z")
        const half = Math.SQRT1_2
        const turn: [number, number, number, number] = axis === "X"
            ? [0, half, 0, half]
            : axis === "Y"
            ? [-half, 0, 0, half]
            : [0, 0, 0, 1]
        const width = (numbers(prim.attrs["width"])[0] ?? 2) * scale[0]
        const length = (numbers(prim.attrs["length"])[0] ?? 2) * scale[1]
        return { type: "plane", origin: { xyz, quat: multiply(quat, turn) }, size: [width, length, 0], ...tint }
    }
    return null
}

/** Every joint: the ones authored as UsdPhysics prims, plus the welds and free joints nesting implies. */
function jointsOf(roots: Prim[], links: Prim[], sceneRoot: Prim | null): DescriptionJoint[] {
    const byPath = new Map<string, Prim>()
    walk(roots, (prim) => byPath.set(pathOf(prim), prim))
    const joints: DescriptionJoint[] = []
    walk(roots, (prim) => {
        const type = JOINT_TYPES[prim.type]
        if (!type) return
        const joint = jointOf(prim, type === "floating" ? freeKind(prim) : type, byPath)
        if (joint) joints.push(joint)
    })
    const claimed = new Set(joints.map((joint) => joint.child))
    // A link that something hangs off is the root of an articulated thing, and a robot's root is placed by tf.
    // Welding it to the room as well would give it two parents, which tf does not allow: its pose then flips
    // between the weld and whatever tf says, which is a robot whose body and pelvis come apart.
    const articulated = new Set(joints.map((joint) => joint.parent))
    for (const prim of links) {
        const name = frameName(prim)
        if (claimed.has(name) || articulated.has(name)) continue
        const ancestor = linkAncestor(prim, sceneRoot)
        if (!ancestor) continue
        joints.push(impliedJoint(prim, ancestor, name))
    }
    return joints
}

function jointOf(
    prim: Prim,
    type: DescriptionJoint["type"],
    byPath: Map<string, Prim>,
): DescriptionJoint | null {
    const parent = bodyName(prim.attrs["physics:body0"], byPath)
    const child = bodyName(prim.attrs["physics:body1"], byPath)
    if (!parent || !child) return null
    const position = numbers(prim.attrs["physics:localPos0"])
    // localRot1 is the rotation that took +z onto the real axis; localRot0 is that with the joint's own origin in front.
    const rot0 = quatOf(prim.attrs["physics:localRot0"])
    const rot1 = quatOf(prim.attrs["physics:localRot1"])
    const lower = numbers(prim.attrs["physics:lowerLimit"])[0]
    const upper = numbers(prim.attrs["physics:upperLimit"])[0]
    const limited = lower !== undefined && upper !== undefined
    // A revolute limit is degrees in USD and radians in URDF; a revolute joint with no limit is continuous.
    const scale = type === "revolute" ? Math.PI / 180 : 1
    return {
        name: frameName(prim),
        type: type === "revolute" && !limited ? "continuous" : type,
        parent,
        child,
        origin: {
            xyz: [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0],
            quat: multiply(rot0, conjugate(rot1)),
        },
        axis: rotate(rot1, [0, 0, 1]),
        ...(limited ? { limit: [lower * scale, upper * scale] as [number, number] } : {}),
    }
}

/** floating, or planar when the axes out of one plane are locked. Read off the applied schemas, not metadata. */
function freeKind(prim: Prim): DescriptionJoint["type"] {
    const applied = prim.meta["apiSchemas"] ?? ""
    return OUT_OF_PLANE.every((axis) => applied.includes(`PhysicsLimitAPI:${axis}`)) ? "planar" : "floating"
}

/**
 * A nested link with no joint prim at all: welded.
 *
 * A USD conveys parent and child by nesting, and a joint prim only adds how the child moves. Every joint dimos
 * writes is a prim, floating and planar included, so this only fires for a layer written elsewhere that states
 * nothing but the hierarchy.
 */
function impliedJoint(prim: Prim, ancestor: Prim, name: string): DescriptionJoint {
    return {
        name: `${name}_weld`,
        type: "fixed",
        parent: frameName(ancestor),
        child: name,
        origin: placementOf(prim),
        axis: [0, 0, 1],
    }
}

function linkAncestor(prim: Prim, sceneRoot: Prim | null): Prim | null {
    let parent = prim.parent
    while (parent) {
        if (isLink(parent) || parent === sceneRoot) return parent
        parent = parent.parent
    }
    return null
}

/**
 * The layer's root prim, when it holds bodies but is not marked as one itself — otherwise null.
 *
 * A scene converted from MJCF has a body per desk and a plain Xform at the root, because MuJoCo's worldbody
 * carries no rigid body of its own. Read literally that makes every stick of furniture a body with no body above
 * it: nothing to weld to, so it can only be placed by a transform published under its own name, and nothing
 * publishes one per desk. The room then draws as the robots standing in it and nothing else.
 *
 * Taking the root as a frame gives the nesting back its meaning — one frame for the room, everything in it welded
 * to that, each at the transform it already carries. A layer whose root is already a body (every robot) has none
 * of this apply to it.
 */
function rootFrame(roots: Prim[], defaultPrim: string | null): Prim | null {
    const root = roots.find((prim) => prim.name === defaultPrim) ?? (roots.length === 1 ? roots[0] : null)
    if (!root || isLink(root)) return null
    let orphans = 0
    let loose = false
    walk(root.children, (prim) => {
        if (isLink(prim) && !linkAncestor(prim, null)) orphans += 1
        if (isGeometry(prim) && !linkAncestor(prim, null)) loose = true
    })
    // several unparented bodies, or shapes in no body at all, make a room: the root is the frame they stand in
    return orphans > 1 || loose ? root : null
}

function pathOf(prim: Prim): string {
    const parts: string[] = []
    let at: Prim | undefined = prim
    while (at) {
        parts.unshift(at.name)
        at = at.parent
    }
    return "/" + parts.join("/")
}

/** The link name a joint's body relationship points at. */
function bodyName(value: string | undefined, byPath: Map<string, Prim>): string {
    if (!value) return ""
    const match = value.match(/<([^>]+)>/)
    if (!match) return ""
    const prim = byPath.get(match[1])
    return prim ? frameName(prim) : ""
}

/** A `(real, i, j, k)` quaternion as (x, y, z, w); USD writes the real part first. */
function quatOf(value: string | undefined): [number, number, number, number] {
    const parts = numbers(value)
    if (parts.length < 4) return [0, 0, 0, 1]
    return [parts[1], parts[2], parts[3], parts[0]]
}

function conjugate(q: [number, number, number, number]): [number, number, number, number] {
    return [-q[0], -q[1], -q[2], q[3]]
}

function multiply(
    a: [number, number, number, number],
    b: [number, number, number, number],
): [number, number, number, number] {
    const [ax, ay, az, aw] = a
    const [bx, by, bz, bw] = b
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

function rotate(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
    const [x, y, z, w] = q
    const [vx, vy, vz] = v
    // v + 2 * cross(q.xyz, cross(q.xyz, v) + w * v)
    const tx = 2 * (y * vz - z * vy + w * vx)
    const ty = 2 * (z * vx - x * vz + w * vy)
    const tz = 2 * (x * vy - y * vx + w * vz)
    return [
        vx + (y * tz - z * ty),
        vy + (z * tx - x * tz),
        vz + (x * ty - y * tx),
    ]
}

/** Omniverse's `/rtx/post/tonemap/op` enum. Their docs give 4 for ACES; 5 is accepted too because
 *  the operator list is ordered differently between versions. Clamp and Linear are the only others
 *  with a three equivalent, and the rest fall through to the layer's own spelling. */
const RTX_TONEMAP_OPS: Record<number, NonNullable<DescriptionLook["toneMap"]>> = {
    0: "none",
    1: "linear",
    4: "filmic",
    5: "filmic",
}

/** The tone curves a layer may name, for the two curves Omniverse's operator list has no number for. */
const TONE_MAPS: Record<string, NonNullable<DescriptionLook["toneMap"]>> = {
    // what Blender puts on by default, so a scene authored to look right there can ask for it by name
    agx: "agx",
    neutral: "neutral",
    filmic: "filmic",
    aces: "filmic",
    acesfilmic: "filmic",
    linear: "linear",
    none: "none",
}

/**
 * The exposure the stage asks to be viewed at, as a plain multiplier.
 *
 * USD puts exposure on the camera rather than on the render settings, because that is where it
 * belongs: a stage is lit in physical units and a camera decides how much of that reaches the
 * image. `UsdGeomCamera.exposure` is a log base-2 compensation -- 0 leaves it alone, +1 doubles
 * the image-plane intensities -- and core USD and Isaac's OmniRtxCameraExposureAPI_1 both put the
 * physical rig next to it: `exposure:iso`, `exposure:time`, `exposure:fStop`, `exposure:responsivity`,
 * combined as responsivity * (time * iso/100 * 2^exposure) / fStop^2. At their defaults that is 1,
 * so a camera naming none of them changes nothing and doubling the ISO doubles the image.
 *
 * Which camera: UsdRender has the render settings point at one (`rel camera = </World/Camera>`),
 * so follow that where it is given, and otherwise take the stage's only one.
 */
function cameraExposure(roots: Prim[], settings: Prim | undefined): number | undefined {
    const linked = (settings?.attrs["camera"] ?? "").match(/<([^>]+)>/)?.[1]?.split("/").pop()
    const cameras: Prim[] = []
    walk(roots, (prim) => {
        if (prim.type === "Camera") {
            cameras.push(prim)
        }
    })
    const camera = cameras.find((prim) => prim.name === linked) ?? cameras[0]
    if (camera === undefined) {
        return undefined
    }
    const attr = (name: string): number | undefined => {
        const raw = camera.attrs[name]
        if (raw === undefined) {
            return undefined
        }
        const value = Number(unquote(raw))
        return Number.isFinite(value) ? value : undefined
    }
    const stops = attr("exposure")
    const iso = attr("exposure:iso")
    const time = attr("exposure:time")
    const fStop = attr("exposure:fStop")
    const responsivity = attr("exposure:responsivity")
    if ([stops, iso, time, fStop, responsivity].every((value) => value === undefined)) {
        return undefined // a camera that says nothing about exposure is not a look
    }
    const aperture = fStop ?? 1
    return (responsivity ?? 1) * ((time ?? 1) * ((iso ?? 100) / 100) * Math.pow(2, stops ?? 0)) /
        (aperture * aperture)
}

/**
 * The look the layer asks for, from a `RenderSettings` prim.
 *
 * A scene that knows how it is lit also knows how it wants to be shown, and the two are one decision: the
 * furniture colours in office_555 were picked against a particular tone curve, so a viewer that applies a
 * different one shows a room nobody chose. Reading it lets the layer say instead.
 *
 * Everything here is optional. A layer naming none of it, or no RenderSettings prim at all, leaves the
 * viewer's own look alone.
 */
function lookOf(roots: Prim[]): DescriptionLook | undefined {
    const matches: Prim[] = []
    walk(roots, (prim) => {
        if (matches.length > 0) return
        // Omniverse hangs these on a prim as applied API schemas rather than giving it a type, so a
        // stage from Isaac is recognised by carrying the attributes at all.
        if (prim.type === "RenderSettings" || Object.keys(prim.attrs).some((k) => k.startsWith("omni:rtx:"))) {
            matches.push(prim)
        }
    })
    const settings = matches[0]
    if (settings === undefined) {
        const exposure = cameraExposure(roots, undefined)
        return exposure === undefined ? undefined : { exposure }
    }
    const attr = (name: string): number | undefined => {
        const raw = settings.attrs[name]
        if (raw === undefined) return undefined
        const value = Number(unquote(raw))
        return Number.isFinite(value) ? value : undefined
    }
    const flag = (name: string): boolean | undefined => {
        const raw = settings.attrs[name]
        return raw === undefined ? undefined : unquote(raw) !== "0" && unquote(raw) !== "false"
    }

    // Omniverse's spelling first, so a stage authored in Isaac reads here without being rewritten;
    // ours only where theirs has no equivalent.
    const op = attr("omni:rtx:post:tonemap:op")
    const named = unquote(settings.attrs["dimos:look:toneMap"] ?? "").toLowerCase()
    const occlusionOn = flag("omni:rtx:ambientOcclusion:enabled")
    const look: DescriptionLook = {
        toneMap: (op !== undefined ? RTX_TONEMAP_OPS[op] : undefined) ?? TONE_MAPS[named],
        // the camera's, in USD's own spelling, before our flat multiplier
        exposure: cameraExposure(roots, settings) ?? attr("dimos:look:exposure"),
        environmentIntensity: attr("dimos:look:environmentIntensity"),
        occlusion: occlusionOn === undefined ? attr("dimos:look:occlusion") : (occlusionOn ? 1 : 0),
        // /rtx/ambientOcclusion/rayLength: how far the occlusion reaches, in scene units, which is
        // exactly what the GTAO pass means by radius.
        occlusionRadius: attr("omni:rtx:ambientOcclusion:rayLength"),
        saturation: attr("dimos:look:saturation"),
        contrast: attr("dimos:look:contrast"),
    }
    return Object.values(look).some((value) => value !== undefined) ? look : undefined
}

/** USD light prims, by their schema name. A layer that names none leaves the viewer's own lighting in place. */
const LIGHT_TYPES: Record<string, DescriptionLight["type"]> = {
    DistantLight: "distant",
    SphereLight: "point",
    DiskLight: "disk",
    RectLight: "rect",
    DomeLight: "dome",
}

/**
 * Every light the layer carries, in world space.
 *
 * A scene knows how it is lit -- office_555 names a sun and eighteen ceiling fittings -- and a renderer told none
 * of it has to invent some, which in practice is a flat ambient fill leaving every surface the same shade. Reading
 * them lets the layer say instead.
 *
 * World space, because a light is placed by composing the transforms above it and the viewer adds it to the scene
 * rather than to the link it was authored under: a lamp bolted to a moving body is rare, and lighting the common
 * case is worth more than following one around.
 */
function lightsOf(roots: Prim[]): DescriptionLight[] {
    const found: DescriptionLight[] = []
    const visit = (prim: Prim, parent: Origin): void => {
        const here = compose(parent, placementOf(prim))
        const type = LIGHT_TYPES[prim.type]
        if (type) {
            const light = lightOf(prim, type, here)
            if (light) found.push(light)
        }
        for (const child of prim.children) visit(child, here)
    }
    for (const root of roots) visit(root, { xyz: [0, 0, 0], quat: [0, 0, 0, 1] })
    return found
}

/** UsdLux's schema defaults for what a light leaves unsaid (pxr usdLux/schema.usda) */
export const LIGHT_DEFAULTS: Record<string, number> = {
    "inputs:intensity": 1,
    "inputs:exposure": 0,
    "inputs:angle": 0.53,
    "inputs:width": 1,
    "inputs:height": 1,
    "inputs:radius": 0.5,
}

function lightOf(prim: Prim, type: DescriptionLight["type"], world: Origin): DescriptionLight | null {
    // the inputs: spelling, else the pre-21.05 one without it
    const raw = (name: string) => prim.attrs[name] ?? prim.attrs[name.replace(/^inputs:/, "")]
    const value = (name: string): number => {
        const parsed = Number(unquote(raw(name) ?? ""))
        return raw(name) !== undefined && Number.isFinite(parsed) ? parsed : LIGHT_DEFAULTS[name]
    }
    const flag = (name: string, fallback: boolean): boolean => {
        const text = raw(name)
        return text === undefined ? fallback : unquote(text) !== "0" && unquote(text) !== "false"
    }
    const intensity = value("inputs:intensity")
    if (!(intensity > 0)) return null
    const colour = numbers(raw("inputs:color"))
    // A light shines down its own -Z; where that points once the transforms above it are applied is its direction.
    const direction = rotate(world.quat, [0, 0, -1])
    const texture = (raw("inputs:texture:file") ?? "").match(/@([^@]+)@/)?.[1]
    return {
        name: frameName(prim),
        type,
        xyz: world.xyz,
        quat: world.quat,
        direction,
        color: colour.length >= 3 ? [colour[0], colour[1], colour[2]] : [1, 1, 1],
        intensity,
        exposure: value("inputs:exposure"),
        normalize: flag("inputs:normalize", false),
        shadow: flag("inputs:shadow:enable", true),
        ...(type === "distant" ? { angle: value("inputs:angle") } : {}),
        ...(type === "rect" ? { width: value("inputs:width"), height: value("inputs:height") } : {}),
        ...(type === "disk" || type === "point" ? { radius: value("inputs:radius") } : {}),
        ...(texture ? { texture } : {}),
    }
}

/** `parent` then `child`, as one place in the world. Scale is not composed: a light has no size to scale. */
function compose(parent: Origin, child: Origin): Origin {
    const turned = rotate(parent.quat, child.xyz)
    return {
        xyz: [parent.xyz[0] + turned[0], parent.xyz[1] + turned[1], parent.xyz[2] + turned[2]],
        quat: multiply(parent.quat, child.quat),
    }
}
