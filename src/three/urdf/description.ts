// A robot's description (a URDF as parseUrdf reads it): links with their visual and collision geometry (meshes named
// by their URI, loaded apart), joints (origin, axis, limits, mimic), the base link and the base's pose in the world. Kinematics does the
// forward kinematics from joint positions.
import * as THREE from "three"

export type V3 = [number, number, number]
type Q = [number, number, number, number]

export interface Origin {
    xyz: V3
    quat: Q
}

/** Which UsdPreviewSurface input an image feeds. */
export type TextureSlot =
    | "diffuse"
    | "emissive"
    | "normal"
    | "occlusion"
    | "roughness"
    | "metallic"
    | "opacity"
    | "clearcoat"
    | "clearcoatRoughness"

/** A UsdUVTexture as a material input reads it: the file, the channel taken, how it wraps and how its st is placed. */
export interface DescriptionTexture {
    file: string
    /** the output the input connects to: `rgb` for a colour, one channel for a scalar */
    channel: "r" | "g" | "b" | "a" | "rgb" | "rgba"
    /** UsdUVTexture's wrapS/wrapT (`useMetadata`, its default, is taken as repeat) */
    wrapS: "repeat" | "mirror" | "clamp" | "black"
    wrapT: "repeat" | "mirror" | "clamp" | "black"
    /** `sourceColorSpace`: `auto` is sRGB for an 8-bit image and linear for a float one */
    colorSpace: "raw" | "sRGB" | "auto"
    /** `inputs:scale` and `inputs:bias` (rgba): the value read is texel * scale + bias */
    scale?: [number, number, number, number]
    bias?: [number, number, number, number]
    /** the primvar its st comes from (a UsdPrimvarReader_float2's varname), when it names one */
    coordinates?: string
    /** a UsdTransform2d between the primvar and the texture: st * scale, turned by rotation (degrees), + translation */
    transform?: { scale: [number, number]; rotation: number; translation: [number, number] }
}

export interface DescriptionGeometry {
    /** `plane`: a flat `size[0]` by `size[1]` face in the origin's xy, facing its +z; cylinder, capsule and cone run along z */
    type: "mesh" | "box" | "cylinder" | "sphere" | "plane" | "capsule" | "cone"
    origin: Origin
    mesh?: string
    /** a mesh authored in the layer itself (a Mesh prim's own points), built in the origin's frame */
    geometry?: THREE.BufferGeometry
    scale?: V3
    size?: V3
    radius?: number
    /** a cylinder's or cone's height, or a capsule's between its caps */
    length?: number
    color?: [number, number, number, number]
    /** how opaque it is, when it names no colour to carry that in */
    opacity?: number
    /** an image the bound material names (UsdUVTexture) for its diffuseColor, fetched like a mesh file */
    texture?: string
    /** every image the bound material reads, by the input it feeds (`diffuse` is `texture`'s) */
    textures?: Partial<Record<TextureSlot, DescriptionTexture>>
    /** the bound material's UsdPreviewSurface finish, where it states one */
    roughness?: number
    metallic?: number
    /** index of refraction: 1 is no interface at all, so no reflection (UsdPreviewSurface's default is 1.5) */
    ior?: number
    /** emissiveColor, linear */
    emissive?: V3
    /** opacityThreshold: above 0, a cut-out (drawn where opacity reaches it, not blended) */
    opacityThreshold?: number
    clearcoat?: number
    clearcoatRoughness?: number
    /** UsdGeomGprim's doubleSided: both faces drawn (USD's default is one) */
    doubleSided?: boolean
}

export interface DescriptionLink {
    name: string
    visuals: DescriptionGeometry[]
    collisions: DescriptionGeometry[]
    /** shown and hidden with the other links of its group (a URDF link's `<group>`, e.g. a sim's scene or people) */
    group?: string
}

/**
 * A light the description carries, so a scene says how it is lit rather than leaving it to whoever draws it.
 *
 * `distant` has a direction and no position, like the sun; `point` has a position; `ambient` has neither and comes
 * from every direction at once. `dome` is the sky: ambient light, and the thing you see when you look past the
 * scene, so a viewer can paint it behind everything as well as light by it. `color` is linear RGB with the
 * brightness taken out of it, which `intensity` carries instead.
 */
