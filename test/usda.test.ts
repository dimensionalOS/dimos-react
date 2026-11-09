// A USD layer read into the same RobotDescription a URDF is. The fixtures are the SAME robot written both ways by
// dimos's own converter (dimos/robot/assets/usd.py), so a change to what dimos emits fails here rather than in a
// browser: parseUsda is compared against parseUrdf field by field.
import { test } from "vitest"
import { assert, assertAlmostEquals, assertEquals, assertThrows } from "./assert.ts"
import { readFileSync } from "node:fs"
import { parsePrims, parseUsda, usdaAssetHashes, usdaMeshUris } from "../src/three/urdf/usda.ts"
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

test("every hashed asset comes back under the path the layer authored", () => {
    // dimos refuses to serve a subtree whose assets are unhashed, so for its layers this is
    // complete — which is what lets a page cache a mesh by content and never refetch it.
    const hashes = usdaAssetHashes(usda)

    const mesh = parseUsda(usda).links.find((link) => link.name === "upper-arm")?.visuals[0]?.mesh
    assert(mesh, "no mesh in the fixture")
    const hash = hashes.get(mesh)
    assert(hash, `no hash for ${mesh}; have ${[...hashes.keys()].join(", ")}`)
    assert(hash.startsWith("sha256:"), hash)
    assertEquals(hash.length, "sha256:".length + 64)
})

test("a layer that hashes nothing is empty rather than an error", () => {
    const bare = '#usda 1.0\n(\n    defaultPrim = "x"\n)\n\ndef Xform "x"\n{\n}\n'
    assertEquals(usdaAssetHashes(bare).size, 0)
})

// ---- what dimos's own vendored layers look like ----------------------------
// A mesh prim there names the servable file in assetInfo and uses the reference arc for a
// `.usdc` sidecar, so the layer is valid USD for usdview, Isaac and MuJoCo. Reading the arc
// first asks for the sidecar, which the mesh loader refuses and nothing is drawn.
const _SIDECAR = `#usda 1.0
(
    defaultPrim = "rig"
)

def Xform "rig"
(
    prepend apiSchemas = ["PhysicsRigidBodyAPI"]
)
{
    def Mesh "visual_0" (
        assetInfo = {
            asset identifier = @meshes/arm.STL@
            string version = "sha256:abc"
        }
        prepend references = @meshes/arm.usdc@
    )
    {
    }
}
`

test("a mesh is fetched by the file assetInfo names, not the USD sidecar it references", () => {
    assertEquals(usdaMeshUris(_SIDECAR), ["meshes/arm.STL"])
})

test("the hash is filed under the same path the mesh is fetched by", () => {
    // Keyed by the sidecar instead, every lookup would miss and nothing would ever be cached.
    assertEquals([...usdaAssetHashes(_SIDECAR)], [["meshes/arm.STL", "sha256:abc"]])
})

test("a layer with only a reference arc still resolves it", () => {
    const arcOnly = _SIDECAR.replace(/assetInfo = \{[^}]*\}\n\s*/, "")
    assertEquals(usdaMeshUris(arcOnly), ["meshes/arm.usdc"])
})

const _PLACED = `#usda 1.0
(
    defaultPrim = "stage"
)

def Xform "stage"
(
    prepend apiSchemas = ["PhysicsRigidBodyAPI"]
)
{
    def Xform "stand_left" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI"]
    )
    {
        double3 xformOp:translate = (0, 1.2, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def Xform "stand_right" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI"]
    )
    {
        double3 xformOp:translate = (0, -1.2, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
`

test("a prim placed with translate is not left at the origin", () => {
    // USD treats translate/orient and one matrix4d as equally normal ways to place a prim.
    // Reading only the matrix put three robots standing 1.2 m apart on top of each other.
    const placed = parseUsda(_PLACED)
    const by = new Map(placed.joints.map((joint: DescriptionJoint) => [joint.child, joint]))

    assertAlmostEquals(by.get("stand_left")!.origin.xyz[1], 1.2, 1e-9)
    assertAlmostEquals(by.get("stand_right")!.origin.xyz[1], -1.2, 1e-9)
})

// ---- colour comes from the bound material, not only displayColor ----------
// The converter writes a real UsdShade Material per MJCF material and binds it per geom, so a
// G1's ten black parts and its silver ones are stated there and nowhere else.
const _MATERIALS = `#usda 1.0
(
    defaultPrim = "rig"
)

def Xform "rig" (
    prepend apiSchemas = ["PhysicsRigidBodyAPI"]
)
{
    def Scope "Materials"
    {
        def Material "black"
        {
            color3f inputs:color = (0.0331, 0.0331, 0.0331)
        }
    }

    def Mesh "visual_0" (
        assetInfo = {
            asset identifier = @meshes/arm.STL@
        }
    )
    {
        rel material:binding = </rig/Materials/black>
    }

    def Mesh "visual_1" (
        assetInfo = {
            asset identifier = @meshes/hand.STL@
        }
    )
    {
        color3f[] primvars:displayColor = [(1, 0, 0)]
        rel material:binding = </rig/Materials/black>
    }
}
`

