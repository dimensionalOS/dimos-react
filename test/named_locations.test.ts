// The labeled-points layer reads dimos's named locations (visualization_msgs.InteractiveMarkerUpdate: the whole list,
// each pose a place by its name, all in the list's frame).
import { test } from "vitest"
import { assertEquals } from "./assert.ts"
import { decodeLcm, encodeLcm } from "../src/index.ts"
import { namedLocationsOf } from "../src/three.ts"

const pose = (name: string, x: number, y: number) => ({
    header: { stamp: { sec: 1, nsec: 0 }, frame_id: "premap" },
    pose: { position: { x, y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    name,
})

test("named locations are a point per pose, by name, in the list's frame", () => {
    const bytes = encodeLcm("visualization_msgs.InteractiveMarkerUpdate", {
        server_id: "run",
        seq_num: 3,
        poses: [pose("common_area", 1, 2), pose("Base of stairs", -3, 0.5)],
    })
    const { points, frame } = namedLocationsOf(decodeLcm("visualization_msgs.InteractiveMarkerUpdate", bytes))
    assertEquals(frame, "premap")
    assertEquals(points.map((point) => [point.label, point.position.x, point.position.y]), [["common_area", 1, 2], [
        "Base of stairs",
        -3,
        0.5,
    ]])
})

test("an empty list is no points", () => {
    assertEquals(namedLocationsOf({ poses: [] }), { points: [], frame: "" })
})

test("a theme color falls back through var()s to the first that's set", async () => {
    const { cssColor } = await import("../src/three/robot_model.ts")
    const { testGlobals } = await import("./fake_globals.ts")
    const saved = [testGlobals.document, testGlobals.getComputedStyle]
    testGlobals.document = { body: {} }
    testGlobals.getComputedStyle = () => ({ getPropertyValue: (name: string) => (name === "--info" ? "#00ff00" : "") })
    try {
        assertEquals(cssColor("var(--entity-location, var(--info, var(--primary)))").getHexString(), "00ff00")
        assertEquals(cssColor("var(--unset)", "#ff0000").getHexString(), "ff0000")
    } finally {
        ;[testGlobals.document, testGlobals.getComputedStyle] = saved
    }
})