export interface DescriptionLight {
    name: string
    /** UsdLux's: DistantLight, SphereLight (`point`), RectLight, DiskLight, CylinderLight, DomeLight; `ambient` lights from everywhere */
    type: "distant" | "point" | "ambient" | "dome" | "rect" | "disk" | "cylinder"
    /** where it is, for a point or area light */
    xyz: V3
    /** the link it moves with (its nearest rigid-body ancestor, or the scene's root frame) and where it is on that link */
    link?: string
    origin?: Origin
    /** how it is turned (x, y, z, w): an area light's face is its xy, shining down its -z */
    quat?: [number, number, number, number]
    /** where it shines, for a distant light */
    direction: V3
    color: [number, number, number]
    /** UsdLux's `inputs:intensity`, as authored */
    intensity: number
    /** `inputs:exposure`: the intensity is scaled by 2^exposure */
    exposure?: number
    /** `inputs:normalize`: the light's power does not change with its size */
    normalize?: boolean
    shadow: boolean
    /** a distant light's angular size, in degrees (`inputs:angle`) */
    angle?: number
    /** a rect light's size, in metres */
    width?: number
    height?: number
    /** a disk, sphere or cylinder light's radius, in metres (`inputs:radius`) */
    radius?: number
    /** a cylinder light's length along its x, in metres */
    length?: number
    /** a dome's picture of the sky (`inputs:texture:file`), fetched like a mesh file */
    texture?: string
    /** `inputs:colorTemperature` in kelvin, when `inputs:enableColorTemperature` is on: the colour is tinted by it */
    colorTemperature?: number
    /** ShapingAPI's cone: the half-angle (degrees) it is confined to, and how softly it falls off at the edge (0..1) */
    cone?: { angle: number; softness: number }
}

/** A Camera prim: where it is, and its lens (UsdGeomCamera, its lengths in the stage's tenths of a unit as USD has them). */
export interface DescriptionCamera {
    name: string
    /** its prim path */
    path: string
    xyz: V3
    quat: Q
    link?: string
    origin?: Origin
    projection: "perspective" | "orthographic"
    /** mm, as are the apertures (USD's convention: tenths of a scene unit) */
    focalLength: number
    horizontalAperture: number
    verticalAperture: number
    /** near and far, in metres */
    clippingRange: [number, number]
    /** the camera the stage's RenderSettings render through */
    selected: boolean
}

/**
 * How a scene wants to be shown: the part of its look that is not geometry or lights.
 *
 * Filmic tone mapping rolls bright colour toward white, so a lit room loses most of its paint to the
 * curve; `neutral` keeps the hue and gives up brightness instead. `saturation` and `contrast` are the
 * grade applied after that, which is the difference between a render and a plain rasterised frame.
 */
export interface DescriptionLook {
    toneMap?: "agx" | "neutral" | "filmic" | "linear" | "none"
    exposure?: number
    /** how strongly the dome's sky lights the room as an environment map (Blender's irradiance volumes, roughly) */
    environmentIntensity?: number
    /** how strongly to darken what is enclosed, standing in for the bounce light that never reaches it */
    occlusion?: number
    /** how far the occlusion reaches, in metres (Omniverse's /rtx/ambientOcclusion/rayLength) */
    occlusionRadius?: number
    saturation?: number
    contrast?: number
}

export interface DescriptionJoint {
    name: string
    type: "revolute" | "continuous" | "prismatic" | "fixed" | "floating" | "planar"
    parent: string
    child: string
    origin: Origin
    axis: V3
    limit?: [number, number]
    mimic?: { joint: string; multiplier: number; offset: number }
}

export interface RobotDescription {
    name: string
    base_link: string
    base_frame: string
    base_pose: Origin
    joint_names: string[]
    links: DescriptionLink[]
    joints: DescriptionJoint[]
    /** what the layer says lights it, in world space; absent or empty means the viewer's own lighting stands */
    lights?: DescriptionLight[]
    /** how the layer asks to be shown; absent means the viewer's own look stands */
    look?: DescriptionLook
    /** the stage's cameras, in world space */
    cameras?: DescriptionCamera[]
}

const originMatrix = (origin: Origin) =>
    new THREE.Matrix4().compose(
        new THREE.Vector3(...origin.xyz),
        new THREE.Quaternion(...origin.quat),
        new THREE.Vector3(1, 1, 1),
    )

/** Joint positions by name: a URDF joint's own name, or the name after a prefix (`arm/joint1` → `joint1`). */
export type JointPositions = Record<string, number>

export class Kinematics {
    /** joints by child link, and the tree order (parents before children) */
    readonly #byChild = new Map<string, DescriptionJoint>()
    readonly #order: DescriptionJoint[] = []
    readonly #origins = new Map<string, THREE.Matrix4>()
    readonly root: string
    /** Every link no joint names as a child. A robot standing in a scene is one of these: its own root is
     * placed by TF, not welded to the room, so the scene's description has one root per robot plus the
     * room's. Walking only the first would leave every other robot's links with no pose at all, and a link
     * with no pose is a link the viewer hides -- three robots present in TF and invisible on screen. */
    readonly roots: readonly string[]
    readonly joints: Map<string, DescriptionJoint>
    /** the joint other joints mimic (an xArm's gripper drive_joint): what a gripper position drives */
    readonly gripperJoint: string | null

