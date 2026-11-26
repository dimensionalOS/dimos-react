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
import type { DescriptionCamera, DescriptionLight, DescriptionLook } from "./urdf/description.ts"
import { focusDistance, splatBackground } from "./point_material.ts"
import { CATCH_UP_SECONDS, PanGate, SmoothFollow } from "./follow.ts"

/** the exposure the viewer's own lights are shown at, when no scene says how it wants to be shown */
const DEFAULT_EXPOSURE = 1.1
/** how often the drawn meshes are measured again: they stream in, and the first frame's box is the robot alone */
const SHADOW_REFIT_MS = 2000
/** the fewest fragment texture units WebGL 2 promises (MAX_TEXTURE_IMAGE_UNITS) */
const WEBGL2_MIN_TEXTURE_UNITS = 16
/** the maps a scene material can bind (robotDescription's) plus the environment: each takes a texture unit, as each shadow does */
const MATERIAL_TEXTURE_UNITS =
    ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "envMap"].length

import { themeColors } from "../theme/theme.ts"
import { cssColor } from "./robot_model.ts"
import { FRAME_BUDGET_MS, splatFallback } from "./rendering.ts"
import { aimShadow, castsShadow, SHADOW_MIN_EXTENT_METRES } from "./shadows.ts"
import { SKY_ROTATION_X, skyTexture } from "./sky.ts"
import { agxLut, AgxPass } from "./agx.ts"
import {
    areaIntensity,
    areaRadiance,
    areaSize,
    cylinderIntensity,
    domeIrradiance,
    domeRadiance,
    lightColor,
    pointIntensity,
    sunIrradiance,
} from "./light_units.ts"
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { AmbientOcclusionPass } from "./ao_pass.ts"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"

