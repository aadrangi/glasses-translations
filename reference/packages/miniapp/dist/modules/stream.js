/**
 * @fileoverview StreamModule -- video streaming from glasses.
 *
 * Wires to cloud streaming extensions via the __phone__ subscriber path.
 *
 * One entry point: `startStream`. By default it provisions a Mentra-hosted
 * stream and returns playback URLs (managed). Pass `direct` to publish straight
 * to your own ingest URL with no relay.
 */
import { MiniappRequestType, MiniappStreamType } from "../protocol";
/** A preview request or lease failed. `code` is one of {@link PreviewErrorCode} when the host sent one. */
export class PreviewError extends Error {
    constructor(code, message) {
        super(message ?? code);
        this.name = "PreviewError";
        this.code = code;
    }
}
function toPreviewError(error) {
    if (error instanceof PreviewError)
        return error;
    const value = (error ?? {});
    const code = typeof value.code === "string" ? value.code : "unsupported";
    const message = typeof value.message === "string" ? value.message : undefined;
    return new PreviewError(code, message);
}
class PreviewHandleImpl {
    constructor(source, handleId, previewTraceId, release) {
        this.source = source;
        this.handleId = handleId;
        this.previewTraceId = previewTraceId;
        this.release = release;
        this.state = "held";
        this.listeners = new Set();
    }
    async stop() {
        if (this.state === "ended")
            return;
        this.end("stopped");
        await this.release(this);
    }
    onStatus(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    /** @internal */
    end(reason) {
        if (this.state === "ended")
            return;
        this.state = "ended";
        this.emit({ state: "ended", reason });
    }
    emit(status) {
        for (const listener of [...this.listeners]) {
            try {
                listener(status);
            }
            catch {
                // A throwing listener must not stop the others from hearing that the lease ended.
            }
        }
    }
}
export class StreamModule {
    constructor(session) {
        this.session = session;
        this.previewHandles = new Map();
    }
    /**
     * Take the preview lease on a source so a `<StreamPreview>` in the UI can show its frames.
     *
     * For `"call"` the caller must declare `CAMERA` and own the active meeting (`session.meeting`).
     * Only one lease exists at a time; a second request fails with `preview_busy`. Rejects with a
     * {@link PreviewError}. Never await this on a call's connect path: preview is additive.
     */
    async preview(options = {}) {
        const source = options.source ?? "call";
        if (source !== "call") {
            throw new PreviewError("unsupported", `Preview source "${String(source)}" is not supported yet`);
        }
        let result;
        try {
            result = await this.session.sendRequest({
                type: MiniappRequestType.STREAM_PREVIEW_START,
                source,
            });
        }
        catch (error) {
            throw toPreviewError(error);
        }
        const handle = new PreviewHandleImpl(result.source ?? source, result.handleId, result.previewTraceId, (h) => this.releasePreview(h));
        this.previewHandles.set(handle.handleId, handle);
        handle.onStatus((status) => {
            if (status.state === "ended")
                this.previewHandles.delete(handle.handleId);
        });
        return handle;
    }
    async releasePreview(handle) {
        this.previewHandles.delete(handle.handleId);
        try {
            await this.session.sendRequest({
                type: MiniappRequestType.STREAM_PREVIEW_STOP,
                handleId: handle.handleId,
            });
        }
        catch (error) {
            throw toPreviewError(error);
        }
    }
    /** @internal — applied by MiniappSession on inbound STREAM_PREVIEW_STATUS. */
    _applyPreviewStatus(payload) {
        if (typeof payload.handleId !== "string")
            return;
        const handle = this.previewHandles.get(payload.handleId);
        if (!handle)
            return;
        if (payload.state === "ended") {
            handle.end(typeof payload.reason === "string" ? payload.reason : "ended");
        }
    }
    /**
     * Start a live video stream from the glasses camera.
     *
     * Managed (default) -- Mentra hosts the stream and the result carries
     * `hlsUrl`/`dashUrl`/`webrtcUrl` for playback. Optionally fan out to your own
     * `destinations`.
     *
     * Direct -- pass `direct` with your own ingest URL; the glasses publish to it
     * and no playback URLs are returned.
     */
    async startStream(options = {}) {
        if (options.direct !== undefined) {
            return this.session.sendRequest({
                type: MiniappRequestType.STREAM_START,
                streamUrl: options.direct,
                video: options.video,
                audio: options.audio,
                sound: options.sound ?? true,
                ...(options.authToken ? { authToken: options.authToken } : {}),
                ...(typeof options.captureAudio === "boolean" ? { captureAudio: options.captureAudio } : {}),
            });
        }
        return this.session.sendRequest({
            type: MiniappRequestType.MANAGED_STREAM_START,
            restreamDestinations: options.destinations,
            video: options.video,
            audio: options.audio,
            sound: options.sound ?? true,
            ingest: options.ingest,
            ...(typeof options.captureAudio === "boolean" ? { captureAudio: options.captureAudio } : {}),
            ...(options.videoPassthrough === true ? { videoPassthrough: true } : {}),
        });
    }
    /**
     * Listen for status updates on the stream this miniapp started or joined.
     * Returns an unsubscribe function.
     *
     * A stream that is recovering on its own reports `reconnecting`, then
     * `reconnected`, and keeps its `streamId` and playback URLs. A
     * `source: "coordinator"` status of `error` means the stream has ended: call
     * `startStream()` again, which returns new playback URLs.
     */
    onStatus(handler) {
        return this.session._subscribe(MiniappStreamType.STREAM_STATUS, handler);
    }
    /** Stop the active stream, or a specific one by `streamId`. */
    async stop(streamId) {
        await this.session.sendRequest({
            type: MiniappRequestType.STREAM_STOP,
            streamId,
        });
    }
}
//# sourceMappingURL=stream.js.map