    constructor(readonly description: RobotDescription) {
        this.joints = new Map(description.joints.map((joint) => [joint.name, joint]))
        for (const joint of description.joints) {
            this.#byChild.set(joint.child, joint)
            this.#origins.set(joint.name, originMatrix(joint.origin))
        }
        const children = new Set(description.joints.map((joint) => joint.child))
        const roots = description.links.filter((link) => !children.has(link.name)).map((link) => link.name)
        this.root = roots[0] ?? description.base_link
        this.roots = roots.length ? roots : [this.root]
        const walked = new Set<string>()
        const visit = (link: string) => {
            for (const joint of description.joints) {
                // A joint reached twice would be ordered twice, and a cycle would never return.
                if (joint.parent === link && !walked.has(joint.name)) {
                    walked.add(joint.name)
                    this.#order.push(joint)
                    visit(joint.child)
                }
            }
        }
        for (const root of this.roots) {
            visit(root)
        }
        const mimicked = description.joints.map((joint) => joint.mimic?.joint).filter((name): name is string => !!name)
        this.gripperJoint = mimicked[0] ?? null
    }

    /** A joint's position from what's given: its own name, a prefixed name, or its mimic source. */
    position(joint: DescriptionJoint, positions: JointPositions): number {
        if (joint.mimic) {
            const source = this.joints.get(joint.mimic.joint)
            return source ? this.position(source, positions) * joint.mimic.multiplier + joint.mimic.offset : 0
        }
        return positions[joint.name] ?? 0
    }

    /** Every link's pose relative to the root link. */
    linkPoses(positions: JointPositions): Map<string, THREE.Matrix4> {
        // Each root at the origin of its own tree; a caller that knows where a root really is (TF) replaces it.
        const poses = new Map<string, THREE.Matrix4>(this.roots.map((root) => [root, new THREE.Matrix4()]))
        const motion = new THREE.Matrix4()
        const axis = new THREE.Vector3()
        for (const joint of this.#order) {
            const parent = poses.get(joint.parent) ?? new THREE.Matrix4()
            const pose = parent.clone().multiply(this.#origins.get(joint.name)!)
            const value = this.position(joint, positions)
            axis.set(...joint.axis).normalize()
            if (joint.type === "revolute" || joint.type === "continuous") {
                pose.multiply(motion.makeRotationAxis(axis, value))
            } else if (joint.type === "prismatic") {
                pose.multiply(motion.makeTranslation(axis.multiplyScalar(value)))
            }
            poses.set(joint.child, pose)
        }
        return poses
    }

    /** The chain of movable joints from `from` down to the link `to`, base first. */
    chain(to: string): DescriptionJoint[] {
        const chain: DescriptionJoint[] = []
        let link = to
        while (this.#byChild.has(link)) {
            const joint = this.#byChild.get(link)!
            if (joint.type !== "fixed" && !joint.mimic) {
                chain.unshift(joint)
            }
            link = joint.parent
        }
        return chain
    }

    /** Each movable joint's position read back from its child link's pose in its parent's (`relative(child, parent)`, e.g. TF). */
    positionsFrom(relative: (child: string, parent: string) => THREE.Matrix4 | null): JointPositions {
        const positions: JointPositions = {}
        const motion = new THREE.Matrix4()
        const rotation = new THREE.Quaternion()
        const translation = new THREE.Vector3()
        for (const joint of this.joints.values()) {
            if (joint.type !== "revolute" && joint.type !== "continuous" && joint.type !== "prismatic") {
                continue
            }
            const pose = relative(joint.child, joint.parent)
            if (!pose) {
                continue
            }
            motion.copy(this.#origins.get(joint.name)!).invert().multiply(pose)
            const axis = new THREE.Vector3(...joint.axis).normalize()
            if (joint.type === "prismatic") {
                positions[joint.name] = translation.setFromMatrixPosition(motion).dot(axis)
            } else {
                rotation.setFromRotationMatrix(motion)
                positions[joint.name] = 2 *
                    Math.atan2(new THREE.Vector3(rotation.x, rotation.y, rotation.z).dot(axis), rotation.w)
            }
        }
        return positions
    }
}

/** URDF names for the joint state's names: `arm/joint1` → `joint1`, a gripper joint → the joint others mimic. */
export function urdfPositions(
    kinematics: Kinematics,
    joints: { name: string; position: number }[],
    isGripper: (name: string) => boolean,
): JointPositions {
    const positions: JointPositions = {}
    for (const { name, position } of joints) {
        if (kinematics.joints.has(name)) {
            positions[name] = position
        } else if (isGripper(name) && kinematics.gripperJoint) {
            positions[kinematics.gripperJoint] = position
        } else {
            const short = name.replace(/^.*\//, "")
            if (kinematics.joints.has(short)) {
                positions[short] = position
            }
        }
    }
    return positions
}

/** The base link's pose in the base frame (the world, usually). */
export function basePose(description: RobotDescription): THREE.Matrix4 {
    return originMatrix(description.base_pose)
}