test("a geom takes the colour of the material it binds", () => {
    // Reading only displayColor drew the whole robot in the viewer's default grey.
    const [visual] = parseUsda(_MATERIALS).links[0].visuals
    assertAlmostEquals(visual.color![0], 0.0331, 1e-6)
    assertAlmostEquals(visual.color![2], 0.0331, 1e-6)
    assertEquals(visual.color![3], 1)
})

test("displayColor still wins over the bound material", () => {
    // A geom that states its own colour means it; the binding is the fallback.
    const visuals = parseUsda(_MATERIALS).links[0].visuals
    assertEquals(visuals[1].color, [1, 0, 0, 1])
})

// A room written the way MuJoCo's converter writes one: a plain Xform at the root, a body per thing standing in
// it, and geoms that are both the collider and the thing you see.
const room = `#usda 1.0
(
    defaultPrim = "office"
)

def Xform "office" (
    apiSchemas = ["GeomModelAPI"]
)
{
    def Scope "Geometry"
    {
        def Xform "desk" (
            apiSchemas = ["PhysicsRigidBodyAPI"]
        )
        {
            double3 xformOp:translate = (2, 0, 0)
            uniform token[] xformOpOrder = ["xformOp:translate"]

            def Cube "desk_g0" (
                apiSchemas = ["PhysicsCollisionAPI", "MjcCollisionAPI"]
            )
            {
                double size = 2
                float3 xformOp:scale = (1, 0.5, 0.4)
                uniform token[] xformOpOrder = ["xformOp:scale"]
            }

            def Cube "desk_hull" (
                apiSchemas = ["PhysicsCollisionAPI", "MjcCollisionAPI"]
            )
            {
                uniform int mjc:group = 3
                double size = 2
            }
        }

        def Xform "wall" (
            apiSchemas = ["PhysicsRigidBodyAPI"]
        )
        {
            double3 xformOp:translate = (0, 5, 0)
            uniform token[] xformOpOrder = ["xformOp:translate"]

            def Cube "wall_g0" (
                apiSchemas = ["PhysicsCollisionAPI", "MjcCollisionAPI"]
            )
            {
                double size = 2
            }
        }
    }
}
`

test("a room whose root is not a body still hangs off one frame", () => {
    // Every body in a converted scene sits under a plain Xform, because MuJoCo's worldbody carries no rigid body.
    // Read literally that makes each one an orphan placeable only from tf, and nothing publishes a transform per
    // desk -- so the room drew as whatever was standing in it and nothing else.
    const description = parseUsda(room)
    assertEquals(description.base_link, "office")
    const welds = description.joints.filter((each) => each.type === "fixed").map((each) =>
        `${each.parent}->${each.child}`
    )
    assertEquals(welds.sort(), ["office->desk", "office->wall"])
    // each still at its own place, not stacked on the room's origin or on each other
    assertEquals(joint(description.joints, "desk_weld").origin.xyz, [2, 0, 0])
    assertEquals(joint(description.joints, "wall_weld").origin.xyz, [0, 5, 0])
})

test("a link with nothing but a collider is drawn as its collider", () => {
    // MuJoCo collides the shape it draws, so a wall is a collider and nothing else. Taking that to mean "do not
    // draw" threw away every wall, floor and slab of a converted room and left only the furniture, which happens
    // to carry separate visual meshes.
    const description = parseUsda(room)
    const wall = description.links.find((link) => link.name === "wall")
    assert(wall, "no wall link")
    assertEquals(wall.visuals.length, 1, "nothing else to show for it, so the collider is what it looks like")
    assertEquals(wall.collisions.length, 1, "...and it is still a collider")
})

test("a link that has something to show keeps its colliders to itself", () => {
    // A collider only stands in where there is no visual at all. Given one, the desk shows that and nothing else.
    const withVisual = room.replace(
        '            def Cube "desk_hull" (',
        '            def Cube "desk_visual"\n            {\n                double size = 1\n            }\n\n' +
            '            def Cube "desk_hull" (',
    )
    const description = parseUsda(withVisual)
    const desk = description.links.find((link) => link.name === "desk")
    assert(desk, "no desk link")
    assertEquals(desk.visuals.length, 1, "the one shape with no collider on it")
    assertEquals(desk.collisions.length, 2, "both colliders stay colliders")
})

