// What a USD scene authors and the description must keep: composition (internal arcs, sublayers, instancers, overs),
// units, transforms, gprims, inline meshes, materials and their bindings, lights and cameras.
import { test } from "vitest"
import { assert, assertAlmostEquals, assertEquals } from "./assert.ts"
import { parsePrims, parseUsda, usdaSublayers } from "../src/three/urdf/usda.ts"
import { meshLooks, usdMeshGeometry } from "../src/three/urdf/usd_mesh.ts"
import { meshGeometry, meshUris } from "../src/three/urdf/parse.ts"
import type { DescriptionGeometry } from "../src/three/urdf/description.ts"

/** a room's root Xform around `body`, so its shapes are drawn welded to it */
const room = (body: string, header = "") =>
    `#usda 1.0
(
    defaultPrim = "room"
${header}
)

def Xform "room"
{
${body}
}
`

const visuals = (text: string, options?: Parameters<typeof parseUsda>[1]): DescriptionGeometry[] =>
    parseUsda(text, options).links.flatMap((link) => link.visuals)

const near = (got: readonly number[] | undefined, want: readonly number[], tolerance = 1e-6) => {
    assert(got, "missing")
    assertEquals(got.length, want.length)
    got.forEach((value, index) => assertAlmostEquals(value, want[index], tolerance))
}

const SQUARE = `
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]`

test("a Mesh authored in the layer itself is drawn from its own points, placed by its transform", () => {
    const [mesh] = visuals(room(`
    def Mesh "slab"
    {${SQUARE}
        double3 xformOp:translate = (0, 0, 2)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }`))
    assertEquals(mesh.type, "mesh")
    assert(mesh.geometry, "no inline geometry")
    assertEquals(mesh.mesh, undefined)
    assertEquals(mesh.geometry.attributes.position.count, 6)
    near(mesh.origin.xyz, [0, 0, 2])
    // nothing to fetch for it
    assertEquals(meshUris(parseUsda(room(`def Mesh "slab" {${SQUARE} }`))), [])
})

