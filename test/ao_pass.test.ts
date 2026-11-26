// deno-lint-ignore-file no-explicit-any -- a renderer stand-in for the pass
// The AO pass's normal render leaves out meshes without normals (a fat line), which would write NaN occlusion.
import { test } from "vitest"
import { assertEquals } from "./assert.ts"
import * as THREE from "three"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { AmbientOcclusionPass } from "../src/three/ao_pass.ts"

test("AmbientOcclusionPass: a fat line is hidden from its normal render and shown again after", () => {
    const scene = new THREE.Scene()
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial())
    const line = new LineSegments2(new LineSegmentsGeometry().setPositions([0, 0, 0, 1, 0, 0]), new LineMaterial())
    scene.add(floor, line)
    const pass = new AmbientOcclusionPass(scene, new THREE.PerspectiveCamera(), 8, 8)
    const seen: string[] = []
    // the normal render is the only scene render; everything else is a full-screen quad
    const renderer = {
        render: (drawn: THREE.Object3D) => {
            if (drawn === scene) {
                scene.traverseVisible((object) =>
                    (object as THREE.Mesh).isMesh && seen.push(object === line ? "line" : "floor")
                )
            }
        },
        getRenderTarget: () => null,
        setRenderTarget: () => {},
        getClearColor: (color: THREE.Color) => color,
        getClearAlpha: () => 1,
        setClearColor: () => {},
        setClearAlpha: () => {},
        clear: () => {},
        autoClear: true,
    } as any
    pass.render(renderer, new THREE.WebGLRenderTarget(8, 8), new THREE.WebGLRenderTarget(8, 8), 0, false)
    assertEquals(seen, ["floor"])
    assertEquals(line.visible, true)
})
