// deno-lint-ignore-file no-explicit-any -- decoded point clouds in any of their forms
/** @jsxRuntime automatic */
/** @jsxImportSource react */
// sensor_msgs.PointCloud2: lidar scans and maps. Live, the gateway's dimos_lcm_pointcloud2 encoding sends quantized
// xyz (+ u8 intensity) at this viewer's bandwidth preset; a replay or props may give decoded clouds instead. The points
// go straight into preallocated GPU buffers (a ring when accumulating) and are colored in the shader, so a new scan
// costs one buffer upload and nothing is allocated per frame.
import * as THREE from "three"
import { useStore } from "../store.ts"
import { headerFrameId } from "../../lcm.ts"
import { decodeMessage } from "../../data.ts"
import { applyLook, makePointMaterial } from "../point_material.ts"
import { appRendering, rendering, resolveLook, splatFallback } from "../rendering.ts"
import {
    CLOUD_PRESETS,
    cloudQualities,
    cloudQualityOf,
    CloudStream,
    formatBytes,
    formatCount,
    setCloudQuality,
    setCloudRate,
} from "../cloud_quality.ts"
import type { CloudQuality } from "../cloud_quality.ts"
import { placeLayer, registerLayer } from "./registry.ts"
import type { LayerContext, LayerSettingsProps, Topic } from "./registry.ts"
import { Field, Select } from "../../components/controls.tsx"
import type { SelectProps } from "../../components/controls.tsx"
import { PointLookEditor } from "../look_editor.tsx"
import type { EditablePointLook } from "../look_editor.tsx"
import type { Message } from "../../data.ts"
import type { Store } from "../store.ts"
import type { FrameInfo } from "../viewer.ts"

/**
 * "latest": only the newest scan, moved by TF every frame; "accumulate": scans stay where they were seen;
 * `maxHz` / `quality` pin the subscription (else this viewer's preset); `frame` overrides the data's frame_id
 */
export interface CloudSettings {
    look: EditablePointLook
    mode: "latest" | "accumulate"
    windowSeconds: number
    maxPoints: number
    maxHz?: number
    quality?: number
    frame?: string
}

/** A cloud's points: xyz triples (in `frame`) and optional 0..255 intensity. */
export interface CloudPoints {
    positions: Float32Array
    intensity?: ArrayLike<number>
    frame?: string
}

/** A decoded sensor_msgs.PointCloud2 (the fields this reads). */
export interface PointCloud2 {
    header?: { frame_id?: string }
    fields?: { name: string; offset: number; datatype: number }[]
    width?: number
    height?: number
    point_step?: number
    is_bigendian?: boolean
    data?: Uint8Array
}

export const CLOUD_DEFAULTS: CloudSettings = {
    look: {
        style: "default",
        size: 0.04,
        colorMode: "height",
        gradient: "memworld",
        axis: 2,
        rangeMin: null,
        rangeMax: null,
        solid: "#7fd4ff",
        opacity: 1,
    },
    mode: "latest",
    windowSeconds: 10,
    maxPoints: 2_000_000,
}

/** dimos's /global_map (any namespace): drawn in glass by default */
export const isGlobalMap = (topic: Topic | null | undefined): boolean => /(^|\/)global_map$/.test(topic?.name ?? "")

/** A map-like cloud by name (drawn with bigger points). */
export const isMapTopic = (topic: Topic | null | undefined): boolean =>
    /map|global|voxel|terrain|costmap/i.test(topic?.name ?? "")

const SPLAT_BUDGET = 3_000_000
/** How often a topic cloud's frame_id is re-read from one raw message (the encoding's output carries no header). */
const FRAME_RECHECK_MS = 30_000

/**
 * sensor_msgs.PointCloud2 (decoded) → `{ positions: Float32Array, intensity?: Uint8Array, frame }`: reads the x/y/z
 * float32 fields (and intensity, scaled to 0..255) at their offsets; NaN points are skipped.
 */