test("metersPerUnit scales every length, and a Y-up stage is turned so its +Y is up", () => {
    const text = room(
        `
    def Cube "box"
    {
        double size = 100
        double3 xformOp:translate = (0, 200, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
    def RectLight "lamp"
    {
        float inputs:width = 50
        float inputs:height = 50
        double3 xformOp:translate = (0, 300, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }`,
        `    metersPerUnit = 0.01
    upAxis = "Y"`,
    )
    const description = parseUsda(text)
    const [box] = description.links.flatMap((link) => link.visuals)
    near(box.size, [1, 1, 1])
    // 2 m up the stage's y, which is now the world's z, and turned with it
    near(box.origin.xyz, [0, 0, 2])
    near(box.origin.quat, [Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    const [lamp] = description.lights!
    near(lamp.xyz, [0, 0, 3])
    assertAlmostEquals(lamp.width!, 0.5, 1e-9)
    // it shone down its -z, which a Y-up stage holds level: the stage's +z is the world's -y, so it shines along +y
    near(lamp.direction, [0, 1, 0])
})

const INTERNAL = room(`
    def Scope "Materials"
    {
        def Material "concrete" (
            add references = </Prototype>
        )
        {
            color3f inputs:color = (0.2, 0.4, 0.6)
            float inputs:roughness = 0.6
            token outputs:surface.connect = </room/Materials/concrete/PreviewSurface.outputs:surface>
        }
    }
    def Cube "floor" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        rel material:binding = </room/Materials/concrete>
    }
    def Cube "hidden" (
        active = false
    )
    {
    }`).replace(
    'def Xform "room"',
    `over "Prototype"
{
    def Shader "PreviewSurface"
    {
        uniform token info:id = "UsdPreviewSurface"
        color3f inputs:diffuseColor.connect = </Prototype.inputs:color>
        float inputs:roughness.connect = </Prototype.inputs:roughness>
        token outputs:surface
    }
    def Cube "drawn_only_if_defined"
    {
    }
}

class "Abstract"
{
    def Cube "never"
    {
    }
}

def Xform "room"`,
)

test("an internal reference composes its prim in, with the paths into it pointed at the referencing prim", () => {
    const shown = visuals(INTERNAL)
    // the over's and the class's cubes are not drawn, nor the inactive one: only the floor
    assertEquals(shown.length, 1)
    // the shader came in through the reference and reads the material's own inputs through rewritten connections
    near(shown[0].color, [0.2, 0.4, 0.6, 1])
    assertAlmostEquals(shown[0].roughness!, 0.6, 1e-9)
})

test("a sublayer the caller hands in composes under the layer, weaker than it", () => {
    const root = `#usda 1.0
(
    defaultPrim = "room"
    subLayers = [@./furniture.usda@]
)

over "room"
{
    over "desk"
    {
        double3 xformOp:translate = (5, 0, 0)
    }
}
`
    const furniture = room(`
    def Cube "desk"
    {
        double3 xformOp:translate = (1, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }`)
    assertEquals(usdaSublayers(root), ["./furniture.usda"])
    const [desk] = visuals(root, { layers: new Map([["./furniture.usda", furniture]]) })
    // the root layer's opinion wins
    near(desk.origin.xyz, [5, 0, 0])
    // without the sublayer there is nothing defined to draw
    assertEquals(visuals(root).length, 0)
})

test("a PointInstancer draws a copy of its prototype at each instance, not the prototype itself", () => {
    const shown = visuals(room(`
    def PointInstancer "chairs"
    {
        rel prototypes = [</room/chairs/Prototypes/chair>]
        int[] protoIndices = [0, 0, 0]
        point3f[] positions = [(1, 0, 0), (2, 0, 0), (3, 0, 0)]
        quath[] orientations = [(1, 0, 0, 0), (0.7071068, 0, 0, 0.7071068), (1, 0, 0, 0)]
        float3[] scales = [(1, 1, 1), (1, 1, 1), (2, 2, 2)]
        int64[] invisibleIds = [2]

        def Scope "Prototypes"
        {
            def Cube "chair"
            {
                double size = 1
            }
        }
    }`))
    assertEquals(shown.length, 2)
    near(shown.map((shape) => shape.origin.xyz[0]), [1, 2])
    // the second turned a quarter about z
    assertAlmostEquals(shown[1].origin.quat[2], Math.SQRT1_2, 1e-6)
})

test("xformOps compose in their authored order, with !invert! and !resetXformStack! honoured", () => {
    const shown = visuals(room(`
    def Xform "parent"
    {
        double3 xformOp:translate = (10, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]

        def Cube "scaled_first"
        {
            double size = 1
            float3 xformOp:scale = (2, 2, 2)
            double3 xformOp:translate = (1, 0, 0)
            uniform token[] xformOpOrder = ["xformOp:scale", "xformOp:translate"]
        }
        def Cube "inverted"
        {
            double size = 1
            double3 xformOp:translate:offset = (3, 0, 0)
            uniform token[] xformOpOrder = ["!invert!xformOp:translate:offset"]
        }
        def Cube "reset"
        {
            double size = 1
            double3 xformOp:translate = (0, 4, 0)
            uniform token[] xformOpOrder = ["!resetXformStack!", "xformOp:translate"]
        }
    }`))
    const [scaled, inverted, reset] = shown
    // the scale is outermost, so it doubles the offset as well as the size
    near(scaled.origin.xyz, [12, 0, 0])
    near(scaled.size, [2, 2, 2])
    near(inverted.origin.xyz, [7, 0, 0])
    // the parent's transform does not reach it
    near(reset.origin.xyz, [0, 4, 0])
})

test("gprims keep their axis and every scale, and Capsule and Cone are drawn", () => {
    const [ellipsoid, cylinder, capsule, cone] = visuals(room(`
    def Sphere "ellipsoid"
    {
        double radius = 1
        float3 xformOp:scale = (1, 2, 3)
        uniform token[] xformOpOrder = ["xformOp:scale"]
    }
    def Cylinder "along_x"
    {
        uniform token axis = "X"
        double radius = 0.5
        double height = 4
    }
    def Capsule "capsule"
    {
        double radius = 0.25
        double height = 1
    }
    def Cone "cone"
    {
        double radius = 1
        double height = 3
    }`))
    assertEquals(ellipsoid.type, "sphere")
    near(ellipsoid.scale, [1, 2, 3])
    assertEquals(cylinder.type, "cylinder")
    assertEquals(cylinder.length, 4)
    // turned a quarter about y: its own z runs along x
    near(cylinder.origin.quat, [0, Math.SQRT1_2, 0, Math.SQRT1_2])
    assertEquals([capsule.type, capsule.radius, capsule.length], ["capsule", 0.25, 1])
    assertEquals([cone.type, cone.radius, cone.length], ["cone", 1, 3])
})

const LOOKS = room(`
    def Material "glow"
    {
        token outputs:surface.connect = </room/glow/surface.outputs:surface>
        def Shader "surface"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:emissiveColor = (1, 0.5, 0)
            float inputs:opacity = 0.4
            float inputs:opacityThreshold = 0.5
            float inputs:clearcoat = 1
            normal3f inputs:normal.connect = </room/glow/normals.outputs:rgb>
            float inputs:roughness.connect = </room/glow/finish.outputs:g>
            token outputs:surface
        }
        def Shader "normals"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @normal.png@
            token inputs:sourceColorSpace = "raw"
            token inputs:wrapS = "mirror"
            token inputs:wrapT = "clamp"
            float4 inputs:scale = (2, 2, 2, 1)
            float4 inputs:bias = (-1, -1, -1, 0)
            float2 inputs:st.connect = </room/glow/place.outputs:result>
            float3 outputs:rgb
        }
        def Shader "place"
        {
            uniform token info:id = "UsdTransform2d"
            float2 inputs:scale = (4, 2)
            float inputs:rotation = 90
            float2 inputs:translation = (0.5, 0)
            float2 inputs:in.connect = </room/glow/reader.outputs:result>
            float2 outputs:result
        }
        def Shader "reader"
        {
            uniform token info:id = "UsdPrimvarReader_float2"
            token inputs:varname = "uvmap"
            float2 outputs:result
        }
        def Shader "finish"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @finish.png@
            float outputs:g
        }
    }
    def Material "plain"
    {
        token outputs:surface.connect = </room/plain/surface.outputs:surface>
        def Shader "surface"
        {
            uniform token info:id = "UsdPreviewSurface"
            token outputs:surface
        }
    }
    def Cube "lit" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        rel material:binding = </room/glow>
        uniform bool doubleSided = 1
    }
    def Cube "bare" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        rel material:binding = </room/plain>
        color3f[] primvars:displayColor = [(1, 0, 0)]
    }
    def Cube "faded"
    {
        float[] primvars:displayOpacity = [0.3]
    }`)

test("a material's emissive colour, cut-out, clearcoat and every image it reads are kept, with how each is read", () => {
    const [lit, bare, faded] = visuals(LOOKS)
    near(lit.emissive, [1, 0.5, 0])
    assertEquals([lit.opacityThreshold, lit.clearcoat, lit.doubleSided], [0.5, 1, true])
    assertEquals(lit.textures?.normal, {
        file: "normal.png",
        channel: "rgb",
        wrapS: "mirror",
        wrapT: "clamp",
        colorSpace: "raw",
        scale: [2, 2, 2, 1],
        bias: [-1, -1, -1, 0],
        coordinates: "uvmap",
        transform: { scale: [4, 2], rotation: 90, translation: [0.5, 0] },
    })
    assertEquals([lit.textures?.roughness?.file, lit.textures?.roughness?.channel], ["finish.png", "g"])
    assertEquals(meshUris(parseUsda(LOOKS)).sort(), ["finish.png", "normal.png"])
    // a bound UsdPreviewSurface stating no diffuseColor is its default grey, not the prim's displayColor
    near(bare.color, [0.18, 0.18, 0.18, 1])
    assertEquals([bare.roughness, bare.metallic], [0.5, 0])
    // no material and no colour: the opacity still arrives
    assertEquals([faded.color, faded.opacity], [undefined, 0.3])
})

test("binding: the preview purpose before all-purpose, a collection's binding, and an ancestor stronger than descendants", () => {
    const material = (name: string, red: number) => `
    def Material "${name}"
    {
        token outputs:surface.connect = </room/${name}/s.outputs:surface>
        def Shader "s"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (${red}, 0, 0)
            token outputs:surface
        }
    }`
    const [preview, collected, overridden] = visuals(
        room(`${material("a", 0.1)}${material("b", 0.2)}${material("c", 0.3)}
    def Cube "preview"
    {
        rel material:binding = </room/a>
        rel material:binding:preview = </room/b>
    }
    def Xform "group" (
        prepend apiSchemas = ["CollectionAPI:picked"]
    )
    {
        rel collection:picked:includes = [</room/group/collected>]
        rel material:binding:collection:picked = [</room/group.collection:picked>, </room/c>]

        def Cube "collected"
        {
        }
    }
    def Xform "strong"
    {
        rel material:binding = </room/a> (
            bindMaterialAs = "strongerThanDescendants"
        )
        def Cube "overridden"
        {
            rel material:binding = </room/b>
        }
    }`),
    )
    assertEquals([preview.color?.[0], collected.color?.[0], overridden.color?.[0]], [0.2, 0.3, 0.1])
})

const LAYER = `#usda 1.0
def Xform "geo"
{
    def Material "red"
    {
        token outputs:surface.connect = </geo/red/s.outputs:surface>
        def Shader "s"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (1, 0, 0)
            token outputs:surface
        }
    }
    def Mesh "two_faces"
    {
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (2, 0, 0), (2, 1, 0)]
        int[] faceVertexCounts = [4, 4]
        int[] faceVertexIndices = [0, 1, 2, 3, 1, 4, 5, 2]
        color3f[] primvars:displayColor = [(0, 1, 0), (0, 0, 1)] (
            interpolation = "uniform"
        )
        uniform token subdivisionScheme = "none"

        def GeomSubset "second" (
            prepend apiSchemas = ["MaterialBindingAPI"]
        )
        {
            uniform token elementType = "face"
            uniform token familyName = "materialBind"
            int[] indices = [1]
            rel material:binding = </geo/red>
        }
    }
    def Cube "box"
    {
        double size = 1
        double3 xformOp:translate = (0, 0, 5)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
`

test("a mesh layer: per-face displayColor, a GeomSubset's own material, and gprims beside its meshes", () => {
    const geometry = usdMeshGeometry(parsePrims(LAYER), "/a/geo.usda")
    const looks = meshLooks(geometry)
    // the unbound face draws in its displayColor per face, the subset's in its material, and the cube in Hydra's grey
    assertEquals(looks.length, 3)
    const groups = geometry.groups.map((group) => ({ look: looks[group.materialIndex!], start: group.start }))
    const colors = geometry.attributes.color
    const first = groups.find(({ look }) => look.vertexColors)!
    assertEquals(first.look.vertexColors, true)
    near([colors.getX(first.start), colors.getY(first.start), colors.getZ(first.start)], [0, 1, 0])
    const red = groups.find(({ look }) => look.color?.[0] === 1)!
    near([colors.getX(red.start), colors.getY(red.start), colors.getZ(red.start)], [1, 0, 0])
    // the cube is there, 5 m up
    const box = groups.find(({ look }) => look.color?.[0] === 0.18)!
    assertAlmostEquals(geometry.attributes.position.getZ(box.start) - 5, 0, 0.51)
})

test("a mesh with no normals is smooth across its shared points, faceted when its subdivisionScheme is none", () => {
    const tent = (scheme: string) =>
        `#usda 1.0
def Mesh "tent"
{
    point3f[] points = [(0, 0, 0), (1, 0, 1), (2, 0, 0), (0, 1, 0), (1, 1, 1), (2, 1, 0)]
    int[] faceVertexCounts = [4, 4]
    int[] faceVertexIndices = [0, 3, 4, 1, 1, 4, 5, 2]
    ${scheme}
}
`
    const normalAtRidge = (text: string) => {
        const geometry = usdMeshGeometry(parsePrims(text))
        const position = geometry.attributes.position
        const normal = geometry.attributes.normal
        for (let index = 0; index < position.count; index++) {
            if (position.getX(index) === 1 && position.getZ(index) === 1) return normal.getX(index)
        }
        return NaN
    }
    // the ridge's normal points straight up when the two slopes are smoothed together, sideways on a facet
    assertAlmostEquals(normalAtRidge(tent("")), 0, 1e-6)
    assert(Math.abs(normalAtRidge(tent(`uniform token subdivisionScheme = "none"`))) > 0.5)
})

test("an OBJ's own normals are kept", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0.6 0 0.8\nf 1//1 2//1 3//1\n`
    const geometry = meshGeometry("tri.obj", new TextEncoder().encode(obj))
    near([geometry.attributes.normal.getX(0), geometry.attributes.normal.getZ(0)], [0.6, 0.8])
})

test("lights: colour temperature, a cone, a cylinder, sizes scaled with their prim, the link each is on, none invisible", () => {
    const description = parseUsda(room(`
    def Xform "lamp" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI"]
    )
    {
        double3 xformOp:translate = (0, 0, 3)
        uniform token[] xformOpOrder = ["xformOp:translate"]

        def SphereLight "bulb" (
            prepend apiSchemas = ["ShapingAPI"]
        )
        {
            float inputs:radius = 0.1
            bool inputs:enableColorTemperature = 1
            float inputs:colorTemperature = 2700
            float inputs:shaping:cone:angle = 30
            float inputs:shaping:cone:softness = 0.2
            float3 xformOp:scale = (2, 2, 2)
            double3 xformOp:translate = (1, 0, 0)
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
        }
    }
    def CylinderLight "tube"
    {
        float inputs:length = 2
        float inputs:radius = 0.05
    }
    def DiskLight "off"
    {
        token visibility = "invisible"
    }`))
    const [bulb, tube] = description.lights!
    assertEquals(description.lights!.length, 2)
    assertAlmostEquals(bulb.radius!, 0.2, 1e-9)
    assertEquals(bulb.cone, { angle: 30, softness: 0.2 })
    assertEquals(bulb.colorTemperature, 2700)
    assertEquals(bulb.link, "lamp")
    near(bulb.origin!.xyz, [1, 0, 0])
    near(bulb.xyz, [1, 0, 3])
    assertEquals([tube.type, tube.length, tube.radius], ["cylinder", 2, 0.05])
})

test("cameras come back placed with their lens, the one RenderSettings names marked", () => {
    const description = parseUsda(room(`
    def Camera "wide"
    {
        float focalLength = 18
        float verticalAperture = 24
        float2 clippingRange = (0.1, 100)
        double3 xformOp:translate = (0, -5, 2)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
    def Camera "tele"
    {
    }
    def Scope "Render"
    {
        def RenderSettings "settings"
        {
            rel camera = </room/wide>
        }
    }`))
    const [wide, tele] = description.cameras!
    assertEquals([wide.name, wide.selected, tele.selected], ["wide", true, false])
    assertEquals([wide.focalLength, wide.verticalAperture, wide.clippingRange], [18, 24, [0.1, 100]])
    near(wide.xyz, [0, -5, 2])
    assertEquals(tele.focalLength, 50)
})
