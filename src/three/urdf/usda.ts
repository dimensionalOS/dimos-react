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
import type { DescriptionGeometry, DescriptionJoint, DescriptionLink, Origin, RobotDescription } from "./description.ts"

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
    const roots = parsePrims(text)
    indexMaterials(roots)
    const links: DescriptionLink[] = []
    const prims: Prim[] = []
    walk(roots, (prim) => {
        if (isLink(prim)) {
            prims.push(prim)
            links.push({
                name: frameName(prim),
                visuals: geometriesOf(prim, false),
                collisions: geometriesOf(prim, true),
            })
        }
    })
    const joints = jointsOf(roots, prims)
    const childLinks = new Set(joints.map((joint) => joint.child))
    const root = links.find((link) => !childLinks.has(link.name))?.name ?? links[0]?.name ?? ""
    return {
        name: defaultPrimName(text) ?? roots[0]?.name ?? "robot",
        base_link: root,
        base_frame: root,
        base_pose: { xyz: [0, 0, 0], quat: [0, 0, 0, 1] },
        joint_names: joints.filter((joint) => joint.type !== "fixed" && !joint.mimic).map((joint) => joint.name),
        links,
        joints,
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
                prim.attrs[attributeName(key)] = value
            }
            index += 1
        }
    }
    return roots
}

type Token =
    | { kind: "def"; primType: string; name: string; meta?: string }
    | { kind: "assign"; key: string; value: string }
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
        tokens.push({ kind: "assign", key: next.key, value: next.value })
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
    }
    return { kind: "assign", end, body: true, primType: "", name: "", key, value: text.slice(at, end).trim() }
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

/** A prim's own transform, as the origin a URDF would state. */
function placementOf(prim: Prim): Origin {
    const matrix = numbers(prim.attrs["xformOp:transform"])
    // USD writes a matrix4d row by row, and the translation is its last row.
    if (matrix.length >= 16) return { xyz: [matrix[12], matrix[13], matrix[14]], quat: quatFromRows(matrix) }
    // A hand-written layer usually places a prim with translate/orient rather than one matrix,
    // and USD treats the two as equally normal. Reading only the matrix left every such prim at
    // the origin -- three robots standing 1.2 m apart rendered on top of each other, with
    // nothing to say they had been moved.
    const translate = numbers(prim.attrs["xformOp:translate"])
    const orient = numbers(prim.attrs["xformOp:orient"])
    return {
        xyz: translate.length >= 3 ? [translate[0], translate[1], translate[2]] : [0, 0, 0],
        // USD writes a quatf as (w, x, y, z); three wants (x, y, z, w).
        quat: orient.length >= 4 ? [orient[1], orient[2], orient[3], orient[0]] : [0, 0, 0, 1],
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

/**
 * Every Material prim in the layer being parsed, by its path, so a geom can find what it binds.
 *
 * Module-level because a geom names its material by absolute path and may sit anywhere in the
 * tree, so the lookup cannot be threaded down from the walk without passing a map through every
 * geometry helper. parseUsda refills it before each parse.
 */
const materials = new Map<string, [number, number, number, number]>()

function indexMaterials(roots: Prim[]): void {
    materials.clear()
    walk(roots, (prim) => {
        if (prim.type !== "Material") return
        const color = numbers(prim.attrs["inputs:color"])
        if (color.length >= 3) materials.set(pathOf(prim), [color[0], color[1], color[2], 1])
    })
}

/**
 * The colour a geometry prim should be drawn in.
 *
 * `primvars:displayColor` first, which is what a geom with no material carries. Then the bound
 * material's own `inputs:color`: the converter writes a real UsdShade Material per MJCF
 * material and binds it, so a G1's ten black parts and its silver ones are stated there and
 * nowhere else. Reading only displayColor drew the whole robot in the default grey, and the
 * only displayColors in a converted layer are the green collision shapes and red sites.
 */
function colorOf(prim: Prim): Partial<DescriptionGeometry> {
    const shown = numbers(prim.attrs["primvars:displayColor"])
    if (shown.length >= 3) return { color: [shown[0], shown[1], shown[2], 1] }
    const bound = (prim.attrs["material:binding"] ?? "").match(/<([^>]+)>/)
    const color = bound ? materials.get(bound[1]) : undefined
    return color ? { color } : {}
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

/** The geometry prims inside a link, as the visuals or the collisions. */
function geometriesOf(prim: Prim, collision: boolean): DescriptionGeometry[] {
    const out: DescriptionGeometry[] = []
    for (const child of prim.children) {
        if (isLink(child) || child.type in JOINT_TYPES || child.type === "Scope") continue
        // Collision geometry is marked by PhysicsCollisionAPI; everything else is a visual.
        const isCollision = (child.meta["apiSchemas"] ?? "").includes("PhysicsCollisionAPI")
        if (isCollision !== collision) continue
        const geometry = geometryOf(child)
        if (geometry) out.push(geometry)
    }
    return out
}

function geometryOf(prim: Prim): DescriptionGeometry | null {
    const origin = placementOf(prim)
    const scale = numbers(prim.attrs["xformOp:scale"])
    const tint = colorOf(prim)
    const mesh = meshPathOf(prim)
    if (prim.type === "Mesh" || mesh) {
        if (!mesh) return null
        return {
            type: "mesh",
            origin,
            mesh,
            ...(scale.length >= 3 ? { scale: [scale[0], scale[1], scale[2]] as [number, number, number] } : {}),
            ...tint,
        }
    }
    if (prim.type === "Cube") {
        // A Cube is a unit cube scaled to the box's extents: USD has no three-sided box.
        const size = numbers(prim.attrs["size"])[0] ?? 1
        const extents: [number, number, number] = scale.length >= 3
            ? [scale[0] * size, scale[1] * size, scale[2] * size]
            : [size, size, size]
        return { type: "box", origin, size: extents, ...tint }
    }
    if (prim.type === "Sphere") {
        const radius = numbers(prim.attrs["radius"])[0] ?? 1
        return { type: "sphere", origin, radius: radius * (scale[0] ?? 1), ...tint }
    }
    if (prim.type === "Cylinder") {
        const radius = numbers(prim.attrs["radius"])[0] ?? 1
        const height = numbers(prim.attrs["height"])[0] ?? 1
        return { type: "cylinder", origin, radius: radius * (scale[0] ?? 1), length: height * (scale[2] ?? 1), ...tint }
    }
    return null
}

/** Every joint: the ones authored as UsdPhysics prims, plus the welds and free joints nesting implies. */
function jointsOf(roots: Prim[], links: Prim[]): DescriptionJoint[] {
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
    for (const prim of links) {
        const name = frameName(prim)
        if (claimed.has(name)) continue
        const ancestor = linkAncestor(prim)
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

function linkAncestor(prim: Prim): Prim | null {
    let parent = prim.parent
    while (parent) {
        if (isLink(parent)) return parent
        parent = parent.parent
    }
    return null
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
