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
// Composition: internal arcs, sublayers (the caller fetches them), variants and PointInstancers; over/class/inactive prims are not drawn.
import * as THREE from "three"
import { inlineMeshGeometry } from "./usd_mesh.ts"
import type {
    DescriptionCamera,
    DescriptionGeometry,
    DescriptionJoint,
    DescriptionLight,
    DescriptionLink,
    DescriptionLook,
    DescriptionTexture,
    Origin,
    RobotDescription,
    TextureSlot,
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
    /** `over` or `class` (absent: `def`): neither is drawn unless composition gives it a def */
    specifier?: "over" | "class"
}

/** A stage's own units: metres per unit (UsdGeom's metersPerUnit) and which axis is up. */
export interface StageMetrics {
    metersPerUnit?: number
    upAxis?: "Y" | "Z"
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
export function parseUsda(text: string, options: { layers?: ReadonlyMap<string, string> } = {}): RobotDescription {
    if (!isUsda(text)) {
        throw new Error("not a USD layer: no #usda header")
    }
    const roots = withSublayers(parsePrims(text), text, options.layers ?? new Map())
    return describe(roots, defaultPrimName(text), stageMetrics(text))
}

/** The layers a layer's `subLayers` names, strongest first, as authored: the caller fetches them for parseUsda. */
export function usdaSublayers(text: string): string[] {
    const listed = layerMetadata(text)["subLayers"] ?? ""
    return [...listed.matchAll(/@([^@]+)@/g)].map((match) => match[1])
}

/** The header's metersPerUnit and upAxis, where it states them. */
export function stageMetrics(text: string): StageMetrics {
    const header = layerMetadata(text)
    const metres = Number(header["metersPerUnit"])
    const up = unquote(header["upAxis"] ?? "")
    return {
        ...(header["metersPerUnit"] !== undefined && metres > 0 ? { metersPerUnit: metres } : {}),
        ...(up === "Y" || up === "Z" ? { upAxis: up } : {}),
    }
}

/** A layer's sublayers composed under it, each weaker than the one before (and their own sublayers under them). */
function withSublayers(roots: Prim[], text: string, layers: ReadonlyMap<string, string>, depth = 0): Prim[] {
    for (const path of usdaSublayers(text)) {
        const sub = layers.get(path)
        if (sub === undefined || depth > 8) continue
        const weaker = isUsda(sub) ? withSublayers(parsePrims(sub), sub, layers, depth + 1) : []
        for (const prim of weaker) {
            const strong = roots.find((root) => root.name === prim.name)
            if (strong) mergeInto(strong, prim, (value) => value)
            else roots.push(prim)
        }
    }
    return roots
}

/** The prims of a layer (text or crate) as a RobotDescription, in metres and Z-up. */
export function describe(roots: Prim[], defaultPrim: string | null, metrics: StageMetrics = {}): RobotDescription {
    composePrims(roots)
    indexMaterials(roots)
    const links: DescriptionLink[] = []
    const prims: Prim[] = []
    const sceneRoot = rootFrame(roots, defaultPrim)
    const shapes = new Map<
        Prim,
        { visuals: DescriptionGeometry[]; collisions: DescriptionGeometry[]; drawable: DescriptionGeometry[] }
    >()
    walkDrawn(roots, (prim) => {
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
    const settings = renderSettingsOf(roots)
    return inMetresZUp({
        name: defaultPrim ?? roots[0]?.name ?? "robot",
        base_link: root,
        base_frame: root,
        base_pose: { xyz: [0, 0, 0], quat: [0, 0, 0, 1] },
        joint_names: joints.filter((joint) => joint.type !== "fixed" && !joint.mimic).map((joint) => joint.name),
        links,
        joints,
        lights: lightsOf(roots, sceneRoot),
        look: lookOf(roots, settings),
        cameras: camerasOf(roots, sceneRoot, settings),
    }, metrics)
}

/** In metres and Z-up: lengths times metersPerUnit (unauthored: 1, as dimos's layers are), a Y-up stage turned at its roots. */
function inMetresZUp(description: RobotDescription, metrics: StageMetrics): RobotDescription {
    const unit = metrics.metersPerUnit ?? 1
    const turn: [number, number, number, number] = metrics.upAxis === "Y"
        ? [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
        : [0, 0, 0, 1]
    if (unit === 1 && turn[3] === 1) return description
    const length = (value: number | undefined) => value === undefined ? undefined : value * unit
    const v3 = (
        value: [number, number, number],
    ): [number, number, number] => [value[0] * unit, value[1] * unit, value[2] * unit]
    const turned = (origin: Origin): Origin => ({ xyz: rotate(turn, origin.xyz), quat: multiply(turn, origin.quat) })
    const children = new Set(description.joints.map((joint) => joint.child))
    const roots = new Set(description.links.filter((link) => !children.has(link.name)).map((link) => link.name))
    const geometry = (item: DescriptionGeometry, root: boolean): DescriptionGeometry => {
        const origin = { xyz: v3(item.origin.xyz), quat: item.origin.quat }
        const out: DescriptionGeometry = { ...item, origin: root ? turned(origin) : origin }
        if (item.size) out.size = v3(item.size)
        if (item.radius !== undefined) out.radius = length(item.radius)
        if (item.length !== undefined) out.length = length(item.length)
        // a mesh's points are in the stage's units too: its scale carries the conversion
        if (item.type === "mesh") out.scale = v3(item.scale ?? [1, 1, 1])
        return out
    }
    const placed = <
        T extends {
            xyz: [number, number, number]
            quat?: [number, number, number, number]
            origin?: Origin
            link?: string
        },
    >(
        item: T,
    ): T => {
        const quat = multiply(turn, item.quat ?? [0, 0, 0, 1])
        const origin = item.origin
            ? (item.link !== undefined && roots.has(item.link) ? turned : (o: Origin) => o)({
                xyz: v3(item.origin.xyz),
                quat: item.origin.quat,
            })
            : undefined
        return { ...item, xyz: rotate(turn, v3(item.xyz)), quat, ...(origin ? { origin } : {}) }
    }
    return {
        ...description,
        links: description.links.map((link) => ({
            ...link,
            visuals: link.visuals.map((item) => geometry(item, roots.has(link.name))),
            collisions: link.collisions.map((item) => geometry(item, roots.has(link.name))),
        })),
        joints: description.joints.map((joint) => {
            const origin = { xyz: v3(joint.origin.xyz), quat: joint.origin.quat }
            const limit = joint.type === "prismatic" && joint.limit
                ? { limit: [joint.limit[0] * unit, joint.limit[1] * unit] as [number, number] }
                : {}
            return { ...joint, origin: roots.has(joint.parent) ? turned(origin) : origin, ...limit }
        }),
        lights: description.lights?.map((light) => ({
            ...placed(light),
            direction: rotate(turn, light.direction),
            ...(light.width !== undefined ? { width: length(light.width) } : {}),
            ...(light.height !== undefined ? { height: length(light.height) } : {}),
            ...(light.radius !== undefined ? { radius: length(light.radius) } : {}),
            ...(light.length !== undefined ? { length: length(light.length) } : {}),
        })),
        cameras: description.cameras?.map((camera) => ({
            ...placed(camera),
            quat: multiply(turn, camera.quat),
            clippingRange: [camera.clippingRange[0] * unit, camera.clippingRange[1] * unit] as [number, number],
        })),
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
                ...(token.specifier !== "def" ? { specifier: token.specifier } : {}),
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
    | { kind: "def"; specifier: "def" | "over" | "class"; primType: string; name: string; meta?: string }
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
                specifier: next.specifier ?? "def",
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
    specifier?: "def" | "over" | "class"
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
        specifier: words[0] === "over" ? "over" : words[0] === "class" ? "class" : "def",
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

/** The layer's own `( ... )` block after `#usda`, by key. */
function layerMetadata(text: string): Record<string, string> {
    const header = text.indexOf("(")
    if (header === -1 || !/^\s*#usda[^\n]*\n\s*$/.test(text.slice(0, header))) return {}
    return parseAssignments(text.slice(header + 1, matching(text, header, "(", ")")))
}

function walk(prims: Prim[], visit: (prim: Prim) => void): void {
    for (const prim of prims) {
        visit(prim)
        walk(prim.children, visit)
    }
}

/** walk, over only what USD draws: defined (no `over`/`class` left), active, and not a PointInstancer's prototype. */
function walkDrawn(prims: Prim[], visit: (prim: Prim) => void): void {
    for (const prim of prims) {
        if (!drawnItself(prim)) continue
        visit(prim)
        walkDrawn(prim.children, visit)
    }
}

/** Prototypes a PointInstancer draws copies of: the prims themselves are not drawn where they stand. */
const prototypes = new WeakSet<Prim>()

function drawnItself(prim: Prim): boolean {
    return !prim.specifier && unquote(prim.meta["active"] ?? "") !== "false" && !prototypes.has(prim)
}

/** Whether USD's default traversal reaches this prim: it and every ancestor defined, active and not a prototype. */
export function defined(prim: Prim): boolean {
    for (let at: Prim | undefined = prim; at; at = at.parent) {
        if (!drawnItself(at)) return false
    }
    return true
}

// ---- composition -------------------------------------------------------------

const composedRoots = new WeakSet<Prim[]>()
const ARCS = ["references", "payload", "inherits", "specializes"]

/** Internal arcs (`</path>` references, payloads, inherits, specializes) composed in weaker than the prim's own, then PointInstancers expanded. */
export function composePrims(roots: Prim[]): Prim[] {
    if (composedRoots.has(roots)) return roots
    composedRoots.add(roots)
    const byPath = new Map<string, Prim>()
    walk(roots, (prim) => byPath.set(pathOf(prim), prim))
    const done = new Set<Prim>()
    const visiting = new Set<Prim>()
    const compose = (prim: Prim): void => {
        if (done.has(prim) || visiting.has(prim)) return
        visiting.add(prim)
        const here = pathOf(prim)
        for (const arc of ARCS) {
            for (const target of internalTargets(prim.meta[arc])) {
                const source = byPath.get(target)
                // an arc to itself or to an ancestor would compose without end
                if (!source || here === target || here.startsWith(`${target}/`)) continue
                compose(source)
                mergeInto(prim, source, pathRewrite(target, here))
            }
        }
        visiting.delete(prim)
        done.add(prim)
        for (const child of prim.children) compose(child)
    }
    roots.forEach(compose)
    walk(roots, (prim) => {
        if (prim.type === "PointInstancer") expandInstancer(prim, byPath)
    })
    return roots
}

/** The prim paths an arc names in this layer: `</a/b>`, not `@file@</a/b>` (another file's) or `@file@`. */
function internalTargets(value: string | undefined): string[] {
    if (!value) return []
    const local = value.replace(/@[^@]*@\s*(<[^>]*>)?/g, "")
    return [...local.matchAll(/<([^>]+)>/g)].map((match) => match[1])
}

/** Every `<from...>` in a value pointed at the same place under `to` instead. */
function pathRewrite(from: string, to: string): (value: string) => string {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`<${escaped}(?=[/.>\\[])`, "g")
    return (value) => value.replace(pattern, `<${to}`)
}

/** `source`'s opinions under `dest`'s: what dest says wins, children of the same name merge, the rest are copied in. */
function mergeInto(dest: Prim, source: Prim, rewrite: (value: string) => string): void {
    if (!dest.type) dest.type = source.type
    // the composed specifier is the strongest defining one: an over on a def is a def
    if (dest.specifier === "over" && source.specifier !== "over") {
        if (source.specifier) dest.specifier = source.specifier
        else delete dest.specifier
    }
    dest.displayName ??= source.displayName
    for (const [key, value] of Object.entries(source.meta)) {
        if (ARCS.includes(key) && internalTargets(value).length) continue
        if (key === "apiSchemas" && dest.meta[key] !== undefined) {
            const names = new Set([...`${dest.meta[key]} ${value}`.matchAll(/"([^"]+)"/g)].map((match) => match[1]))
            dest.meta[key] = `[${[...names].map((name) => `"${name}"`).join(", ")}]`
        } else {
            dest.meta[key] ??= rewrite(value)
        }
    }
    for (const [key, value] of Object.entries(source.attrs)) dest.attrs[key] ??= rewrite(value)
    if (source.values) {
        dest.values ??= {}
        for (const [key, value] of Object.entries(source.values)) dest.values[key] ??= value
    }
    for (const child of source.children) {
        const mine = dest.children.find((each) => each.name === child.name)
        if (mine) mergeInto(mine, child, rewrite)
        else dest.children.push(clonePrim(child, dest, rewrite))
    }
}

/** A deep copy of a prim under `parent`, its paths rewritten, its internal arcs already composed into it. */
function clonePrim(prim: Prim, parent: Prim | undefined, rewrite: (value: string) => string): Prim {
    const meta: Record<string, string> = {}
    for (const [key, value] of Object.entries(prim.meta)) {
        if (!(ARCS.includes(key) && internalTargets(value).length)) meta[key] = rewrite(value)
    }
    const attrs: Record<string, string> = {}
    for (const [key, value] of Object.entries(prim.attrs)) attrs[key] = rewrite(value)
    const copy: Prim = {
        type: prim.type,
        name: prim.name,
        meta,
        attrs,
        children: [],
        ...(parent ? { parent } : {}),
        ...(prim.displayName !== undefined ? { displayName: prim.displayName } : {}),
        ...(prim.specifier ? { specifier: prim.specifier } : {}),
        ...(prim.values ? { values: { ...prim.values } } : {}),
    }
    copy.children = prim.children.map((child) => clonePrim(child, copy, rewrite))
    return copy
}

/** An attribute as numbers: a crate's typed value as it is stored, else the text's. */
function numbersIn(prim: Prim, name: string): ArrayLike<number> {
    const value = prim.values?.[name]
    if (value instanceof Float32Array || value instanceof Float64Array || value instanceof Int32Array) return value
    if (Array.isArray(value) && value.every((item) => typeof item === "number")) return value as number[]
    if (value && typeof value === "object" && "values" in value) return (value as { values: ArrayLike<number> }).values
    return numbers(prim.attrs[name])
}

/** A quaternion array as (x, y, z, w) each: a crate stores them so, a text layer writes (w, x, y, z). */
function quatsIn(prim: Prim, name: string): number[] {
    const stored = prim.values?.[name]
    const raw = Array.from(numbersIn(prim, name))
    if (stored && typeof stored === "object" && "shape" in stored) return raw
    const out: number[] = []
    for (let index = 0; index + 3 < raw.length; index += 4) {
        out.push(raw[index + 1], raw[index + 2], raw[index + 3], raw[index])
    }
    return out
}

/** A PointInstancer's instances as Xforms holding a copy of their prototype, which is then not drawn where it stands. */
function expandInstancer(instancer: Prim, byPath: Map<string, Prim>): void {
    const targets = [...(instancer.attrs["prototypes"] ?? "").matchAll(/<([^>]+)>/g)].map((match) => match[1])
    const protos = targets.map((path) => byPath.get(path))
    protos.forEach((proto) => proto && prototypes.add(proto))
    const indices = numbersIn(instancer, "protoIndices")
    const positions = numbersIn(instancer, "positions")
    const orientations = quatsIn(instancer, "orientations")
    const scales = numbersIn(instancer, "scales")
    const ids = numbersIn(instancer, "ids")
    const hidden = new Set(Array.from(numbersIn(instancer, "invisibleIds")))
    const here = pathOf(instancer)
    const matrix = new THREE.Matrix4()
    for (let index = 0; index < indices.length; index++) {
        const proto = protos[indices[index]]
        if (!proto || hidden.has(ids.length ? ids[index] : index)) continue
        const name = `instance_${index}`
        matrix.compose(
            new THREE.Vector3(positions[index * 3] ?? 0, positions[index * 3 + 1] ?? 0, positions[index * 3 + 2] ?? 0),
            orientations.length >= index * 4 + 4
                ? new THREE.Quaternion(...orientations.slice(index * 4, index * 4 + 4))
                : new THREE.Quaternion(),
            scales.length >= index * 3 + 3
                ? new THREE.Vector3(scales[index * 3], scales[index * 3 + 1], scales[index * 3 + 2])
                : new THREE.Vector3(1, 1, 1),
        )
        const placed: Prim = {
            type: "Xform",
            name,
            meta: {},
            attrs: { "xformOp:transform": matrixText(matrix), "xformOpOrder": `["xformOp:transform"]` },
            children: [],
            parent: instancer,
        }
        const copy = clonePrim(proto, placed, pathRewrite(pathOf(proto), `${here}/${name}/${proto.name}`))
        delete copy.specifier
        placed.children.push(copy)
        instancer.children.push(placed)
    }
}

/** A three matrix as USD writes a matrix4d: row by row, the translation last (three's column-major elements, in order). */
function matrixText(matrix: THREE.Matrix4): string {
    const e = matrix.elements
    return `( ${[0, 1, 2, 3].map((row) => `(${e.slice(row * 4, row * 4 + 4).join(", ")})`).join(", ")} )`
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

/** A prim's xformOps composed in xformOpOrder (first outermost), as where it is, how it is turned and how scaled. */
export function xformOf(prim: Prim): Placement {
    return decompose(localMatrix(prim).matrix)
}

/** A prim's xformOps as one matrix (first listed outermost, `!invert!` inverted), and whether it has `!resetXformStack!`. */
export function localMatrix(prim: Prim): { matrix: THREE.Matrix4; resets: boolean } {
    const order = [...(prim.attrs["xformOpOrder"] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1])
    // a layer that states ops without an order (older dimos layers) is read in the usual one
    const ops = order.length > 0
        ? order
        : ["xformOp:transform", "xformOp:translate", "xformOp:orient", "xformOp:scale"].filter((op) => op in prim.attrs)
    const matrix = new THREE.Matrix4()
    let resets = false
    for (const op of ops) {
        if (op === "!resetXformStack!") {
            resets = true
            matrix.identity()
            continue
        }
        const inverse = op.startsWith("!invert!")
        const name = inverse ? op.slice(8) : op
        const value = Array.from(numbersIn(prim, name))
        const one = opMatrix(name, value)
        matrix.multiply(inverse ? one.invert() : one)
    }
    return { matrix, resets }
}

function opMatrix(name: string, value: number[]): THREE.Matrix4 {
    const kind = name.split(":")[1] ?? ""
    const degrees = Math.PI / 180
    const out = new THREE.Matrix4()
    if (kind === "translate" && value.length >= 3) return out.makeTranslation(value[0], value[1], value[2])
    // USD writes a quatf as (w, x, y, z); three wants (x, y, z, w).
    if (kind === "orient" && value.length >= 4) {
        return out.makeRotationFromQuaternion(new THREE.Quaternion(value[1], value[2], value[3], value[0]).normalize())
    }
    if (kind === "scale") {
        return value.length >= 3
            ? out.makeScale(value[0], value[1], value[2])
            : out.makeScale(value[0] ?? 1, value[0] ?? 1, value[0] ?? 1)
    }
    if (kind === "rotateX") return out.makeRotationX((value[0] ?? 0) * degrees)
    if (kind === "rotateY") return out.makeRotationY((value[0] ?? 0) * degrees)
    if (kind === "rotateZ") return out.makeRotationZ((value[0] ?? 0) * degrees)
    const rotation = kind.match(/^rotate([XYZ]{3})$/)
    if (rotation && value.length >= 3) {
        // rotateXYZ turns about X first, then Y, then Z: as a product the last axis is outermost
        for (const axis of rotation[1]) {
            const index = "XYZ".indexOf(axis)
            const turn = new THREE.Matrix4()
            if (index === 0) turn.makeRotationX(value[0] * degrees)
            else if (index === 1) turn.makeRotationY(value[1] * degrees)
            else turn.makeRotationZ(value[2] * degrees)
            out.premultiply(turn)
        }
        return out
    }
    // USD writes a matrix4d row by row with the translation last: three's column-major elements in the same order
    if (kind === "transform" && value.length >= 16) return out.fromArray(value)
    return out
}

/** A matrix as a translation, rotation and scale (a shear, which a placement cannot hold, is dropped). */
function decompose(matrix: THREE.Matrix4): Placement {
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    matrix.decompose(position, rotation, scale)
    return {
        xyz: [position.x, position.y, position.z],
        quat: [rotation.x, rotation.y, rotation.z, rotation.w],
        scale: [scale.x, scale.y, scale.z],
    }
}

/** A prim's transform in the stage: every transform above it, down to (and with) its own, as USD composes them. */
export function worldMatrix(prim: Prim): THREE.Matrix4 {
    const chain: Prim[] = []
    for (let at: Prim | undefined = prim; at; at = at.parent) chain.unshift(at)
    return chain.reduce((placed, at) => {
        const { matrix, resets } = localMatrix(at)
        return resets ? matrix : placed.multiply(matrix)
    }, new THREE.Matrix4())
}

/** What a bound material says a surface looks like: UsdPreviewSurface's inputs, resolved through connections. */
interface Surface {
    color?: [number, number, number]
    /** the images its inputs read, by the input */
    textures: Partial<Record<TextureSlot, DescriptionTexture>>
    /** the primvar its diffuseColor reads (a UsdPrimvarReader_float3, usually displayColor), per vertex */
    colorPrimvar?: string
    opacity?: number
    roughness?: number
    metallic?: number
    ior?: number
    emissive?: [number, number, number]
    opacityThreshold?: number
    clearcoat?: number
    clearcoatRoughness?: number
    /** a UsdPreviewSurface, whose unstated inputs are its schema's defaults rather than nothing */
    preview: boolean
}

/** UsdPreviewSurface's scalar inputs and their schema defaults (pxr usdImaging/usdShaders shaderDefs) */
const PREVIEW_SCALARS = [
    ["opacity", "inputs:opacity", 1],
    ["roughness", "inputs:roughness", 0.5],
    ["metallic", "inputs:metallic", 0],
    ["ior", "inputs:ior", undefined],
    ["opacityThreshold", "inputs:opacityThreshold", 0],
    ["clearcoat", "inputs:clearcoat", 0],
    ["clearcoatRoughness", "inputs:clearcoatRoughness", 0.01],
] as const

/** the inputs that can read an image, and the slot it fills */
const TEXTURE_INPUTS: [TextureSlot, string][] = [
    ["diffuse", "inputs:diffuseColor"],
    ["emissive", "inputs:emissiveColor"],
    ["normal", "inputs:normal"],
    ["occlusion", "inputs:occlusion"],
    ["roughness", "inputs:roughness"],
    ["metallic", "inputs:metallic"],
    ["opacity", "inputs:opacity"],
    ["clearcoat", "inputs:clearcoat"],
    ["clearcoatRoughness", "inputs:clearcoatRoughness"],
]

/** Every Material's surface by path, refilled per parse: a geom binds by absolute path from anywhere in the tree. */
const surfaces = new Map<string, Surface>()
/** every prim by path, for the collections a binding names */
let primsByPath = new Map<string, Prim>()

/** Index a layer's materials for surfaceLook: the main description does it itself, a mesh layer's reader calls this. */
export function describeMaterials(roots: Prim[]): void {
    indexMaterials(roots)
}

function indexMaterials(roots: Prim[]): void {
    surfaces.clear()
    const byPath = new Map<string, Prim>()
    walk(roots, (prim) => byPath.set(pathOf(prim), prim))
    primsByPath = byPath
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
        return own.length >= 3
            ? { color: [own[0], own[1], own[2]], textures: {}, preview: false }
            : { textures: {}, preview: false }
    }
    const preview = unquote(shader.attrs["info:id"] ?? "") === "UsdPreviewSurface"
    const out: Surface = { textures: {}, preview }
    for (const [slot, name] of TEXTURE_INPUTS) {
        const texture = inputOf(shader, name, byPath)?.texture
        if (texture) out.textures[slot] = texture
    }
    const diffuse = inputOf(shader, "inputs:diffuseColor", byPath)
    if (diffuse?.texture) {
        // the texture's scale multiplies what it reads, which is what three's colour does to a map
        const scale = diffuse.texture.scale
        out.color = scale ? [scale[0], scale[1], scale[2]] : [1, 1, 1]
    } else if (diffuse?.primvar) {
        out.colorPrimvar = diffuse.primvar
    } else {
        const value = diffuse?.value ?? numbers(material.attrs["inputs:diffuseColor"])
        if (value.length >= 3) out.color = [value[0], value[1], value[2]]
        else if (preview) out.color = [0.18, 0.18, 0.18]
    }
    const emissive = inputOf(shader, "inputs:emissiveColor", byPath)
    const glow = emissive?.texture ? (emissive.texture.scale ?? [1, 1, 1]) : (emissive?.value ?? [])
    if (glow.length >= 3 && (glow[0] > 0 || glow[1] > 0 || glow[2] > 0)) out.emissive = [glow[0], glow[1], glow[2]]
    for (const [key, name, fallback] of PREVIEW_SCALARS) {
        const input = inputOf(shader, name, byPath)
        // a texture's scale, else the shader's input, else the material's own (MuJoCo puts them there), else the schema default
        const value = input?.texture
            ? (input.texture.scale?.[0] ?? 1)
            : input?.value?.[0] ?? numbers(material.attrs[name])[0] ??
                (preview ? fallback : undefined)
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

/** A shader input: its value, or (following its connection through any interface input) an image or a primvar. */
function inputOf(
    prim: Prim,
    name: string,
    byPath: Map<string, Prim>,
    depth = 0,
): { value?: number[]; texture?: DescriptionTexture; primvar?: string } | null {
    const connection = connectionOf(prim.attrs[`${name}.connect`])
    if (connection && depth < 8) {
        const source = byPath.get(connection.prim)
        if (!source) return null
        const id = unquote(source.attrs["info:id"] ?? "")
        if (id === "UsdUVTexture" && connection.attribute.startsWith("outputs:")) {
            const texture = textureOf(source, connection.attribute.slice(8), byPath)
            return texture ? { texture } : null
        }
        if (id.startsWith("UsdPrimvarReader") && connection.attribute.startsWith("outputs:")) {
            const primvar = stringInput(source, "inputs:varname", byPath)
            return primvar ? { primvar } : null
        }
        return inputOf(source, connection.attribute, byPath, depth + 1)
    }
    const value = prim.attrs[name]
    return value === undefined ? null : { value: numbers(value) }
}

/** A token or string input, followed through its connection to the interface input that states it. */
function stringInput(prim: Prim, name: string, byPath: Map<string, Prim>): string | undefined {
    let at: Prim | undefined = prim
    let attribute = name
    for (let depth = 0; at && depth < 8; depth++) {
        const next = connectionOf(at.attrs[`${attribute}.connect`])
        if (!next) {
            const value = at.attrs[attribute]
            return value === undefined ? undefined : unquote(value)
        }
        at = byPath.get(next.prim)
        attribute = next.attribute
    }
    return undefined
}

const WRAPS = new Set(["repeat", "mirror", "clamp", "black"])

/** A UsdUVTexture as the input reading `channel` of it sees it: its file, wrap, colour space, scale and bias, and st. */
function textureOf(texture: Prim, channel: string, byPath: Map<string, Prim>): DescriptionTexture | null {
    const file = (texture.attrs["inputs:file"] ?? "").match(/@([^@]+)@/)?.[1]
    if (!file) return null
    const wrap = (name: string) => {
        const value = unquote(texture.attrs[name] ?? "")
        // useMetadata (the default) asks the file, and a png or jpeg says nothing: repeat, as Storm samples it
        return (WRAPS.has(value) ? value : "repeat") as DescriptionTexture["wrapS"]
    }
    const space = unquote(texture.attrs["inputs:sourceColorSpace"] ?? "")
    const four = (name: string): [number, number, number, number] | undefined => {
        const value = numbers(texture.attrs[name])
        return value.length >= 4 ? [value[0], value[1], value[2], value[3]] : undefined
    }
    const scale = four("inputs:scale")
    const bias = four("inputs:bias")
    const out: DescriptionTexture = {
        file,
        channel:
            (["r", "g", "b", "a", "rgb", "rgba"].includes(channel) ? channel : "rgb") as DescriptionTexture["channel"],
        wrapS: wrap("inputs:wrapS"),
        wrapT: wrap("inputs:wrapT"),
        colorSpace: space === "raw" || space === "sRGB" ? space : "auto",
        ...(scale ? { scale } : {}),
        ...(bias ? { bias } : {}),
    }
    // st: a primvar reader's varname, maybe through a UsdTransform2d that scales, turns and moves it first
    let at = connectionOf(texture.attrs["inputs:st.connect"])
    for (let depth = 0; at && depth < 8; depth++) {
        const source = byPath.get(at.prim)
        if (!source) break
        const id = unquote(source.attrs["info:id"] ?? "")
        if (id === "UsdTransform2d") {
            const two = (name: string, fallback: [number, number]): [number, number] => {
                const value = numbers(source.attrs[name])
                return value.length >= 2 ? [value[0], value[1]] : fallback
            }
            out.transform = {
                scale: two("inputs:scale", [1, 1]),
                rotation: numbers(source.attrs["inputs:rotation"])[0] ?? 0,
                translation: two("inputs:translation", [0, 0]),
            }
            at = connectionOf(source.attrs["inputs:in.connect"])
        } else if (id.startsWith("UsdPrimvarReader")) {
            const name = stringInput(source, "inputs:varname", byPath)
            if (name) out.coordinates = name
            break
        } else {
            // an interface input between them: follow it
            at = connectionOf(source.attrs[`${at.attribute}.connect`])
        }
    }
    return out
}

/** `["a", "b"]` or `<a>, <b>` as the paths it names. */
function targetsOf(value: string | undefined): string[] {
    return [...(value ?? "").matchAll(/<([^>]+)>/g)].map((match) => match[1])
}

/** Whether `path` is in the collection at `collection` (`/a/b.collection:name`): includes, excludes, expansion. */
function inCollection(collection: string, path: string, depth = 0): boolean {
    const dot = collection.indexOf(".collection:")
    if (dot === -1 || depth > 8) return false
    const owner = primsByPath.get(collection.slice(0, dot))
    if (!owner) return false
    const prefix = collection.slice(dot + 1)
    const explicit = unquote(owner.attrs[`${prefix}:expansionRule`] ?? "") === "explicitOnly"
    const covers = (target: string) =>
        target.includes(".collection:")
            ? inCollection(target, path, depth + 1)
            : path === target || (!explicit && path.startsWith(`${target}/`))
    const includes = targetsOf(owner.attrs[`${prefix}:includes`])
    const root = unquote(owner.attrs[`${prefix}:includeRoot`] ?? "")
    const included = includes.some(covers) || ((root === "1" || root === "true") && !explicit)
    return included && !targetsOf(owner.attrs[`${prefix}:excludes`]).some(covers)
}

/** The material a prim binds for `purpose` (`""` all-purpose): its collection bindings first, then its direct one. */
function bindingAt(at: Prim, geom: string, purpose: string): { material: string; stronger: boolean } | undefined {
    const strength = (name: string) => unquote(at.attrs[`${name}:bindMaterialAs`] ?? "") === "strongerThanDescendants"
    const collectionPrefixes = purpose
        ? [`material:binding:collection:${purpose}:`, `material:binding:${purpose}:collection:`]
        : ["material:binding:collection:"]
    for (const [name, value] of Object.entries(at.attrs)) {
        if (name.endsWith(":bindMaterialAs") || !collectionPrefixes.some((prefix) => name.startsWith(prefix))) continue
        // an all-purpose collection binding is not a purpose's
        const rest = name.slice("material:binding:collection:".length)
        if (!purpose && (rest.startsWith("preview:") || rest.startsWith("full:"))) continue
        const [collection, material] = targetsOf(value)
        if (collection && material && inCollection(collection, geom)) return { material, stronger: strength(name) }
    }
    const direct = purpose ? `material:binding:${purpose}` : "material:binding"
    const material = targetsOf(at.attrs[direct])[0]
    return material ? { material, stronger: strength(direct) } : undefined
}

/** UsdShade's bound material for a preview renderer: `preview` purpose, else all-purpose; nearest wins unless an ancestor is stronger. */
function boundSurface(prim: Prim): Surface | undefined {
    const geom = pathOf(prim)
    for (const purpose of ["preview", ""]) {
        let found: string | undefined
        for (let at: Prim | undefined = prim; at; at = at.parent) {
            const binding = bindingAt(at, geom, purpose)
            if (binding && (!found || binding.stronger)) found = binding.material
        }
        if (found) return surfaces.get(found)
    }
    return undefined
}

/** The primvar a prim's bound material reads its diffuse texture's coordinates from, if it names one. */
export function textureCoordinates(prim: Prim): string | undefined {
    return boundSurface(prim)?.textures.diffuse?.coordinates
}

/** The primvar a prim's colour is read from per vertex: the one its material's diffuseColor reads, else displayColor. */
export function colorPrimvar(prim: Prim): string | undefined {
    const surface = boundSurface(prim)
    if (surface && (surface.preview || surface.color)) return surface.colorPrimvar
    return "displayColor"
}

/** How a geometry draws: its bound material wins over displayColor, as USD has it (displayColor is the no-material fallback). */
export function surfaceLook(prim: Prim): Partial<DescriptionGeometry> {
    const found = boundSurface(prim)
    // a material only counts when it states a surface this can read
    const surface = found && (found.preview || found.color) ? found : undefined
    const shown = numbers(prim.attrs["primvars:displayColor"])
    const opacity = surface ? (surface.opacity ?? 1) : (numbers(prim.attrs["primvars:displayOpacity"])[0] ?? 1)
    const fromPrimvar = surface?.colorPrimvar ? numbers(prim.attrs[`primvars:${surface.colorPrimvar}`]) : []
    const color = surface?.color ??
        (fromPrimvar.length >= 3 ? fromPrimvar : !surface && shown.length >= 3 ? shown : undefined)
    const textures = surface?.textures ?? {}
    return {
        ...(color ? { color: [color[0], color[1], color[2], opacity] as [number, number, number, number] } : {}),
        ...(!color && opacity < 1 ? { opacity } : {}),
        ...(textures.diffuse ? { texture: textures.diffuse.file } : {}),
        ...(Object.keys(textures).length ? { textures } : {}),
        ...(surface?.roughness !== undefined ? { roughness: surface.roughness } : {}),
        ...(surface?.metallic !== undefined ? { metallic: surface.metallic } : {}),
        ...(surface?.ior !== undefined ? { ior: surface.ior } : {}),
        ...(surface?.emissive ? { emissive: surface.emissive } : {}),
        ...(surface?.opacityThreshold ? { opacityThreshold: surface.opacityThreshold } : {}),
        ...(surface?.clearcoat
            ? { clearcoat: surface.clearcoat, clearcoatRoughness: surface.clearcoatRoughness ?? 0.01 }
            : {}),
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

/** The file a prim's reference or payload arc names (an arc within the layer is composed instead). */
function referenceOf(prim: Prim): string | null {
    for (const arc of ["references", "payload"]) {
        const match = (prim.meta[arc] ?? "").match(/@([^@]+)@/)
        if (match) return match[1]
    }
    return null
}

const SHAPES = new Set(["Mesh", "Cube", "Sphere", "Cylinder", "Capsule", "Cone", "Plane"])

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
        if (!drawnItself(prim)) return
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

/** The prim's placement in `owner`'s unscaled frame (where tf puts it): every transform between, the owner's scale included. */
function placementUnder(prim: Prim, owner: Prim): Placement {
    return decompose(frameMatrix(owner).invert().multiply(worldMatrix(prim)))
}

/** A link's frame in the stage: its world transform without its scale, which is where tf puts it. */
function frameMatrix(owner: Prim): THREE.Matrix4 {
    const { xyz, quat } = decompose(worldMatrix(owner))
    return new THREE.Matrix4().compose(
        new THREE.Vector3(...xyz),
        new THREE.Quaternion(...quat),
        new THREE.Vector3(1, 1, 1),
    )
}

function geometryOf(prim: Prim, owner: Prim): DescriptionGeometry | null {
    const { xyz, quat, scale } = placementUnder(prim, owner)
    const origin: Origin = { xyz, quat }
    const tint = surfaceLook(prim)
    const mesh = meshPathOf(prim)
    const uneven = scale.some((value) => Math.abs(value - 1) > 1e-9)
    const doubleSided = unquote(prim.attrs["doubleSided"] ?? "") === "1" ||
        unquote(prim.attrs["doubleSided"] ?? "") === "true"
    const look = { ...tint, ...(doubleSided ? { doubleSided } : {}) }
    if (mesh) return { type: "mesh", origin, mesh, ...(uneven ? { scale } : {}), ...look }
    if (prim.type === "Mesh") {
        // a mesh authored in the layer itself: built from its own points, placed by its origin and scale
        const geometry = inlineMeshGeometry(prim)
        return geometry ? { type: "mesh", origin, geometry, ...(uneven ? { scale } : {}), ...look } : null
    }
    // a size left unsaid is UsdGeom's schema default (pxr usdGeom/schema.usda: Cube size 2, radius 1, height 2, Plane 2 x 2)
    if (prim.type === "Cube") {
        // A Cube is a unit cube scaled to the box's extents: USD has no three-sided box.
        const size = numbers(prim.attrs["size"])[0] ?? 2
        return { type: "box", origin, size: [scale[0] * size, scale[1] * size, scale[2] * size], ...look }
    }
    if (prim.type === "Sphere") {
        const radius = numbers(prim.attrs["radius"])[0] ?? 1
        // an unevenly scaled sphere is an ellipsoid: the radius stays and the scale stretches it
        return uneven && !(Math.abs(scale[0] - scale[1]) < 1e-9 && Math.abs(scale[1] - scale[2]) < 1e-9)
            ? { type: "sphere", origin, radius, scale, ...look }
            : { type: "sphere", origin, radius: radius * scale[0], ...look }
    }
    if (prim.type === "Cylinder" || prim.type === "Capsule" || prim.type === "Cone") {
        // run along `axis` (Z unless it says otherwise): turned so the shape's own z is that axis
        const { turn, across } = alongAxis(unquote(prim.attrs["axis"] ?? "Z"), scale)
        const radius = numbers(prim.attrs["radius"])[0] ?? (prim.type === "Capsule" ? 0.5 : 1)
        const height = numbers(prim.attrs["height"])[0] ?? (prim.type === "Capsule" ? 1 : 2)
        const type = prim.type === "Cylinder" ? "cylinder" : prim.type === "Capsule" ? "capsule" : "cone"
        const placed = { xyz, quat: multiply(quat, turn) }
        // the axis' scale stretches the length, the other two the radius: equal, they fold into it; not, they stay
        return Math.abs(across[0] - across[1]) < 1e-9
            ? { type, origin: placed, radius: radius * across[0], length: height * across[2], ...look }
            : { type, origin: placed, radius, length: height, scale: across, ...look }
    }
    if (prim.type === "Plane") {
        // A Plane lies across its axis (Z unless it says otherwise): turned so its face is the shape's xy.
        const { turn, across } = alongAxis(unquote(prim.attrs["axis"] ?? "Z"), scale)
        const width = (numbers(prim.attrs["width"])[0] ?? 2) * across[0]
        const length = (numbers(prim.attrs["length"])[0] ?? 2) * across[1]
        return { type: "plane", origin: { xyz, quat: multiply(quat, turn) }, size: [width, length, 0], ...look }
    }
    return null
}

/** The turn taking a shape's own z onto `axis`, and the prim's scale in the shape's own axes. */
function alongAxis(axis: string, scale: [number, number, number]): {
    turn: [number, number, number, number]
    across: [number, number, number]
} {
    const half = Math.SQRT1_2
    // about y by a quarter: the shape's x, y, z lie along the prim's -z, y, x
    if (axis === "X") return { turn: [0, half, 0, half], across: [scale[2], scale[1], scale[0]] }
    // about x by minus a quarter: the shape's x, y, z lie along the prim's x, -z, y
    if (axis === "Y") return { turn: [-half, 0, 0, half], across: [scale[0], scale[2], scale[1]] }
    return { turn: [0, 0, 0, 1], across: scale }
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
        origin: (({ xyz, quat }) => ({ xyz, quat }))(placementUnder(prim, ancestor)),
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
    const camera = selectedCamera(roots, settings)
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

/** The camera the render settings point at (`rel camera`), else the stage's only one. */
function selectedCamera(roots: Prim[], settings: Prim | undefined): Prim | undefined {
    const linked = targetsOf(settings?.attrs["camera"])[0]
    const cameras: Prim[] = []
    walkDrawn(roots, (prim) => {
        if (prim.type === "Camera") cameras.push(prim)
    })
    return cameras.find((prim) => pathOf(prim) === linked) ??
        cameras.find((prim) => prim.name === linked?.split("/").pop()) ??
        (cameras.length === 1 ? cameras[0] : undefined)
}

/** The stage's render settings: a `RenderSettings` prim, or one carrying Omniverse's `omni:rtx:` attributes. */
function renderSettingsOf(roots: Prim[]): Prim | undefined {
    let found: Prim | undefined
    walkDrawn(roots, (prim) => {
        // Omniverse applies these as API schemas, so an Isaac stage is known by carrying the attributes
        if (
            !found && (prim.type === "RenderSettings" || Object.keys(prim.attrs).some((k) => k.startsWith("omni:rtx:")))
        ) {
            found = prim
        }
    })
    return found
}

/** Every Camera prim in world space with its lens as authored (its clipping range in stage units until inMetresZUp). */
function camerasOf(roots: Prim[], sceneRoot: Prim | null, settings: Prim | undefined): DescriptionCamera[] {
    const selected = selectedCamera(roots, settings)
    const out: DescriptionCamera[] = []
    walkDrawn(roots, (prim) => {
        if (prim.type !== "Camera") return
        const value = (name: string, fallback: number) => {
            const parsed = numbers(prim.attrs[name])[0]
            return parsed !== undefined && Number.isFinite(parsed) ? parsed : fallback
        }
        const clipping = numbers(prim.attrs["clippingRange"])
        const { xyz, quat } = decompose(worldMatrix(prim))
        out.push({
            name: frameName(prim),
            path: pathOf(prim),
            xyz,
            quat,
            ...onLink(prim, sceneRoot),
            projection: unquote(prim.attrs["projection"] ?? "") === "orthographic" ? "orthographic" : "perspective",
            // UsdGeomCamera's schema defaults
            focalLength: value("focalLength", 50),
            horizontalAperture: value("horizontalAperture", 20.955),
            verticalAperture: value("verticalAperture", 15.2908),
            clippingRange: clipping.length >= 2 ? [clipping[0], clipping[1]] : [1, 1000000],
            selected: prim === selected,
        })
    })
    return out
}

/** The link a light or camera moves with (its nearest rigid-body ancestor, or the scene's root frame) and its place on it. */
function onLink(prim: Prim, sceneRoot: Prim | null): { link?: string; origin?: Origin } {
    const owner = linkAncestor(prim, sceneRoot)
    if (!owner) return {}
    const { xyz, quat } = decompose(frameMatrix(owner).invert().multiply(worldMatrix(prim)))
    return { link: frameName(owner), origin: { xyz, quat } }
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
function lookOf(roots: Prim[], settings: Prim | undefined): DescriptionLook | undefined {
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
    CylinderLight: "cylinder",
    DomeLight: "dome",
    DomeLight_1: "dome",
    // no PortalLight: it only guides a path tracer's dome sampling, which a rasteriser lighting by the whole dome has no use for
}

/** Every light in world space, placed and scaled by every transform above it, with the link it is on (`link`/`origin`). */
function lightsOf(roots: Prim[], sceneRoot: Prim | null): DescriptionLight[] {
    const found: DescriptionLight[] = []
    walkDrawn(roots, (prim) => {
        const type = LIGHT_TYPES[prim.type]
        // an invisible light lights nothing (UsdLux lights are imageable)
        if (!type || !rendered(prim)) return
        const light = lightOf(prim, type, worldMatrix(prim))
        if (light) found.push({ ...light, ...onLink(prim, sceneRoot) })
    })
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
    "inputs:length": 1,
    "inputs:colorTemperature": 6500,
    "inputs:shaping:cone:angle": 90,
    "inputs:shaping:cone:softness": 0,
}

function lightOf(prim: Prim, type: DescriptionLight["type"], world: THREE.Matrix4): DescriptionLight | null {
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
    const { xyz, quat, scale } = decompose(world)
    // A light shines down its own -Z; where that points once the transforms above it are applied is its direction.
    const direction = rotate(quat, [0, 0, -1])
    const texture = (raw("inputs:texture:file") ?? "").match(/@([^@]+)@/)?.[1]
    // a light's size is in its own frame, so the transforms above it scale it: x and y for a face, the largest for a radius
    const sized = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]))
    const treatAsPoint = type === "point" && flag("treatAsPoint", false)
    const cone = value("inputs:shaping:cone:angle")
    return {
        name: frameName(prim),
        type,
        xyz,
        quat,
        direction,
        color: colour.length >= 3 ? [colour[0], colour[1], colour[2]] : [1, 1, 1],
        intensity,
        exposure: value("inputs:exposure"),
        normalize: flag("inputs:normalize", false),
        shadow: flag("inputs:shadow:enable", true),
        ...(flag("inputs:enableColorTemperature", false) ? { colorTemperature: value("inputs:colorTemperature") } : {}),
        // a cone of 90 degrees or more is the whole hemisphere a face lights anyway: no shaping
        ...(cone < 90 && type !== "distant" && type !== "dome"
            ? { cone: { angle: cone, softness: Math.max(0, Math.min(1, value("inputs:shaping:cone:softness"))) } }
            : {}),
        ...(type === "distant" ? { angle: value("inputs:angle") } : {}),
        ...(type === "rect"
            ? { width: value("inputs:width") * Math.abs(scale[0]), height: value("inputs:height") * Math.abs(scale[1]) }
            : {}),
        ...(type === "disk"
            ? { radius: value("inputs:radius") * Math.max(Math.abs(scale[0]), Math.abs(scale[1])) }
            : {}),
        ...(type === "point" ? { radius: treatAsPoint ? 0 : value("inputs:radius") * sized } : {}),
        ...(type === "cylinder"
            ? {
                radius: flag("treatAsLine", false)
                    ? 0
                    : value("inputs:radius") * Math.max(Math.abs(scale[1]), Math.abs(scale[2])),
                length: value("inputs:length") * Math.abs(scale[0]),
            }
            : {}),
        ...(texture ? { texture } : {}),
    }
}
