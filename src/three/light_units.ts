// UsdLux lights in three's units as Blender 5.1 imports and renders them (each factor measured in EEVEE).
import type { DescriptionLight } from "./urdf/description.ts"
import { LIGHT_DEFAULTS } from "./urdf/usda.ts"

/** Blender's USD import makes a sun of strength 4 * intensity (measured in Blender 5.1: 2.549 for intensity 2, exposure 1) */
const BLENDER_SUN_PER_INTENSITY = 4

/** UsdLux's exposure: the intensity is scaled by 2^exposure. */
const stops = (light: DescriptionLight) => Math.pow(2, light.exposure ?? 0)

/** Sun irradiance: Blender imports strength 4 * intensity; unnormalized it is disc radiance, times pi sin^2(half-angle). */
export function sunIrradiance(light: DescriptionLight): number {
    const disc = light.normalize
        ? 1
        : Math.PI * Math.sin(((light.angle ?? LIGHT_DEFAULTS["inputs:angle"]) * Math.PI) / 180) ** 2
    return BLENDER_SUN_PER_INTENSITY * light.intensity * stops(light) * disc
}

/** A rect or disk light's width and height: a disk as the square of equal area, as three has no disk-shaped area light. */
export function areaSize(light: DescriptionLight): [number, number] {
    if (light.type === "disk") {
        const side = (light.radius ?? LIGHT_DEFAULTS["inputs:radius"]) * Math.sqrt(Math.PI)
        return [side, side]
    }
    return [light.width ?? LIGHT_DEFAULTS["inputs:width"], light.height ?? LIGHT_DEFAULTS["inputs:height"]]
}

/** The radiance of an area light's face: intensity * 2^exposure, divided by its area when normalized (UsdLux; Blender agrees). */
export function areaRadiance(light: DescriptionLight): number {
    const [width, height] = areaSize(light)
    return (light.intensity * stops(light)) / (light.normalize ? width * height : 1)
}

/** A sphere light as a point: its radiance times the disc it shows (pi r^2) is the intensity three's PointLight takes. */
export function pointIntensity(light: DescriptionLight): number {
    const radius = light.radius ?? LIGHT_DEFAULTS["inputs:radius"]
    const area = 4 * Math.PI * radius * radius
    return (light.intensity * stops(light) * Math.PI * radius * radius) / (light.normalize ? area : 1)
}

/** A dome's radiance: intensity * 2^exposure, the same from every direction (Blender's World background strength). */
export function domeRadiance(light: DescriptionLight): number {
    return light.intensity * stops(light)
}

/** The irradiance a uniform dome gives any surface: its radiance over the hemisphere a surface faces, pi * L. */
export function domeIrradiance(light: DescriptionLight): number {
    return Math.PI * domeRadiance(light)
}

/** The on-axis intensity of a rect or disk light's face, radiance times area: what a spot standing in for it takes. */
export function areaIntensity(light: DescriptionLight): number {
    const [width, height] = areaSize(light)
    return areaRadiance(light) * width * height
}

/** A cylinder light as a point: its radiance times the side it shows broadside (2 r × length). */
export function cylinderIntensity(light: DescriptionLight): number {
    const radius = light.radius ?? LIGHT_DEFAULTS["inputs:radius"]
    const length = light.length ?? LIGHT_DEFAULTS["inputs:length"]
    // normalized, the power is that of a unit light whatever its size: divide by the area it emits from
    const side = 2 * Math.PI * radius * length
    return (light.intensity * stops(light) * 2 * radius * length) / (light.normalize && side > 0 ? side : 1)
}

/** A blackbody's linear Rec.709 colour (Kim et al.'s Planckian fit, 1667-25000 K), 6500 K white, luminance 1: UsdLux's colorTemperature tint. */
export function blackbody(kelvin: number): [number, number, number] {
    const raw = (temperature: number): [number, number, number] => {
        const t = Math.max(1667, Math.min(25000, temperature))
        const x = t <= 4000
            ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
            : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039
        const y = t <= 2222
            ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
            : t <= 4000
            ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
            : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483
        const X = x / y
        const Z = (1 - x - y) / y
        return [
            3.2406 * X - 1.5372 - 0.4986 * Z,
            -0.9689 * X + 1.8758 + 0.0415 * Z,
            0.0557 * X - 0.204 + 1.057 * Z,
        ]
    }
    const white = raw(6500)
    const colour = raw(kelvin).map((value, index) => Math.max(0, value / white[index])) as [number, number, number]
    const luminance = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]
    return colour.map((value) => value / luminance) as [number, number, number]
}

/** The colour a light shines in: its colour, tinted by its colour temperature when it turns that on. */
export function lightColor(light: DescriptionLight): [number, number, number] {
    if (light.colorTemperature === undefined) return light.color
    const tint = blackbody(light.colorTemperature)
    return [light.color[0] * tint[0], light.color[1] * tint[1], light.color[2] * tint[2]]
}
