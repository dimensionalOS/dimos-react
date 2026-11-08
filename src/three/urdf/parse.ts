// A URDF read into a RobotDescription (description.ts): parseUrdf turns the XML into links, joints and geometry, with
// meshes named by their URI and loaded apart (meshGeometry: STL, OBJ, DAE, PLY). decodeMeshFile reads a
// files.MeshFile, the way dimos's UrdfManager answers a /file_request with a file's own bytes.
import * as THREE from "three"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { type DescriptionGeometry, type DescriptionJoint, type Origin, type RobotDescription } from "./description.ts"

type V3 = [number, number, number]

const numbers = (text: string | null | undefined, fallback: V3): V3 => {
    const parts = (text ?? "").trim().split(/\s+/).map(Number)
    return parts.length === 3 && parts.every(Number.isFinite) ? parts as V3 : fallback
}

function originOf(element: Element | null): Origin {
    const xyz = numbers(element?.getAttribute("xyz"), [0, 0, 0])
    const [roll, pitch, yaw] = numbers(element?.getAttribute("rpy"), [0, 0, 0])
    // URDF rpy is fixed-axis roll, pitch, yaw: R = Rz(yaw) Ry(pitch) Rx(roll), three's "ZYX" order
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, pitch, yaw, "ZYX"))
    return { xyz, quat: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] }
}

/** child elements (childNodes, not `children`, so any DOM implementation will do) */
const elements = (element: Element) =>
    Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1)
const child = (element: Element, name: string) => elements(element).find((each) => each.tagName === name) ?? null
const children = (element: Element, name: string) => elements(element).filter((each) => each.tagName === name)

function colorOf(
    material: Element | null,
    named: Map<string, [number, number, number, number]>,
): [number, number, number, number] | undefined {
    if (!material) {
        return undefined
    }
    const rgba = child(material, "color")?.getAttribute("rgba")?.trim().split(/\s+/).map(Number)
    if (rgba?.length === 4 && rgba.every(Number.isFinite)) {
        return rgba as [number, number, number, number]
    }
    return named.get(material.getAttribute("name") ?? "")
}

function geometryOf(item: Element, named: Map<string, [number, number, number, number]>): DescriptionGeometry | null {
    const holder = child(item, "geometry")
    const shape = holder && elements(holder)[0]
    if (!shape) {
        return null
    }
    const geometry: DescriptionGeometry = {
        type: "box",
        origin: originOf(child(item, "origin")),
        color: colorOf(child(item, "material"), named),
    }
    switch (shape.tagName) {
        case "mesh":
            geometry.type = "mesh"
            geometry.mesh = shape.getAttribute("filename") ?? ""
            geometry.scale = numbers(shape.getAttribute("scale"), [1, 1, 1])
            return geometry.mesh ? geometry : null
        case "box":
            geometry.size = numbers(shape.getAttribute("size"), [0.1, 0.1, 0.1])
            return geometry
        case "cylinder":
            geometry.type = "cylinder"
            geometry.radius = Number(shape.getAttribute("radius") ?? 0.05)
            geometry.length = Number(shape.getAttribute("length") ?? 0.1)
            return geometry
        case "sphere":
            geometry.type = "sphere"
            geometry.radius = Number(shape.getAttribute("radius") ?? 0.05)
            return geometry
    }
    return null
}

/** A link's `<group>NAME</group>` (a dimos extension; URDF parsers ignore elements they don't know): the layer list
 * shows and hides its links together, by a row named for it. */
function groupOf(link: Element): { group?: string } {
    const group = child(link, "group")?.textContent?.trim()
    return group ? { group } : {}
}

