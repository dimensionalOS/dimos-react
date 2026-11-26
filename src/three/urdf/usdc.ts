// A USD crate (.usdc, version 0.4+) read into usda.ts's Prim tree; kinds geometry does not use (dictionaries, time samples) are skipped.
import type { Prim, StageMetrics } from "./usda.ts"

/** The crate's prims, and the prim its pseudo-root names as default. */
export interface Crate {
    roots: Prim[]
    defaultPrim: string | null
    /** the layer's metersPerUnit and upAxis, where it states them */
    metrics: StageMetrics
}

/** True for a crate, by its magic rather than its name. */
export function isUsdc(bytes: Uint8Array): boolean {
    return bytes.length >= 8 && new TextDecoder().decode(bytes.subarray(0, 8)) === "PXR-USDC"
}

// ---- LZ4 and pxr's compressions -----------------------------------------------

/** One LZ4 block (the raw block format, no frame) from `src` into `dst` at `at`; returns where it stopped. */
function lz4Block(src: Uint8Array, dst: Uint8Array, at: number): number {
    let read = 0
    let write = at
    while (read < src.length) {
        const token = src[read++]
        let literals = token >> 4
        if (literals === 15) {
            for (let more = 255; more === 255;) literals += more = src[read++]
        }
        dst.set(src.subarray(read, read + literals), write)
        read += literals
        write += literals
        if (read >= src.length) break
        const offset = src[read] | (src[read + 1] << 8)
        read += 2
        let length = token & 15
        if (length === 15) {
            for (let more = 255; more === 255;) length += more = src[read++]
        }
        length += 4
        for (let index = 0; index < length; index++, write++) dst[write] = dst[write - offset]
    }
    return write
}

/** TfFastCompression's buffer: a chunk count, then one LZ4 block or that many length-prefixed ones. */
function fastDecompress(src: Uint8Array, size: number): Uint8Array {
    const out = new Uint8Array(size)
    const chunks = src[0]
    if (chunks === 0) {
        lz4Block(src.subarray(1), out, 0)
        return out
    }
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength)
    let read = 1
    let write = 0
    for (let chunk = 0; chunk < chunks; chunk++) {
        const length = view.getInt32(read, true)
        read += 4
        write = lz4Block(src.subarray(read, read + length), out, write)
        read += length
    }
    return out
}

/** pxr's integer coding (Usd_IntegerCompression): a common delta, 2-bit codes, then the deltas that are not it. */
function decodeIntegers(data: Uint8Array, count: number, wide: boolean): Float64Array {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const out = new Float64Array(count)
    const common = wide ? Number(view.getBigInt64(0, true)) : view.getInt32(0, true)
    const codes = wide ? 8 : 4
    let values = codes + Math.floor((count * 2 + 7) / 8)
    let previous = 0
    for (let index = 0; index < count; index++) {
        const code = (data[codes + (index >> 2)] >> ((index & 3) * 2)) & 3
        let delta = common
        if (code === 1) {
            delta = wide ? view.getInt16(values, true) : view.getInt8(values)
            values += wide ? 2 : 1
        } else if (code === 2) {
            delta = wide ? view.getInt32(values, true) : view.getInt16(values, true)
            values += wide ? 4 : 2
        } else if (code === 3) {
            delta = wide ? Number(view.getBigInt64(values, true)) : view.getInt32(values, true)
            values += wide ? 8 : 4
        }
        previous += delta
        out[index] = previous
    }
    return out
}

// ---- the file ----------------------------------------------------------------