test("a dome light is the sky, not just another ambient fill", () => {
    // A viewer that only lights by it leaves flat black outside the windows of a room that
    // told it what the sky looks like. Keeping dome distinct from ambient is what lets the
    // viewer paint it as well as light by it.
    const sky = `#usda 1.0
(
    defaultPrim = "room"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "room"
{
    def DomeLight "sky"
    {
        color3f inputs:color = (0.45, 0.6, 0.95)
        float inputs:intensity = 0.8
    }

    def DistantLight "sun"
    {
        color3f inputs:color = (1, 1, 1)
        float inputs:intensity = 0.5
    }
}
`
    const lights = parseUsda(sky).lights ?? []
    const dome = lights.find((light) => light.type === "dome")
    assert(dome, `no dome light in ${lights.map((light) => light.type).join(", ")}`)
    assertAlmostEquals(dome.color[2], 0.95, 1e-6, "the sky keeps its own colour")
    assertEquals(lights.filter((light) => light.type === "distant").length, 1, "the sun is still a sun")
})

test("a layer says how it wants to be shown, and a layer that says nothing stays silent", () => {
    // The furniture colours in a room were picked against some tone curve. Showing them through a
    // different one shows a room nobody chose, so the layer gets to name the curve and the grade.
    const graded = `#usda 1.0
(
    defaultPrim = "room"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "room"
{
}

def RenderSettings "Look"
{
    uniform token dimos:look:toneMap = "neutral"
    float dimos:look:exposure = 1
    float dimos:look:saturation = 1.25
    float dimos:look:contrast = 1.06
}
`
    const look = parseUsda(graded).look
    assert(look, "the layer named a look and it did not survive parsing")
    assertEquals(look.toneMap, "neutral")
    assertAlmostEquals(look.exposure ?? 0, 1, 1e-6)
    assertAlmostEquals(look.saturation ?? 0, 1.25, 1e-6)
    assertAlmostEquals(look.contrast ?? 0, 1.06, 1e-6)
    // Absent is not the same as default: a viewer told nothing keeps whatever it already had.
    assertEquals(look.toneMap !== undefined && look.exposure !== undefined, true)

    const plain = `#usda 1.0
(
    defaultPrim = "room"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "room"
{
}
`
    assertEquals(parseUsda(plain).look, undefined, "a layer with no RenderSettings asks for nothing")
})

test("exposure comes off the camera, in USD's own spelling", () => {
    // USD puts exposure on the camera rather than on the render settings, as a log base-2 stop,
    // and Isaac's camera exposure API puts the physical rig beside it. A stage authored there has
    // to read here without being rewritten.
    const head = `#usda 1.0
(
    defaultPrim = "room"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "room"
{
}
`
    const stops = parseUsda(`${head}
def Camera "view"
{
    float exposure = 1
}
`).look
    assert(stops, "a camera that names an exposure is a look on its own, with no RenderSettings")
    assertAlmostEquals(stops.exposure ?? 0, 2, 1e-6, "one stop doubles the image")

    // the physical set, at USD's defaults: ISO 100, 1 s, f/1, responsivity 1 -- so no change
    const neutral = parseUsda(`${head}
def Camera "view"
{
    float exposure:iso = 100
    float exposure:time = 1
    float exposure:fStop = 1
    float exposure:responsivity = 1
}
`).look
    assertAlmostEquals(neutral?.exposure ?? 0, 1, 1e-6, "the default rig changes nothing")

    // responsivity * (time * iso/100 * 2^stops) / fStop^2 = 1 * (0.5 * 4 * 2) / 4
    const rigged = parseUsda(`${head}
def Camera "view"
{
    float exposure = 1
    float exposure:iso = 400
    float exposure:time = 0.5
    float exposure:fStop = 2
}
`).look
    assertAlmostEquals(rigged?.exposure ?? 0, 1, 1e-6)

    // UsdRender points the settings at one camera, so that is the one that is read
    const two = parseUsda(`${head}
def Camera "wrong"
{
    float exposure = 3
}

def Camera "chosen"
{
    float exposure = 0
}

def RenderSettings "Look"
{
    rel camera = </room/chosen>
    float dimos:look:saturation = 1.2
}
`).look
    assertAlmostEquals(two?.exposure ?? -1, 1, 1e-6, "the linked camera, not the first one")
    assertAlmostEquals(two?.saturation ?? 0, 1.2, 1e-6, "and the rest of the look still reads")

    // our flat multiplier still works where there is no camera to ask
    const flat = parseUsda(`${head}
def RenderSettings "Look"
{
    float dimos:look:exposure = 1.05
}
`).look
    assertAlmostEquals(flat?.exposure ?? 0, 1.05, 1e-6)

    const silent = parseUsda(`${head}
def Camera "view"
{
    float focalLength = 24
}
`).look
    assertEquals(silent, undefined, "a camera that says nothing about exposure is not a look")
})
