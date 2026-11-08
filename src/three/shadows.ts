// Where a directional light stands and how much it shadows.
//
// A directional light's shadow is one orthographic box, and anything outside it casts nothing at all. A box
// of a fixed size around the origin is wrong for a room that is 43 m across and centred 10 m off it: the far
// half of the room falls outside, and where the boundary crosses a wall it leaves a hard-edged wedge. So the
// box is fitted to what is drawn instead, and the light aimed at the middle of it rather than at the origin.
import * as THREE from "three"

export const SHADOW_MIN_EXTENT_METRES = 8
// Over a whole room one texel covers centimetres, and at that size a depth bias alone cannot keep a wall the
// light grazes from shadowing itself -- the self-shadowing is a fine diagonal hatch that crawls as the camera
// moves and reads as z-fighting. normalBias moves the lookup along the surface normal instead, so it is set
// from the texel's own size. A finer map would sharpen a big room's shadows, but 4096 squared is 67 MB of
// depth buffer and this runs on phones, so the bias does the work rather than the resolution.
const SHADOW_TEXELS = 2048

/** Which way the light travels, kept so the caster can be re-aimed when the scene it covers changes. */
const SHADOW_DIRECTION = "shadowDirection"

/** A directional light that shadows: it keeps its direction, and `aimShadow` sizes the box it covers. */
export function castsShadow(light: THREE.DirectionalLight, direction: THREE.Vector3) {
    light.castShadow = true
    light.shadow.mapSize.set(SHADOW_TEXELS, SHADOW_TEXELS)
    light.shadow.bias = -0.0005
    light.userData[SHADOW_DIRECTION] = direction.clone().normalize()
}

/** Aim a caster so its shadow box covers the whole of `box`, at the finest texel that stays affordable. */
export function aimShadow(light: THREE.DirectionalLight, box: THREE.Box3) {
    const direction = light.userData[SHADOW_DIRECTION] as THREE.Vector3 | undefined
    if (!light.castShadow || !direction) {
        return
    }
    const centre = box.getCenter(new THREE.Vector3())
    const extent = Math.max(box.getSize(new THREE.Vector3()).length() / 2, SHADOW_MIN_EXTENT_METRES)
    light.shadow.normalBias = 2 * (2 * extent / SHADOW_TEXELS)
    // the light stands off far enough that the whole box is in front of it
    light.position.copy(centre).addScaledVector(direction, -(extent + SHADOW_MIN_EXTENT_METRES))
    light.target.position.copy(centre)
    light.target.updateMatrixWorld()
    const camera = light.shadow.camera
    camera.left = camera.bottom = -extent
    camera.right = camera.top = extent
    camera.near = 0.5
    camera.far = 2 * extent + 2 * SHADOW_MIN_EXTENT_METRES
    camera.updateProjectionMatrix()
}

/** How many of a scene's own lamps may cast. A point light's shadow is a cube -- six renders of
 * the scene every frame -- so eighteen ceiling fittings would be a hundred and eight. The few
 * strongest are what a room's shape reads from; the rest still light it, they just do not occlude. */
export const MAX_SHADOW_LAMPS = 4

/** A lamp inside the room: a near shadow, cheap enough that a handful can afford one. */
export function lampCastsShadow(light: THREE.PointLight, reach: number) {
    light.castShadow = true
    light.shadow.mapSize.set(512, 512)
    light.shadow.bias = -0.004
    // a cube face covers a quarter-turn, so one texel is ~0.2 deg; the offset is set from that at
    // the far end of the lamp's reach rather than from the scene, which is what a room-sized
    // directional bias would be
    light.shadow.normalBias = Math.max(0.02, reach * 0.004)
    const camera = light.shadow.camera
    camera.near = 0.15
    camera.far = reach
    camera.updateProjectionMatrix()
}
