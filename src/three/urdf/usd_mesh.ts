// A USD layer's Meshes as one geometry, placed, triangulated and coloured per vertex by their material (no textures).
import * as THREE from "three"
import { describeMaterials, type Prim, rendered, surfaceLook, xformOf } from "./usda.ts"

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

function interpolationOf(prim: Prim, name: string): string {
    const value = prim.values?.[`${name}:interpolation`]
    return typeof value === "string" ? value : "vertex"
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

/** Every rendered Mesh under `roots` as one non-indexed geometry, with normals, uvs where every part has them, and colours. */
export function usdMeshGeometry(roots: Prim[]): THREE.BufferGeometry {
    describeMaterials(roots)
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const colors: number[] = []
    let allNormals = true
    let allUvs = true
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
        const st = numbersOf(prim, "primvars:st")
        const stIndices = numbersOf(prim, "primvars:st:indices")
        const stBy = interpolationOf(prim, "primvars:st")
        const look = surfaceLook(prim)
        // Hydra's fallback displayColor for a prim with neither material nor displayColor (pxr usdImaging)
        const color = look.color ?? [0.18, 0.18, 0.18, 1]
        const leftHanded = (prim.attrs["orientation"] ?? "").includes("leftHanded")
        const hasNormals = normal.length > 0
        const hasUvs = st.length > 0
        allNormals &&= hasNormals
        allUvs &&= hasUvs
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
    if (!positions.length) throw new Error("no meshes in the layer")
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
    if (allUvs) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
    if (allNormals) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
    else geometry.computeVertexNormals()
    return geometry
}