/** each value kind's number in a ValueRep (pxr crateDataTypes.h, xx(...) entries) */
const TYPE = {
    Bool: 1,
    UChar: 2,
    Int: 3,
    UInt: 4,
    Int64: 5,
    UInt64: 6,
    Half: 7,
    Float: 8,
    Double: 9,
    String: 10,
    Token: 11,
    AssetPath: 12,
    Matrix2d: 13,
    Matrix3d: 14,
    Matrix4d: 15,
    Quatd: 16,
    Quatf: 17,
    Quath: 18,
    Vec2d: 19,
    Vec2f: 20,
    Vec2h: 21,
    Vec2i: 22,
    Vec3d: 23,
    Vec3f: 24,
    Vec3h: 25,
    Vec3i: 26,
    Vec4d: 27,
    Vec4f: 28,
    Vec4h: 29,
    Vec4i: 30,
    Dictionary: 31,
    TokenListOp: 32,
    StringListOp: 33,
    PathListOp: 34,
    ReferenceListOp: 35,
    IntListOp: 36,
    Int64ListOp: 37,
    UIntListOp: 38,
    UInt64ListOp: 39,
    PathVector: 40,
    TokenVector: 41,
    Specifier: 42,
    Permission: 43,
    Variability: 44,
    VariantSelectionMap: 45,
    TimeSamples: 46,
    Payload: 47,
    DoubleVector: 48,
    LayerOffsetVector: 49,
    StringVector: 50,
    ValueBlock: 51,
    Value: 52,
    UnregisteredValue: 53,
    UnregisteredValueListOp: 54,
    PayloadListOp: 55,
} as const

/** each vector, matrix and quaternion kind's component count and bytes per component (pxr Gf types: Vec3f is 3 floats) */
const SHAPED: Record<number, [number, number]> = {
    [TYPE.Matrix2d]: [4, 8],
    [TYPE.Matrix3d]: [9, 8],
    [TYPE.Matrix4d]: [16, 8],
    [TYPE.Quatd]: [4, 8],
    [TYPE.Quatf]: [4, 4],
    [TYPE.Quath]: [4, 2],
    [TYPE.Vec2d]: [2, 8],
    [TYPE.Vec2f]: [2, 4],
    [TYPE.Vec2h]: [2, 2],
    [TYPE.Vec2i]: [2, 4],
    [TYPE.Vec3d]: [3, 8],
    [TYPE.Vec3f]: [3, 4],
    [TYPE.Vec3h]: [3, 2],
    [TYPE.Vec3i]: [3, 4],
    [TYPE.Vec4d]: [4, 8],
    [TYPE.Vec4f]: [4, 4],
    [TYPE.Vec4h]: [4, 2],
    [TYPE.Vec4i]: [4, 4],
}

/** SdfSpecType values the SPECS section stores (pxr sdf/types.h SdfSpecType) */
const SPEC_ATTRIBUTE = 1
const SPEC_PRIM = 6
const SPEC_RELATIONSHIP = 8
/** the ValueRep bits (pxr crateFile.h ValueRep: IsArrayBit, IsInlinedBit, IsCompressedBit, a type byte, a 48-bit payload) */
const REP_ARRAY = 0x80000000
const REP_INLINED = 0x40000000
const REP_COMPRESSED = 0x20000000
/** arrays shorter than this are stored uncompressed (pxr crateFile.cpp MinCompressedArraySize) */
const MIN_COMPRESSED_ARRAY = 16
/** a field set's terminator, an index of ~0 (pxr crateFile.cpp FieldIndex default) */
const FIELD_SET_END = 4294967295
/** SdfListOp's header bits: explicit, added, deleted, ordered, prepended, appended (pxr crateFile.cpp _ListOpHeader), and whether composition keeps them */
const LIST_OP_PARTS = [[2, true], [4, true], [8, false], [16, false], [32, true], [64, true]] as const

/** A value as the crate held it: a number, string, typed array, token list, path or a tagged kind of its own. */
type Value =
    | number
    | boolean
    | string
    | number[]
    | string[]
    | Float32Array
    | Float64Array
    | { asset: string }
    | { path: string }
    | { paths: string[] }
    | { tokens: string[] }
    | { references: string[] }
    | { shape: number; values: Float64Array | Float32Array }

