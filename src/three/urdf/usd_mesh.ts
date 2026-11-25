// A USD layer's Meshes as one geometry, placed, triangulated, coloured per vertex and grouped by material (meshLooks).
import * as THREE from "three"
import type { DescriptionGeometry } from "./description.ts"
import { describeMaterials, type Prim, rendered, surfaceLook, textureCoordinates, xformOf } from "./usda.ts"

/** One material of a mesh layer, for the geometry group of the same index: its colour, finish and texture. */
export type MeshLook = Pick<DescriptionGeometry, "color" | "texture" | "roughness" | "metallic" | "ior">

type Numbers = ArrayLike<number>

/** An attribute as numbers: the crate's typed value, else the text's. */
function numbersOf(prim: Prim, name: string): Numbers {
    const value = prim.values?.[name]
    if (value instanceof Float32Array || value instanceof Float64Array) return value
    if (value && typeof value === "object" && "values" in value) return (value as { values: Float64Array }).values
    const text = prim.attrs[name]
    if (!text) return []
    return [...text.matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map((match) => Number(match[0]))
}

/** A primvar's interpolation, from a crate's metadata or a text layer's (both kept as `<name>:interpolation`). */
function interpolationOf(prim: Prim, name: string): string {
    const value = prim.values?.[`${name}:interpolation`] ??
        prim.attrs[`${name}:interpolation`]?.replace(/["']/g, "").trim()
    return typeof value === "string" ? value : "vertex"
}

/** `path` as named from the layer at `layer`: a relative path joined to the layer's directory, an absolute one as it is. */
export function resolveAgainst(layer: string, path: string): string {
    if (path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return path
    const base = layer.split("?")[0]
    // a URL's scheme and host (`package://pkg`) stay as they are; only the path after them is normalized
    const origin = base.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i)?.[0] ?? ""
    const joined = base.slice(origin.length, base.lastIndexOf("/") + 1) + path
    const out: string[] = []
    for (const part of joined.split("/")) {
        if (part === "." || (part === "" && out.length)) continue
        if (part === ".." && out.length && out[out.length - 1] !== ".." && out[out.length - 1] !== "") out.pop()
        else out.push(part)
    }
    return origin + out.join("/")
}

/** The materials of a mesh layer's geometry, one per group (usdMeshGeometry), or none for any other geometry. */
export function meshLooks(geometry: THREE.BufferGeometry): MeshLook[] {
    return (geometry.userData.looks as MeshLook[] | undefined) ?? []
}

/** Every image a mesh layer's materials name, once each, as paths resolved against the layer's own. */
export function meshTextures(geometry: THREE.BufferGeometry): string[] {
    return [...new Set(meshLooks(geometry).map((look) => look.texture).filter((uri): uri is string => !!uri))]
}

function matrixOf(prim: Prim): THREE.Matrix4 {
    const matrix = new THREE.Matrix4()
    for (let at: Prim | undefined = prim; at; at = at.parent) {
        const { xyz, quat, scale } = xformOf(at)
        matrix.premultiply(
            new THREE.Matrix4().compose(
                new THREE.Vector3(...xyz),
                new THREE.Quaternion(...quat),
                new THREE.Vector3(...scale),
            ),
        )
    }
    return matrix
}

/** Every rendered Mesh under `roots` as one non-indexed geometry, a group per material, its texture resolved against `layer`. */
export function usdMeshGeometry(roots: Prim[], layer = ""): THREE.BufferGeometry {
    describeMaterials(roots)
    // each material's triangles apart, so the geometry's groups are runs of one material
    const parts = new Map<
        string,
        { look: MeshLook; positions: number[]; normals: number[]; uvs: number[]; colors: number[] }
    >()
    let allNormals = true
    let anyUvs = false
    const visit = (prim: Prim) => {
        if (prim.type === "Mesh" && rendered(prim)) addMesh(prim)
        prim.children.forEach(visit)
    }
    const addMesh = (prim: Prim) => {
        const points = numbersOf(prim, "points")
        const counts = numbersOf(prim, "faceVertexCounts")
        const indices = numbersOf(prim, "faceVertexIndices")
        if (points.length < 9 || indices.length < 3) return
        const matrix = matrixOf(prim)
        const turn = new THREE.Matrix3().getNormalMatrix(matrix)
        const normal = numbersOf(prim, "normals")
        const normalBy = interpolationOf(prim, "normals")
        // the primvar the material's texture reads, else USD's conventional name for texture coordinates
        const coordinates = `primvars:${textureCoordinates(prim) ?? "st"}`
        const st = numbersOf(prim, coordinates)
        const stIndices = numbersOf(prim, `${coordinates}:indices`)
        const stBy = interpolationOf(prim, coordinates)
        const surface = surfaceLook(prim)
        // Hydra's fallback displayColor for a prim with neither material nor displayColor (pxr usdImaging)
        const color = surface.color ?? [0.18, 0.18, 0.18, 1]
        const look: MeshLook = {
            color,
            ...(surface.texture ? { texture: resolveAgainst(layer, surface.texture) } : {}),
            ...(surface.roughness !== undefined ? { roughness: surface.roughness } : {}),
            ...(surface.metallic !== undefined ? { metallic: surface.metallic } : {}),
            ...(surface.ior !== undefined ? { ior: surface.ior } : {}),
        }
        const key = JSON.stringify(look)
        if (!parts.has(key)) parts.set(key, { look, positions: [], normals: [], uvs: [], colors: [] })
        const { positions, normals, uvs, colors } = parts.get(key)!
        const leftHanded = (prim.attrs["orientation"] ?? "").includes("leftHanded")
        const hasNormals = normal.length > 0
        const hasUvs = st.length > 0
        allNormals &&= hasNormals
        anyUvs ||= hasUvs
        const point = new THREE.Vector3()
        const direction = new THREE.Vector3()
        // the value an attribute has at one corner: per vertex, per face-vertex (the corner's running index), or per face
        const corner = (by: string, vertex: number, running: number, face: number) =>
            by === "faceVarying" ? running : by === "uniform" ? face : by === "constant" ? 0 : vertex
        let running = 0
        for (let face = 0, start = 0; face < counts.length; face++) {
            const count = counts[face]
            // a fan from the first corner: right for the convex polygons a mesh layer holds
            for (let index = 1; index + 1 < count; index++) {
                const triangle = leftHanded ? [0, index + 1, index] : [0, index, index + 1]
                for (const offset of triangle) {
                    const vertex = indices[start + offset]
                    point.set(points[vertex * 3], points[vertex * 3 + 1], points[vertex * 3 + 2]).applyMatrix4(matrix)
                    positions.push(point.x, point.y, point.z)
                    if (hasNormals) {
                        const at = corner(normalBy, vertex, running + offset, face)
                        direction.set(normal[at * 3], normal[at * 3 + 1], normal[at * 3 + 2]).applyMatrix3(turn)
                            .normalize()
                        normals.push(direction.x, direction.y, direction.z)
                    } else {
                        normals.push(0, 0, 0)
                    }
                    if (hasUvs) {
                        let at = corner(stBy, vertex, running + offset, face)
                        if (stIndices.length) at = stIndices[at]
                        uvs.push(st[at * 2], st[at * 2 + 1])
                    } else {
                        uvs.push(0, 0)
                    }
                    colors.push(color[0], color[1], color[2])
                }
            }
            start += count
            running += count
        }
    }
    roots.forEach(visit)
    const all = [...parts.values()]
    const joined = (field: "positions" | "normals" | "uvs" | "colors") => all.flatMap((part) => part[field])
    const positions = joined("positions")
    if (!positions.length) throw new Error("no meshes in the layer")
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(joined("colors"), 3))
    if (anyUvs) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(joined("uvs"), 2))
    if (allNormals) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(joined("normals"), 3))
    else geometry.computeVertexNormals()
    let start = 0
    for (const [index, part] of all.entries()) {
        geometry.addGroup(start, part.positions.length / 3, index)
        start += part.positions.length / 3
    }
    geometry.userData.looks = all.map((part) => part.look)
    return geometry
}
