// A CAD-style view cube for the 3D view: a small cube in a corner that turns with the camera. Click a face (Top,
// Front, Right, ...), an edge or a corner to orbit there (the 26 standard views, keeping the target and distance), or
// drag it to orbit. Z is up: Top is +z, Front looks along +y (from -y), Right along -x (from +x). It draws on its own
// small canvas, so its clicks never reach the scene's picking.
import * as THREE from "three"
import { themeColors } from "../theme/theme.ts"
import type { Viewer } from "./viewer.ts"

export type ViewCubeCorner = "top-right" | "top-left" | "bottom-right" | "bottom-left"

/** A spot on the cube: each axis -1, 0 or 1 (a face has one non-zero, an edge two, a corner three). */
export type CubeRegion = [number, number, number]

/** how much of the cube's half-size counts as an edge or corner band (the rest of a face is the face) */
export const EDGE_BAND = 0.3

const FACES: { normal: CubeRegion; up: CubeRegion; label: string }[] = [
    { normal: [0, 0, 1], up: [0, 1, 0], label: "Top" },
    { normal: [0, 0, -1], up: [0, -1, 0], label: "Bottom" },
    { normal: [0, -1, 0], up: [0, 0, 1], label: "Front" },
    { normal: [0, 1, 0], up: [0, 0, 1], label: "Back" },
    { normal: [1, 0, 0], up: [0, 0, 1], label: "Right" },
    { normal: [-1, 0, 0], up: [0, 0, 1], label: "Left" },
]

/** The region under a point on the cube's surface (cube-local, half-size 1). */
export function cubeRegion(point: { x: number; y: number; z: number }, band = EDGE_BAND): CubeRegion {
    const axis = (value: number) => (value > 1 - band ? 1 : value < -(1 - band) ? -1 : 0)
    return [axis(point.x), axis(point.y), axis(point.z)]
}

/** "Top", "Front Right", "Top Front Left", ... */
export function regionLabel([x, y, z]: CubeRegion): string {
    const parts = [
        z > 0 ? "Top" : z < 0 ? "Bottom" : "",
        y < 0 ? "Front" : y > 0 ? "Back" : "",
        x > 0 ? "Right" : x < 0 ? "Left" : "",
    ]
    return parts.filter(Boolean).join(" ")
}

/**
 * The direction to look from (target → camera, unit) for a region. Straight above or below gets a hair of -y, so the
 * screen's up stays +y (OrbitControls can't look exactly along its up axis).
 */
export function regionDirection([x, y, z]: CubeRegion): THREE.Vector3 {
    const direction = new THREE.Vector3(x, y, z)
    if (x === 0 && y === 0) {
        direction.y = -0.002
    }
    return direction.normalize()
}

/** The highlight box of a region: its center and size, cube-local, a little proud of the surface. */
export function regionBox(region: CubeRegion, band = EDGE_BAND): { center: THREE.Vector3; size: THREE.Vector3 } {
    const proud = 0.04
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    region.forEach((value, axis) => {
        if (value === 0) {
            center.setComponent(axis, 0)
            size.setComponent(axis, 2 - 2 * band)
        } else {
            center.setComponent(axis, value * (1 - band / 2 + proud / 2))
            size.setComponent(axis, band + proud)
        }
    })
    return { center, size }
}

const faceColors = () => {
    const colors = themeColors()
    return {
        face: colors.raised || colors.surface || "#2a2f38",
        border: colors.border || "#4a505c",
        text: colors.fg || "#e6e8eb",
        hover: colors.primary || "#3b82f6",
        font: colors.sans || "system-ui, sans-serif",
    }
}

