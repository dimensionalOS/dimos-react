// The sky a dome light stands for. The orientation constant is measured, not guessed: in a Z-up
// world with no backgroundRotation, looking straight up and straight down both return the strip's
// midpoint, because three samples the background on world Y.
import { test } from "vitest"
import { assert, assertEquals } from "./assert.ts"
import * as THREE from "three"

const { SKY_ROTATION_X, skyStops } = await import("../src/three/sky.ts")

const WHITE_DOME = new THREE.Color(0.9333333, 0.9333333, 1)
const luma = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const at = (stops: ReturnType<typeof skyStops>, where: number) => stops.find((s) => s.at === where)!.colour

test("the strip is turned so its top row sits overhead", () => {
    assertEquals(SKY_ROTATION_X, Math.PI / 2)
})

test("it reads as a sky: deep overhead, pale at the horizon", () => {
    const stops = skyStops(WHITE_DOME, 0.3)
    const zenith = at(stops, 0)
    const horizon = at(stops, 0.49)
    assert(luma(zenith) < luma(horizon), "the zenith has to be darker than the horizon")
    assert(zenith.b > zenith.r, "the sky overhead is blue, not grey")
    // the old gradient was derived wholly from a dim dome and came out near-neutral
    assert(zenith.b - zenith.r > 0.1, `too washed out: r ${zenith.r.toFixed(2)} b ${zenith.b.toFixed(2)}`)
})

test("below the horizon is ground, not more sky", () => {
    const stops = skyStops(WHITE_DOME, 0.3)
    const above = at(stops, 0.49)
    const below = at(stops, 0.5)
    assert(luma(below) < luma(above), "the ground is darker than the sky it meets")
    assert(below.r >= below.b, "the ground is not blue")
    assert(luma(at(stops, 1)) < luma(below), "and it darkens underfoot")
})

test("a warm dome tints the sky warm", () => {
    const sunset = skyStops(new THREE.Color(1.0, 0.55, 0.3), 0.6)
    const horizon = at(sunset, 0.49)
    assert(horizon.r > horizon.b, "a warm dome should not leave a blue horizon")
})

test("a dim dome does not black the sky out, a bright one does not blow it out", () => {
    const dim = luma(at(skyStops(WHITE_DOME, 0), 0.49))
    const bright = luma(at(skyStops(WHITE_DOME, 10), 0.49))
    assert(dim > 0.4, `a dome at zero still leaves a visible sky, got ${dim.toFixed(2)}`)
    assert(bright < 1.2, `a very bright dome stays in range, got ${bright.toFixed(2)}`)
})

test("the stops run from the top of the strip to the bottom, in order", () => {
    const stops = skyStops(WHITE_DOME, 0.5)
    assertEquals(stops[0].at, 0)
    assertEquals(stops[stops.length - 1].at, 1)
    for (let i = 1; i < stops.length; i++) {
        assert(stops[i].at > stops[i - 1].at, "stops must increase")
    }
})
