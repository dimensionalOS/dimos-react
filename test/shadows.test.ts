// The shadow box a directional light covers. A room is tens of metres across and need not sit on the origin:
// office_555 spans x -31..11.6, and a fixed box around the origin left half of it outside, drawing the
// frustum's own edge across a wall as a hard wedge.
import { test } from "vitest"
import { assert, assertEquals } from "./assert.ts"
import * as THREE from "three"

const { aimShadow, castsShadow } = await import("../src/three/shadows.ts")

/** office_555's own extents. */
const OFFICE = new THREE.Box3(new THREE.Vector3(-31, -18.5, -1.5), new THREE.Vector3(11.6, 17.5, 8.15))

function caster(direction: THREE.Vector3): THREE.DirectionalLight {
    const light = new THREE.DirectionalLight(0xffffff, 1)
    castsShadow(light, direction)
    return light
}

/** Every corner of `box`, in the light's own view space. */
function cornersInLightSpace(light: THREE.DirectionalLight, box: THREE.Box3): THREE.Vector3[] {
    light.updateMatrixWorld(true)
    light.shadow.updateMatrices(light)
    const toLight = light.shadow.camera.matrixWorldInverse
    const out: THREE.Vector3[] = []
    for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
                out.push(new THREE.Vector3(x, y, z).applyMatrix4(toLight))
            }
        }
    }
    return out
}

test("the shadow box covers a whole room that is nowhere near the origin", () => {
    for (
        const direction of [
            new THREE.Vector3(-5, -3, -10),
            new THREE.Vector3(0.2, -0.9, -0.4),
            new THREE.Vector3(1, 0, -1),
        ]
    ) {
        const light = caster(direction)
        aimShadow(light, OFFICE)
        const camera = light.shadow.camera
        for (const corner of cornersInLightSpace(light, OFFICE)) {
            // the camera looks down -z, so a corner in front of it is at negative z
            const depth = -corner.z
            assert(
                corner.x >= camera.left && corner.x <= camera.right &&
                    corner.y >= camera.bottom && corner.y <= camera.top &&
                    depth >= camera.near && depth <= camera.far,
                `${direction.toArray()}: corner ${corner.toArray().map((v) => v.toFixed(1))} outside ` +
                    `[${camera.left}, ${camera.right}] x [${camera.bottom}, ${camera.top}] x [${camera.near}, ${camera.far}]`,
            )
        }
    }
})

test("the light aims at the middle of what it lights, not at the origin", () => {
    const light = caster(new THREE.Vector3(0, 0, -1))
    aimShadow(light, OFFICE)
    const centre = OFFICE.getCenter(new THREE.Vector3())
    assertEquals(light.target.position.toArray().map((v) => Math.round(v * 100) / 100), [
        Math.round(centre.x * 100) / 100,
        Math.round(centre.y * 100) / 100,
        Math.round(centre.z * 100) / 100,
    ])
    assert(light.position.distanceTo(centre) > 20, "the light stands off the scene it lights")
})

test("normalBias follows the texel, so a bigger box offsets further", () => {
    const room = caster(new THREE.Vector3(0, 0, -1))
    aimShadow(room, OFFICE)
    const extent = OFFICE.getSize(new THREE.Vector3()).length() / 2
    assertEquals(room.shadow.mapSize.x, 2048)
    assertEquals(room.shadow.normalBias, 2 * (2 * extent / 2048))

    const desk = caster(new THREE.Vector3(0, 0, -1))
    aimShadow(desk, new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 1)))
    assert(desk.shadow.normalBias > 0, "a small scene still offsets along the normal")
    assert(desk.shadow.normalBias < room.shadow.normalBias, "and offsets less than a whole room does")
})

test("a light that does not cast is left alone", () => {
    const light = new THREE.DirectionalLight(0xffffff, 1)
    const before = light.position.clone()
    aimShadow(light, OFFICE)
    assertEquals(light.castShadow, false)
    assertEquals(light.position.toArray(), before.toArray())
})