/** Hill's LTC Fresnel with the material's F90, not three's fixed 1, so an ior-1 surface does not mirror area lights. */
function rectAreaFresnelWithF90(): void {
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment
    const fixed = "( material.specularColor * t2.x + ( vec3( material.specularF90 ) - material.specularColor ) * t2.y )"
    THREE.ShaderChunk.lights_physical_pars_fragment = chunk.replace(
        "( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y )",
        fixed,
    )
}

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
    #composer: EffectComposer | null = null
    #gtao: AmbientOcclusionPass | null = null
    #occlusion = 0
    #occlusionRadius = 0.5
    #environment: THREE.Texture | null = null
    #environmentFrom: THREE.Texture | null = null
    #output: OutputPass | null = null
    /** Blender's AgX, once its LUT is decoded; three's own AgX stands in until then */
    #agx: AgxPass | null = null
    #agxLoading = false
    /** every light casting a shadow right now: their boxes are re-aimed as the drawn scene grows */
    #shadowCasters: THREE.DirectionalLight[] = []
    /** the scene's point and spot lights that shadow: their depth range follows the drawn scene too */
    #localCasters: { light: THREE.PointLight | THREE.SpotLight; radius: number }[] = []
    /** the dome a scene's lights name: its turn and how bright its picture is, for the environment it lights by */
    #dome: { rotation: THREE.Euler; intensity: number } | null = null
    /** the camera's own lens, kept while the view looks through a scene's camera */
    #ownLens: { fov: number; near: number; far: number } | null = null
    /** the bounds the casters were last aimed at, to tell a scene that grew from one that only moved */
    #shadowBounds: THREE.Box3 | null = null
    #shadowFittedAt = 0
    #sky: THREE.Texture | null = null
    /** whether the sky is ours to dispose (a uniform one we made) or the caller's (a dome's picture) */
    #ownSky = false
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
        // A hemisphere light takes its axis from its position, which three defaults to (0,1,0). This
        // viewer is Z-up, so left alone the sky half lights whatever faces +Y -- a sideways direction
        // here -- and every floor and desk top gets the dim mix halfway between sky and ground. That
        // is why an upward face could come out near black while the side of the same object was lit.
        sky.position.set(0, 0, 1)
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
        // USD's camera exposure is 0 stops unless the stage says otherwise; the viewer's own guess is for its own lights
        renderer.toneMappingExposure = look ? (look.exposure ?? 1) : DEFAULT_EXPOSURE
        if (curve === "agx") {
            this.#loadAgx()
        }
        if (this.#agx) {
            this.#agx.exposure = renderer.toneMappingExposure
        }
        // The nearest thing this renderer has to Blender's irradiance volumes. Blender's rooms read
        // right largely because light bounces; here nothing does, and a two-colour hemisphere is a poor
        // stand-in -- it lights a face by which way it points and nothing else. Pre-filtering the dome's
        // own sky into an environment map at least lights each face by what is actually above it.
        //
        // Pre-filtered, not handed over raw: three builds a PMREM from whatever is assigned here, and a
        // raw strip made that fail. Generated once per sky and disposed with it.
        // Omniverse states the reach in scene units and defaults it to 35, which is a room; under a
        // desk is the scale that reads here, so a stated radius is honoured but kept sane.
        const radius = Math.max(0.1, Math.min(4, look?.occlusionRadius ?? 0.5))
        if (radius !== this.#occlusionRadius) {
            this.#occlusionRadius = radius
            this.#gtao?.updateGtaoMaterial({ radius })
        }
        const occlusion = Math.max(0, Math.min(1, look?.occlusion ?? 0))
        if (occlusion !== this.#occlusion) {
            this.#occlusion = occlusion
            if (this.#gtao) {
                this.#gtao.blendIntensity = occlusion
            }
        }
        // a dome lights by its own sky, prefiltered (diffuse and reflections); environmentIntensity scales it, as Blender's World strength
        if (this.#sky && this.#dome) {
            this.scene.environment = this.#environmentOf(this.#sky)
            this.scene.environmentRotation.copy(this.#dome.rotation)
            this.scene.environmentIntensity = this.#dome.intensity * (look?.environmentIntensity ?? 1)
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

    /** Light the scene as a description says (light_units.ts): a dome is the sky and environment, a shadowed or cone-shaped rect/disk a spot (three's area lights can do neither). */
    setSceneLights(
        lights: readonly DescriptionLight[] | null | undefined,
        textures?: ReadonlyMap<string, THREE.Texture>,
    ): void {
        for (const light of this.#sceneLights) {
            light.removeFromParent()
            if (light instanceof THREE.SpotLight || light instanceof THREE.DirectionalLight) {
                light.target.removeFromParent()
            }
            light.dispose()
        }
        this.#sceneLights = []
        this.#localCasters = []
        this.#shadowCasters = this.#defaultLights.filter((light) => light.castShadow) as THREE.DirectionalLight[]
        const wanted = lights ?? []
        const dome = wanted.find((light) => light.type === "dome")
        if (!dome) {
            this.#clearSky()
            this.#dome = null
        }
        for (const light of this.#defaultLights) light.visible = wanted.length === 0
        if (wanted.some((light) => (light.type === "rect" || light.type === "disk") && !light.shadow && !light.cone)) {
            RectAreaLightUniformsLib.init()
            rectAreaFresnelWithF90()
        }
        const shadowed = this.#shadowedLights(wanted)
        for (const light of wanted) {
            const colour = new THREE.Color(...lightColor(light))
            const shadow = shadowed.has(light)
            let made: THREE.Light | null = null
            if (light.type === "distant") {
                made = new THREE.DirectionalLight(colour, sunIrradiance(light))
            } else if (light.type === "dome") {
                if (light !== dome) continue
                // the dome's own radiance (or picture) behind the room, its equirectangular top overhead in this Z-up world, then turned as its prim is
                const picture = light.texture ? textures?.get(light.texture) : undefined
                const rotation = new THREE.Euler().setFromRotationMatrix(
                    new THREE.Matrix4().makeRotationFromQuaternion(
                        new THREE.Quaternion(...(light.quat ?? [0, 0, 0, 1])),
                    )
                        .multiply(new THREE.Matrix4().makeRotationX(SKY_ROTATION_X)),
                )
                this.#setSky(
                    picture ?? skyTexture(colour.clone().multiplyScalar(domeRadiance(light))),
                    !picture,
                    rotation,
                )
                if (picture) {
                    this.scene.backgroundIntensity = domeRadiance(light)
                }
                this.#dome = { rotation, intensity: picture ? domeRadiance(light) : 1 }
                continue
            } else if (light.type === "ambient") {
                made = new THREE.AmbientLight(colour, domeIrradiance(light))
            } else if ((light.type === "rect" || light.type === "disk") && !light.shadow && !light.cone) {
                const [width, height] = areaSize(light)
                const area = new THREE.RectAreaLight(colour, areaRadiance(light), width, height)
                area.quaternion.set(...(light.quat ?? [0, 0, 0, 1]))
                made = area
            } else {
                const intensity = light.type === "rect" || light.type === "disk"
                    ? areaIntensity(light)
                    : light.type === "cylinder"
                    ? cylinderIntensity(light)
                    : pointIntensity(light)
                const faces = light.type === "rect" || light.type === "disk"
                if (light.cone || faces) {
                    // a face lights the hemisphere in front of it; a cone narrows that (three's widest is a hemisphere)
                    const angle = light.cone ? Math.min(Math.PI / 2, (light.cone.angle * Math.PI) / 180) : Math.PI / 2
                    const spot = new THREE.SpotLight(
                        colour,
                        intensity,
                        0,
                        angle,
                        light.cone ? light.cone.softness : 1,
                        2,
                    )
                    spot.target.position.set(
                        ...(light.xyz.map((value, index) => value + light.direction[index]) as [
                            number,
                            number,
                            number,
                        ]),
                    )
                    this.scene.add(spot.target)
                    made = spot
                } else {
                    made = new THREE.PointLight(colour, intensity, 0, 2)
                }
            }
            if (made instanceof THREE.DirectionalLight) {
                // A distant light has no position, only a direction: aimShadow stands it off from the scene.
                made.position.set(...(light.direction.map((value) => -value * 50) as [number, number, number]))
                if (shadow) {
                    castsShadow(made, new THREE.Vector3(...light.direction))
                    this.scene.add(made.target)
                    this.#shadowCasters.push(made)
                }
            } else if (made) {
                made.position.set(...light.xyz)
                if (shadow && (made instanceof THREE.PointLight || made instanceof THREE.SpotLight)) {
                    made.castShadow = true
                    made.shadow.mapSize.setScalar(this.#localShadowTexels(made))
                    made.shadow.bias = -0.0005
                    this.#localCasters.push({ light: made, radius: light.radius ?? 0 })
                }
            }
            if (!made) continue
            made.layers.enable(ON_TOP_CHANNEL)
            this.scene.add(made)
            this.#sceneLights.push(made)
        }
        this.#shadowBounds = null
        this.#fitShadows()
        // new lights: say the look again, or a rebuild lights the room twice
        this.setSceneLook(this.#look)
        this.requestRender()
    }

    /** a spot's shadow map costs the sun's; a point light's six faces share that total */
    #localShadowTexels(light: THREE.PointLight | THREE.SpotLight): number {
        const sun = this.#defaultLights.find((each) => each.castShadow) as THREE.DirectionalLight
        return light instanceof THREE.PointLight
            ? Math.round(sun.shadow.mapSize.x / Math.sqrt(8))
            : sun.shadow.mapSize.x
    }

    /** the lights that shadow: all that ask, while texture units last, brightest first */
    #shadowedLights(lights: readonly DescriptionLight[]): Set<DescriptionLight> {
        const units = this.renderer?.capabilities.maxTextures ?? WEBGL2_MIN_TEXTURE_UNITS
        const budget = Math.max(
            0,
            units - MATERIAL_TEXTURE_UNITS - this.#shadowCasters.filter((light) => light.visible).length,
        )
        const asking = lights.filter((light) => light.shadow && light.type !== "dome" && light.type !== "ambient")
        const strength = (light: DescriptionLight) =>
            light.type === "distant"
                ? Infinity
                : light.type === "rect" || light.type === "disk"
                ? areaIntensity(light)
                : light.type === "cylinder"
                ? cylinderIntensity(light)
                : pointIntensity(light)
        const chosen = [...asking].sort((a, b) => strength(b) - strength(a)).slice(0, budget)
        if (chosen.length < asking.length) {
            console.info(
                `3D view: ${asking.length} lights ask to shadow, this GPU has texture units for ${budget}: the brightest do`,
            )
        }
        return new Set(chosen)
    }

    /** Look through one of the scene's cameras: its pose and its lens (focal length over the vertical aperture, clipping range); null gives the view back. */
    viewThrough(camera: DescriptionCamera | null): void {
        if (!camera) {
            if (this.#ownLens) {
                Object.assign(this.camera, this.#ownLens)
                this.#ownLens = null
                this.camera.updateProjectionMatrix()
                this.requestRender()
            }
            return
        }
        this.#ownLens ??= { fov: this.camera.fov, near: this.camera.near, far: this.camera.far }
        this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(camera.verticalAperture / (2 * camera.focalLength)))
        this.camera.near = Math.max(1e-4, camera.clippingRange[0])
        this.camera.far = Math.max(this.camera.near * 2, camera.clippingRange[1])
        this.camera.updateProjectionMatrix()
        // a USD camera looks down its -z with +y up, as three's does; orbiting then pivots about a point ahead of it
        const turn = new THREE.Quaternion(...camera.quat)
        const position = new THREE.Vector3(...camera.xyz)
        const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(turn)
        this.#place(position.clone().add(ahead), position)
    }

    /**
     * Point every shadow caster at what is drawn now.
     *
     * The meshes' own bounding boxes, not the points: a cloud reaches tens of metres past the walls and would
     * blow the box up to where the room is a handful of texels across. Nothing happens unless the drawn meshes
     * have grown outside the box already aimed at, so a scene that is only moving re-fits once and then stops.
     */
    #fitShadows(): void {
        if (!this.#shadowCasters.length && !this.#localCasters.length) {
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
        const reach = box.getSize(new THREE.Vector3()).length()
        const centre = box.getCenter(new THREE.Vector3())
        for (const { light, radius } of this.#localCasters) {
            const camera = light.shadow.camera
            camera.near = 0.05
            camera.far = Math.max(1, light.position.distanceTo(centre) + reach)
            camera.updateProjectionMatrix()
            // a sphere's penumbra spans the angle it subtends from the scene's middle, in texels of a quarter-turn cube face
            const across = Math.max(0.5, light.position.distanceTo(centre))
            light.shadow.radius = Math.max(
                1,
                (Math.atan(radius / across) / (Math.PI / 2)) * this.#localShadowTexels(light),
            )
            // two texels' width where the scene is, as the sun's normalBias is set (shadows.ts)
            light.shadow.normalBias = 2 * ((2 * across) / this.#localShadowTexels(light))
            light.shadow.needsUpdate = true
        }
        this.requestRender()
    }

    /** The sky a scene's dome light stands for, behind everything and taking no depth. `own`: made here, so ours to dispose. */
    #setSky(texture: THREE.Texture, own: boolean, rotation: THREE.Euler) {
        if (this.#ownSky) {
            this.#sky?.dispose()
        }
        this.#sky = texture
        this.#ownSky = own
        this.scene.background = texture
        this.scene.backgroundIntensity = 1
        // three samples the background on world Y; this viewer is Z-up, so the picture has to be turned
        this.scene.backgroundRotation.copy(rotation)
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
        if (this.#ownSky) {
            this.#sky.dispose()
        }
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
        const renderer = this.renderer
        if (!renderer) {
            return
        }
        const agx = this.#look?.toneMap === "agx" && this.#agx !== null
        const composer = this.#occlusion > 0 || agx ? this.#composerFor(renderer) : null
        if (!composer) {
            this.#onTop.render(renderer, this.scene, this.camera)
            return
        }
        // the beauty goes through the composer (occlusion, then AgX or OutputPass), the on-top overlay straight to the canvas
        if (this.#gtao) {
            this.#gtao.enabled = this.#occlusion > 0
        }
        if (this.#agx) {
            this.#agx.enabled = agx
        }
        if (this.#output) {
            this.#output.enabled = !agx
        }
        const mask = this.camera.layers.mask
        this.camera.layers.set(0)
        composer.render()
        this.camera.layers.mask = mask
        if (this.#onTop.any()) {
            const { autoClear } = renderer
            const background = this.scene.background
            renderer.autoClear = false
            this.scene.background = null
            renderer.clearDepth()
            this.camera.layers.set(ON_TOP_CHANNEL)
            renderer.render(this.scene, this.camera)
            this.camera.layers.mask = mask
            this.scene.background = background
            renderer.autoClear = autoClear
        }
    }

    /** Decode Blender's AgX LUT once and put its pass in the composer; three's AgX draws until it is ready. */
    #loadAgx() {
        if (this.#agx || this.#agxLoading || !this.renderer) {
            return
        }
        this.#agxLoading = true
        agxLut().then((lut) => {
            if (this.#disposed) {
                return
            }
            this.#agx = new AgxPass(lut)
            this.#agx.exposure = this.renderer?.toneMappingExposure ?? 1
            this.#composer?.addPass(this.#agx)
            this.requestRender()
        }).catch((error) => console.warn("3D view: Blender's AgX could not be loaded, three's stands in", error))
    }

    /**
     * The composer, built on first use and kept. Null if it could not be built -- a renderer that
     * cannot give us the targets is a reason to draw the scene plainly, not a reason to draw nothing.
     */
    #composerFor(renderer: THREE.WebGLRenderer): EffectComposer | null {
        if (this.#composer) {
            return this.#composer
        }
        try {
            const width = Math.max(1, this.#host.clientWidth)
            const height = Math.max(1, this.#host.clientHeight)
            const ratio = renderer.getPixelRatio()
            // linear and half float, so the tone curve at the end sees light above 1; multisampled like the canvas
            const target = new THREE.WebGLRenderTarget(width * ratio, height * ratio, {
                type: THREE.HalfFloatType,
                // the canvas's own multisampling, so a frame through the composer is antialiased the same
                samples: renderer.getContext().getParameter(renderer.getContext().SAMPLES) as number,
            })
            const composer = new EffectComposer(renderer, target)
            composer.addPass(new RenderPass(this.scene, this.camera))
            const gtao = new AmbientOcclusionPass(this.scene, this.camera, width, height)
            // Nothing in this renderer bounces light, so a crease is lit exactly as brightly as the
            // open floor beside it. This is the half of bounce that can be had cheaply: darken what
            // is enclosed. The radius is in metres of scene, and a desk's underside is the scale that
            // matters here, not a room's corner.
            gtao.updateGtaoMaterial({
                radius: this.#occlusionRadius,
                // samples bunched near the pixel, so a foot on the floor is found, not stepped over
                distanceExponent: 2,
                thickness: 1,
                scale: 1.5,
                samples: 32,
            })
            gtao.blendIntensity = this.#occlusion
            gtao.enabled = this.#occlusion > 0
            composer.addPass(gtao)
            this.#output = new OutputPass()
            composer.addPass(this.#output)
            if (this.#agx) {
                composer.addPass(this.#agx)
            }
            composer.setSize(width, height)
            this.#gtao = gtao
            this.#composer = composer
            return composer
        } catch (error) {
            console.warn("3D view: no composer, the scene is drawn plainly", error)
            this.#occlusion = 0
            return null
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
        this.#composer?.setSize(width, height)
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
