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

export interface DescriptionGeometry {
    type: "mesh" | "box" | "cylinder" | "sphere"
    origin: Origin
    mesh?: string
    scale?: V3
    size?: V3
    radius?: number
    length?: number
    color?: [number, number, number, number]
    /** an image the bound material names (UsdUVTexture), to be fetched like a mesh file and tiled over this shape */
    texture?: string
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
    type: "distant" | "point" | "ambient" | "dome"
    /** where it is, for a point light */
    xyz: V3
    /** where it shines, for a distant light */
    direction: V3
    color: [number, number, number]
    intensity: number
    shadow: boolean
}

/**
 * How a scene wants to be shown: the part of its look that is not geometry or lights.
 *
 * Filmic tone mapping rolls bright colour toward white, so a lit room loses most of its paint to the
 * curve; `neutral` keeps the hue and gives up brightness instead. `saturation` and `contrast` are the
 * grade applied after that, which is the difference between a render and a plain rasterised frame.
 */
export interface DescriptionLook {
    toneMap?: "neutral" | "filmic" | "linear" | "none"
    exposure?: number
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
