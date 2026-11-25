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

/** A rect or disk light's width and height: a disk as the square of equal area, which is what a RectAreaLight can draw. */
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