export function pointCloud2ToPositions(cloud: PointCloud2): CloudPoints & { frame: string } {
    const fields = Object.fromEntries((cloud.fields ?? []).map((field) => [field.name, field]))
    const step = cloud.point_step
    const count = (cloud.width ?? 0) * (cloud.height ?? 1)
    const data = cloud.data
    if (!fields.x || !fields.y || !fields.z || !step || !data) {
        return { positions: new Float32Array(0), frame: cloud.header?.frame_id ?? "" }
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const little = !cloud.is_bigendian
    const positions = new Float32Array(count * 3)
    const intensityField = fields.intensity
    const intensity = intensityField ? new Uint8Array(count) : undefined
    const raw = intensityField ? new Float32Array(count) : null
    let kept = 0
    for (let index = 0; index < count; index++) {
        const at = index * step
        if (at + step > data.byteLength) {
            break
        }
        const x = view.getFloat32(at + fields.x.offset, little)
        const y = view.getFloat32(at + fields.y.offset, little)
        const z = view.getFloat32(at + fields.z.offset, little)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            continue
        }
        positions[kept * 3] = x
        positions[kept * 3 + 1] = y
        positions[kept * 3 + 2] = z
        if (raw && intensityField) {
            raw[kept] = intensityField.datatype === 7
                ? view.getFloat32(at + intensityField.offset, little)
                : view.getUint8(at + intensityField.offset)
        }
        kept++
    }
    if (raw && intensity) {
        let max = 0
        for (let index = 0; index < kept; index++) {
            max = Math.max(max, raw[index])
        }
        for (let index = 0; index < kept; index++) {
            intensity[index] = max > 0 ? Math.round((raw[index] / max) * 255) : 0
        }
    }
    return {
        positions: positions.subarray(0, kept * 3),
        intensity: intensity?.subarray(0, kept),
        frame: cloud.header?.frame_id ?? "",
    }
}

/** Any cloud-shaped value (decoded data: any shape) → `{ positions, intensity?, frame? }` or null. */
function cloudOf(value: any): CloudPoints | null {
    if (value?.positions) {
        return { positions: value.positions, intensity: value.intensity, frame: value.frame ?? value.header?.frame_id }
    }
    if (value?.fields) {
        return pointCloud2ToPositions(value)
    }
    return null
}

export class CloudLayer {
    root = new THREE.Group()
    #points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
    #geometry = new THREE.BufferGeometry()
    #material: THREE.ShaderMaterial
    #capacity = 0
    #write = 0
    #filled = 0
    /** null until known: a cloud placed without its frame would ride the wrong pose */
    #frame: string | null = null
    /** the latest scan's timestamp (ms): what it is placed with */
    #stamp: number | undefined = undefined
    /** a frame given by the app (props), which wins over the data's */
    #fixedFrameOverride: string | undefined = undefined
    #range: [number, number] = [0, 2]
    #rangeSeen = false
    #unsubscribe: (() => void)[] = []
    #stream: CloudStream | null = null
    #rateSince = performance.now()
    #scans = 0
    #frameTimer: ReturnType<typeof setInterval> | undefined = undefined
    #fixedFrame = ""
    #lastCount = 0
    #mode: CloudSettings["mode"]
    /** data-clock origin (ms): point times are seconds since it, small enough for float32 */
    #epoch: number
    settings: Store<CloudSettings>
    topic: Topic | null
    context: LayerContext

