// Small stand-in models of a robot at its pose: a dog on four legs, a humanoid, a wheeled base, a quad-rotor drone,
// or a plain arrow. Real-world sized, +x forward (REP-103), base_link at the body's center (ground robots stand on
// z = -height). Colors come from the theme (--primary body, --muted-fg joints, --warn nose) unless given.
import * as THREE from "three"
import { themeColors } from "../theme/theme.ts"

export const ROBOT_KINDS = ["dog", "humanoid", "wheeled", "drone", "arrow"]

/** A model's colors: CSS colors or tokens like "var(--primary)". */
export interface RobotModelColors {
    body?: string
    dark?: string
    nose?: string
}

interface Palette {
    body: THREE.Color
    dark: THREE.Color
    nose: THREE.Color
}

type Vec3 = [number, number, number]

/** A CSS color (or a token like "var(--primary)") as a THREE.Color; `fallback` when it can't be resolved. */
export function cssColor(value: string | null | undefined, fallback = "#888888"): THREE.Color {
    let text = value
    // var(--a, <fallback>): --a's value, else the fallback (itself possibly another var(...))
    while (typeof text === "string" && text.startsWith("var(") && typeof document !== "undefined") {
        const inner = text.slice(4, -1)
        const comma = inner.indexOf(",")
        const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
        text = getComputedStyle(document.body ?? document.documentElement).getPropertyValue(name).trim() ||
            (comma < 0 ? "" : inner.slice(comma + 1).trim())
    }
    const color = new THREE.Color()
    try {
        // color-mix() and friends aren't parseable by three; a 1px canvas resolves any CSS color
        if (text && /^[a-z-]+\(/i.test(text) && !/^(rgb|hsl)a?\(/i.test(text) && typeof document !== "undefined") {
            const canvas = document.createElement("canvas")
            canvas.width = canvas.height = 1
            // no 2D context throws below, into the catch
            const context = canvas.getContext("2d")!
            context.fillStyle = text
            context.fillRect(0, 0, 1, 1)
            const [r, g, b] = context.getImageData(0, 0, 1, 1).data
            return color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
        }
        color.setStyle(text || fallback)
    } catch {
        color.setStyle(fallback)
    }
    return color
}

function palette(colors: RobotModelColors = {}): Palette {
    const theme = themeColors()
    return {
        body: cssColor(colors.body ?? theme.primary, "#5fb4e6"),
        dark: cssColor(colors.dark ?? theme.mutedFg, "#26323f"),
        nose: cssColor(colors.nose ?? theme.warn, "#f5b14c"),
    }
}

function material(color: THREE.Color, opacity = 0.85) {
    return new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })
}

function box(x: number, y: number, z: number, at: Vec3, color: THREE.Color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material(color))
    mesh.position.set(...at)
    return mesh
}

function cylinder(radius: number, length: number, at: Vec3, axis: "x" | "y" | "z", color: THREE.Color) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), material(color))
    mesh.position.set(...at)
    if (axis === "x") {
        mesh.rotation.z = Math.PI / 2
    } else if (axis === "z") {
        mesh.rotation.x = Math.PI / 2
    }
    return mesh
}

function heading(at: Vec3, size: number, color: THREE.Color) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(size * 0.5, size, 16), material(color, 0.95))
    cone.rotation.z = -Math.PI / 2
    cone.position.set(...at)
    return cone
}

const MAKERS: Record<string, (p: Palette) => THREE.Group> = {
    dog(p) {
        const group = new THREE.Group()
        group.add(box(0.6, 0.26, 0.14, [0, 0, 0], p.body))
        group.add(box(0.14, 0.18, 0.12, [0.33, 0, 0.04], p.dark))
        for (const x of [0.22, -0.22]) {
            for (const y of [0.13, -0.13]) {
                group.add(cylinder(0.025, 0.3, [x, y, -0.2], "z", p.dark))
            }
        }
        group.add(heading([0.45, 0, 0.04], 0.08, p.nose))
        return group
    },
    humanoid(p) {
        const group = new THREE.Group()
        group.add(box(0.18, 0.34, 0.4, [0, 0, 0.25], p.body))
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), material(p.dark))
        head.position.set(0, 0, 0.56)
        group.add(head)
        for (const y of [0.1, -0.1]) {
            group.add(cylinder(0.04, 0.6, [0, y, -0.28], "z", p.dark))
        }
        for (const y of [0.22, -0.22]) {
            group.add(cylinder(0.03, 0.42, [0, y, 0.22], "z", p.dark))
        }
        group.add(heading([0.16, 0, 0.56], 0.07, p.nose))
        return group
    },
    wheeled(p) {
        const group = new THREE.Group()
        group.add(box(0.55, 0.45, 0.18, [0, 0, 0], p.body))
        for (const x of [0.17, -0.17]) {
            for (const y of [0.25, -0.25]) {
                group.add(cylinder(0.09, 0.06, [x, y, -0.06], "y", p.dark))
            }
        }
        group.add(heading([0.33, 0, 0.02], 0.09, p.nose))
        return group
    },
    drone(p) {
        const group = new THREE.Group()
        group.add(box(0.16, 0.16, 0.07, [0, 0, 0], p.body))
        for (const angle of [45, 135, 225, 315]) {
            const radians = (angle * Math.PI) / 180
            const arm = box(0.26, 0.025, 0.02, [Math.cos(radians) * 0.13, Math.sin(radians) * 0.13, 0], p.dark)
            arm.rotation.z = radians
            group.add(arm)
            const rotor = cylinder(0.08, 0.008, [Math.cos(radians) * 0.24, Math.sin(radians) * 0.24, 0.03], "z", p.body)
            rotor.material.opacity = 0.45
            rotor.material.transparent = true
            group.add(rotor)
        }
        group.add(heading([0.13, 0, 0], 0.06, p.nose))
        return group
    },
    arrow(p) {
        const group = new THREE.Group()
        group.add(cylinder(0.025, 0.4, [0.2, 0, 0], "x", p.body))
        group.add(heading([0.45, 0, 0], 0.12, p.nose))
        return group
    },
}

/**
 * A stand-in model of `kind` (ROBOT_KINDS), or null for an unknown kind.
 * @param colors CSS colors or tokens
 */
export function robotModel(kind: string, colors?: RobotModelColors): THREE.Group | null {
    const make = MAKERS[kind]
    if (!make) {
        return null
    }
    const group = make(palette(colors))
    group.name = `robot-model-${kind}`
    group.matrixAutoUpdate = false
    group.renderOrder = 1
    return group
}

/** Disposes a model's geometries and materials (and removes it from its parent). */
export function disposeTree(object: THREE.Object3D) {
    object.traverse((child) => {
        const { geometry, material } = child as Partial<THREE.Mesh>
        geometry?.dispose()
        if (Array.isArray(material)) {
            material.forEach((item) => item.dispose())
        } else {
            material?.dispose()
        }
    })
    object.removeFromParent()
}
