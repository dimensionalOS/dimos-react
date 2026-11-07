// A USD layer read into the same RobotDescription a URDF is. The fixtures are the SAME robot written both ways by
// dimos's own converter (dimos/robot/assets/usd.py), so a change to what dimos emits fails here rather than in a
// browser: parseUsda is compared against parseUrdf field by field.
import { test } from "vitest"
import { assert, assertAlmostEquals, assertEquals, assertThrows } from "./assert.ts"
import { readFileSync } from "node:fs"
import { parsePrims, parseUsda, usdaMeshUris } from "../src/three/urdf/usda.ts"
import { parseUrdf } from "../src/three/urdf/parse.ts"
import { Window } from "happy-dom"
;(globalThis as { DOMParser?: unknown }).DOMParser = new Window().DOMParser
import type { DescriptionJoint } from "../src/three/urdf/description.ts"

const usda = readFileSync(new URL("./fixtures/probe.usda", import.meta.url), "utf8")
const urdf = readFileSync(new URL("./fixtures/probe.urdf", import.meta.url), "utf8")

function joint(joints: DescriptionJoint[], name: string): DescriptionJoint {
    const found = joints.find((each) => each.name === name)
    assert(found, `no joint ${name} in ${joints.map((each) => each.name).join(", ")}`)
    return found
}

test("a layer's links come back under the names tf uses", () => {
    const description = parseUsda(usda)
    // `upper-arm` is the case that matters: a prim name cannot hold a "-", so the real name is in displayName
    assertEquals(description.links.map((link) => link.name).sort(), ["base", "tool", "upper-arm", "world"])
    assertEquals(description.base_link, "world")
})

test("the same robot reads the same from its USD as from its URDF", () => {
    const fromUsd = parseUsda(usda)
    const fromUrdf = parseUrdf(urdf)

    assertEquals(fromUsd.links.map((link) => link.name).sort(), fromUrdf.links.map((link) => link.name).sort())
    assertEquals(fromUsd.base_link, fromUrdf.base_link)
    assertEquals(
        fromUsd.joints.map((each) => each.name).sort(),
        fromUrdf.joints.map((each) => each.name).sort(),
    )
    for (const expected of fromUrdf.joints) {
        const got = joint(fromUsd.joints, expected.name)
        assertEquals(got.type, expected.type, expected.name)
        assertEquals([got.parent, got.child], [expected.parent, expected.child], expected.name)
        for (let axis = 0; axis < 3; axis += 1) {
            // single precision on the way out: localPos is point3f, localRot is quatf
            assertAlmostEquals(got.origin.xyz[axis], expected.origin.xyz[axis], 1e-6, `${expected.name} xyz`)
        }
    }
})

test("a joint's axis and limits survive, including the ones easy to get backwards", () => {
    const description = parseUsda(usda)

    // authored about z with the real axis folded into the local rotations
    const shoulder = joint(description.joints, "shoulder")
    assertEquals(shoulder.type, "revolute")
    for (const value of shoulder.axis) {
        assertAlmostEquals(value, 0.57735, 1e-4)
    }
    // a revolute limit is degrees in USD and radians in URDF
    assert(shoulder.limit, "no limit")
    assertAlmostEquals(shoulder.limit[0], -1.2, 1e-5)
    assertAlmostEquals(shoulder.limit[1], 0.8, 1e-5)
})

test("a revolute joint with no limit is read back as continuous", () => {
    const wrist = joint(parseUsda(usda).joints, "wrist")
    assertEquals(wrist.type, "continuous")
    assertEquals(wrist.limit, undefined)
})

test("a floating base does not come back welded", () => {
    // Written as no joint prim at all (a USD body with no joint is free), so the one left out is recorded on the
    // child link. Without reading that record a walking robot's base is fixed wherever it was authored.
    const base = joint(parseUsda(usda).joints, "floating_base")
    assertEquals(base.type, "floating")
    assertEquals([base.parent, base.child], ["world", "base"])
    assertAlmostEquals(base.origin.xyz[2], 0.8, 1e-6)
})

test("each geometry kind comes back with its dimensions", () => {
    const links = new Map(parseUsda(usda).links.map((link) => [link.name, link]))

    const box = links.get("base")?.collisions[0]
    assertEquals(box?.type, "box")
    assertEquals(box?.size?.map((value) => Number(value.toFixed(6))), [0.1, 0.2, 0.3])

    const cylinder = links.get("upper-arm")?.collisions[0]
    assertEquals(cylinder?.type, "cylinder")
    assertAlmostEquals(cylinder?.radius ?? 0, 0.05, 1e-6)
    assertAlmostEquals(cylinder?.length ?? 0, 0.4, 1e-6)

    const sphere = links.get("tool")?.collisions[0]
    assertEquals(sphere?.type, "sphere")
    assertAlmostEquals(sphere?.radius ?? 0, 0.03, 1e-6)
})

test("a mesh keeps the path the description named, so it is asked for the same way", () => {
    const visual = parseUsda(usda).links.find((link) => link.name === "upper-arm")?.visuals[0]
    assertEquals(visual?.type, "mesh")
    assert(visual?.mesh?.endsWith("meshes/arm.stl"), visual?.mesh)
    assertEquals(usdaMeshUris(usda), [visual?.mesh])
})

test("a geometry's own origin survives", () => {
    const box = parseUsda(usda).links.find((link) => link.name === "base")?.collisions[0]
    assertAlmostEquals(box?.origin.xyz[2] ?? 0, 0.01, 1e-6)
    // rpy 0 0 0.5 about z
    assertAlmostEquals(box?.origin.quat[2] ?? 0, Math.sin(0.25), 1e-6)
    assertAlmostEquals(box?.origin.quat[3] ?? 0, Math.cos(0.25), 1e-6)
})

test("the URDF kept in customData does not derail the reader", () => {
    // dimos stores what it could not convert as a triple-quoted string, and that XML holds braces. A reader that
    // counts braces without knowing it is inside a string walks off the end of the tree.
    assert(usda.includes("'''<inertial"), "the fixture no longer exercises this")
    const prims = parsePrims(usda)
    assertEquals(prims.length, 1)
    const robot = prims[0]
    // base, upper-arm and tool nest down the tree; the joints sit in a Scope beside them
    assert(robot.children.some((child) => child.type === "Scope" && child.name === "joints"))
    assert(parseUsda(usda).links.length === 4)
})

test("a layer that is not USD is refused rather than half-read", () => {
    assertThrows(() => parseUsda("<robot name='x'></robot>"))
    assertThrows(() => parseUsda(""))
})

test("a layer with no robot in it reads as a description with no links", () => {
    const description = parseUsda('#usda 1.0\n(\n    defaultPrim = "empty"\n)\n\ndef Xform "empty"\n{\n}\n')
    assertEquals(description.links, [])
    assertEquals(description.joints, [])
    assertEquals(description.name, "empty")
})
