// The sky a scene's dome light stands for.
//
// three samples an equirectangular background on world Y, but this viewer is Z-up
// (`camera.up.set(0, 0, 1)`), so without `scene.backgroundRotation` the gradient runs sideways and
// you see the same band whether you look up or down -- measured: looking along +Z and -Z both
// returned the midpoint colour. Rotating the background by +90 degrees about X puts the top of the
// painted strip overhead; the rest of this file is written in those terms.
//
// Because v is linear in asin(y), a row of the strip is a fixed elevation: the top row is straight
// up, the middle row is the horizon, the bottom row is straight down. So the stops below are placed
// by angle rather than by eye.
import * as THREE from "three"

/** what `scene.backgroundRotation` has to be for the strip's top row to sit overhead in a Z-up world */
export const SKY_ROTATION_X = Math.PI / 2

/** the strip is 1 px wide: nothing varies with azimuth */
const STRIP_HEIGHT = 256

// A real sky is deep overhead and pale at the horizon, and what is below the horizon is ground, not
// more sky. Keeping the ground in the gradient is what stops the scene looking like it floats in a
// blue void when the camera drops below the floor.
const ZENITH = new THREE.Color(0.11, 0.26, 0.60)
const HIGH = new THREE.Color(0.30, 0.52, 0.83)
const HORIZON = new THREE.Color(0.82, 0.89, 0.97)
const GROUND_NEAR = new THREE.Color(0.46, 0.44, 0.41)
const GROUND_FAR = new THREE.Color(0.20, 0.19, 0.18)

/** A dome light's intensity lights the room; it is not how bright the sky is. It only nudges it. */
function brightness(intensity: number): number {
    return Math.min(1.25, Math.max(0.75, 0.75 + 0.5 * intensity))
}

/** The dome's hue, with its brightness divided out, so a white dome leaves the sky's own colours alone. */
function tintOf(colour: THREE.Color): THREE.Color {
    const peak = Math.max(colour.r, colour.g, colour.b)
    return peak > 1e-6 ? colour.clone().multiplyScalar(1 / peak) : new THREE.Color(1, 1, 1)
}

export interface SkyStop {
    /** 0 at the top of the strip (straight up), 0.5 at the horizon, 1 at the bottom (straight down) */
    at: number
    colour: THREE.Color
}

/** The sky a dome of this colour and intensity stands for, as gradient stops down the strip. */
export function skyStops(colour: THREE.Color, intensity: number): SkyStop[] {
    const tint = tintOf(colour)
    const lift = brightness(intensity)
    const shade = (base: THREE.Color, groundward: boolean) => {
        const out = base.clone().multiply(tint).multiplyScalar(lift)
        // the ground takes the sky's tint only faintly: lit earth does not turn blue
        return groundward ? out.lerp(base.clone().multiplyScalar(lift), 0.65) : out
    }
    return [
        { at: 0.0, colour: shade(ZENITH, false) },
        { at: 0.25, colour: shade(HIGH, false) },
        { at: 0.49, colour: shade(HORIZON, false) },
        { at: 0.5, colour: shade(GROUND_NEAR, true) },
        { at: 1.0, colour: shade(GROUND_FAR, true) },
    ]
}

/** The stops painted into a texture ready for `scene.background`. Null where there is no DOM. */
export function skyTexture(colour: THREE.Color, intensity: number): THREE.CanvasTexture | null {
    const canvas = globalThis.document?.createElement("canvas")
    const context = canvas?.getContext("2d")
    if (!canvas || !context) {
        return null
    }
    canvas.width = 1
    canvas.height = STRIP_HEIGHT
    const gradient = context.createLinearGradient(0, 0, 0, STRIP_HEIGHT)
    for (const stop of skyStops(colour, intensity)) {
        gradient.addColorStop(stop.at, `#${stop.colour.getHexString()}`)
    }
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, STRIP_HEIGHT)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.mapping = THREE.EquirectangularReflectionMapping
    return texture
}