    /** `topic` null: data comes through setData */
    constructor(context: LayerContext, topic: Topic | null, settings: Store<CloudSettings>) {
        this.context = context
        this.topic = topic
        this.settings = settings
        this.#mode = settings.get().mode
        this.#epoch = context.viewer.dataClock()
        this.#material = makePointMaterial(context.viewer.pixelsPerMeter)
        this.#points = new THREE.Points(this.#geometry, this.#material)
        this.#points.frustumCulled = false
        this.#points.matrixAutoUpdate = false
        this.root.add(this.#points)
        this.#resize(1024)
        if (topic) {
            this.#readFrame()
            this.#frameTimer = setInterval(() => this.#readFrame(), FRAME_RECHECK_MS)
            this.#openStream()
            this.#unsubscribe.push(cloudQualities.subscribe(() => this.#stream?.setQuality(cloudQualityOf(topic.key))))
        }
        this.#unsubscribe.push(settings.subscribe(() => this.#onSettings()))
        this.#unsubscribe.push(
            rendering.subscribe(() => this.#onSettings()),
            appRendering.subscribe(() => this.#onSettings()),
            splatFallback.subscribe(() => this.#onSettings()),
        )
        this.#onSettings()
    }

    #openStream() {
        const topic = this.topic
        if (!topic) {
            return
        }
        const onMessage = (message: Message) => {
            let value
            try {
                value = decodeMessage(message, "auto", topic.type)
            } catch {
                return
            }
            const cloud = cloudOf(value)
            if (!cloud) {
                return
            }
            if (typeof cloud.frame === "string" && this.#frame === null) {
                this.setFrame(cloud.frame)
            }
            this.onCloud(cloud.positions, cloud.intensity, message.timestamp)
        }
        const { maxHz, quality } = this.settings.get()
        if (maxHz !== undefined || quality !== undefined) {
            // the app pinned rate / detail: one fixed subscription instead of the viewer's preset
            this.#stream = null
            const stop = this.context.source.subscribe(
                topic.key,
                {
                    delivery: "latest",
                    maxHz: maxHz ?? 20,
                    encoding: "dimos_lcm_pointcloud2",
                    encodeOptions: { quality: quality ?? 1 },
                },
                onMessage,
            )
            this.#fixedStream = { stop }
            return
        }
        this.#stream = new CloudStream(this.context.source, topic.key, cloudQualityOf(topic.key), onMessage)
    }

    #fixedStream: { stop: () => void } | null = null

    #onSettings() {
        const settings = this.settings.get()
        if (settings.frame !== undefined && settings.frame !== this.#fixedFrameOverride) {
            this.setFrame(settings.frame, true)
        }
        if (settings.mode !== this.#mode) {
            this.#mode = settings.mode
            this.#clear()
        }
        this.#material.uniforms.uWindow.value = settings.mode === "accumulate" && settings.windowSeconds > 0
            ? settings.windowSeconds
            : -1
        applyLook(this.#material, resolveLook(settings.look), this.#range)
        this.#syncSplatBudget()
        this.context.viewer.requestRender()
    }

    /** One raw message for its header's frame_id, then unsubscribe (a raw cloud is big). */
    #readFrame() {
        const topic = this.topic
        if (this.#fixedFrameOverride !== undefined || !topic) {
            return
        }
        let stop: (() => void) | null = null
        stop = this.context.source.subscribe(topic.key, { delivery: "latest", maxHz: 1 }, (message) => {
            let frame: unknown = null
            // decoded LCM / a published value: any shape
            const value: any = message.value ?? message.decoded
            try {
                frame = value
                    ? (value.frame ?? value.header?.frame_id ?? null)
                    : headerFrameId(topic.type, message.bytes)
            } catch {
                // not LCM and no frame in the payload
            }
            if (typeof frame === "string") {
                this.setFrame(frame)
            }
            stop?.()
            stop = null
        })
        this.#unsubscribe.push(() => stop?.())
    }

    /** The cloud's frame (an app-given frame wins over the data's). */
    setFrame(frame: string, override = false) {
        if (override) {
            this.#fixedFrameOverride = frame
        }
        const next = this.#fixedFrameOverride ?? frame
        if (next !== this.#frame) {
            this.#frame = next
            this.#clear()
        }
    }

    /** Props data: `{ positions | points, intensity?, frame?, timestamp? }` or a decoded PointCloud2 (any shape). */
    setData(data: any) {
        const cloud = cloudOf(data?.points ? { ...data, positions: data.points } : data)
        if (!cloud) {
            return
        }
        const positions = cloud.positions instanceof Float32Array ? cloud.positions : Float32Array.from(cloud.positions)
        this.setFrame(cloud.frame ?? this.#frame ?? "")
        this.onCloud(positions, cloud.intensity, data.timestamp ?? Date.now())
    }

    #syncSplatBudget() {
        this.#material.uniforms.uKeep.value = Math.min(1, SPLAT_BUDGET / Math.max(1, this.#filled))
    }

    #resize(capacity: number) {
        this.#capacity = capacity
        const position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage)
        const time = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
        const intensity = new THREE.BufferAttribute(new Uint8Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
        this.#geometry.dispose()
        this.#geometry = new THREE.BufferGeometry()
        this.#geometry.setAttribute("position", position)
        this.#geometry.setAttribute("aTime", time)
        this.#geometry.setAttribute("aIntensity", intensity)
        this.#geometry.setDrawRange(0, 0)
        this.#points.geometry = this.#geometry
        this.#write = 0
        this.#filled = 0
    }