/** A URDF's XML as a RobotDescription posed at its root link (base_frame = base_link = the root; meshes by URI, not inline). */
export function parseUrdf(xml: string): RobotDescription {
    const document = new DOMParser().parseFromString(xml, "text/xml")
    const robot = document.documentElement
    if (!robot || robot.tagName !== "robot") {
        throw new Error("not a URDF: no <robot>")
    }
    const named = new Map<string, [number, number, number, number]>()
    for (const material of children(robot, "material")) {
        const color = colorOf(material, new Map())
        if (color) {
            named.set(material.getAttribute("name") ?? "", color)
        }
    }
    const links = children(robot, "link").map((link) => ({
        name: link.getAttribute("name") ?? "",
        visuals: children(link, "visual").map((item) => geometryOf(item, named)).filter((
            item,
        ): item is DescriptionGeometry => !!item),
        collisions: children(link, "collision").map((item) => geometryOf(item, named)).filter((
            item,
        ): item is DescriptionGeometry => !!item),
        ...groupOf(link),
    }))
    const joints: DescriptionJoint[] = children(robot, "joint").map((joint) => {
        const limit = child(joint, "limit")
        const mimic = child(joint, "mimic")
        const lower = Number(limit?.getAttribute("lower")), upper = Number(limit?.getAttribute("upper"))
        return {
            name: joint.getAttribute("name") ?? "",
            type: (joint.getAttribute("type") ?? "fixed") as DescriptionJoint["type"],
            parent: child(joint, "parent")?.getAttribute("link") ?? "",
            child: child(joint, "child")?.getAttribute("link") ?? "",
            origin: originOf(child(joint, "origin")),
            axis: numbers(child(joint, "axis")?.getAttribute("xyz"), [1, 0, 0]),
            ...(limit && Number.isFinite(lower) && Number.isFinite(upper) && lower < upper
                ? { limit: [lower, upper] as [number, number] }
                : {}),
            ...(mimic
                ? {
                    mimic: {
                        joint: mimic.getAttribute("joint") ?? "",
                        multiplier: Number(mimic.getAttribute("multiplier") ?? 1),
                        offset: Number(mimic.getAttribute("offset") ?? 0),
                    },
                }
                : {}),
        }
    })
    const childLinks = new Set(joints.map((joint) => joint.child))
    const root = links.find((link) => !childLinks.has(link.name))?.name ?? links[0]?.name ?? ""
    return {
        name: robot.getAttribute("name") ?? "robot",
        base_link: root,
        base_frame: root,
        base_pose: { xyz: [0, 0, 0], quat: [0, 0, 0, 1] },
        joint_names: joints.filter((joint) => joint.type !== "fixed" && !joint.mimic).map((joint) => joint.name),
        links,
        joints,
    }
}

/** Every mesh URI the description's links use, once each. */
export function meshUris(description: RobotDescription): string[] {
    const uris = description.links.flatMap((link) => [...link.visuals, ...link.collisions]).map((item) => item.mesh)
        .filter((uri): uri is string => !!uri)
    return [...new Set(uris)]
}

/** files.MeshFile's wire form (dimos/msgs/files/MeshFile.py): `<f64 ts><u32 uri length><uri><file bytes>`, little endian. */
export function decodeMeshFile(bytes: Uint8Array): { ts: number; uri: string; data: Uint8Array } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.byteLength < 12) {
        throw new Error(`MeshFile too short (${bytes.byteLength} bytes)`)
    }
    const uriLength = view.getUint32(8, true)
    if (12 + uriLength > bytes.byteLength) {
        throw new Error("MeshFile's uri runs past its end")
    }
    return {
        ts: view.getFloat64(0, true),
        uri: new TextDecoder().decode(bytes.subarray(12, 12 + uriLength)),
        data: bytes.subarray(12 + uriLength),
    }
}

/** The meshes of an OBJ or DAE scene as one geometry (positions only, in the scene's frame; materials dropped). */
function mergedMeshes(scene: THREE.Object3D): THREE.BufferGeometry {
    scene.updateMatrixWorld(true)
    const parts: THREE.BufferGeometry[] = []
    scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh && mesh.geometry.attributes.position) {
            const part = new THREE.BufferGeometry()
            part.setAttribute("position", mesh.geometry.attributes.position.clone())
            part.setIndex(mesh.geometry.index ? mesh.geometry.index.clone() : null)
            parts.push(part.applyMatrix4(mesh.matrixWorld).toNonIndexed())
        }
    })
    if (!parts.length) {
        throw new Error("no meshes in the file")
    }
    const merged = mergeGeometries(parts)
    parts.forEach((part) => part.dispose())
    merged.computeVertexNormals()
    return merged
}

/** A mesh file (STL binary or ASCII, OBJ, DAE, PLY) as a BufferGeometry in meters, its kind told by the URI's extension. */
export function meshGeometry(uri: string, data: Uint8Array): THREE.BufferGeometry {
    const extension = uri.split("?")[0].split(".").pop()?.toLowerCase()
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    let geometry: THREE.BufferGeometry
    if (extension === "stl") {
        geometry = new STLLoader().parse(buffer)
    } else if (extension === "ply") {
        geometry = new PLYLoader().parse(buffer)
    } else if (extension === "obj") {
        geometry = mergedMeshes(new OBJLoader().parse(new TextDecoder().decode(data)))
    } else if (extension === "dae") {
        const collada = new ColladaLoader().parse(new TextDecoder().decode(data), "")
        if (!collada) {
            throw new Error("not a COLLADA file")
        }
        // ColladaLoader turns a Z_UP file Y-up for three; a URDF's link frames are already Z-up.
        collada.scene.rotation.set(0, 0, 0)
        geometry = mergedMeshes(collada.scene)
    } else {
        throw new Error(`unsupported mesh format .${extension}`)
    }
    if (!geometry.attributes.normal) {
        geometry.computeVertexNormals()
    }
    geometry.userData.shared = true
    return geometry
}
