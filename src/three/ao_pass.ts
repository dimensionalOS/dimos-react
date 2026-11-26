import * as THREE from "three"
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js"

/** GTAOPass hides lines from its normal pass but not LineSegments2, a Mesh with no normals: its NaN normals made occlusion 0, a black patch. */
export class AmbientOcclusionPass extends GTAOPass {
    override render(
        renderer: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
        deltaTime: number,
        maskActive: boolean,
    ) {
        const hidden: THREE.Object3D[] = []
        this.scene.traverseVisible((object) => {
            if ((object as THREE.Mesh).isMesh && !(object as THREE.Mesh).geometry?.getAttribute("normal")) {
                hidden.push(object)
            }
        })
        for (const object of hidden) {
            object.visible = false
        }
        try {
            super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        } finally {
            for (const object of hidden) {
                object.visible = true
            }
        }
    }
}