    #clear() {
        this.#write = 0
        this.#filled = 0
        this.#rangeSeen = false
        this.#geometry.setDrawRange(0, 0)
        this.context.viewer.requestRender()
    }

    /** One scan: xyz triples (in the cloud's frame) and optional 0..255 intensity. */
    onCloud(positions: ArrayLike<number>, intensity: ArrayLike<number> | undefined, timestamp: number | undefined) {
        if (this.#frame === null) {
            return
        }
        const settings = this.settings.get()
        const count = Math.floor(positions.length / 3)
        this.#lastCount = count
        this.#scans++
        const accumulate = settings.mode === "accumulate"
        let transform: THREE.Matrix4 | null = null
        this.#stamp = timestamp
        if (accumulate) {
            // placed once, with the tf from when it was seen: points already kept don't move when the robot does
            transform = this.context.tf.lookupAt(this.#frame, this.context.viewer.fixedFrame, timestamp)
            if (!transform) {
                this.context.setStatus({
                    problem: `no TF path from "${this.#frame}" to "${this.context.viewer.fixedFrame}"`,
                    frame: this.#frame,
                })
                return
            }
        }
        const wanted = accumulate ? Math.max(count, settings.maxPoints) : count
        if (wanted > this.#capacity || (!accumulate && this.#capacity > 4 * Math.max(wanted, 1024))) {
            this.#resize(accumulate ? wanted : Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(1, wanted)))))
        }
        // #resize made all three plain BufferAttributes
        const position = this.#geometry.getAttribute("position") as THREE.BufferAttribute
        const time = this.#geometry.getAttribute("aTime") as THREE.BufferAttribute
        const strength = this.#geometry.getAttribute("aIntensity") as THREE.BufferAttribute
        const now = (this.context.viewer.dataClock() - this.#epoch) / 1000
        const start = accumulate ? this.#write : 0
        const xyz = position.array
        const times = time.array
        const values = strength.array
        const e = transform?.elements
        for (let index = 0; index < count; index++) {
            const slot = (start + index) % this.#capacity
            const x = positions[index * 3],
                y = positions[index * 3 + 1],
                z = positions[index * 3 + 2]
            if (e) {
                xyz[slot * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]
                xyz[slot * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
                xyz[slot * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
            } else {
                xyz[slot * 3] = x
                xyz[slot * 3 + 1] = y
                xyz[slot * 3 + 2] = z
            }
            times[slot] = now
            values[slot] = intensity ? intensity[index] : 0
        }
        // upload only what changed (a wrapped write is two ranges)
        for (const attribute of [position, time, strength]) {
            attribute.clearUpdateRanges()
            const size = attribute.itemSize
            const firstLength = Math.min(count, this.#capacity - start)
            attribute.addUpdateRange(start * size, firstLength * size)
            if (firstLength < count) {
                attribute.addUpdateRange(0, (count - firstLength) * size)
            }
            attribute.needsUpdate = true
        }
        if (accumulate) {
            this.#write = (start + count) % this.#capacity
            this.#filled = Math.min(this.#capacity, this.#filled + count)
            this.#points.matrix.identity()
        } else {
            this.#filled = count
        }
        this.#geometry.setDrawRange(0, this.#filled)
        this.#syncSplatBudget()
        this.#updateRange(
            positions,
            intensity,
            transform ?? this.context.tf.lookupAt(this.#frame, this.context.viewer.fixedFrame, timestamp),
        )
        this.context.viewer.noteData(timestamp)
    }

    /** Auto color range: 5th-95th percentile of a sample, eased so it doesn't flicker scan to scan. */
    #updateRange(
        positions: ArrayLike<number>,
        intensity: ArrayLike<number> | undefined,
        transform: THREE.Matrix4 | null,
    ) {
        const look = this.settings.get().look
        const count = positions.length / 3
        if (!count) {
            return
        }
        let low: number, high: number
        if (look.colorMode === "intensity") {
            ;[low, high] = intensity ? [0, 255] : [0, 1]
        } else {
            const e = transform?.elements ?? new THREE.Matrix4().elements
            const step = Math.max(1, Math.floor(count / 2048))
            const samples: number[] = []
            for (let index = 0; index < count; index += step) {
                const x = positions[index * 3],
                    y = positions[index * 3 + 1],
                    z = positions[index * 3 + 2]
                const world = [
                    e[0] * x + e[4] * y + e[8] * z + e[12],
                    e[1] * x + e[5] * y + e[9] * z + e[13],
                    e[2] * x + e[6] * y + e[10] * z + e[14],
                ]
                samples.push(
                    look.colorMode === "range"
                        ? Math.hypot(world[0] - e[12], world[1] - e[13], world[2] - e[14])
                        : world[look.axis ?? 2],
                )
            }
            samples.sort((a, b) => a - b)
            low = look.colorMode === "range" ? 0 : samples[Math.floor(samples.length * 0.05)]
            high = samples[Math.floor(samples.length * 0.95)]
        }
        if (!this.#rangeSeen) {
            this.#range = [low, high]
            this.#rangeSeen = true
        } else {
            this.#range = [
                this.#range[0] + (low - this.#range[0]) * 0.2,
                this.#range[1] + (high - this.#range[1]) * 0.2,
            ]
        }
        applyLook(this.#material, resolveLook(look), this.#range)
    }

    /** The data jumped (a replay's seek): an accumulated map starts over. */
    reset() {
        if (this.settings.get().mode === "accumulate") {
            this.#clear()
        }
    }

    update(frame: FrameInfo) {
        const settings = this.settings.get()
        if (frame.fixedFrame !== this.#fixedFrame) {
            this.#fixedFrame = frame.fixedFrame
            if (settings.mode === "accumulate") {
                this.#clear()
            }
        }
        this.#material.uniforms.uNow.value = (frame.dataNow - this.#epoch) / 1000
        if (settings.mode === "accumulate" && settings.windowSeconds > 0) {
            this.context.viewer.requestRender() // old points fade out by time even with no new scans
        }
        if (this.#frame !== null) {
            // the latest scan sits where the sensor was when it was taken, not where tf says it is now
            const placed = settings.mode === "accumulate" ||
                placeLayer(this.context, this.#points, this.#frame, frame.fixedFrame, this.#stamp)
            if (placed) {
                const sensor = this.context.tf.lookupAt(this.#frame, frame.fixedFrame, this.#stamp)
                if (sensor) {
                    this.#material.uniforms.uSensor.value.setFromMatrixPosition(sensor)
                }
            }
        }
        if (frame.now - this.#rateSince > 1000) {
            const seconds = (frame.now - this.#rateSince) / 1000
            this.#rateSince = frame.now
            let rate
            if (this.#stream && this.topic) {
                rate = this.#stream.sample(frame.now)
                setCloudRate(this.topic.key, rate)
            } else {
                rate = { hz: this.#scans / seconds, bytesPerSecond: 0 }
            }
            this.#scans = 0
            const kept = settings.mode === "accumulate" ? `${formatCount(this.#filled)} kept · ` : ""
            const bytes = rate.bytesPerSecond ? ` · ${formatBytes(rate.bytesPerSecond)}/s` : ""
            this.context.setStatus({
                info: this.#frame === null
                    ? "waiting for frame_id…"
                    : `${kept}${formatCount(this.#lastCount)} pts · ${rate.hz.toFixed(1)} Hz${bytes} · ${
                        this.#frame || "no frame"
                    }`,
                frame: this.#frame ?? undefined,
            })
        }
    }

    dispose() {
        clearInterval(this.#frameTimer)
        this.#unsubscribe.forEach((stop) => stop())
        this.#stream?.close()
        this.#fixedStream?.stop()
        if (this.topic) {
            setCloudRate(this.topic.key, null)
        }
        this.#geometry.dispose()
        this.#material.dispose()
    }
}

export interface CloudQualitySelectProps extends Omit<SelectProps<CloudQuality>, "value" | "options" | "onChange"> {
    topicKey: string
}

/** This viewer's bandwidth preset for a cloud topic (shared by every place that shows it). */
export function CloudQualitySelect({ topicKey, ...rest }: CloudQualitySelectProps) {
    useStore(cloudQualities)
    return (
        <Select
            value={cloudQualityOf(topicKey)}
            options={CLOUD_PRESETS.map((preset): [CloudQuality, string] => [preset.id, preset.label])}
            onChange={(quality) => setCloudQuality(topicKey, quality)}
            {...rest}
        />
    )
}

/** A point-cloud layer's settings: its look, keep mode and window, and this viewer's bandwidth preset. */
export function CloudSettingsEditor({ settings, topic }: LayerSettingsProps<CloudSettings>) {
    const value = useStore(settings)
    return (
        <div className="dr-layer-settings-grid">
            <PointLookEditor look={value.look} onChange={(look) => settings.update({ look })} />
            <Field label="Keep">
                <Select<CloudSettings["mode"]>
                    value={value.mode}
                    options={[
                        ["latest", "latest scan"],
                        ["accumulate", "accumulate"],
                    ]}
                    onChange={(mode) => settings.update({ mode })}
                />
            </Field>
            {value.mode === "accumulate"
                ? (
                    <Field label="Window">
                        <Select
                            value={value.windowSeconds}
                            options={[
                                [5, "5 s"],
                                [10, "10 s"],
                                [30, "30 s"],
                                [120, "2 min"],
                                [0, "forever"],
                            ]}
                            onChange={(windowSeconds) => settings.update({ windowSeconds })}
                        />
                    </Field>
                )
                : null}
            {topic
                ? (
                    <Field
                        label="Bandwidth"
                        hint={`this viewer's: ${
                            CLOUD_PRESETS.map((preset) => `${preset.label}: ${preset.about}`).join(
                                "; ",
                            )
                        }`}
                    >
                        <CloudQualitySelect topicKey={topic.key} />
                    </Field>
                )
                : null}
        </div>
    )
}

registerLayer<CloudSettings>({
    id: "pointcloud",
    label: "Point cloud",
    types: ["sensor_msgs.PointCloud2"],
    // a map's points at its 10 cm voxel size
    defaults: (topic) =>
        isMapTopic(topic)
            // the global map in glass, so what's inside it (the robot, the paths, the locations) shows through
            ? {
                ...CLOUD_DEFAULTS,
                look: {
                    ...CLOUD_DEFAULTS.look,
                    size: 0.1,
                    ...(isGlobalMap(topic) ? { colorMode: "glass" as const } : {}),
                },
            }
            : structuredClone(CLOUD_DEFAULTS),
    create: (context, topic, settings) => new CloudLayer(context, topic, settings),
    Settings: CloudSettingsEditor,
})
