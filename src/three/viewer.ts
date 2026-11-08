// The three.js view (ported from dim-controller core/render/viewer.ts): one renderer, a ROS-convention (Z up) scene in
// the fixed frame, orbit/pan/zoom controls (mouse: left orbit, right / shift-left pan, wheel zoom; touch: one finger
// orbit, two fingers pan + pinch zoom), a smoothed follow camera, a 2D label overlay, and a render loop that only
// draws when something changed. It keeps fps / frame time / latency numbers in `stats`.
import * as THREE from "three"
import { ON_TOP_CHANNEL, OnTopPass } from "./on_top.ts"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js"
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { Store } from "./store.ts"
import type { DescriptionLight, DescriptionLook } from "./urdf/description.ts"
import { focusDistance, splatBackground } from "./point_material.ts"
import { CATCH_UP_SECONDS, PanGate, SmoothFollow } from "./follow.ts"

// A layer states a light's brightness the way MuJoCo does: the magnitude of its colour, 0..1. Turning that into
// three's units is this side's job, because only this side knows three's falloff model.
//
// A directional light has no falloff, so it scales straight: a 0.55 sun becomes a 1.65 key.
const DEFAULT_EXPOSURE = 1.1
const DISTANT_GAIN = 3
// A point light does: three's decay of 2 divides by the square of the distance, so an intensity that reads as 0.18
// on a wall 3 m away has to leave the lamp at 0.18 * 3^2. Scaling by the gain alone is what made eighteen ceiling
// fittings contribute nothing at all -- 0.72 at the bulb is 0.08 by the time it reaches the floor.
const POINT_REFERENCE_METRES = 3
const POINT_GAIN = 4
// Ambient has no direction to fall off along; it is the fill that keeps shadows from going black.
const AMBIENT_GAIN = 2
/** how often the drawn meshes are measured again: they stream in, and the first frame's box is the robot alone */
const SHADOW_REFIT_MS = 2000

import { themeColors } from "../theme/theme.ts"
import { cssColor } from "./robot_model.ts"
import { FRAME_BUDGET_MS, splatFallback } from "./rendering.ts"
import { aimShadow, castsShadow, lampCastsShadow, MAX_SHADOW_LAMPS, SHADOW_MIN_EXTENT_METRES } from "./shadows.ts"
import { SKY_ROTATION_X, skyTexture } from "./sky.ts"

export interface RenderStats {
    fps: number
    frameMs: number
    latencyP50: number | null
    latencyP95: number | null
    arrivalToFrameMs: number | null
    drawCalls: number
    points: number
}

/** `now`: performance.now() of the frame; `dataNow`: the data clock (a replay's playhead, else performance.now()) */
export interface FrameInfo {
    now: number
    dataNow: number
    fixedFrame: string
    camera: THREE.PerspectiveCamera
}

export interface ViewerOptions {
    clock?: () => number
    grid?: boolean
    antialias?: boolean
    near?: number
    far?: number
    fov?: number
    gridSize?: number
    gridDivisions?: number
    freeOrbit?: boolean
}

export interface PickResult {
    point: THREE.Vector3
    on: "points" | "mesh" | "ground"
    object?: THREE.Object3D
}

/** OrbitControls' private damping state, cleared when the camera is placed directly. */
interface OrbitControlsInternals {
    _sphericalDelta?: THREE.Spherical
    _panOffset?: THREE.Vector3
    _scale?: number
}

const isPoints = (object: THREE.Object3D): object is THREE.Points => !!(object as Partial<THREE.Points>).isPoints
const isMesh = (object: THREE.Object3D): object is THREE.Mesh => !!(object as Partial<THREE.Mesh>).isMesh
const isLineSegments2 = (object: THREE.Object3D): boolean => !!(object as Partial<LineSegments2>).isLineSegments2

/**
 * `direction` as a unit vector no further than `maxPolar` from +z (the orbit's limit): one below it keeps its heading
 * and sits on the limit (straight down: from the front, -y). Null for a zero or non-finite direction.
 */
export function limitPolar(direction: THREE.Vector3, maxPolar: number): THREE.Vector3 | null {
    const to = direction.clone().normalize()
    if (!Number.isFinite(to.x) || to.lengthSq() === 0) {
        return null
    }
    if (Math.acos(THREE.MathUtils.clamp(to.z, -1, 1)) > maxPolar) {
        const flat = new THREE.Vector2(to.x, to.y)
        if (flat.lengthSq() < 1e-12) {
            flat.set(0, -1)
        }
        flat.normalize().multiplyScalar(Math.sin(maxPolar))
        to.set(flat.x, flat.y, Math.cos(maxPolar))
    }
    return to
}

/** The canvas renders at the screen's resolution, up to 2× (beyond that the extra pixels cost more than they show). */
const pixelRatio = () => Math.min(2, globalThis.devicePixelRatio || 1)

