// Objects drawn over the rest of the scene (a layer's "Draw on top"): a second render pass after the depth buffer is
// cleared, so clouds and voxels never hide them. Nothing about the objects changes but their three.js layer channel,
// so it switches live: no new materials, no re-created layer.
import * as THREE from "three"

/** The three.js layer channel the on-top pass draws; the scene's own pass draws channel 0. */
export const ON_TOP_CHANNEL = 1

/** What OnTopPass needs of a WebGLRenderer. */
export interface PassRenderer {
    autoClear: boolean
    render(scene: THREE.Object3D, camera: THREE.Camera): void
    clearDepth(): void
}

export class OnTopPass {
    #roots: Set<THREE.Object3D> = new Set()

    /** `object` and everything under it (children added later too) on top, or back in the scene. */
    set(object: THREE.Object3D, on: boolean) {
        if (on) {
            this.#roots.add(object)
            object.traverse((child) => child.layers.set(ON_TOP_CHANNEL))
        } else if (this.#roots.delete(object)) {
            object.traverse((child) => child.layers.set(0))
        }
    }

    has(object: THREE.Object3D): boolean {
        return this.#roots.has(object)
    }

    /** Whether anything is on top at all, for a caller doing its own main pass. */
    any(): boolean {
        return this.#roots.size > 0
    }

    /** The scene, then (when anything is on top) the on-top objects over it. Lights must be on ON_TOP_CHANNEL too. */
    render(renderer: PassRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        if (!this.#roots.size) {
            renderer.render(scene, camera)
            return
        }
        for (const root of this.#roots) {
            root.traverse((child) => child.layers.set(ON_TOP_CHANNEL))
        }
        renderer.render(scene, camera)
        const { autoClear } = renderer
        const background = scene.background
        const mask = camera.layers.mask
        renderer.autoClear = false
        scene.background = null
        renderer.clearDepth()
        camera.layers.set(ON_TOP_CHANNEL)
        renderer.render(scene, camera)
        camera.layers.mask = mask
        scene.background = background
        renderer.autoClear = autoClear
    }
}
