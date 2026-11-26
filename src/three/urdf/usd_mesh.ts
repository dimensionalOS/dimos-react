// A USD layer's Meshes and gprims as one geometry, each corner in the colour it draws in, a group per material (meshLooks).
import * as THREE from "three"
import type { DescriptionGeometry, DescriptionTexture } from "./description.ts"
import {
    colorPrimvar,
    composePrims,
    defined,
    describeMaterials,
    localMatrix,
    type Prim,
    rendered,
    surfaceLook,
    textureCoordinates,
} from "./usda.ts"

/** One material of a mesh layer, for the geometry group of the same index: its colour, finish and images. */
export type MeshLook =
    & Pick<
        DescriptionGeometry,
        | "color"
        | "texture"
        | "textures"
        | "roughness"
        | "metallic"
        | "ior"
        | "emissive"
        | "opacityThreshold"
        | "clearcoat"
        | "clearcoatRoughness"
        | "doubleSided"
    >
    & {
        /** whether its corners' colours differ (a primvar per vertex, face or corner): the colour attribute says them */
        vertexColors?: boolean
    }

type Numbers = ArrayLike<number>

/** An attribute as numbers: the crate's typed value, else the text's. */
function numbersOf(prim: Prim, name: string): Numbers {
    const value = prim.values?.[name]
    if (value instanceof Float32Array || value instanceof Float64Array || value instanceof Int32Array) return value
    if (Array.isArray(value) && value.every((item) => typeof item === "number")) return value as number[]
    if (value && typeof value === "object" && "values" in value) return (value as { values: Float64Array }).values
    const text = prim.attrs[name]
    if (!text || text === "None") return []
    return [...text.matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map((match) => Number(match[0]))
}

/** A primvar's interpolation, from a crate's metadata or a text layer's (both kept as `<name>:interpolation`). */
function interpolationOf(prim: Prim, name: string, fallback = "vertex"): string {
    const value = prim.values?.[`${name}:interpolation`] ??
        prim.attrs[`${name}:interpolation`]?.replace(/["']/g, "").trim()
    return typeof value === "string" ? value : fallback
}

function token(prim: Prim, name: string): string {
    const value = prim.values?.[name] ?? prim.attrs[name]
    return typeof value === "string" ? value.replace(/["']/g, "").trim() : ""
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
    const files = meshLooks(geometry).flatMap((look) =>
        Object.values(look.textures ?? {}).map((texture) => texture?.file)
    )
    return [...new Set(files.filter((uri): uri is string => !!uri))]
}

/** The prim's transform down from (not including) `top`, as USD composes it, a reset stack honoured. */
function matrixOf(prim: Prim, top?: Prim): THREE.Matrix4 {
    const chain: Prim[] = []
    for (let at: Prim | undefined = prim; at && at !== top; at = at.parent) chain.unshift(at)
    return chain.reduce((placed, at) => {
        const { matrix, resets } = localMatrix(at)
        return resets ? matrix : placed.multiply(matrix)
    }, new THREE.Matrix4())
}

/** A mesh's look, its images resolved against the layer. */
function lookOf(prim: Prim, layer: string, vertexColors: boolean): MeshLook {
    const surface = surfaceLook(prim)
    const textures: Partial<Record<string, DescriptionTexture>> = {}
    for (const [slot, texture] of Object.entries(surface.textures ?? {})) {
        if (texture) textures[slot] = { ...texture, file: resolveAgainst(layer, texture.file) }
    }
    const doubleSided = ["1", "true"].includes(
        token(prim.type === "GeomSubset" && prim.parent ? prim.parent : prim, "doubleSided"),
    )
    // Hydra's fallback displayColor for a prim with neither material nor displayColor (pxr usdImaging)
    const color = surface.color ?? [0.18, 0.18, 0.18, surface.opacity ?? 1]
    return {
        color,
        ...(textures.diffuse
            ? { texture: textures.diffuse.file, textures }
            : Object.keys(textures).length
            ? { textures }
            : {}),
        ...(surface.roughness !== undefined ? { roughness: surface.roughness } : {}),
        ...(surface.metallic !== undefined ? { metallic: surface.metallic } : {}),
        ...(surface.ior !== undefined ? { ior: surface.ior } : {}),
        ...(surface.emissive ? { emissive: surface.emissive } : {}),
        ...(surface.opacityThreshold ? { opacityThreshold: surface.opacityThreshold } : {}),
        ...(surface.clearcoat ? { clearcoat: surface.clearcoat, clearcoatRoughness: surface.clearcoatRoughness } : {}),
        ...(doubleSided ? { doubleSided } : {}),
        ...(vertexColors ? { vertexColors } : {}),
    }
}

interface Part {
    look: MeshLook
    positions: number[]
    normals: number[]
    uvs: number[]
    colors: number[]
    alphas: number[]
}

/** Triangles gathered per material, then joined into one geometry with a group per material. */
class Builder {
    readonly parts = new Map<string, Part>()
    anyUvs = false
    anyAlpha = false

    part(look: MeshLook): Part {
        const key = JSON.stringify(look)
        let part = this.parts.get(key)
        if (!part) {
            part = { look, positions: [], normals: [], uvs: [], colors: [], alphas: [] }
            this.parts.set(key, part)
        }
        return part
    }

    finish(): THREE.BufferGeometry {
        const all = [...this.parts.values()]
        const joined = (field: "positions" | "normals" | "uvs" | "colors" | "alphas") =>
            all.flatMap((part) => part[field])
        const positions = joined("positions")
        if (!positions.length) throw new Error("no meshes in the layer")
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(joined("normals"), 3))
        if (this.anyAlpha) {
            const rgb = joined("colors")
            const alpha = joined("alphas")
            const rgba = new Float32Array(alpha.length * 4)
            for (let index = 0; index < alpha.length; index++) {
                rgba.set([rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2], alpha[index]], index * 4)
            }
            geometry.setAttribute("color", new THREE.BufferAttribute(rgba, 4))
        } else {
            geometry.setAttribute("color", new THREE.Float32BufferAttribute(joined("colors"), 3))
        }
        if (this.anyUvs) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(joined("uvs"), 2))
        let start = 0
        for (const [index, part] of all.entries()) {
            geometry.addGroup(start, part.positions.length / 3, index)
            start += part.positions.length / 3
        }
        geometry.userData.looks = all.map((part) => part.look)
        return geometry
    }

    /** A Mesh prim's faces, placed by `matrix`, each face in its GeomSubset's material or else the mesh's. */
    addMesh(prim: Prim, matrix: THREE.Matrix4, layer: string): void {
        const points = numbersOf(prim, "points")
        const counts = numbersOf(prim, "faceVertexCounts")
        const indices = numbersOf(prim, "faceVertexIndices")
        if (points.length < 9 || indices.length < 3) return
        const turn = new THREE.Matrix3().getNormalMatrix(matrix)
        // a mirroring transform turns every face inside out: the winding flips with it
        const mirrored = matrix.determinant() < 0
        const leftHanded = token(prim, "orientation") === "leftHanded" !== mirrored
        const normal = numbersOf(prim, "normals").length
            ? numbersOf(prim, "normals")
            : numbersOf(prim, "primvars:normals")
        const normalBy = numbersOf(prim, "normals").length
            ? interpolationOf(prim, "normals")
            : interpolationOf(prim, "primvars:normals")
        const normalIndices = numbersOf(prim, "primvars:normals:indices")
        // the primvar the material's texture reads, else USD's conventional name for texture coordinates
        const coordinates = `primvars:${textureCoordinates(prim) ?? "st"}`
        const st = numbersOf(prim, coordinates)
        const stIndices = numbersOf(prim, `${coordinates}:indices`)
        const stBy = interpolationOf(prim, coordinates)
        // the colour each corner draws in: the material's, or the primvar its diffuseColor (or, unbound, displayColor) reads
        const primvar = colorPrimvar(prim)
        const shown = primvar ? numbersOf(prim, `primvars:${primvar}`) : []
        const shownBy = interpolationOf(prim, `primvars:${primvar}`, "constant")
        const shownIndices = numbersOf(prim, `primvars:${primvar}:indices`)
        const opacity = numbersOf(prim, "primvars:displayOpacity")
        const opacityBy = interpolationOf(prim, "primvars:displayOpacity", "constant")
        const opacityIndices = numbersOf(prim, "primvars:displayOpacity:indices")
        const alphaVaries = opacity.length > 1 && opacityBy !== "constant"
        this.anyAlpha ||= alphaVaries
        // a look's corners take the mesh's colour primvar when that is what its colour comes from and it varies
        const varies = (source: Prim) => {
            const name = colorPrimvar(source)
            return !!name && name === primvar && shown.length > 3 && shownBy !== "constant"
        }
        // each face's own look: a materialBind GeomSubset's binding, else the mesh's
        const meshLook = lookOf(prim, layer, varies(prim))
        const faceLooks = new Map<number, MeshLook>()
        for (const subset of prim.children) {
            if (subset.type !== "GeomSubset" || token(subset, "elementType") !== "face") continue
            if ((token(subset, "familyName") || "materialBind") !== "materialBind") continue
            // a subset binding nothing of its own draws as the rest of the mesh does
            if (!Object.keys(subset.attrs).some((name) => name.startsWith("material:binding"))) continue
            const look = lookOf(subset, layer, varies(subset))
            for (const face of Array.from(numbersOf(subset, "indices"))) faceLooks.set(face, look)
        }
        // no normals authored: smooth across shared points for a subdivision surface (USD's default), faceted for "none"
        const smooth = normal.length === 0 &&
            !["none", "bilinear"].includes(token(prim, "subdivisionScheme") || "catmullClark")
        const pointNormals = smooth ? smoothNormals(points, counts, indices, leftHanded) : null
        const point = new THREE.Vector3()
        const direction = new THREE.Vector3()
        const a = new THREE.Vector3()
        const b = new THREE.Vector3()
        const c = new THREE.Vector3()
        const at = (valueIndices: Numbers, by: string, vertex: number, running: number, face: number) => {
            const index = by === "faceVarying" ? running : by === "uniform" ? face : by === "constant" ? 0 : vertex
            return valueIndices.length ? valueIndices[index] : index
        }
        let running = 0
        for (let face = 0, start = 0; face < counts.length; face++) {
            const count = counts[face]
            const part = this.part(faceLooks.get(face) ?? meshLook)
            // a fan from the first corner: right for the convex polygons a mesh layer holds
            for (let index = 1; index + 1 < count; index++) {
                const triangle = leftHanded ? [0, index + 1, index] : [0, index, index + 1]
                const corners = triangle.map((offset) => indices[start + offset])
                if (!normal.length && !pointNormals) {
                    // faceted: the triangle's own normal, in the placed frame
                    a.fromArray(points as number[], corners[0] * 3).applyMatrix4(matrix)
                    b.fromArray(points as number[], corners[1] * 3).applyMatrix4(matrix)
                    c.fromArray(points as number[], corners[2] * 3).applyMatrix4(matrix)
                    direction.subVectors(c, b).cross(a.clone().sub(b)).normalize()
                }
                for (const [corner, offset] of triangle.entries()) {
                    const vertex = corners[corner]
                    const facing = running + offset
                    point.set(points[vertex * 3], points[vertex * 3 + 1], points[vertex * 3 + 2]).applyMatrix4(matrix)
                    part.positions.push(point.x, point.y, point.z)
                    if (normal.length || pointNormals) {
                        const source = normal.length ? normal : pointNormals!
                        const n = normal.length ? at(normalIndices, normalBy, vertex, facing, face) : vertex
                        direction.set(source[n * 3], source[n * 3 + 1], source[n * 3 + 2]).applyMatrix3(turn)
                            .normalize()
                    }
                    part.normals.push(direction.x, direction.y, direction.z)
                    if (st.length) {
                        const uv = at(stIndices, stBy, vertex, facing, face)
                        part.uvs.push(st[uv * 2], st[uv * 2 + 1])
                        this.anyUvs = true
                    } else {
                        part.uvs.push(0, 0)
                    }
                    const look = part.look
                    if (look.vertexColors) {
                        const colour = at(shownIndices, shownBy, vertex, facing, face)
                        part.colors.push(shown[colour * 3] ?? 1, shown[colour * 3 + 1] ?? 1, shown[colour * 3 + 2] ?? 1)
                    } else {
                        const colour = look.color ?? [1, 1, 1, 1]
                        part.colors.push(colour[0], colour[1], colour[2])
                    }
                    part.alphas.push(
                        alphaVaries
                            ? opacity[at(opacityIndices, opacityBy, vertex, facing, face)] ?? 1
                            : look.color?.[3] ?? 1,
                    )
                }
            }
            start += count
            running += count
        }
    }

    /** A Cube, Sphere, Cylinder, Capsule, Cone or Plane in a mesh layer, tessellated and placed by `matrix`. */
    addGprim(prim: Prim, matrix: THREE.Matrix4, layer: string): void {
        const shape = gprimGeometry(prim)
        if (!shape) return
        const geometry = shape.toNonIndexed()
        geometry.applyMatrix4(matrix)
        const look = lookOf(prim, layer, false)
        const part = this.part(look)
        const positions = geometry.attributes.position
        const normals = geometry.attributes.normal
        const uvs = geometry.attributes.uv
        const colour = look.color ?? [1, 1, 1, 1]
        for (let index = 0; index < positions.count; index++) {
            part.positions.push(positions.getX(index), positions.getY(index), positions.getZ(index))
            part.normals.push(normals.getX(index), normals.getY(index), normals.getZ(index))
            // a gprim has no st of its own; three's per-face coordinates stand in for Hydra's none
            part.uvs.push(uvs ? uvs.getX(index) : 0, uvs ? uvs.getY(index) : 0)
            part.colors.push(colour[0], colour[1], colour[2])
            part.alphas.push(colour[3] ?? 1)
        }
        shape.dispose()
        geometry.dispose()
    }
}

/** Area-weighted normals at each point, for a mesh smooth across its shared points: each face's normal, summed. */
function smoothNormals(points: Numbers, counts: Numbers, indices: Numbers, leftHanded: boolean): Float32Array {
    const out = new Float32Array(points.length)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const face = new THREE.Vector3()
    for (let at = 0, start = 0; at < counts.length; at++) {
        // the whole polygon's area normal, its fan's triangles summed, so a quad counts once at each of its corners
        face.set(0, 0, 0)
        for (let index = 1; index + 1 < counts[at]; index++) {
            a.fromArray(points as number[], indices[start] * 3)
            b.fromArray(points as number[], indices[start + index] * 3)
            c.fromArray(points as number[], indices[start + index + 1] * 3)
            face.add(c.sub(b).cross(a.sub(b)))
        }
        if (leftHanded) face.negate()
        for (let corner = 0; corner < counts[at]; corner++) {
            const point = indices[start + corner]
            out[point * 3] += face.x
            out[point * 3 + 1] += face.y
            out[point * 3 + 2] += face.z
        }
        start += counts[at]
    }
    for (let index = 0; index < out.length; index += 3) {
        const length = Math.hypot(out[index], out[index + 1], out[index + 2]) || 1
        out[index] /= length
        out[index + 1] /= length
        out[index + 2] /= length
    }
    return out
}

/** A gprim as three geometry in its own frame, at UsdGeom's schema sizes where it leaves them unsaid. */
function gprimGeometry(prim: Prim): THREE.BufferGeometry | null {
    const value = (name: string, fallback: number) => numbersOf(prim, name)[0] ?? fallback
    const axis = token(prim, "axis") || "Z"
    // three builds round shapes along y; USD's run along their axis
    const alongAxis = (geometry: THREE.BufferGeometry) =>
        axis === "X" ? geometry.rotateZ(-Math.PI / 2) : axis === "Z" ? geometry.rotateX(Math.PI / 2) : geometry
    switch (prim.type) {
        case "Cube": {
            const size = value("size", 2)
            return new THREE.BoxGeometry(size, size, size)
        }
        case "Sphere":
            return new THREE.SphereGeometry(value("radius", 1), 24, 16)
        case "Cylinder":
            return alongAxis(new THREE.CylinderGeometry(value("radius", 1), value("radius", 1), value("height", 2), 24))
        case "Capsule":
            return alongAxis(new THREE.CapsuleGeometry(value("radius", 0.5), value("height", 1), 8, 24))
        case "Cone":
            return alongAxis(new THREE.ConeGeometry(value("radius", 1), value("height", 2), 24))
        case "Plane": {
            const plane = new THREE.PlaneGeometry(value("width", 2), value("length", 2))
            return axis === "X" ? plane.rotateY(Math.PI / 2) : axis === "Y" ? plane.rotateX(-Math.PI / 2) : plane
        }
    }
    return null
}

const GPRIMS = new Set(["Cube", "Sphere", "Cylinder", "Capsule", "Cone", "Plane"])

/** Every drawn Mesh and gprim under `roots` as one non-indexed geometry, a group per material, images resolved against `layer`. */
export function usdMeshGeometry(roots: Prim[], layer = ""): THREE.BufferGeometry {
    composePrims(roots)
    describeMaterials(roots)
    const builder = new Builder()
    const visit = (prim: Prim) => {
        if (!defined(prim)) return
        if (prim.type === "Mesh" && rendered(prim)) builder.addMesh(prim, matrixOf(prim), layer)
        else if (GPRIMS.has(prim.type) && rendered(prim)) builder.addGprim(prim, matrixOf(prim), layer)
        prim.children.forEach(visit)
    }
    roots.forEach(visit)
    return builder.finish()
}

/** A Mesh prim authored in the description's own layer, built in its own frame with its materials and subsets'; null if faceless. */
export function inlineMeshGeometry(prim: Prim): THREE.BufferGeometry | null {
    const builder = new Builder()
    builder.addMesh(prim, new THREE.Matrix4(), "")
    try {
        const geometry = builder.finish()
        geometry.userData.shared = true
        return geometry
    } catch {
        return null
    }
}
