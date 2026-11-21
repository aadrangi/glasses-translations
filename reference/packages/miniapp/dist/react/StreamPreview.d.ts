/**
 * `<StreamPreview>` — draws the raw decoded frames of the source the miniapp's background has
 * leased with `session.stream.preview()`.
 *
 * The component owns only the renderer (canvas, WebGL context, textures). Mounting it shows the
 * preview; unmounting it hides the preview and stops production, but keeps the document's
 * connection open so the next mount starts without a handshake. Releasing the lease is the
 * background's job (`handle.stop()`), not this component's.
 *
 * Frame bytes never enter React state: frames go from the transport to the renderer directly.
 */
import { type CSSProperties } from "react";
import type { PreviewConnectionState } from "./stream-preview/PreviewConnection";
import { type PreviewFit, type YuvRenderer, type YuvRendererOptions } from "./stream-preview/yuvRenderer";
export type { PreviewFit } from "./stream-preview/yuvRenderer";
export type { PreviewConnectionState } from "./stream-preview/PreviewConnection";
export interface StreamPreviewStatus {
    state: PreviewConnectionState;
    /** The Mentra App is in the background; production is paused and resumes on return. */
    paused: boolean;
    /** Why the state changed, when the host said (`source_ended`, `stopped`, ...). */
    reason?: string;
    /** Error code for `error` / `unsupported`. */
    code?: string;
    /** Latest once-a-second host counters plus page-side counters. */
    stats?: Record<string, unknown>;
}
export interface StreamPreviewProps {
    /** `contain` letterboxes (default); `cover` fills and crops. The picture is never stretched. */
    fit?: PreviewFit;
    onStatus?: (status: StreamPreviewStatus) => void;
    /** Typed preview error codes: `source_ended`, `unsupported`, `transport_failed`, ... */
    onError?: (code: string) => void;
    className?: string;
    style?: CSSProperties;
}
type RendererFactory = (canvas: HTMLCanvasElement, options: YuvRendererOptions) => YuvRenderer | null;
/** Test seam: WebGL is not available in headless DOMs. */
export declare function setStreamPreviewRendererFactoryForTests(factory: RendererFactory | null): void;
export declare function StreamPreview({ fit, onStatus, onError, className, style }: StreamPreviewProps): import("react").JSX.Element;
//# sourceMappingURL=StreamPreview.d.ts.map