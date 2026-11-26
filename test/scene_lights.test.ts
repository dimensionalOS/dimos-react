// A scene's USD lights as the viewer makes them: the dome is the environment (no flat ambient), a lamp that shadows
// or is shaped by a cone is a spot (three's area lights can do neither), a sphere light's shadow softens with its radius.
import { test } from "vitest"
import { assert, assertAlmostEquals, assertEquals } from "./assert.ts"
import { testGlobals } from "./fake_globals.ts"
import * as THREE from "three"
import type { DescriptionLight } from "../src/three/urdf/description.ts"
import { areaIntensity, blackbody, lightColor } from "../src/three/light_units.ts"

const { Window } = await import("happy-dom")
const dom = new Window({ url: "http://localhost/" })
testGlobals.window ??= dom
testGlobals.document ??= dom.document
testGlobals.getComputedStyle ??= dom.getComputedStyle.bind(dom)
testGlobals.requestAnimationFrame ??= () => 0
testGlobals.cancelAnimationFrame ??= () => {}
testGlobals.addEventListener ??= () => {}
testGlobals.removeEventListener ??= () => {}
testGlobals.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
}
// no WebGL here: the viewer warns and draws nothing, but its scene is built all the same
console.warn = () => {}
const { Viewer } = await import("../src/three/viewer.ts")

const light = (fields: Partial<DescriptionLight>): DescriptionLight => ({
    name: "l",
    type: "rect",
    xyz: [0, 0, 3],
    direction: [0, 0, -1],
    color: [1, 1, 1],
    intensity: 10,
    shadow: false,
    ...fields,
})

const made = (viewer: InstanceType<typeof Viewer>) => {
    const out: THREE.Light[] = []
    viewer.scene.traverse((object) => {
        if ((object as THREE.Light).isLight && object.visible) out.push(object as THREE.Light)
    })
    return out
}

test("a dome is the sky and the environment the scene is lit by, turned with its prim; no ambient light stands in", () => {
    const viewer = new Viewer(document.createElement("div") as unknown as HTMLElement)
    viewer.setSceneLights([light({ type: "dome", intensity: 2, quat: [0, 0, Math.SQRT1_2, Math.SQRT1_2] })])
    assertEquals(made(viewer).filter((each) => each instanceof THREE.AmbientLight).length, 0)
    assert(viewer.scene.background, "no sky")
    // a quarter about z, after the picture's own turn upright
    const turned = new THREE.Matrix4().makeRotationFromEuler(viewer.scene.backgroundRotation)
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(turned)
    assertAlmostEquals(up.z, 1, 1e-6)
})

test("a lamp that shadows, or that a cone narrows, is a spot; one that does neither keeps its area light", () => {
    const viewer = new Viewer(document.createElement("div") as unknown as HTMLElement)
    viewer.setSceneLights([
        light({ name: "plain" }),
        light({ name: "shadowed", shadow: true, width: 2, height: 0.5 }),
        light({ name: "cone", type: "point", radius: 0.1, cone: { angle: 30, softness: 0.25 } }),
        light({ name: "bulb", type: "point", radius: 0.2, shadow: true }),
    ])
    const [plain, shadowed, cone, bulb] = made(viewer)
    assert(plain instanceof THREE.RectAreaLight)
    assert(shadowed instanceof THREE.SpotLight)
    assertEquals(shadowed.castShadow, true)
    // radiance times area, on its axis, over the hemisphere it faces
    assertAlmostEquals(shadowed.intensity, 10, 1e-9)
    assertAlmostEquals(shadowed.angle, Math.PI / 2, 1e-9)
    assert(cone instanceof THREE.SpotLight)
    assertAlmostEquals(cone.angle, Math.PI / 6, 1e-9)
    assertAlmostEquals(cone.penumbra, 0.25, 1e-9)
    assert(bulb instanceof THREE.PointLight)
    assertEquals(bulb.castShadow, true)
    // a 0.2 m sphere 3 m from the scene's middle blurs its shadow over more than one texel
    assert(bulb.shadow.radius > 1, `${bulb.shadow.radius}`)
})

test("a blackbody at 6500 K is white, and an area light's spot stand-in has its radiance times its area", () => {
    blackbody(6500).forEach((value) => assertAlmostEquals(value, 1, 1e-9))
    // warm: more red than blue once tinted
    const [red, , blue] = lightColor(light({ colorTemperature: 2700 }))
    assert(red > blue)
    assertAlmostEquals(areaIntensity(light({ width: 2, height: 0.5 })), 10, 1e-9)
})
