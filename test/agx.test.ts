// Blender's AgX, as dimos's sim2/mujoco/look.py computes it: the values below are look.py's agx() on the same colours.
import { test } from "vitest"
import { assert } from "./assert.ts"
import { agx, agxLut } from "../src/three/agx.ts"

const CASES: [[number, number, number], [number, number, number]][] = [
    [[0, 0, 0], [0, 0, 0]],
    [[0.18, 0.18, 0.18], [0.46132, 0.46132, 0.461352]],
    [[1, 1, 1], [0.77097, 0.77097, 0.770986]],
    [[0.8, 0.4, 0.1], [0.761327, 0.606108, 0.417243]],
    [[0.05, 0.2, 0.6], [0.290775, 0.507409, 0.717314]],
    [[3.5, 3.4, 3.2], [0.903121, 0.900303, 0.895667]],
    [[20, 15, 10], [1, 0.993545, 0.977511]],
    [[0.001, 0.002, 0.0005], [0.003754, 0.008838, 0.000175]],
]

test("the LUT tone maps as look.py does, to within 1/255", async () => {
    const lut = await agxLut()
    for (const [linear, expected] of CASES) {
        const got = agx(lut, linear)
        for (let channel = 0; channel < 3; channel++) {
            // look.py rounds the code value to 16 bits before its 2.4 power; that is all the difference allowed
            assert(
                Math.abs(got[channel] - expected[channel]) < 1 / 255,
                `${linear} -> ${got}, look.py says ${expected}`,
            )
        }
    }
})