/** an IEEE 754 binary16 (GfHalf) as a number */
function half(bits: number): number {
    const sign = bits & 0x8000 ? -1 : 1
    const exponent = (bits >> 10) & 0x1f
    const fraction = bits & 0x3ff
    if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
    if (exponent === 31) return fraction ? NaN : sign * Infinity
    return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

class Reader {
    readonly view: DataView
    tokens: string[] = []
    strings: string[] = []
    paths: string[] = []
    version: [number, number, number]

    constructor(readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        this.version = [bytes[8], bytes[9], bytes[10]]
    }

    atLeast(major: number, minor: number): boolean {
        return this.version[0] > major || (this.version[0] === major && this.version[1] >= minor)
    }

    u64(at: number): number {
        return Number(this.view.getBigUint64(at, true))
    }

    /** `count` integers coded and compressed at `at`; returns them and where they end. */
    compressedInts(at: number, count: number, wide = false): [Float64Array, number] {
        const size = this.u64(at)
        const working = (wide ? 8 : 4) + Math.floor((count * 2 + 7) / 8) + count * (wide ? 8 : 4)
        const raw = fastDecompress(this.bytes.subarray(at + 8, at + 8 + size), working)
        return [decodeIntegers(raw, count, wide), at + 8 + size]
    }

    /** An inlined or stored value from its 64-bit rep (the low and high 32 bits). */
    value(low: number, high: number): Value | undefined {
        const array = (high & REP_ARRAY) !== 0
        const inlined = (high & REP_INLINED) !== 0
        const compressed = (high & REP_COMPRESSED) !== 0
        const type = (high >>> 16) & 0xff
        const payload = low + (high & 0xffff) * 2 ** 32
        if (array) return payload === 0 ? [] : this.array(type, payload, compressed)
        if (inlined) return this.inlined(type, low)
        return this.stored(type, payload)
    }

    inlined(type: number, payload: number): Value | undefined {
        const view = new DataView(new ArrayBuffer(4))
        view.setUint32(0, payload, true)
        switch (type) {
            case TYPE.Bool:
                return payload !== 0
            case TYPE.UChar:
            case TYPE.UInt:
            case TYPE.Specifier:
            case TYPE.Permission:
            case TYPE.Variability:
                return payload >>> 0
            case TYPE.Int:
                return payload | 0
            case TYPE.Float:
            case TYPE.Double:
                // a double that fits a float is stored as one
                return view.getFloat32(0, true)
            case TYPE.Half:
                return half(payload & 0xffff)
            case TYPE.Token:
                return this.tokens[payload]
            case TYPE.String:
                return this.strings[payload]
            case TYPE.AssetPath:
                return { asset: this.tokens[payload] }
        }
        const shaped = SHAPED[type]
        if (shaped) {
            // a vector of small whole numbers is inlined as int8s; a matrix as its diagonal
            const [count] = shaped
            const side = Math.round(Math.sqrt(count))
            const isMatrix = type >= TYPE.Matrix2d && type <= TYPE.Matrix4d
            const values = new Float64Array(count)
            for (let index = 0; index < (isMatrix ? side : count); index++) {
                values[isMatrix ? index * side + index : index] = view.getInt8(index)
            }
            return { shape: type, values }
        }
        return undefined
    }

    stored(type: number, at: number): Value | undefined {
        const view = this.view
        switch (type) {
            case TYPE.Double:
                return view.getFloat64(at, true)
            case TYPE.Float:
                return view.getFloat32(at, true)
            case TYPE.Int64:
            case TYPE.UInt64:
                return Number(view.getBigInt64(at, true))
            case TYPE.TokenVector:
                return { tokens: this.indexList(at, this.tokens) }
            case TYPE.StringVector:
                return { tokens: this.indexList(at, this.strings) }
            case TYPE.PathVector:
                return { paths: this.indexList(at, this.paths) }
            case TYPE.DoubleVector: {
                const count = this.u64(at)
                return Array.from({ length: count }, (_, index) => view.getFloat64(at + 8 + index * 8, true))
            }
            case TYPE.TokenListOp:
                return { tokens: this.listOp(at, (offset) => [this.tokens[view.getUint32(offset, true)], 4]) }
            case TYPE.PathListOp:
                return { paths: this.listOp(at, (offset) => [this.paths[view.getUint32(offset, true)], 4]) }
            case TYPE.ReferenceListOp:
            case TYPE.PayloadListOp:
                return { references: this.listOp(at, (offset) => this.reference(offset, type === TYPE.PayloadListOp)) }
            case TYPE.Payload:
                return { references: [this.reference(at, true)[0]] }
        }
        const shaped = SHAPED[type]
        if (shaped) return { shape: type, values: this.components(type, at, 1) }
        return undefined
    }

    /** A reference (or payload) as a text layer writes it (`@asset@`, `</prim>` or both); and how many bytes it took. */
    reference(at: number, payload: boolean): [string, number] {
        const asset = this.strings[this.view.getUint32(at, true)] ?? ""
        const prim = this.paths[this.view.getUint32(at + 4, true)] ?? ""
        const text = `${asset ? `@${asset}@` : ""}${prim && prim !== "/" ? `<${prim}>` : ""}`
        // asset, prim path, layer offset, and a reference's custom data (taken as empty: a mesh layer writes none)
        return [text, payload ? 4 + 4 + 16 : 4 + 4 + 16 + 8]
    }

    indexList(at: number, table: string[]): string[] {
        const count = this.u64(at)
        return Array.from({ length: count }, (_, index) => table[this.view.getUint32(at + 8 + index * 4, true)])
    }

    /** A list op's items, explicit or prepended/added/appended (what composition keeps), by `item` per entry. */
    listOp(at: number, item: (offset: number) => [string, number]): string[] {
        const header = this.bytes[at]
        let offset = at + 1
        const out: string[] = []
        for (const [bit, keep] of LIST_OP_PARTS) {
            if (!(header & bit)) continue
            const count = this.u64(offset)
            offset += 8
            for (let index = 0; index < count; index++) {
                const [value, size] = item(offset)
                if (keep) out.push(value)
                offset += size
            }
        }
        return out
    }

    /** `count` elements of a vector/matrix/quat kind at `at`, as doubles. */
    components(type: number, at: number, count: number): Float64Array {
        const [per, size] = SHAPED[type]
        const out = new Float64Array(per * count)
        const integer = type === TYPE.Vec2i || type === TYPE.Vec3i || type === TYPE.Vec4i
        for (let index = 0; index < out.length; index++) {
            const offset = at + index * size
            out[index] = size === 8
                ? this.view.getFloat64(offset, true)
                : size === 2
                ? half(this.view.getUint16(offset, true))
                : integer
                ? this.view.getInt32(offset, true)
                : this.view.getFloat32(offset, true)
        }
        return out
    }

    array(type: number, at: number, compressed: boolean): Value | undefined {
        let offset = at
        // before crate 0.5 an array starts with a 4-byte shape rank; from 0.7 its count is 64-bit (pxr crateFile.cpp)
        if (!this.atLeast(0, 5)) offset += 4
        const wide = this.atLeast(0, 7)
        const count = wide ? this.u64(offset) : this.view.getUint32(offset, true)
        offset += wide ? 8 : 4
        const integer = type === TYPE.Int || type === TYPE.UInt || type === TYPE.Int64 || type === TYPE.UInt64
        const real = type === TYPE.Float || type === TYPE.Double || type === TYPE.Half
        if (compressed && count >= MIN_COMPRESSED_ARRAY && integer) {
            return this.compressedInts(offset, count, type === TYPE.Int64 || type === TYPE.UInt64)[0]
        }
        if (compressed && count >= MIN_COMPRESSED_ARRAY && real) {
            const code = String.fromCharCode(this.bytes[offset])
            offset += 1
            if (code === "i") return this.compressedInts(offset, count)[0]
            const size = this.view.getUint32(offset, true)
            offset += 4
            const table = this.scalars(type, offset, size)
            const [indexes] = this.compressedInts(offset + size * this.scalarSize(type), count)
            return Float64Array.from(indexes, (index) => table[index])
        }
        if (integer || real || type === TYPE.Bool || type === TYPE.UChar) return this.scalars(type, offset, count)
        if (type === TYPE.Token || type === TYPE.String || type === TYPE.AssetPath) {
            const table = type === TYPE.String ? this.strings : this.tokens
            return Array.from({ length: count }, (_, index) => table[this.view.getUint32(offset + index * 4, true)])
        }
        if (SHAPED[type]) {
            const [, size] = SHAPED[type]
            // the common big ones (points, normals, uvs) stay as floats, which is what three wants anyway
            if (size === 4 && type !== TYPE.Vec2i && type !== TYPE.Vec3i && type !== TYPE.Vec4i) {
                const per = SHAPED[type][0]
                return new Float32Array(this.bytes.slice(offset, offset + count * per * 4).buffer)
            }
            return { shape: type, values: this.components(type, offset, count) }
        }
        return undefined
    }

    scalarSize(type: number): number {
        return type === TYPE.Double || type === TYPE.Int64 || type === TYPE.UInt64
            ? 8
            : type === TYPE.Half
            ? 2
            : type === TYPE.Bool || type === TYPE.UChar
            ? 1
            : 4
    }

    scalars(type: number, at: number, count: number): Float64Array {
        const out = new Float64Array(count)
        const view = this.view
        const size = this.scalarSize(type)
        for (let index = 0; index < count; index++) {
            const offset = at + index * size
            out[index] = type === TYPE.Double
                ? view.getFloat64(offset, true)
                : type === TYPE.Float
                ? view.getFloat32(offset, true)
                : type === TYPE.Half
                ? half(view.getUint16(offset, true))
                : type === TYPE.Int
                ? view.getInt32(offset, true)
                : type === TYPE.UInt
                ? view.getUint32(offset, true)
                : size === 8
                ? Number(view.getBigInt64(offset, true))
                : view.getUint8(offset)
        }
        return out
    }
}

/** The crate's prims: every prim spec as a Prim, its attributes in `values` (and small ones as text in `attrs`). */
export function parseUsdc(bytes: Uint8Array): Crate {
    if (!isUsdc(bytes)) throw new Error("not a USD crate: no PXR-USDC header")
    const reader = new Reader(bytes)
    if (!reader.atLeast(0, 4)) throw new Error(`USD crate ${reader.version.join(".")} is older than this reader (0.4)`)
    const toc = reader.u64(16)
    const sections = new Map<string, number>()
    const count = reader.u64(toc)
    for (let index = 0; index < count; index++) {
        const at = toc + 8 + index * 32
        const name = new TextDecoder().decode(bytes.subarray(at, at + 16)).replace(/\0.*$/s, "")
        sections.set(name, reader.u64(at + 16))
    }
    const section = (name: string) => {
        const at = sections.get(name)
        if (at === undefined) throw new Error(`USD crate has no ${name} section`)
        return at
    }

    // TOKENS: a count, then the null-separated text, compressed
    {
        const at = section("TOKENS")
        const tokens = reader.u64(at)
        const size = reader.u64(at + 8)
        const packed = reader.u64(at + 16)
        const text = new TextDecoder().decode(fastDecompress(bytes.subarray(at + 24, at + 24 + packed), size))
        reader.tokens = text.split("\0").slice(0, tokens)
    }
    {
        const at = section("STRINGS")
        reader.strings = reader.indexList(at, reader.tokens)
    }
    // FIELDS: each field's name (a token) and its value's rep
    const fields: { name: string; low: number; high: number }[] = []
    {
        const at = section("FIELDS")
        const total = reader.u64(at)
        const [names, end] = reader.compressedInts(at + 8, total)
        const size = reader.u64(end)
        const reps = fastDecompress(bytes.subarray(end + 8, end + 8 + size), total * 8)
        const repView = new DataView(reps.buffer)
        for (let index = 0; index < total; index++) {
            fields.push({
                name: reader.tokens[names[index]],
                low: repView.getUint32(index * 8, true),
                high: repView.getUint32(index * 8 + 4, true),
            })
        }
    }
    const fieldSets: Float64Array = (() => {
        const at = section("FIELDSETS")
        return reader.compressedInts(at + 8, reader.u64(at))[0]
    })()
    // PATHS: a tree of tokens, walked as pxr writes it (a child follows its parent, a jump finds the next sibling)
    {
        const at = section("PATHS")
        reader.paths = new Array(reader.u64(at)).fill("")
        const encoded = reader.u64(at + 8)
        const [pathIndexes, a] = reader.compressedInts(at + 16, encoded)
        const [elements, b] = reader.compressedInts(a, encoded)
        const [jumps] = reader.compressedInts(b, encoded)
        const build = (start: number, parentPath: string | null): void => {
            let current = start
            let parent = parentPath
            let child = false
            let sibling = false
            do {
                const here = current++
                if (parent === null) {
                    parent = "/"
                    reader.paths[pathIndexes[here]] = "/"
                } else {
                    const token = elements[here]
                    const element = reader.tokens[Math.abs(token)]
                    reader.paths[pathIndexes[here]] = token < 0
                        ? `${parent}.${element}`
                        : parent === "/"
                        ? `/${element}`
                        : `${parent}/${element}`
                }
                child = jumps[here] > 0 || jumps[here] === -1
                sibling = jumps[here] >= 0
                if (child) {
                    if (sibling) build(here + jumps[here], parent)
                    parent = reader.paths[pathIndexes[here]]
                }
            } while (child || sibling)
        }
        build(0, null)
    }
    // SPECS: each path's kind and its field set
    const at = section("SPECS")
    const specs = reader.u64(at)
    const [specPaths, a] = reader.compressedInts(at + 8, specs)
    const [specFieldSets, b] = reader.compressedInts(a, specs)
    const [specTypes] = reader.compressedInts(b, specs)
    const fieldsOf = (set: number): Record<string, Value | undefined> => {
        const out: Record<string, Value | undefined> = {}
        for (
            let index = set;
            index < fieldSets.length && fieldSets[index] >= 0 && fieldSets[index] !== FIELD_SET_END;
            index++
        ) {
            const field = fields[fieldSets[index]]
            if (field) out[field.name] = reader.value(field.low, field.high)
        }
        return out
    }

    const prims = new Map<string, Prim>()
    const order = new Map<string, string[]>()
    let defaultPrim: string | null = null
    const metrics: StageMetrics = {}
    const properties: [number, string, Record<string, Value | undefined>][] = []
    for (let index = 0; index < specs; index++) {
        const path = reader.paths[specPaths[index]]
        const kind = specTypes[index]
        const own = fieldsOf(specFieldSets[index])
        if (path === "/") {
            defaultPrim = typeof own.defaultPrim === "string" ? own.defaultPrim : null
            if (typeof own.metersPerUnit === "number" && own.metersPerUnit > 0) {
                metrics.metersPerUnit = own.metersPerUnit
            }
            if (own.upAxis === "Y" || own.upAxis === "Z") metrics.upAxis = own.upAxis
            order.set("/", tokensOf(own.primChildren))
        } else if (kind === SPEC_PRIM) {
            const name = path.slice(path.lastIndexOf("/") + 1)
            const prim: Prim = {
                type: typeof own.typeName === "string" ? own.typeName : "",
                name,
                meta: {},
                attrs: {},
                children: [],
                values: {},
            }
            const schemas = tokensOf(own.apiSchemas)
            if (schemas.length) prim.meta["apiSchemas"] = `[${schemas.map((schema) => `"${schema}"`).join(", ")}]`
            // SdfSpecifier: 0 def, 1 over, 2 class
            if (own.specifier === 1) prim.specifier = "over"
            else if (own.specifier === 2) prim.specifier = "class"
            for (const arc of ["references", "payload"]) {
                const listed = own[arc] as { references: string[] } | undefined
                if (listed?.references?.length) prim.meta[arc] = listed.references.join(", ")
            }
            for (const arc of ["inheritPaths", "specializes"]) {
                const listed = own[arc] as { paths: string[] } | undefined
                if (listed?.paths?.length) {
                    prim.meta[arc === "inheritPaths" ? "inherits" : arc] = listed.paths.map((path) => `<${path}>`).join(
                        ", ",
                    )
                }
            }
            if (typeof own.active === "boolean" && !own.active) prim.meta["active"] = "false"
            prims.set(path, prim)
            order.set(path, tokensOf(own.primChildren))
        } else if (kind === SPEC_ATTRIBUTE || kind === SPEC_RELATIONSHIP) {
            properties.push([kind, path, own])
        }
    }
    for (const [kind, path, own] of properties) {
        const dot = path.lastIndexOf(".")
        const prim = prims.get(path.slice(0, dot))
        if (!prim) continue
        const name = path.slice(dot + 1)
        if (kind === SPEC_RELATIONSHIP) {
            const targets = (own.targetPaths as { paths: string[] } | undefined)?.paths ?? []
            if (targets.length) prim.attrs[name] = targets.map((target) => `<${target}>`).join(", ")
            continue
        }
        const connections = (own.connectionPaths as { paths: string[] } | undefined)?.paths ?? []
        if (connections.length) prim.attrs[`${name}.connect`] = `<${connections[0]}>`
        if (typeof own.interpolation === "string") prim.values![`${name}:interpolation`] = own.interpolation
        const value = own.default
        if (value === undefined) continue
        prim.values![name] = value
        const text = asText(value)
        if (text !== undefined) prim.attrs[name] = text
    }
    const roots: Prim[] = []
    const attach = (path: string, into: Prim[], parent?: Prim) => {
        for (const name of order.get(path) ?? []) {
            const childPath = path === "/" ? `/${name}` : `${path}/${name}`
            const prim = prims.get(childPath)
            if (!prim) continue
            if (parent) prim.parent = parent
            into.push(prim)
            attach(childPath, prim.children, prim)
        }
    }
    attach("/", roots)
    return { roots, defaultPrim, metrics }
}

function tokensOf(value: Value | undefined): string[] {
    if (Array.isArray(value)) return value.map(String)
    return (value as { tokens?: string[] } | undefined)?.tokens ?? []
}

/** A value in the text layer's spelling, for the readers that take attributes as text; none for a big array. */
function asText(value: Value): string | undefined {
    const list = (values: ArrayLike<number>) => Array.from(values).join(", ")
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (typeof value === "string") return `"${value}"`
    if (value instanceof Float32Array || value instanceof Float64Array) {
        return value.length <= 64 ? `[${list(value)}]` : undefined
    }
    if (Array.isArray(value)) {
        return value.length <= 64
            ? `[${value.map((item) => typeof item === "string" ? `"${item}"` : item).join(", ")}]`
            : undefined
    }
    if ("asset" in value) return `@${value.asset}@`
    if ("path" in value) return `<${value.path}>`
    if ("tokens" in value) return `[${value.tokens.map((token) => `"${token}"`).join(", ")}]`
    if ("shape" in value) {
        const values = Array.from(value.values)
        // a quaternion is stored (x, y, z, w) and written (w, x, y, z)
        if (value.shape === TYPE.Quatd || value.shape === TYPE.Quatf || value.shape === TYPE.Quath) {
            if (values.length === 4) return `(${values[3]}, ${values[0]}, ${values[1]}, ${values[2]})`
            return undefined
        }
        if (value.shape === TYPE.Matrix4d && values.length === 16) {
            return `( ${[0, 1, 2, 3].map((row) => `(${list(values.slice(row * 4, row * 4 + 4))})`).join(", ")} )`
        }
        const per = SHAPED[value.shape]?.[0] ?? 1
        if (values.length === per) return `(${list(values)})`
        return values.length <= 64 * per ? `[${list(values)}]` : undefined
    }
    return undefined
}