export class Viewer {
    /** null when the browser couldn't start WebGL: the scene still updates but nothing draws (`webglError` says why) */
    renderer: THREE.WebGLRenderer | null
    webglError: string | null
    /** what the view draws into and takes pointer input on: the renderer's canvas, or a blank one without WebGL */
    canvas: HTMLCanvasElement
    labels: CSS2DRenderer
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(60, 1, 0.05, 10000)
    /** the lighting used when nothing in the scene says what its own is */
    #defaultLights: THREE.Light[] = []
    /** the lighting a loaded scene asked for, which stands in for the defaults while it is there */
    #sceneLights: THREE.Light[] = []
    #look: DescriptionLook | null = null
    #environment: THREE.Texture | null = null
    #environmentFrom: THREE.Texture | null = null
    #shadowLamps: THREE.PointLight[] = []
    /** every light casting a shadow right now: their boxes are re-aimed as the drawn scene grows */
    #shadowCasters: THREE.DirectionalLight[] = []
    /** the bounds the casters were last aimed at, to tell a scene that grew from one that only moved */
    #shadowBounds: THREE.Box3 | null = null
    #shadowFittedAt = 0
    #sky: THREE.CanvasTexture | null = null
    controls: OrbitControls
    stats: Store<RenderStats> = new Store({
        fps: 0,
        frameMs: 0,
        latencyP50: null,
        latencyP95: null,
        arrivalToFrameMs: null,
        drawCalls: 0,
        points: 0,
    })
    /** world units → pixels at 1 m depth; point shaders size by it */
    pixelsPerMeter = { value: 1 }
    /** view size in CSS pixels; thick-line materials share it */
    resolution = new THREE.Vector2(1, 1)
    fixedFrame = "world"
    /** where the camera follows (a point in the fixed frame); the React layer sets it each frame from followFrame */
    followTarget: THREE.Vector3 | null = null
    /** a hidden view (display: none, a collapsed pane) draws nothing; what changed meanwhile is drawn once unpaused */
    paused = false
    /** following stopped because the user panned away; `resumeFollow()` ends it */
    followPaused = new Store({ paused: false })
    /**
     * The clock things age by (ms): point-cloud windows, marker lifetimes, rates. performance.now() live; a replay's
     * playhead (Scene3D sets it from a replay source), so a paused replay doesn't age.
     */
    dataClock = () => performance.now()

    #host: HTMLElement
    #dirty = true
    #listeners: Set<(frame: FrameInfo) => void> = new Set()
    #grid: THREE.GridHelper | null = null
    #gridVisible = true
    #gridSize = 60
    #gridDivisions = 60
    #frameTimes: number[] = []
    #cpuTimes: number[] = []
    #pendingData: { ts: number; arrival: number }[] = []
    #latencies: number[] = []
    #arrivals: number[] = []
    #lastStats = 0
    #lastDeclutter = 0
    #clock: () => number
    #follow = new SmoothFollow()
    #lastFollow = new THREE.Vector3()
    #following = false
    #followDelta = new THREE.Vector3()
    #catchingUp = false
    #panGate = new PanGate()
    #beforeControls = new THREE.Vector3()
    #pan = new THREE.Vector3()
    #reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null
    #lastFrame = 0
    #frameRequest = 0
    #resizeObserver: ResizeObserver
    #disposed = false
    #resetListeners: Set<() => void> = new Set()
    #onTop = new OnTopPass()
    #slowSeconds = 0
    /** a viewFrom() orbit in progress: unit directions (target → camera), start time, length */
    #glide: { from: THREE.Vector3; turn: THREE.Quaternion; start: number; ms: number; distance: number } | null = null

    /**
     * @param host the element the canvas fills (give it a size; it is watched for resizes)
     * @param options `clock`: the clock message
     *   timestamps are in (ms, for latency; default Date.now). `near` / `far` / `fov`: the camera (defaults 0.05 m,
     *   10 km, 60°; a small model like a URDF wants near ≈ 0.001). `gridSize` (m) / `gridDivisions`: the ground grid
     *   (default 60 m in 1 m cells; a grid that runs to the horizon aliases its lines into a black band there). `freeOrbit`: the camera may orbit below the ground (default: it stays above).
     */
    constructor(
        host: HTMLElement,
        {
            clock = () => Date.now(),
            grid = true,
            antialias = false,
            near = 0.05,
            far = 10000,
            fov = 60,
            gridSize = 60,
            gridDivisions = 60,
            freeOrbit = false,
        }: ViewerOptions = {},
    ) {
        this.#host = host
        this.#clock = clock
        this.#gridVisible = grid
        this.#gridSize = gridSize
        this.#gridDivisions = gridDivisions
        this.camera.near = near
        this.camera.far = far
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
        let renderer: THREE.WebGLRenderer | null = null
        try {
            renderer = new THREE.WebGLRenderer({ antialias, alpha: true, powerPreference: "high-performance" })
            renderer.setPixelRatio(pixelRatio())
            renderer.setClearColor(0x000000, 0)
            // Lights are given in the intensities a room really has, which blow out without one. Filmic rolls the
            // highlights off instead of clipping them to white. A scene that would rather keep its colour than its
            // brightness says so through setSceneLook.
            renderer.toneMapping = THREE.ACESFilmicToneMapping
            renderer.toneMappingExposure = DEFAULT_EXPOSURE
            // A shape only reads as a shape if something is darker than the rest of it.
            renderer.shadowMap.enabled = true
            renderer.shadowMap.type = THREE.PCFSoftShadowMap
        } catch (error) {
            console.warn("3D view: WebGL unavailable", error)
        }
        this.renderer = renderer
        this.webglError = renderer ? null : "this browser couldn't start WebGL"
        this.canvas = renderer?.domElement ?? document.createElement("canvas")
        this.canvas.className = "dr-scene-canvas"
        host.appendChild(this.canvas)
        this.labels = new CSS2DRenderer()
        this.labels.domElement.className = "dr-scene-labels"
        host.appendChild(this.labels.domElement)

        this.camera.up.set(0, 0, 1)
        this.camera.position.set(-6, -6, 5)
        this.controls = new OrbitControls(this.camera, this.canvas)
        this.controls.enableDamping = true
        this.controls.dampingFactor = 0.18
        this.controls.screenSpacePanning = false
        this.controls.maxPolarAngle = freeOrbit ? Math.PI : Math.PI * 0.495
        this.controls.addEventListener("change", () => this.requestRender())
        this.controls.addEventListener("start", () => {
            this.#panGate.start()
            // the user grabbed the view: a viewFrom() glide stops where it is
            this.#glide = null
        })

        // A hemisphere light bright enough to light the scene on its own lights every face of every object the
        // same, which is why a room full of furniture came out as flat pastel cutouts. It belongs at the level of
        // light bouncing off the walls; what shows a shape is a key light strong enough to leave the far side of
        // it dark, with shadows underneath. The fill opposite the key keeps that far side readable rather than
        // black.
        const sky = new THREE.HemisphereLight(0xdde8ff, 0x202830, 0.5)
        const sun = new THREE.DirectionalLight(0xfff4e6, 2.4)
        castsShadow(sun, new THREE.Vector3(-5, -3, -10))
        const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6)
        fill.position.set(-6, -4, 3)
        for (const light of [sky, sun, fill]) {
            // lights only reach the passes whose channel they're on
            light.layers.enable(ON_TOP_CHANNEL)
            this.scene.add(light)
        }
        this.scene.add(sun.target)
        this.#defaultLights = [sky, sun, fill]
        this.#shadowCasters = [sun]
        this.#fitShadows()
        this.setTheme()

