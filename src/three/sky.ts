// The dome as the sky behind the room: a uniform picture at its radiance, as Blender draws a World of that strength.
import * as THREE from "three"

/** what `scene.background(Rotation)` has to be for an equirectangular picture's top row to sit overhead in a Z-up world */
export const SKY_ROTATION_X = Math.PI / 2

/** A uniform sky of this linear radiance, as an HDR texture three tone maps like the rest of the frame. */
export function skyTexture(radiance: THREE.Color): THREE.DataTexture {
    // PMREMGenerator prefilters from a cube face width / 4 wide, and its smallest level is 2^4 (its LOD_MIN): any narrower and the environment is black
    const width = 4 * 2 ** 4
    const height = width / 2
    const data = new Float32Array(width * height * 4)
    for (let index = 0; index < width * height; index++) {
        data.set([radiance.r, radiance.g, radiance.b, 1], index * 4)
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
    texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.needsUpdate = true
    return texture
}