function faceTexture(label: string, colors: ReturnType<typeof faceColors>, anisotropy: number): THREE.CanvasTexture {
    // big enough that the face is drawn from it shrunk, never stretched, even supersampled on a 2x screen
    const size = 512
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    const context = canvas.getContext("2d")
    if (context) {
        // the face a step lighter than the surface (so the cube stands off a dark scene), inside a dark border: two faces'
        // borders meet in one thick dark line along each edge, flat (no lighter stroke to read as a gradient)
        const border = 28
        context.fillStyle = colors.face
        context.fillRect(0, 0, size, size)
        context.globalAlpha = 0.16
        context.fillStyle = colors.text
        context.fillRect(border, border, size - 2 * border, size - 2 * border)
        context.globalAlpha = 1
        context.fillStyle = colors.text
        context.textAlign = "center"
        context.textBaseline = "middle"
        context.font = `700 ${label.length > 5 ? 100 : 116}px ${colors.font}`
        context.fillText(label.toUpperCase(), size / 2, size / 2 + 4)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = anisotropy
    return texture
}

export interface ViewCubeOptions {
    corner?: ViewCubeCorner
    /** CSS pixels */
    size?: number
    /** drawn at this many times the screen's pixels and shrunk, so its edges and labels come out smooth */
    supersample?: number
}

export class ViewCube {
    readonly canvas: HTMLCanvasElement
    #viewer: Viewer
    #renderer: THREE.WebGLRenderer
    #size: number
    #supersample: number
    #densityQuery: MediaQueryList | null = null
    #scene = new THREE.Scene()
    #camera = new THREE.OrthographicCamera(-1.85, 1.85, 1.85, -1.85, 0.1, 50)
    #cube = new THREE.Group()
    #pickBox = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ visible: false }))
    #highlight = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
    )
    #edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }),
    )
    #faces: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = []
    #hover: CubeRegion | null = null
    #lastQuaternion = new THREE.Quaternion(NaN, NaN, NaN, NaN)
    #dirty = true
    #raycaster = new THREE.Raycaster()
    #drag: { x: number; y: number; moved: boolean; id: number } | null = null
    #offFrame: () => void
    #onTheme = () => this.setTheme()

    constructor(
        viewer: Viewer,
        parent: HTMLElement,
        { corner = "top-right", size = 96, supersample = 2 }: ViewCubeOptions = {},
    ) {
        this.#viewer = viewer
        this.#size = size
        this.#supersample = supersample
        this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        this.#fitPixels()
        this.#renderer.setClearColor(0x000000, 0)
        this.canvas = this.#renderer.domElement
        this.canvas.className = `dr-scene-viewcube dr-scene-viewcube--${corner}`
        this.canvas.setAttribute("role", "img")
        this.canvas.setAttribute("aria-label", "View cube: click a face, edge or corner to look from there")
        parent.appendChild(this.canvas)

        for (const face of FACES) {
            const normal = new THREE.Vector3(...face.normal)
            const up = new THREE.Vector3(...face.up)
            const right = up.clone().cross(normal)
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial())
            mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal))
            mesh.position.copy(normal)
            mesh.userData.label = face.label
            this.#faces.push(mesh)
            this.#cube.add(mesh)
        }
        this.#highlight.visible = false
        this.#highlight.renderOrder = 2
        // the faces draw their own thick borders: the 1 px GL edges would only blur them
        this.#edges.visible = false
        this.#cube.add(this.#pickBox, this.#edges, this.#highlight)
        this.#scene.add(this.#cube)
        this.setTheme()

        this.canvas.addEventListener("pointermove", this.#onMove)
        this.canvas.addEventListener("pointerleave", this.#onLeave)
        this.canvas.addEventListener("pointerdown", this.#onDown)
        this.canvas.addEventListener("pointerup", this.#onUp)
        this.canvas.addEventListener("pointercancel", this.#onCancel)
        // the wheel over the cube zooms the scene, as it would anywhere else on the view
        this.canvas.addEventListener("wheel", this.#onWheel, { passive: false })
        addEventListener("dimos-react-theme", this.#onTheme)
        this.#offFrame = viewer.onFrame(() => this.#sync())
        this.#sync()
    }

    /** The canvas at the screen's current pixel density (times the supersampling); again whenever that changes (zoom, another screen). */
    #fitPixels = () => {
        const density = globalThis.devicePixelRatio || 1
        this.#renderer.setPixelRatio(density * this.#supersample)
        this.#renderer.setSize(this.#size, this.#size)
        this.#densityQuery?.removeEventListener("change", this.#fitPixels)
        this.#densityQuery = globalThis.matchMedia?.(`(resolution: ${density}dppx)`) ?? null
        this.#densityQuery?.addEventListener("change", this.#fitPixels)
        this.#dirty = true
        if (this.#faces.length) {
            this.#sync()
        }
    }

    /** Re-reads the theme's colors (faces, edges, hover). */
    setTheme() {
        const colors = faceColors()
        const anisotropy = this.#renderer.capabilities.getMaxAnisotropy()
        for (const face of this.#faces) {
            face.material.map?.dispose()
            face.material.map = faceTexture(face.userData.label, colors, anisotropy)
            face.material.needsUpdate = true
        }
        this.#edges.material.color.set(colors.border)
        this.#highlight.material.color.set(colors.hover)
        this.#dirty = true
        this.#sync()
    }

    /** Mirrors the main camera: the cube shows the world's axes the way the view sees them. */
    #sync() {
        const camera = this.#viewer.camera
        if (!this.#dirty && camera.quaternion.equals(this.#lastQuaternion)) {
            return
        }
        this.#lastQuaternion.copy(camera.quaternion)
        this.#camera.quaternion.copy(camera.quaternion)
        this.#camera.position.set(0, 0, 10).applyQuaternion(camera.quaternion)
        this.#camera.updateMatrixWorld()
        this.#dirty = false
        this.#renderer.render(this.#scene, this.#camera)
    }

    #regionAt(event: PointerEvent): CubeRegion | null {
        const rect = this.canvas.getBoundingClientRect()
        const ndc = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        )
        this.#raycaster.setFromCamera(ndc, this.#camera)
        const hit = this.#raycaster.intersectObject(this.#pickBox, false)[0]
        return hit ? cubeRegion(this.#pickBox.worldToLocal(hit.point.clone())) : null
    }

    #setHover(region: CubeRegion | null) {
        const same = region && this.#hover && region.every((value, axis) => value === this.#hover![axis])
        if (same || (!region && !this.#hover)) {
            return
        }
        this.#hover = region
        this.#highlight.visible = !!region
        if (region) {
            const { center, size } = regionBox(region)
            this.#highlight.position.copy(center)
            this.#highlight.scale.copy(size)
        }
        this.canvas.title = region ? regionLabel(region) : ""
        this.canvas.style.cursor = region ? "pointer" : ""
        this.#dirty = true
        this.#sync()
    }

    #onMove = (event: PointerEvent) => {
        const drag = this.#drag
        if (drag && drag.id === event.pointerId) {
            const dx = event.clientX - drag.x
            const dy = event.clientY - drag.y
            if (!drag.moved && Math.hypot(dx, dy) < 4) {
                return
            }
            drag.moved = true
            drag.x = event.clientX
            drag.y = event.clientY
            this.#orbit(dx, dy)
            return
        }
        this.#setHover(this.#regionAt(event))
    }

    #onLeave = () => {
        if (!this.#drag) {
            this.#setHover(null)
        }
    }

    #onDown = (event: PointerEvent) => {
        if (event.button !== 0) {
            return
        }
        event.preventDefault()
        this.canvas.setPointerCapture?.(event.pointerId)
        this.#drag = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId }
    }

    #onUp = (event: PointerEvent) => {
        const drag = this.#drag
        this.#drag = null
        this.canvas.releasePointerCapture?.(event.pointerId)
        if (!drag || drag.moved) {
            return
        }
        const region = this.#regionAt(event)
        if (region) {
            this.#viewer.viewFrom(regionDirection(region))
        }
    }

    #onCancel = () => {
        this.#drag = null
    }

    #onWheel = (event: WheelEvent) => {
        event.preventDefault()
        this.#viewer.canvas.dispatchEvent(new WheelEvent("wheel", event))
    }

    /** Dragging the cube orbits the view around its target, like dragging the scene. */
    #orbit(dx: number, dy: number) {
        const viewer = this.#viewer
        const offset = viewer.camera.position.clone().sub(viewer.controls.target)
        const spherical = new THREE.Spherical().setFromVector3(new THREE.Vector3(offset.x, offset.z, -offset.y))
        spherical.theta -= dx * 0.012
        spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.012, 0.001, viewer.controls.maxPolarAngle)
        const turned = new THREE.Vector3().setFromSpherical(spherical)
        viewer.viewFrom(new THREE.Vector3(turned.x, -turned.z, turned.y).normalize(), { animate: false })
    }

    dispose() {
        this.#offFrame()
        this.#densityQuery?.removeEventListener("change", this.#fitPixels)
        removeEventListener("dimos-react-theme", this.#onTheme)
        this.canvas.removeEventListener("pointermove", this.#onMove)
        this.canvas.removeEventListener("pointerleave", this.#onLeave)
        this.canvas.removeEventListener("pointerdown", this.#onDown)
        this.canvas.removeEventListener("pointerup", this.#onUp)
        this.canvas.removeEventListener("pointercancel", this.#onCancel)
        this.canvas.removeEventListener("wheel", this.#onWheel)
        this.#scene.traverse((object) => {
            const mesh = object as THREE.Mesh
            mesh.geometry?.dispose()
            const material = mesh.material as THREE.MeshBasicMaterial | undefined
            material?.map?.dispose()
            material?.dispose()
        })
        this.#renderer.dispose()
        this.#renderer.forceContextLoss?.()
        this.canvas.remove()
    }
}