        this.#resizeObserver = new ResizeObserver(() => this.#resize())
        this.#resizeObserver.observe(host)
        this.#watchPixelRatio()
        this.#resize()
        this.#frameRequest = requestAnimationFrame(this.#loop)
    }

    #makeGrid(dark: boolean): THREE.GridHelper {
        const colors = themeColors()
        const grid = new THREE.GridHelper(
            this.#gridSize,
            this.#gridDivisions,
            cssColor(colors.sceneGridMajor || colors.border, "gray"),
            cssColor(colors.sceneGrid || colors.surface, "gray"),
        )
        grid.rotation.x = Math.PI / 2
        grid.userData.noPick = true
        grid.material.transparent = true
        // It is a ruler, not scenery. At 0.7 it read as a tiled floor laid over the room and
        // competed with what is actually there; faint enough to measure against and no more.
        grid.material.opacity = dark ? 0.18 : 0.14
        grid.visible = this.#gridVisible
        return grid
    }

    /**
     * Light the scene the way a loaded description says to, instead of the viewer's own guess.
     *
     * A scene knows how it is lit and the viewer does not: office_555 names a sun and eighteen ceiling fittings,
     * and lighting it with one fixed key and a fill renders it as flat pastel cutouts no matter how the room was
     * built. Passing an empty list (or none) puts the defaults back, which is what a robot on its own wants.
     *
     * Intensities arrive in USD's photometric units, where a lamp is in the hundreds; three's lights are relative,
     * so a point light is divided back down by the same factor the exporter multiplied up by.
     */
    /**
     * How the scene asks to be shown, or `null` for the viewer's own look.
     *
     * A room's colours were chosen against some tone curve, and showing them through a different one shows a room
     * nobody picked: filmic rolls bright colour toward white, so paint that looked right in the authoring tool
     * arrives washed out. A layer that cares names the curve it wants, and the grade that goes after it.
     *
     * The grade is a CSS filter on the canvas rather than a render pass. The canvas is already transparent with
     * the page's background behind it, so the filter reaches what was drawn and nothing else, and it costs no
     * extra target to composite through -- worth more here than the precision a real pass would buy.
     */
    setSceneLook(look: DescriptionLook | null | undefined): void {
        this.#look = look ?? null
        const renderer = this.renderer
        if (!renderer) return
        const curve = look?.toneMap
        renderer.toneMapping = curve === "agx"
            // Blender's own default view transform, so a room graded to look right in Blender keeps
            // looking right here. It holds saturation into the highlights where filmic bleaches them.
            ? THREE.AgXToneMapping
            : curve === "neutral"
            ? THREE.NeutralToneMapping
            : curve === "linear"
            ? THREE.LinearToneMapping
            : curve === "none"
            ? THREE.NoToneMapping
            : THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = look?.exposure ?? DEFAULT_EXPOSURE
        // The nearest thing this renderer has to Blender's irradiance volumes. Blender's rooms read
        // right largely because light bounces; here nothing does, and a two-colour hemisphere is a poor
        // stand-in -- it lights a face by which way it points and nothing else. Pre-filtering the dome's
        // own sky into an environment map at least lights each face by what is actually above it.
        //
        // Pre-filtered, not handed over raw: three builds a PMREM from whatever is assigned here, and a
        // raw strip made that fail. Generated once per sky and disposed with it.
        const environment = look?.environmentIntensity
        if (environment !== undefined && this.#sky) {
            this.scene.environment = this.#environmentOf(this.#sky)
            this.scene.environmentRotation.set(SKY_ROTATION_X, 0, 0)
            this.scene.environmentIntensity = environment
            for (const light of this.#sceneLights) {
                if (light instanceof THREE.HemisphereLight) {
                    light.intensity = 0
                }
            }
        } else {
            this.scene.environment = null
            this.scene.environmentIntensity = 1
        }
        const saturation = look?.saturation ?? 1
        const contrast = look?.contrast ?? 1
        const grade = []
        if (saturation !== 1) grade.push(`saturate(${saturation})`)
        if (contrast !== 1) grade.push(`contrast(${contrast})`)
        renderer.domElement.style.filter = grade.length > 0 ? grade.join(" ") : ""
        this.requestRender()
    }

    setSceneLights(lights: readonly DescriptionLight[] | null | undefined): void {
        for (const light of this.#sceneLights) {
            light.removeFromParent()
            light.dispose()
        }
        this.#sceneLights = []
        this.#shadowLamps = []
        this.#shadowCasters = this.#defaultLights.filter((light) => light.castShadow) as THREE.DirectionalLight[]
        const wanted = lights ?? []
        if (!wanted.some((light) => light.type === "dome")) {
            this.#clearSky()
        }
        for (const light of this.#defaultLights) light.visible = wanted.length === 0
        // A lamp's shadow is a cube map -- six renders a frame -- so only a few get one. Without
        // any, a room lit from its own ceiling has nothing standing on the floor: the sun through
        // the windows is the only thing casting, and a desk under a fitting throws no shadow of
        // its own.
        //
        // Which few is decided per frame by #aimShadowLamps, not here, because a room's fittings
        // are all the same lamp: picking "the brightest" off eighteen identical ceiling lights is
        // an all-ties sort that always lands on the same arbitrary corner, and every desk
        // elsewhere stays shadowless.
        const lamps = wanted.filter((light) =>
            light.type !== "distant" && light.type !== "dome" && light.type !== "ambient"
        )
        for (const light of wanted) {
            const colour = new THREE.Color(light.color[0], light.color[1], light.color[2])
            if (light.type === "dome") {
                // A dome light is the sky: it lights everything, and it is what you see when you
                // look past the room. Painting it as well as lighting by it is what stops an
                // office with windows from having flat black outside them.
                this.#setSky(colour, light.intensity)
            }
            const made = light.type === "distant"
                ? new THREE.DirectionalLight(colour, light.intensity * DISTANT_GAIN)
                : light.type === "ambient" || light.type === "dome"
                ? new THREE.HemisphereLight(colour, colour.clone().multiplyScalar(0.4), light.intensity * AMBIENT_GAIN)
                : new THREE.PointLight(
                    colour,
                    light.intensity * POINT_GAIN * POINT_REFERENCE_METRES * POINT_REFERENCE_METRES,
                    0,
                    2,
                )
            if (made instanceof THREE.DirectionalLight) {
                // A distant light has no position, only a direction: aimShadow stands it off from the scene.
                made.position.set(...(light.direction.map((value) => -value * 50) as [number, number, number]))
                if (light.shadow) {
                    castsShadow(made, new THREE.Vector3(...light.direction))
                    this.scene.add(made.target)
                    this.#shadowCasters.push(made)
                }
            } else {
                made.position.set(...light.xyz)
                if (made instanceof THREE.PointLight && light.shadow && lamps.includes(light)) {
                    made.userData.lampRadius = light.radius ?? 0
                    this.#shadowLamps.push(made)
                }
            }
            made.layers.enable(ON_TOP_CHANNEL)
            this.scene.add(made)
            this.#sceneLights.push(made)
        }
        this.#shadowBounds = null
        this.#fitShadows()
        // These lights are new, so whatever the look said about the sky and the hemisphere has to be said
        // again; otherwise a rebuild quietly lights the room twice.
        if (this.#look) {
            this.setSceneLook(this.#look)
        }
        this.requestRender()
    }

    /**
     * Give the cube maps to the lamps nearest the camera.
     *
     * A ceiling's fittings are all the same lamp, so there is no "brightest few" to choose: every
     * ranking by intensity is a tie, and the same arbitrary three win every time while the rest of
     * the room casts nothing. What matters is which lamps light the part of the room being looked
     * at, and that changes as the camera moves, so it is decided per refit rather than once.
     */
    #aimShadowLamps(): void {
        if (this.#shadowLamps.length === 0) {
            return
        }
        const eye = this.camera.position
        const byRange = [...this.#shadowLamps]
            .sort((a, b) => a.position.distanceToSquared(eye) - b.position.distanceToSquared(eye))
        const chosen = new Set(byRange.slice(0, MAX_SHADOW_LAMPS))
        for (const lamp of this.#shadowLamps) {
            // Every lamp stays lit. Switching the far ones off was tried, to stop them filling in the
            // shadows the near ones cast, and it does deepen the shadow -- but a room is not dark where
            // the camera is not, and it took a third of the light out with it. What actually matters is
            // that the lamps overhead of whatever is being looked at are the ones casting; the rest are
            // far enough that their inverse-square fill is small.
            const wanted = chosen.has(lamp)
            if (wanted === lamp.castShadow) {
                continue
            }
            if (wanted) {
                // it only has to reach the floor and the furniture under it, not the room
                lampCastsShadow(lamp, Math.max(4, lamp.position.z * 1.6), lamp.userData.lampRadius ?? 0)
            } else {
                lamp.castShadow = false
                lamp.shadow.map?.dispose()
                lamp.shadow.map = null
            }
        }
    }

    /**
     * Point every shadow caster at what is drawn now.
     *
     * The meshes' own bounding boxes, not the points: a cloud reaches tens of metres past the walls and would
     * blow the box up to where the room is a handful of texels across. Nothing happens unless the drawn meshes
     * have grown outside the box already aimed at, so a scene that is only moving re-fits once and then stops.
     */
    #fitShadows(): void {
        if (!this.#shadowCasters.length) {
            return
        }
        const box = new THREE.Box3()
        const own = new THREE.Box3()
        this.scene.updateMatrixWorld()
        this.scene.traverseVisible((object) => {
            if (!isMesh(object) || isLineSegments2(object) || object.userData.noPick) {
                return
            }
            const geometry = object.geometry as THREE.BufferGeometry | undefined
            if (!geometry) {
                return
            }
            if (!geometry.boundingBox) {
                geometry.computeBoundingBox()
            }
            if (geometry.boundingBox) {
                box.union(own.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld))
            }
        })
        if (box.isEmpty()) {
            // Nothing drawn yet, or a view that is only point clouds: the caster still needs somewhere to
            // stand, or it sits at the origin aimed at the origin and lights nothing at all.
            box.setFromCenterAndSize(
                new THREE.Vector3(),
                new THREE.Vector3(1, 1, 1).multiplyScalar(2 * SHADOW_MIN_EXTENT_METRES),
            )
        }
        if (this.#shadowBounds?.containsBox(box)) {
            return
        }
        this.#shadowBounds = box.clone()
        for (const light of this.#shadowCasters) {
            aimShadow(light, box)
        }
        this.requestRender()
    }

    /** The sky a scene's dome light stands for, behind everything and taking no depth. */
    #setSky(colour: THREE.Color, intensity: number) {
        const texture = skyTexture(colour, intensity)
        if (!texture) {
            return
        }
        this.#sky?.dispose()
        this.#sky = texture
        this.scene.background = texture
        // three samples the background on world Y; this viewer is Z-up, so the strip has to be turned
        this.scene.backgroundRotation.set(SKY_ROTATION_X, 0, 0)
    }

    /** The sky, pre-filtered into something a PBR material can be lit by. Cached per sky texture. */
    #environmentOf(sky: THREE.Texture): THREE.Texture | null {
        if (this.#environmentFrom === sky && this.#environment) {
            return this.#environment
        }
        this.#environment?.dispose()
        this.#environment = null
        this.#environmentFrom = null
        if (!this.renderer) {
            return null
        }
        const pmrem = new THREE.PMREMGenerator(this.renderer)
        try {
            this.#environment = pmrem.fromEquirectangular(sky).texture
            this.#environmentFrom = sky
        } catch (error) {
            console.warn("3D view: could not prefilter the sky for lighting", error)
        } finally {
            pmrem.dispose()
        }
        return this.#environment
    }

    /** Back to the themed background (CSS behind the canvas), and let the texture go. */
    #clearSky() {
        if (!this.#sky) return
        this.scene.background = null
        this.scene.backgroundRotation.set(0, 0, 0)
        this.scene.environment = null
        this.#environment?.dispose()
        this.#environment = null
        this.#environmentFrom = null
        this.#sky.dispose()
        this.#sky = null
    }

    /** Re-reads the theme: grid, fog and splat background (the background itself is CSS behind the canvas). */
    setTheme() {
        const dark = typeof document === "undefined" ||
            getComputedStyle(document.documentElement).colorScheme.trim() !== "light"
        if (this.#grid) {
            this.scene.remove(this.#grid)
            this.#grid.geometry.dispose()
            this.#grid.material.dispose()
        }
        this.#grid = this.#makeGrid(dark)
        this.scene.add(this.#grid)
        const background = cssColor(themeColors().sceneBg || themeColors().bg, "black")
        this.scene.fog = dark ? null : new THREE.Fog(background, 40, 110)
        splatBackground.copy(background)
        this.requestRender()
    }

    /** Shows or hides the ground grid. */
    setGrid(visible: boolean) {
        this.#gridVisible = visible
        if (this.#grid) {
            this.#grid.visible = visible
        }
        this.requestRender()
    }

    /** Hides scene labels that overlap a more important one (frame names give way to data labels). */
    #declutter() {
        const elements = [...this.labels.domElement.querySelectorAll<HTMLElement>(".dr-scene-label")].filter(
            (element) => element.style.display !== "none",
        )
        const placed: DOMRect[] = []
        const ranked = elements
            .map((element) => ({
                element,
                rect: element.getBoundingClientRect(),
                minor: element.classList.contains("dr-frame-label"),
            }))
            .sort((a, b) => Number(a.minor) - Number(b.minor))
        for (const { element, rect } of ranked) {
            const hit = placed.some(
                (other) =>
                    rect.left < other.right &&
                    rect.right > other.left &&
                    rect.top < other.bottom &&
                    rect.bottom > other.top,
            )
            element.classList.toggle("dr-covered", hit)
            if (!hit) {
                placed.push(rect)
            }
        }
    }

    /**
     * The view as an image, now: runs the frame listeners, renders and reads the canvas in the same task (no
     * preserveDrawingBuffer needed). Returns a data URL (`type` default image/png).
     */
    capture(type = "image/png"): string {
        const info = {
            now: performance.now(),
            dataNow: this.dataClock(),
            fixedFrame: this.fixedFrame,
            camera: this.camera,
        }
        for (const listener of this.#listeners) {
            listener(info)
        }
        this.#render()
        return this.canvas.toDataURL(type)
    }

    /**
     * Draws `object` (and everything under it, children added later too) over the rest of the scene: in a second pass
     * after the depth buffer is cleared, so clouds and voxels never hide it (it still depth-tests against itself and
     * other on-top objects). Off (the default for every object): drawn in the scene, hidden by whatever is in front.
     */
    setOnTop(object: THREE.Object3D, on: boolean) {
        this.#onTop.set(object, on)
        this.requestRender()
    }

    #render() {
        if (this.renderer) {
            this.#onTop.render(this.renderer, this.scene, this.camera)
        }
    }

    /** Draw on the next frame. */
    requestRender() {
        this.#dirty = true
    }

    /** Layers call this when a message changed what's drawn; the next frame draws it and times it. */
    noteData(timestampMs?: number) {
        if (timestampMs !== undefined && Number.isFinite(timestampMs)) {
            this.#pendingData.push({ ts: timestampMs, arrival: performance.now() })
        }
        this.#dirty = true
    }

    /** `listener()` when the data jumped (a replay's seek): layers drop what they gathered over time. */
    onReset(listener: () => void): () => void {
        this.#resetListeners.add(listener)
        return () => this.#resetListeners.delete(listener)
    }

    /** Tells every layer the data jumped (Scene3D calls it on the source's seek). */
    reset() {
        for (const listener of [...this.#resetListeners]) {
            try {
                listener()
            } catch (error) {
                console.error("[dimos-react] scene reset listener threw", error)
            }
        }
        this.requestRender()
    }

    /**
     * `listener(frame)` every animation frame, before rendering. Returns unsubscribe.
     */
    onFrame(listener: (frame: FrameInfo) => void): () => void {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }

    /**
     * The point in the scene (the fixed frame) under a screen point (client px): the nearest drawn cloud point within
     * a few pixels of the ray or the nearest mesh hit, else where the ray meets the ground (z = 0). Null on a miss.
     */
    pick(clientX: number, clientY: number): PickResult | null {
        const rect = this.canvas.getBoundingClientRect()
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        )
        const raycaster = new THREE.Raycaster()
        // on-top objects are pickable too
        raycaster.layers.enable(ON_TOP_CHANNEL)
        raycaster.setFromCamera(ndc, this.camera)
        const { origin, direction } = raycaster.ray
        const PICK_PX = 6
        const slope = (PICK_PX * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * 2) / Math.max(1, rect.height)
        // assigned inside visit(), so declared wide (not narrowed to null)
        let best = null as (PickResult & { distance: number }) | null
        const meshes: THREE.Mesh[] = []
        const point = new THREE.Vector3()
        const offset = new THREE.Vector3()
        const visit = (object: THREE.Object3D) => {
            if (!object.visible || object.userData.noPick) {
                return
            }
            if (isPoints(object)) {
                const geometry = object.geometry
                const position = geometry.getAttribute("position")
                if (position) {
                    const end = Math.min(position.count, geometry.drawRange.start + geometry.drawRange.count)
                    const array = position.array
                    const world = object.matrixWorld
                    for (let index = geometry.drawRange.start; index < end; index++) {
                        point.set(array[index * 3], array[index * 3 + 1], array[index * 3 + 2]).applyMatrix4(world)
                        offset.subVectors(point, origin)
                        const along = offset.dot(direction)
                        if (along <= this.camera.near || (best && along >= best.distance)) {
                            continue
                        }
                        const away = offset.addScaledVector(direction, -along).length()
                        if (away <= along * slope) {
                            best = { distance: along, point: point.clone(), on: "points", object }
                        }
                    }
                }
            } else if (isMesh(object) && !isLineSegments2(object)) {
                meshes.push(object)
            }
            for (const child of object.children) {
                visit(child)
            }
        }
        this.scene.updateMatrixWorld()
        visit(this.scene)
        const hit = raycaster.intersectObjects(meshes, false)[0]
        if (hit && (!best || hit.distance < best.distance)) {
            best = { distance: hit.distance, point: hit.point.clone(), on: "mesh", object: hit.object }
        }
        if (best) {
            return { point: best.point, on: best.on, object: best.object }
        }
        const ground = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3())
        return ground ? { point: ground, on: "ground" } : null
    }

    /** Looks at `target` from the current direction, `distance` away (from straight above: the default 3/4 view). */
    frame(target: THREE.Vector3, distance: number) {
        const direction = this.camera.position.clone().sub(this.controls.target).normalize()
        if (!Number.isFinite(direction.x) || direction.lengthSq() === 0 || direction.z > 0.97) {
            direction.set(-1, -1, 0.9).normalize()
        }
        this.#place(target, target.clone().addScaledVector(direction, distance))
    }

    /** Frames everything drawn (dataBounds); false when nothing is drawn. */
    frameAll(): boolean {
        const box = this.dataBounds()
        if (!box) {
            return false
        }
        const size = box.getSize(new THREE.Vector3()).length()
        this.frame(box.getCenter(new THREE.Vector3()), Math.max(2, size * 0.9))
        return true
    }

    /**
     * Straight down on the area around `center` (the drawn data within 15 m of it, 12-30 m across), or without one on
     * everything drawn (or the origin).
     */
    topDownAround(center?: THREE.Vector3 | null) {
        const bounds = this.dataBounds()
        if (center) {
            let extent = 20
            if (bounds) {
                const near = bounds
                    .clone()
                    .intersect(new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(30, 30, 1e6)))
                if (!near.isEmpty()) {
                    const size = near.getSize(new THREE.Vector3())
                    extent = THREE.MathUtils.clamp(Math.max(size.x, size.y), 12, 30)
                }
            }
            this.topDown(center.clone(), extent)
        } else if (bounds) {
            const size = bounds.getSize(new THREE.Vector3())
            const middle = bounds.getCenter(new THREE.Vector3())
            this.topDown(middle.setZ(bounds.min.z), THREE.MathUtils.clamp(Math.max(size.x, size.y), 6, 400))
        } else {
            this.topDown(new THREE.Vector3(), 20)
        }
    }

    /** Straight down onto `target` from high enough that `extent` meters fit the shorter side of the view. */
    topDown(target: THREE.Vector3, extent: number) {
        const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2
        const fit = Math.min(1, this.camera.aspect)
        const height = (extent / 2 / Math.tan(halfFov) / fit) * 1.1
        // a hair south of overhead, so "up" on screen is +y
        this.#place(target, new THREE.Vector3(target.x, target.y - height * 0.002, target.z + height))
    }

    /**
     * Orbits around the current target to look from `direction` (target → camera; need not be unit), keeping the
     * distance: a view cube's Top / Front / corner views. Glides there (`ms`, default 450; instant with
     * `animate: false` or prefers-reduced-motion). Without freeOrbit, directions below the horizon stop at it.
     */
    viewFrom(direction: THREE.Vector3, { animate = true, ms = 450 }: { animate?: boolean; ms?: number } = {}) {
        const to = limitPolar(direction, this.controls.maxPolarAngle)
        if (!to) {
            return
        }
        const offset = this.camera.position.clone().sub(this.controls.target)
        const distance = offset.length() || 10
        const from = offset.normalize()
        if (!animate || this.#reducedMotion?.matches || from.angleTo(to) < 1e-4) {
            this.#glide = null
            this.#place(this.controls.target.clone(), this.controls.target.clone().addScaledVector(to, distance))
            return
        }
        // the shortest turn; straight through the other side turns about +z, so the view stays upright
        const turn = from.dot(to) < -0.9999
            ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)
            : new THREE.Quaternion().setFromUnitVectors(from, to)
        this.#glide = { from, turn, start: performance.now(), ms, distance }
        this.requestRender()
    }

    /** One step of a viewFrom() glide (eased), around wherever the target is now (it may be following). */
    #stepGlide(now: number) {
        const glide = this.#glide
        if (!glide) {
            return
        }
        const t = THREE.MathUtils.clamp((now - glide.start) / glide.ms, 0, 1)
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        const direction = glide.from
            .clone()
            .applyQuaternion(new THREE.Quaternion().slerp(glide.turn, eased))
            .normalize()
        // aim only (unlike #place, following carries on undisturbed); the loop's controls.update() follows
        this.#clearDamping()
        this.camera.position.copy(this.controls.target).addScaledVector(direction, glide.distance)
        this.camera.lookAt(this.controls.target)
        this.#dirty = true
        if (t >= 1) {
            this.#glide = null
        }
    }

    /** Drops OrbitControls' leftover damping, so a placed camera doesn't drift on. */
    #clearDamping() {
        const controls = this.controls as OrbitControls & OrbitControlsInternals
        controls._sphericalDelta?.set(0, 0, 0)
        controls._panOffset?.set(0, 0, 0)
        if (controls._scale !== undefined) {
            controls._scale = 1
        }
    }

    /** Puts the camera at `position` looking at `target` now (no leftover damping, no follow glide). */
    #place(target: THREE.Vector3, position: THREE.Vector3) {
        this.#clearDamping()
        this.controls.target.copy(target)
        this.camera.position.copy(position)
        this.camera.lookAt(target)
        this.controls.update()
        this.#following = false
        this.#follow.reset()
        this.requestRender()
    }

    /** Stops following until `resumeFollow()`: the camera stays where it is. */
    pauseFollow() {
        if (!this.followPaused.get().paused) {
            this.followPaused.set({ paused: true })
        }
    }

    /** Follows again: the followed point glides back to the middle, angle and zoom kept. */
    resumeFollow() {
        this.#catchingUp = true
        this.#following = false
        this.#follow.reset()
        if (this.followPaused.get().paused) {
            this.followPaused.set({ paused: false })
        }
        this.requestRender()
    }

    /**
     * Where the drawn data is (point clouds and meshes, not the grid or helpers): the 2nd-98th percentile box of a
     * sample of their points. Null when nothing is drawn.
     */
    dataBounds(): THREE.Box3 | null {
        const xs: number[] = [],
            ys: number[] = [],
            zs: number[] = []
        const point = new THREE.Vector3()
        this.scene.updateMatrixWorld()
        this.scene.traverseVisible((object) => {
            const drawn = isPoints(object) || (isMesh(object) && !isLineSegments2(object))
            if (!drawn || object.userData.noPick) {
                return
            }
            const geometry = object.geometry as THREE.BufferGeometry | undefined
            const position = geometry?.getAttribute("position")
            if (!geometry || !position) {
                return
            }
            const start = geometry.drawRange.start
            const end = Math.min(position.count, start + geometry.drawRange.count)
            const stride = Math.max(1, Math.floor((end - start) / 20000))
            for (let index = start; index < end; index += stride) {
                point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld)
                if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
                    xs.push(point.x)
                    ys.push(point.y)
                    zs.push(point.z)
                }
            }
        })
        if (!xs.length) {
            return null
        }
        const range = (values: number[]) => {
            values.sort((a, b) => a - b)
            return [
                values[Math.floor(values.length * 0.02)],
                values[Math.min(values.length - 1, Math.floor(values.length * 0.98))],
            ]
        }
        const [x, y, z] = [range(xs), range(ys), range(zs)]
        return new THREE.Box3(new THREE.Vector3(x[0], y[0], z[0]), new THREE.Vector3(x[1], y[1], z[1]))
    }

    /** devicePixelRatio changes when the window moves between displays or the page is zoomed. */
    #watchPixelRatio() {
        const query = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio}dppx)`)
        query?.addEventListener(
            "change",
            () => {
                if (this.#disposed) {
                    return
                }
                this.renderer?.setPixelRatio(pixelRatio())
                this.#resize()
                this.#watchPixelRatio()
            },
            { once: true },
        )
    }

    #resize() {
        const width = Math.max(1, this.#host.clientWidth)
        const height = Math.max(1, this.#host.clientHeight)
        if (this.renderer) {
            this.renderer.setSize(width, height)
        } else {
            Object.assign(this.canvas, { width, height })
        }
        this.labels.setSize(width, height)
        this.camera.aspect = width / height
        this.camera.updateProjectionMatrix()
        this.resolution.set(width, height)
        this.pixelsPerMeter.value = (height * (this.renderer?.getPixelRatio() ?? 1)) /
            (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
        this.requestRender()
    }

    #loop = (now: number) => {
        if (this.#disposed) {
            return
        }
        this.#frameRequest = requestAnimationFrame(this.#loop)
        // meshes arrive over tens of seconds, so the box they need is only known once they are in
        if (now - this.#shadowFittedAt > SHADOW_REFIT_MS) {
            this.#shadowFittedAt = now
            this.#fitShadows()
            this.#aimShadowLamps()
        }
        const dt = this.#lastFrame ? (now - this.#lastFrame) / 1000 : 0
        this.#lastFrame = now
        const reduced = !!this.#reducedMotion?.matches
        const following = !!this.followTarget && !this.followPaused.get().paused
        if (following) {
            const target = this.followTarget!
            if (reduced) {
                this.#follow.reset()
            }
            const [x, y, z] = this.#follow.step([target.x, target.y, target.z], dt)
            if (this.#catchingUp) {
                const gap = this.#followDelta.set(x, y, z).sub(this.controls.target)
                if (!reduced && gap.length() > 1e-3) {
                    gap.multiplyScalar(1 - Math.exp(-dt / CATCH_UP_SECONDS))
                } else {
                    this.#catchingUp = false
                }
                this.camera.position.add(gap)
                this.controls.target.add(gap)
                this.#dirty = true
            } else if (this.#following) {
                const delta = this.#followDelta.set(x, y, z).sub(this.#lastFollow)
                if (delta.lengthSq() > 1e-10) {
                    this.camera.position.add(delta)
                    this.controls.target.add(delta)
                    this.#dirty = true
                }
            } else {
                // starting to follow: bring the target onto the followed point
                this.#catchingUp = true
            }
            this.#lastFollow.set(x, y, z)
            this.#following = true
        } else {
            this.#following = false
            this.#follow.reset()
        }
        this.#stepGlide(now)
        focusDistance.value = this.camera.position.distanceTo(this.controls.target)
        this.#beforeControls.copy(this.controls.target)
        if (this.controls.update()) {
            this.#dirty = true
        }
        // orbit and zoom keep following; a pan (right-drag, shift-drag, two fingers) stops it
        const pan = this.#pan.copy(this.controls.target).sub(this.#beforeControls)
        if (following && pan.lengthSq() > 0) {
            const verdict = this.#panGate.step([pan.x, pan.y, pan.z], focusDistance.value)
            if (verdict.action === "pause") {
                const [x, y, z] = verdict.restore
                this.controls.target.add(this.#followDelta.set(x, y, z))
                this.camera.position.add(this.#followDelta)
                this.#catchingUp = false
                this.pauseFollow()
            } else {
                this.controls.target.sub(pan)
                this.camera.position.sub(pan)
            }
        }
        const started = performance.now()
        const info = { now, dataNow: this.dataClock(), fixedFrame: this.fixedFrame, camera: this.camera }
        for (const listener of this.#listeners) {
            try {
                listener(info)
            } catch (error) {
                console.error("[dimos-react] scene frame listener threw", error)
            }
        }
        if (this.#dirty && !this.paused) {
            this.#dirty = false
            this.#render()
            // CSS2D labels show only on the camera's channels: on-top layers' names too
            const mask = this.camera.layers.mask
            this.camera.layers.enable(ON_TOP_CHANNEL)
            this.labels.render(this.scene, this.camera)
            this.camera.layers.mask = mask
            if (now - this.#lastDeclutter > 150) {
                this.#lastDeclutter = now
                this.#declutter()
            }
            const drawn = performance.now()
            if (this.#pendingData.length) {
                const clockNow = this.#clock()
                for (const data of this.#pendingData) {
                    this.#latencies.push(clockNow - data.ts)
                    this.#arrivals.push(drawn - data.arrival)
                }
                this.#pendingData.length = 0
            }
            this.#cpuTimes.push(drawn - started)
        }
        this.#frameTimes.push(now)
        if (now - this.#lastStats > 1000) {
            this.#publishStats(now)
        }
    }

    #publishStats(now: number) {
        const percentile = (values: number[], p: number) => {
            if (!values.length) {
                return null
            }
            const sorted = [...values].sort((a, b) => a - b)
            return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
        }
        const span = (now - this.#lastStats) / 1000
        let points = 0
        let splats = false
        this.scene.traverseVisible((object) => {
            if (isPoints(object)) {
                const material = object.material as Partial<THREE.ShaderMaterial>
                splats ||= "SPLAT" in (material.defines ?? {})
                const geometry = object.geometry
                points += Math.min(geometry.drawRange.count, geometry.getAttribute("position")?.count ?? 0)
            }
        })
        this.stats.set({
            fps: Math.round(this.#frameTimes.length / span),
            frameMs: this.#cpuTimes.length ? this.#cpuTimes.reduce((a, b) => a + b, 0) / this.#cpuTimes.length : 0,
            latencyP50: percentile(this.#latencies, 0.5),
            latencyP95: percentile(this.#latencies, 0.95),
            arrivalToFrameMs: percentile(this.#arrivals, 0.5),
            drawCalls: this.renderer?.info.render.calls ?? 0,
            points,
        })
        // splats that can't keep up for 3 s in a row are drawn as cubes instead (splatFallback; clear it to retry)
        const times = this.#frameTimes
        const frameMs = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 0
        this.#slowSeconds = splats && frameMs > FRAME_BUDGET_MS * 1.25 ? this.#slowSeconds + 1 : 0
        if (this.#slowSeconds >= 3 && !splatFallback.get().active) {
            splatFallback.set({ active: true, frameMs })
        }
        this.#frameTimes.length = 0
        this.#cpuTimes.length = 0
        this.#latencies.length = 0
        this.#arrivals.length = 0
        this.#lastStats = now
    }

    /** Stops the loop and frees the GPU context and DOM. */
    dispose() {
        this.#disposed = true
        cancelAnimationFrame(this.#frameRequest)
        this.#resizeObserver.disconnect()
        this.controls.dispose()
        this.#grid?.geometry.dispose()
        this.#grid?.material.dispose()
        this.renderer?.dispose()
        this.renderer?.forceContextLoss?.()
        this.canvas.remove()
        this.labels.domElement.remove()
        this.#listeners.clear()
        this.#resetListeners.clear()
    }
}
