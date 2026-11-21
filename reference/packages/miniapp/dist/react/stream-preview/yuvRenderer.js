/**
 * WebGL1 YUV → RGB renderer for raw preview frames.
 *
 * WebGL1 only, on purpose: the Mentra App supports iOS 15.5 / Safari 15, where WebGL2, WebCodecs,
 * `VideoFrame` and `OffscreenCanvas` are either absent or unreliable. Everything here is the
 * 2013 feature set — `LUMINANCE` textures, one draw call, a fragment shader doing the colour
 * conversion.
 *
 * Rules:
 *   - JavaScript never touches a pixel. Planes go to `texImage2D`/`texSubImage2D` as views.
 *   - `readPixels` is never called; it would stall the pipeline.
 *   - `drawFrame` times the SUBMIT, not the paint. See the comment on that method.
 */
import { previewTrace, previewTraceWarn } from "./trace";
const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
uniform mat2 uTransform;
varying vec2 vTexCoord;
void main() {
  gl_Position = vec4(uTransform * aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}
`;
/**
 * `uCoeff` is (Cr→R, Cb→G, Cr→G, Cb→B) for the frame's matrix; `uYOffset`/`uYScale`/`uCScale`
 * carry the range. Both are uniforms rather than shader variants so a stream that switches
 * colour metadata mid-run does not force a recompile.
 */
function fragmentShader(format) {
    const chroma = format === "nv12"
        ? `uniform sampler2D uUv;
vec2 chromaSample() {
  vec4 texel = texture2D(uUv, vTexCoord);
  return vec2(texel.r, texel.a);
}`
        : `uniform sampler2D uU;
uniform sampler2D uV;
vec2 chromaSample() {
  return vec2(texture2D(uU, vTexCoord).r, texture2D(uV, vTexCoord).r);
}`;
    return `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vTexCoord;
uniform sampler2D uY;
uniform float uYOffset;
uniform float uYScale;
uniform float uCScale;
uniform vec4 uCoeff;
${chroma}
void main() {
  float y = (texture2D(uY, vTexCoord).r - uYOffset) * uYScale;
  vec2 c = (chromaSample() - 0.5019608) * uCScale;
  vec3 rgb = vec3(
    y + uCoeff.x * c.y,
    y + uCoeff.y * c.x + uCoeff.z * c.y,
    y + uCoeff.w * c.x);
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;
}
/** Standard BT.601 and BT.709 conversion coefficients, as (Cr→R, Cb→G, Cr→G, Cb→B). */
const MATRIX_COEFFICIENTS = {
    bt601: [1.402, -0.344136, -0.714136, 1.772],
    bt709: [1.5748, -0.187324, -0.468124, 1.8556],
};
/** Limited range is Y 16..235 and chroma 16..240; full range uses the whole byte. */
const RANGE_SCALES = {
    limited: { yOffset: 16 / 255, yScale: 255 / 219, cScale: 255 / 224 },
    full: { yOffset: 0, yScale: 1, cScale: 1 },
};
/** Clockwise quarter turns, as exact cos/sin so 90° stays 90°. */
const ROTATIONS = [
    { cos: 1, sin: 0 },
    { cos: 0, sin: 1 },
    { cos: -1, sin: 0 },
    { cos: 0, sin: -1 },
];
const POSITIONS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
// v = 0 is the first uploaded row, which is the top of the image, so it maps to NDC y = +1.
const TEX_COORDS = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);
class WebGlYuvRenderer {
    constructor(canvas, gl, options) {
        this.canvas = canvas;
        this.gl = gl;
        this.options = options;
        this.programs = new Map();
        this.textures = new Map();
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.layout = null;
        this.lost = false;
        this.onContextLost = (event) => {
            // Without preventDefault the context is never restored, and the canvas would stay black for
            // the rest of the document.
            event.preventDefault();
            this.lost = true;
            this.programs.clear();
            this.textures.clear();
            this.positionBuffer = null;
            this.texCoordBuffer = null;
            this.layout = null;
            previewTraceWarn("webgl_context_lost");
            this.options.onError?.("webgl_context_lost");
        };
        this.onContextRestored = () => {
            // Everything was invalidated by the loss; the next frame rebuilds it lazily.
            this.lost = false;
            previewTrace("webgl_context_restored");
        };
        this.fit = options.fit ?? "contain";
        canvas.addEventListener("webglcontextlost", this.onContextLost);
        canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    }
    get alive() {
        return !this.lost && !this.gl.isContextLost();
    }
    setFit(fit) {
        this.fit = fit;
    }
    /**
     * Upload the planes and submit one draw.
     *
     * The returned number is how long the SUBMIT took: uploads plus `drawArrays`, measured with
     * `performance.now()`. It is NOT presentation latency and not a frame time — GL is asynchronous
     * and the pixels reach the screen some unknown time later. Proving presentation would need
     * `readPixels` or a fence, and both change what they measure.
     *
     * Returns null when there is no usable context.
     */
    drawFrame(frame) {
        if (!this.alive)
            return null;
        const gl = this.gl;
        const startedAt = performance.now();
        const bundle = this.programFor(frame.pixelFormat);
        if (!bundle)
            return null;
        this.syncDrawingBuffer();
        gl.useProgram(bundle.program);
        // Tight packing: every plane row starts on a byte boundary, which the default alignment of 4
        // would get wrong for any odd width.
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        const reallocate = !this.layout ||
            this.layout.width !== frame.width ||
            this.layout.height !== frame.height ||
            this.layout.format !== frame.pixelFormat;
        if (reallocate && this.layout && this.layout.format !== frame.pixelFormat)
            this.dropChromaTextures();
        if (frame.pixelFormat === "nv12") {
            if (!this.upload("y", 0, gl.LUMINANCE, frame.width, frame.height, frame.y, reallocate))
                return null;
            if (!this.upload("uv", 1, gl.LUMINANCE_ALPHA, frame.chromaWidth, frame.chromaHeight, frame.uv, reallocate)) {
                return null;
            }
        }
        else {
            if (!this.upload("y", 0, gl.LUMINANCE, frame.width, frame.height, frame.y, reallocate))
                return null;
            if (!this.upload("u", 1, gl.LUMINANCE, frame.chromaWidth, frame.chromaHeight, frame.u, reallocate))
                return null;
            if (!this.upload("v", 2, gl.LUMINANCE, frame.chromaWidth, frame.chromaHeight, frame.v, reallocate))
                return null;
        }
        if (reallocate) {
            this.layout = { width: frame.width, height: frame.height, format: frame.pixelFormat };
            this.bindSamplers(bundle, frame.pixelFormat);
        }
        const coefficients = MATRIX_COEFFICIENTS[frame.colorMatrix];
        const range = RANGE_SCALES[frame.colorRange];
        gl.uniform1f(bundle.uYOffset, range.yOffset);
        gl.uniform1f(bundle.uYScale, range.yScale);
        gl.uniform1f(bundle.uCScale, range.cScale);
        gl.uniform4f(bundle.uCoeff, coefficients[0], coefficients[1], coefficients[2], coefficients[3]);
        gl.uniformMatrix2fv(bundle.uTransform, false, this.transformFor(frame));
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return performance.now() - startedAt;
    }
    dispose() {
        this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
        this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
        const gl = this.gl;
        if (!gl.isContextLost()) {
            for (const texture of this.textures.values())
                gl.deleteTexture(texture);
            for (const bundle of this.programs.values())
                gl.deleteProgram(bundle.program);
            if (this.positionBuffer)
                gl.deleteBuffer(this.positionBuffer);
            if (this.texCoordBuffer)
                gl.deleteBuffer(this.texCoordBuffer);
        }
        this.textures.clear();
        this.programs.clear();
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.layout = null;
    }
    /** Scale the rotated frame to contain or cover the canvas without ever stretching it. */
    transformFor(frame) {
        const { cos, sin } = ROTATIONS[frame.rotationQuarters] ?? ROTATIONS[0];
        const quarterTurned = frame.rotationQuarters % 2 === 1;
        const frameWidth = quarterTurned ? frame.height : frame.width;
        const frameHeight = quarterTurned ? frame.width : frame.height;
        const canvasAspect = this.canvas.width / Math.max(1, this.canvas.height);
        const frameAspect = frameWidth / Math.max(1, frameHeight);
        let scaleX = 1;
        let scaleY = 1;
        const frameIsWider = frameAspect > canvasAspect;
        if (this.fit === "cover") {
            if (frameIsWider)
                scaleX = frameAspect / canvasAspect;
            else
                scaleY = canvasAspect / frameAspect;
        }
        else if (frameIsWider)
            scaleY = canvasAspect / frameAspect;
        else
            scaleX = frameAspect / canvasAspect;
        // Column-major for uniformMatrix2fv: scale ∘ clockwise rotation.
        return new Float32Array([scaleX * cos, -scaleY * sin, scaleX * sin, scaleY * cos]);
    }
    syncDrawingBuffer() {
        const canvas = this.canvas;
        const ratio = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * ratio));
        const height = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * ratio));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        this.gl.viewport(0, 0, canvas.width, canvas.height);
    }
    upload(key, unit, format, width, height, pixels, reallocate) {
        const gl = this.gl;
        let texture = this.textures.get(key);
        if (!texture) {
            const created = gl.createTexture();
            if (!created) {
                this.options.onError?.("texture_allocation_failed");
                return false;
            }
            texture = created;
            this.textures.set(key, texture);
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            // No mipmaps and CLAMP_TO_EDGE, which is what WebGL1 requires for non-power-of-two sizes.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, pixels);
            return true;
        }
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // Reallocating every frame is the classic way to make a renderer look slower than it is.
        if (reallocate)
            gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, pixels);
        else
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, format, gl.UNSIGNED_BYTE, pixels);
        return true;
    }
    /** A format switch leaves the other layout's chroma textures allocated; drop them. */
    dropChromaTextures() {
        for (const key of ["u", "v", "uv"]) {
            const texture = this.textures.get(key);
            if (!texture)
                continue;
            this.gl.deleteTexture(texture);
            this.textures.delete(key);
        }
    }
    bindSamplers(bundle, format) {
        const gl = this.gl;
        gl.uniform1i(gl.getUniformLocation(bundle.program, "uY"), 0);
        if (format === "nv12") {
            gl.uniform1i(gl.getUniformLocation(bundle.program, "uUv"), 1);
            return;
        }
        gl.uniform1i(gl.getUniformLocation(bundle.program, "uU"), 1);
        gl.uniform1i(gl.getUniformLocation(bundle.program, "uV"), 2);
    }
    programFor(format) {
        const existing = this.programs.get(format);
        if (existing) {
            this.bindGeometry(existing);
            return existing;
        }
        const gl = this.gl;
        const program = this.link(VERTEX_SHADER, fragmentShader(format));
        if (!program)
            return null;
        const bundle = {
            program,
            aPosition: gl.getAttribLocation(program, "aPosition"),
            aTexCoord: gl.getAttribLocation(program, "aTexCoord"),
            uTransform: gl.getUniformLocation(program, "uTransform"),
            uYOffset: gl.getUniformLocation(program, "uYOffset"),
            uYScale: gl.getUniformLocation(program, "uYScale"),
            uCScale: gl.getUniformLocation(program, "uCScale"),
            uCoeff: gl.getUniformLocation(program, "uCoeff"),
        };
        this.programs.set(format, bundle);
        gl.useProgram(program);
        this.bindSamplers(bundle, format);
        this.bindGeometry(bundle);
        return bundle;
    }
    bindGeometry(bundle) {
        const gl = this.gl;
        if (!this.positionBuffer) {
            this.positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, POSITIONS, gl.STATIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(bundle.aPosition);
        gl.vertexAttribPointer(bundle.aPosition, 2, gl.FLOAT, false, 0, 0);
        if (!this.texCoordBuffer) {
            this.texCoordBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, TEX_COORDS, gl.STATIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(bundle.aTexCoord);
        gl.vertexAttribPointer(bundle.aTexCoord, 2, gl.FLOAT, false, 0, 0);
    }
    link(vertexSource, fragmentSource) {
        const gl = this.gl;
        const vertex = this.compile(gl.VERTEX_SHADER, vertexSource);
        const fragment = this.compile(gl.FRAGMENT_SHADER, fragmentSource);
        if (!vertex || !fragment)
            return null;
        const program = gl.createProgram();
        if (!program) {
            this.options.onError?.("program_allocation_failed");
            return null;
        }
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        // The shaders are owned by the program once linked; keeping them alive leaks on every restore.
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program) ?? "";
            gl.deleteProgram(program);
            previewTraceWarn("webgl_program_link_failed", { log: log.slice(0, 120) });
            this.options.onError?.(`program_link_failed: ${log.slice(0, 120)}`);
            return null;
        }
        return program;
    }
    compile(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) {
            this.options.onError?.("shader_allocation_failed");
            return null;
        }
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader) ?? "";
            gl.deleteShader(shader);
            previewTraceWarn("webgl_shader_compile_failed", { log: log.slice(0, 120) });
            this.options.onError?.(`shader_compile_failed: ${log.slice(0, 120)}`);
            return null;
        }
        return shader;
    }
}
/** Create the renderer, or null when this WebView has no WebGL1 context to give. */
export function createYuvRenderer(canvas, options = {}) {
    const attributes = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
    };
    const gl = canvas.getContext("webgl", attributes) ??
        canvas.getContext("experimental-webgl", attributes);
    if (!gl) {
        options.onError?.("webgl_unavailable");
        return null;
    }
    return new WebGlYuvRenderer(canvas, gl, options);
}
//# sourceMappingURL=yuvRenderer.js.map