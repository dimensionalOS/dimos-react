/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Editors for how points look: the point-style picker (a card per style) and the full look editor (style, size, color
// mode, gradient, range, opacity) every point layer's settings use. Settings → Rendering pages use StylePicker and
// CubeShadePicker for the page-wide defaults (the `rendering` store).
import { cx } from "../cx.ts"
import { useStore } from "./store.ts"
import { GradientPicker } from "./gradient_picker.tsx"
import { CUBE_SHADES, POINT_STYLES } from "./point_material.ts"
import { appRendering, rendering, splatFallback } from "./rendering.ts"
import { ColorSwatch } from "../components/input_devices.tsx"
import { Button, Field, NumberInput, Select, Slider } from "../components/controls.tsx"
import type { NumberInputProps, SelectProps } from "../components/controls.tsx"
import type { ColorMode, CubeShade, PointLook, PointStyle } from "./point_material.ts"

/**
 * A point look as the editors see it: `style` may also be "default" (follow the page-wide default style), and the
 * fields the editor always shows are set.
 */
export interface EditablePointLook extends Omit<PointLook, "style" | "gradient" | "solid"> {
    style: string
    gradient: string
    solid: string
}

type StyleOption = [style: string, label: string, about: string]

export interface StylePickerProps {
    value: string
    onChange: (style: string) => void
    withDefault?: string
    className?: string
}

/**
 * A card per point style with a one-line description; `withDefault` adds a "default · <style>" card that follows
 * the page-wide default (Settings → Rendering).
 */
export function StylePicker({ value, onChange, withDefault, className }: StylePickerProps) {
    const fallback: StyleOption[] = withDefault
        ? [["default", `default · ${withDefault}`, "follow the page's default style"]]
        : []
    const options: StyleOption[] = [
        ...fallback,
        ...Object.entries(POINT_STYLES).map(([style, info]): StyleOption => [style, info.label, info.about]),
    ]
    return (
        <span className={cx("dr-style-picker", className)} role="radiogroup">
            {options.map(([style, label, about]) => (
                <button
                    type="button"
                    role="radio"
                    aria-checked={value === style}
                    key={style}
                    className={cx("dr-style-card", value === style && "dr-style-card--on")}
                    onClick={() => onChange(style)}
                    title={about}
                >
                    <span className={`dr-style-swatch dr-style-swatch--${style}`} />
                    <span className="dr-style-name">{label}</span>
                    <span className="dr-style-about">{about}</span>
                </button>
            ))}
        </span>
    )
}

/** The page-wide cube shading (the `rendering` store), as a Select. */
export function CubeShadePicker(props: Partial<SelectProps<CubeShade>>) {
    const { cubeShade } = useStore(rendering)
    return (
        <Select
            value={cubeShade}
            // Object.entries widens CUBE_SHADES' keys to string
            options={Object.entries(CUBE_SHADES).map(([id, shade]) => ({ value: id as CubeShade, label: shade.label }))}
            onChange={(next) => rendering.update({ cubeShade: next })}
            {...props}
        />
    )
}

/**
 * Settings → Rendering for the 3D view: the default point style and cube shading, and the splat fallback's notice
 * (with a retry).
 */
export function RenderingSettings() {
    const value = useStore(rendering)
    const fallback = useStore(splatFallback)
    return (
        <div className="dr-layer-settings-grid">
            <Field
                label="Point style"
                hint={fallback.active
                    ? `glow couldn't keep up (${fallback.frameMs.toFixed(0)} ms a frame): drawn as cubes`
                    : "every point layer that keeps its style on default"}
            >
                <StylePicker
                    value={value.pointStyle}
                    // no withDefault: the picker only offers POINT_STYLES' keys
                    onChange={(pointStyle) => rendering.update({ pointStyle: pointStyle as PointStyle })}
                />
            </Field>
            {fallback.active
                ? (
                    <Button size="sm" onClick={() => splatFallback.set({ active: false, frameMs: 0 })}>
                        Try glow again
                    </Button>
                )
                : null}
            <Field label="Cube shading">
                <CubeShadePicker />
            </Field>
            <NearShrinkSetting />
        </div>
    )
}

/** Settings → Rendering's near-shrink distance: points closer than it shrink, so walls next to the camera open up. */
export function NearShrinkSetting() {
    const { nearShrink } = useStore(rendering)
    const app = useStore(appRendering)
    const value = nearShrink ?? app.nearShrink
    return (
        <Field
            label="See through near the camera"
            hint={nearShrink === null
                ? "points closer than this shrink, so a wall you're next to doesn't hide what's behind it (the app's default)"
                : "points closer than this shrink, so a wall you're next to doesn't hide what's behind it"}
        >
            <Slider
                min={0}
                max={4}
                step={0.25}
                value={value}
                format={(meters) => (meters > 0 ? `${meters} m` : "off")}
                onChange={(meters) => rendering.update({ nearShrink: meters })}
            />
        </Field>
    )
}

export interface PointLookEditorProps {
    look: EditablePointLook
    onChange: (look: EditablePointLook) => void
}

/**
 * Edits a point look (style, size, color mode, gradient, axis, range, opacity). Used by every layer that draws points.
 */
export function PointLookEditor({ look, onChange }: PointLookEditorProps) {
    const set = (patch: Partial<EditablePointLook>) => onChange({ ...look, ...patch })
    const global = useStore(rendering)
    const shown = look.style === "default" ? global.pointStyle : look.style
    return (
        <div className="dr-look-editor">
            <Field label="Style">
                <StylePicker
                    value={look.style}
                    onChange={(style) => set({ style })}
                    withDefault={POINT_STYLES[global.pointStyle]?.label}
                />
            </Field>
            <Field label={shown === "voxel" ? "Voxel" : "Size"}>
                <Slider
                    min={0.01}
                    max={0.5}
                    step={0.01}
                    value={look.size}
                    format={(size) => `${Math.round(size * 100)} cm`}
                    onChange={(size) => set({ size })}
                />
            </Field>
            <Field label="Color">
                <Select<ColorMode>
                    value={look.colorMode}
                    options={[
                        ["height", "by height"],
                        ["intensity", "by intensity"],
                        ["range", "by distance"],
                        ["solid", "solid"],
                        ["glass", "glass"],
                    ]}
                    onChange={(colorMode) => set({ colorMode })}
                />
            </Field>
            {look.colorMode === "solid"
                ? (
                    <Field label="Solid">
                        <ColorSwatch value={look.solid} onChange={(solid) => set({ solid })} />
                    </Field>
                )
                : [
                    <GradientPicker key="gradients" value={look.gradient} onChange={(gradient) => set({ gradient })} />,
                    look.colorMode === "height" || look.colorMode === "glass"
                        ? (
                            <Field label="Axis" key="axis">
                                <Select<0 | 1 | 2>
                                    value={look.axis}
                                    options={[
                                        [2, "z (height)"],
                                        [0, "x"],
                                        [1, "y"],
                                    ]}
                                    onChange={(axis) => set({ axis })}
                                />
                            </Field>
                        )
                        : null,
                    <Field label="Range" hint="empty = automatic (5th–95th percentile)" key="range">
                        <span className="dr-range-inputs">
                            <RangeInput value={look.rangeMin} onChange={(rangeMin) => set({ rangeMin })} />
                            <RangeInput value={look.rangeMax} onChange={(rangeMax) => set({ rangeMax })} />
                        </span>
                    </Field>,
                ]}
            <Field label="Opacity">
                <Slider
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={look.opacity ?? 1}
                    format={(opacity) => `${Math.round(opacity * 100)}%`}
                    onChange={(opacity) => set({ opacity })}
                />
            </Field>
        </div>
    )
}

export interface RangeInputProps extends Omit<NumberInputProps, "value" | "onChange" | "placeholder"> {
    value?: number | null
    onChange: (value: number | null) => void
    placeholder?: string
}

/** A number or nothing (null = automatic): empty input clears it. */
export function RangeInput({ value, onChange, placeholder = "auto", ...rest }: RangeInputProps) {
    return (
        <NumberInput
            value={value}
            step={0.1}
            placeholder={placeholder}
            size="sm"
            nullable={true}
            onChange={onChange}
            {...rest}
        />
    )
}
