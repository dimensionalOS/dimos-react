// UsdLux lights in three's units against Blender 5.1 EEVEE on a one-light stage: a matte plane of albedo 0.5 seen from above.
import { test } from "vitest"
import { assertAlmostEquals } from "./assert.ts"
import { areaRadiance, areaSize, domeIrradiance, sunIrradiance } from "../src/three/light_units.ts"
import type { DescriptionLight } from "../src/three/urdf/description.ts"

const light = (fields: Partial<DescriptionLight>): DescriptionLight => ({
    name: "l",
    type: "distant",
    xyz: [0, 0, 0],
    direction: [0, 0, -1],
    color: [1, 1, 1],
    intensity: 1,
    shadow: true,
    ...fields,
})
const reflected = (irradiance: number) => (0.5 * irradiance) / Math.PI

test("a normalized sun: Blender rendered 2.549 for intensity 2, exposure 1", () => {
    assertAlmostEquals(reflected(sunIrradiance(light({ intensity: 2, exposure: 1, normalize: true }))), 2.549, 0.01)
})

test("an unnormalized sun is its disc's radiance: Blender rendered 241.1 for intensity 2000, exposure 1, angle 10", () => {
    assertAlmostEquals(reflected(sunIrradiance(light({ intensity: 2000, exposure: 1, angle: 10 }))), 241.1, 1.5)
})

test("a dome lights every surface with pi times its radiance: Blender rendered 0.743 red for intensity 1.5", () => {
    assertAlmostEquals(
        reflected(domeIrradiance(light({ type: "dome", intensity: 1.5, color: [1, 0.5, 0.25] }))),
        0.743,
        0.01,
    )
})

test("a rect light's face is intensity * 2^exposure, divided by its area when normalized", () => {
    assertAlmostEquals(
        areaRadiance(light({ type: "rect", intensity: 3, exposure: 2, width: 1, height: 0.5 })),
        12,
        1e-9,
    )
    assertAlmostEquals(
        areaRadiance(light({ type: "rect", intensity: 3, exposure: 2, width: 1, height: 0.5, normalize: true })),
        24,
        1e-9,
    )
})

test("a disk is drawn as the square of the same area", () => {
    const [width, height] = areaSize(light({ type: "disk", radius: 0.2 }))
    assertAlmostEquals(width * height, Math.PI * 0.04, 1e-9)
})
