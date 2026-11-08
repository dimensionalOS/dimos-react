// The URDF API (dimos's UrdfManager): the XML read into a RobotDescription (origins, geometry, materials, mimic, the
// root), MeshFile replies decoded, STL meshes (binary and ASCII) loaded, joint positions read back from link poses, and
// a model filling in as its meshes arrive.
import { test } from "vitest"
import { Window } from "happy-dom"
import { assert, assertAlmostEquals, assertEquals, assertThrows } from "./assert.ts"
import { decodeMeshFile, meshGeometry, meshUris, parseUrdf } from "../src/three/urdf/parse.ts"
import { Kinematics } from "../src/three/urdf/description.ts" // the tests run in node, which has no DOMParser; the browser's is what a page uses
;(globalThis as { DOMParser?: unknown }).DOMParser = new Window().DOMParser

const URDF = `<?xml version="1.0"?>
<robot name="two_link">
  <material name="grey"><color rgba="0.5 0.5 0.5 1"/></material>
  <link name="base_link">
    <visual><origin xyz="0 0 0.1" rpy="0 0 1.5707963"/><geometry><mesh filename="package://two/meshes/base.STL" scale="0.001 0.001 0.001"/></geometry><material name="grey"/></visual>
    <collision><geometry><box size="0.2 0.2 0.1"/></geometry></collision>
  </link>
  <link name="arm">
    <visual><geometry><cylinder radius="0.02" length="0.3"/></geometry><material name="red"><color rgba="1 0 0 0.5"/></material></visual>
    <visual><geometry><mesh filename="package://two/meshes/base.STL"/></geometry></visual>
  </link>
  <link name="finger"/>
  <link name="finger_mirror"/>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/><child link="arm"/>
    <origin xyz="0 0 0.2" rpy="1.5707963 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-1" upper="1" effort="1" velocity="1"/>
  </joint>
  <joint name="slide" type="prismatic">
    <parent link="arm"/><child link="finger"/><axis xyz="0 1 0"/><limit lower="0" upper="0.04" effort="1" velocity="1"/>
  </joint>
  <joint name="slide_mirror" type="prismatic">
    <parent link="arm"/><child link="finger_mirror"/><mimic joint="slide" multiplier="-1"/>
  </joint>
</robot>`

/** a binary STL of one triangle */
function binaryStl(): Uint8Array {
    const bytes = new Uint8Array(84 + 50)
    const view = new DataView(bytes.buffer)
    view.setUint32(80, 1, true)
    const vertices = [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0]
    vertices.forEach((value, index) => view.setFloat32(84 + index * 4, value, true))
    return bytes
}

const ASCII_STL = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t`

/** files.MeshFile as dimos encodes it */
function meshFile(uri: string, data: Uint8Array): Uint8Array {
    const name = new TextEncoder().encode(uri)
    const bytes = new Uint8Array(12 + name.length + data.length)
    const view = new DataView(bytes.buffer)
    view.setFloat64(0, 1234.5, true)
    view.setUint32(8, name.length, true)
    bytes.set(name, 12)
    bytes.set(data, 12 + name.length)
    return bytes
}

test("a URDF reads into a description at its root link", () => {
    const description = parseUrdf(URDF)
    assertEquals(description.name, "two_link")
    assertEquals(description.base_link, "base_link")
    assertEquals(description.base_frame, "base_link")
    assertEquals(description.joint_names, ["shoulder", "slide"])
    const base = description.links.find((link) => link.name === "base_link")!
    assertEquals(base.visuals[0].mesh, "package://two/meshes/base.STL")
    assertEquals(base.visuals[0].scale, [0.001, 0.001, 0.001])
    assertEquals(base.visuals[0].color, [0.5, 0.5, 0.5, 1])
    assertAlmostEquals(base.visuals[0].origin.quat[2], Math.SQRT1_2, 1e-6)
    assertEquals(base.collisions[0].size, [0.2, 0.2, 0.1])
    const arm = description.links.find((link) => link.name === "arm")!
    assertEquals(arm.visuals[0].type, "cylinder")
    assertEquals(arm.visuals[0].color, [1, 0, 0, 0.5])
    const shoulder = description.joints.find((joint) => joint.name === "shoulder")!
    assertEquals(shoulder.limit, [-1, 1])
    assertAlmostEquals(shoulder.origin.quat[0], Math.SQRT1_2, 1e-6)
    assertEquals(description.joints.find((joint) => joint.name === "slide_mirror")!.mimic, {
        joint: "slide",
        multiplier: -1,
        offset: 0,
    })
    assertEquals(meshUris(description), ["package://two/meshes/base.STL"])
    assertThrows(() => parseUrdf("<notarobot/>"))
})

test("a MeshFile reply decodes to its uri and the file's bytes", () => {
    const decoded = decodeMeshFile(meshFile("package://two/meshes/base.STL", binaryStl()))
    assertEquals(decoded.ts, 1234.5)
    assertEquals(decoded.uri, "package://two/meshes/base.STL")
    assertEquals(decoded.data.length, 134)
    assertThrows(() => decodeMeshFile(new Uint8Array(4)))
})

test("STL meshes load, binary and ASCII", () => {
    for (const data of [binaryStl(), new TextEncoder().encode(ASCII_STL)]) {
        const geometry = meshGeometry("package://x/a.STL", data)
        assertEquals(geometry.attributes.position.count, 3)
        assert(geometry.attributes.normal)
    }
    assertThrows(() => meshGeometry("package://x/a.3ds", binaryStl()))
})

test("a Z_UP COLLADA mesh keeps its own axes, as a URDF link frame expects", () => {
    const dae = `<?xml version="1.0"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_geometries><geometry id="g"><mesh>
    <source id="p"><float_array id="pa" count="9">0 0 0 0.1 0 0 0 0 -0.2</float_array>
      <technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="v"><input semantic="POSITION" source="#p"/></vertices>
    <triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="s"><node id="n"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>`
    const geometry = meshGeometry("package://x/calf.dae", new TextEncoder().encode(dae))
    geometry.computeBoundingBox()
    assertAlmostEquals(geometry.boundingBox!.min.z, -0.2, 1e-6)
    assertAlmostEquals(geometry.boundingBox!.max.y, 0, 1e-6)
})

test("joint positions read back from link poses (TF)", () => {
    const kinematics = new Kinematics(parseUrdf(URDF))
    const poses = kinematics.linkPoses({ shoulder: 0.7, slide: 0.03 })
    const relative = (child: string, parent: string) => poses.get(parent)!.clone().invert().multiply(poses.get(child)!)
    const positions = kinematics.positionsFrom(relative)
    assertAlmostEquals(positions.shoulder, 0.7, 1e-6)
    assertAlmostEquals(positions.slide, 0.03, 1e-6)
})
