// Blender 5.1's AgX exactly (its AgX Base sRGB LUT, tetrahedral as OCIO, as dimos's sim2/mujoco/look.py), as a pass.
import * as THREE from "three"
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js"
import { AGX_LOG2_RANGE, AGX_LUT_DEFLATED, AGX_REC709_TO_EGAMUT } from "./agx_lut.ts"

/** The LUT's points per side, from how many RGB entries it holds. */
export function lutSize(entries: number): number {
    return Math.round(Math.cbrt(entries / 3))
}

/** The LUT as `size^3` RGB code values in [0, 1], red slowest and blue fastest, from its inflated bytes (two per value). */
export function agxLutValues(inflated: Uint8Array): Float32Array {
    const size = lutSize(inflated.length / 2)
    const count = size * size * size
    const half = 3 * count
    const out = new Float32Array(count * 3)
    for (let channel = 0; channel < 3; channel++) {
        // a running sum along red undoes the stored differences
        const along = new Int32Array(size * size)
        for (let red = 0; red < size; red++) {
            for (let rest = 0; rest < size * size; rest++) {
                const at = channel * count + red * size * size + rest
                const delta = ((inflated[at] << 8) | inflated[half + at]) << 16 >> 16
                along[rest] = (along[rest] + delta) & 0xffff
                out[(red * size * size + rest) * 3 + channel] = along[rest] / 65535
            }
        }
    }
    return out
}

async function inflate(base64: string): Promise<Uint8Array> {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

let decoded: Promise<Float32Array> | null = null

/** The LUT's values, decoded once per page. */
export function agxLut(): Promise<Float32Array> {
    decoded ??= inflate(AGX_LUT_DEFLATED).then((bytes) => agxLutValues(bytes))
    return decoded
}

/** One linear Rec.709 colour through the chain, on the CPU: what the pass computes per pixel. Display sRGB in [0, 1]. */
export function agx(lut: Float32Array, color: [number, number, number]): [number, number, number] {
    const size = lutSize(lut.length)
    const [low, high] = AGX_LOG2_RANGE
    const m = AGX_REC709_TO_EGAMUT
    const point = [0, 1, 2].map((row) => {
        const egamut = m[row * 3] * color[0] + m[row * 3 + 1] * color[1] + m[row * 3 + 2] * color[2]
        const stops = Math.log2(Math.max(egamut, 2 ** low))
        return Math.min(1, Math.max(0, (stops - low) / (high - low))) * (size - 1)
    })
    const base = point.map((value) => Math.min(Math.floor(value), size - 2))
    const [red, green, blue] = point.map((value, index) => value - base[index])
    const at = (r: number, g: number, b: number) => ((base[0] + r) * size + base[1] + g) * size + base[2] + b
    const first = red >= green && red >= blue ? [1, 0, 0] : green >= blue ? [0, 1, 0] : [0, 0, 1]
    const last = blue <= red && blue <= green ? [0, 0, 1] : green <= red ? [0, 1, 0] : [1, 0, 0]
    const top = Math.max(red, green, blue)
    const bottom = Math.min(red, green, blue)
    const mid = red + green + blue - top - bottom
    const corners: [number, number][] = [
        [at(0, 0, 0), 1 - top],
        [at(first[0], first[1], first[2]), top - mid],
        [at(1 - last[0], 1 - last[1], 1 - last[2]), mid - bottom],
        [at(1, 1, 1), bottom],
    ]
    return [0, 1, 2].map((channel) => {
        const code = corners.reduce((sum, [index, weight]) => sum + lut[index * 3 + channel] * weight, 0)
        return srgbOf(Math.min(1, Math.max(0, code)) ** 2.4)
    }) as [number, number, number]
}

/** The sRGB transfer curve (IEC 61966-2-1). */
function srgbOf(light: number): number {
    return light <= 0.0031308 ? 12.92 * light : 1.055 * light ** (1 / 2.4) - 0.055
}

const fragment = (size: number) => /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform highp sampler3D lut;
    uniform float exposure;
    uniform mat3 toEgamut;
    uniform vec2 range;
    varying vec2 vUv;
    const int SIZE = ${size};

    vec3 at(ivec3 rgb) {
        return texelFetch(lut, rgb.zyx, 0).rgb;
    }

    void main() {
        vec4 linear = texture2D(tDiffuse, vUv);
        vec3 egamut = toEgamut * (linear.rgb * exposure);
        vec3 stops = log2(max(egamut, vec3(exp2(range.x))));
        vec3 point = clamp((stops - range.x) / (range.y - range.x), 0.0, 1.0) * float(SIZE - 1);
        ivec3 base = min(ivec3(point), ivec3(SIZE - 2));
        vec3 f = point - vec3(base);
        // the cell's low corner to its high one, first along the axis with the largest fraction, last the smallest
        ivec3 first = (f.r >= f.g && f.r >= f.b) ? ivec3(1, 0, 0) : (f.g >= f.b ? ivec3(0, 1, 0) : ivec3(0, 0, 1));
        ivec3 last = (f.b <= f.r && f.b <= f.g) ? ivec3(0, 0, 1) : (f.g <= f.r ? ivec3(0, 1, 0) : ivec3(1, 0, 0));
        float high = max(max(f.r, f.g), f.b);
        float low = min(min(f.r, f.g), f.b);
        float mid = f.r + f.g + f.b - high - low;
        vec3 code = at(base) * (1.0 - high) + at(base + first) * (high - mid)
            + at(base + ivec3(1) - last) * (mid - low) + at(base + ivec3(1)) * low;
        vec3 light = pow(clamp(code, 0.0, 1.0), vec3(2.4));
        vec3 srgb = mix(12.92 * light, 1.055 * pow(light, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, light));
        gl_FragColor = vec4(srgb, linear.a);
    }
`

/** The last pass of a composer: the linear frame, times `exposure`, through Blender's AgX to display sRGB. */
export class AgxPass extends Pass {
    readonly material: THREE.ShaderMaterial
    readonly #quad: FullScreenQuad
    readonly #texture: THREE.Data3DTexture

    constructor(lut: Float32Array) {
        super()
        const size = lutSize(lut.length)
        const rgba = new Float32Array(size * size * size * 4)
        for (let index = 0; index < size * size * size; index++) {
            rgba.set(lut.subarray(index * 3, index * 3 + 3), index * 4)
            rgba[index * 4 + 3] = 1
        }
        // x is blue, y green, z red: the LUT's own order, blue fastest
        this.#texture = new THREE.Data3DTexture(rgba, size, size, size)
        this.#texture.format = THREE.RGBAFormat
        this.#texture.type = THREE.FloatType
        this.#texture.minFilter = this.#texture.magFilter = THREE.NearestFilter
        this.#texture.unpackAlignment = 1
        this.#texture.needsUpdate = true
        const m = AGX_REC709_TO_EGAMUT
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                lut: { value: this.#texture },
                exposure: { value: 1 },
                toEgamut: { value: new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]) },
                range: { value: new THREE.Vector2(AGX_LOG2_RANGE[0], AGX_LOG2_RANGE[1]) },
            },
            vertexShader:
                "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
            fragmentShader: fragment(size),
            depthTest: false,
            depthWrite: false,
        })
        this.#quad = new FullScreenQuad(this.material)
    }

    set exposure(value: number) {
        this.material.uniforms.exposure.value = value
    }

    override render(
        renderer: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
    ): void {
        this.material.uniforms.tDiffuse.value = readBuffer.texture
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
        this.#quad.render(renderer)
    }

    override dispose(): void {
        this.material.dispose()
        this.#texture.dispose()
        this.#quad.dispose()
    }
}
