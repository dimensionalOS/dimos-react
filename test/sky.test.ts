// The sky a dome light stands for: the dome itself, at its own radiance, as Blender draws a World of that strength.
import { test } from "vitest"
import { assertAlmostEquals, assertEquals } from "./assert.ts"
import * as THREE from "three"

const { SKY_ROTATION_X, skyTexture } = await import("../src/three/sky.ts")

test("a picture's top row is turned overhead", () => {
    // in a Z-up world with no backgroundRotation, three samples the background on world Y
    assertEquals(SKY_ROTATION_X, Math.PI / 2)
})

test("the sky is the dome's radiance, unclamped, in every texel", () => {
    const texture = skyTexture(new THREE.Color(3.559, 3.2, 1.5))
    const data = texture.image.data as Float32Array
    for (let at = 0; at < data.length; at += 4) {
        assertAlmostEquals(data[at], 3.559, 1e-6)
        assertAlmostEquals(data[at + 1], 3.2, 1e-6)
        assertAlmostEquals(data[at + 2], 1.5, 1e-6)
    }
    assertEquals(texture.type, THREE.FloatType)
    // wide enough for PMREMGenerator to prefilter into an environment (a 2 x 1 strip came out black)
    assertEquals([texture.image.width, texture.image.height], [64, 32])
    assertEquals(texture.colorSpace, THREE.LinearSRGBColorSpace)
})
