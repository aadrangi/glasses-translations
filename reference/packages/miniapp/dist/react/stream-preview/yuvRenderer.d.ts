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
import type { ParsedFrame } from "./protocol";
/** `contain` letterboxes; `cover` fills the canvas and crops the overflow. Never stretches. */
export type PreviewFit = "contain" | "cover";
export interface YuvRendererOptions {
    /** Context loss, a failed compile, a failed upload: anything that makes the canvas stop. */
    onError?: (reason: string) => void;
    fit?: PreviewFit;
}
export interface YuvRenderer {
    /** False once the GL context is lost, until it is restored. */
    readonly alive: boolean;
    setFit(fit: PreviewFit): void;
    drawFrame(frame: ParsedFrame): number | null;
    dispose(): void;
}
/** Create the renderer, or null when this WebView has no WebGL1 context to give. */
export declare function createYuvRenderer(canvas: HTMLCanvasElement, options?: YuvRendererOptions): YuvRenderer | null;
//# sourceMappingURL=yuvRenderer.d.ts.map