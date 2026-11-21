/**
 * @fileoverview CameraModule — glasses camera control and photo capture.
 */
import { parsePhotoCompression } from "@mentra/cloud-protocol/photo-compression";
import { MiniappRequestType } from "../protocol";
export class CameraModule {
    constructor(session) {
        this.session = session;
    }
    /** True iff `CAMERA` is declared in the miniapp's manifest. */
    get hasPermission() {
        return this.session._hasManifestPermission("CAMERA");
    }
    /**
     * Apply a session-owned camera FOV/ROI override on the glasses.
     *
     * Resolves after the ASG client reports that the setting was applied to camera
     * hardware after the restart cooldown. The host restores the prior override or persistent base
     * when this miniapp closes. Requires CAMERA permission declared in miniapp.json.
     */
    async setFov(request) {
        return this.session.sendRequest({
            type: MiniappRequestType.CAMERA_FOV,
            ...request,
        });
    }
    /**
     * Take a photo with the glasses camera. Requires CAMERA permission declared in miniapp.json.
     *
     * The glasses send the photo to the phone over Bluetooth, and it stays there as one of the miniapp's
     * own files: no internet connection is needed and nothing is uploaded. Read it with
     * `session.blob.bytes(photo.key)`, show it in the miniapp's screen from `photo.url`, and send it
     * wherever the miniapp needs it. The phone deletes it after 30 minutes.
     *
     * If the glasses don't have a camera, the phone-side handler rejects with an error. Check
     * `session.capabilities.hasCamera` before calling.
     */
    async takePhoto(options = {}) {
        const photo = await this.session.sendRequest(
        // `delivery` asks the Mentra App to keep the photo on the phone. One that predates local photos ignores it.
        { ...this.photoRequest(options), delivery: "local" }, options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : undefined);
        // A Mentra App from before local photos answers with a cloud URL and no key. A miniapp built with this
        // SDK declares the first version that has them as its minHostVersion, so this is a development build
        // that is behind.
        if (typeof photo?.key !== "string" || !photo.key) {
            throw new Error("This Mentra App can't keep photos on the phone yet. Update the Mentra App.");
        }
        return photo;
    }
    /**
     * Take a photo and upload it to Mentra's cloud, resolving to a short-lived signed URL.
     *
     * @deprecated Use {@link takePhoto}, which keeps the photo on the phone. This remains for one
     * case: a full-size photo that must reach a server quickly. The glasses can upload it over their
     * own Wi-Fi, which is much faster than sending it to the phone over Bluetooth. It needs an
     * internet connection, and it goes away once the glasses can send large photos to the phone.
     */
    async takeCloudPhoto(options = {}) {
        return this.session.sendRequest({
            ...this.photoRequest(options),
            ...(options.transferMethod !== undefined ? { transferMethod: options.transferMethod } : {}),
        }, options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : undefined);
    }
    /** The capture settings of a photo request, shared by both delivery paths. */
    photoRequest(options) {
        return {
            type: MiniappRequestType.PHOTO,
            size: options.size ?? "medium",
            mode: options.mode ?? "photo",
            compress: parsePhotoCompression(options.compress),
            sound: options.sound ?? true,
            saveToGallery: options.saveToGallery ?? false,
            exposureTimeNs: options.exposureTimeNs,
            iso: options.iso,
            aeExposureDivisor: options.aeExposureDivisor,
            isoCap: options.isoCap,
            noiseReduction: options.noiseReduction,
            edgeEnhancement: options.edgeEnhancement,
            zsl: options.zsl,
            mfnr: options.mfnr,
            ispDigitalGain: options.ispDigitalGain,
            ispAnalogGain: options.ispAnalogGain,
        };
    }
    /**
     * Pre-warm the glasses camera so the next takePhoto() is near-instant.
     * The camera stays warm for ~durationMs (default 15s, maximum 5 minutes); call warmUp() again to
     * extend it. Warm with the same `size` you'll capture with — a mismatched size
     * forces the camera to reconfigure and loses the speedup. Requires CAMERA
     * permission in miniapp.json. Resolves once the camera reports ready. The host automatically
     * releases this miniapp's request-owned lease when the miniapp closes.
     *
     * Warm-ups are serialized: only one runs at a time and none may start while a
     * photo is being captured. If the camera is busy (a capture is in flight, or
     * another warm-up is still opening) this rejects with `camera_busy` — retry
     * shortly, or just call takePhoto() (it works regardless, only slower). The
     * normal warmUp() → takePhoto() sequence never hits this.
     */
    async warmUp(options = {}) {
        await this.session.sendRequest({
            type: MiniappRequestType.CAMERA_WARM_UP,
            size: options.size ?? "medium",
            mode: options.mode ?? "photo",
            exposureTimeNs: options.exposureTimeNs,
            durationMs: options.durationMs ?? 15000,
            zsl: options.zsl,
            mfnr: options.mfnr,
        });
    }
    /**
     * Start recording video on the glasses camera. Returns a `recordingId` to pass
     * to {@link stopVideoRecording} after the glasses report that recording
     * started. Requires CAMERA permission declared in miniapp.json. Check
     * `session.capabilities.hasCamera` before calling.
     *
     * Resolution and frame rate are optional — omit them to use the device's saved
     * button-video settings. Lowering `fps` (e.g. to 5) keeps the glasses cooler
     * during long recordings.
     */
    async startVideoRecording(options = {}) {
        return this.session.sendRequest({
            type: MiniappRequestType.VIDEO_RECORDING_START,
            width: options.width,
            height: options.height,
            fps: options.fps,
            sound: options.sound ?? true,
            save: options.save ?? false,
        });
    }
    /**
     * Stop an in-progress video recording started with {@link startVideoRecording}.
     *
     * By default the recording stays on the glasses. Pass `uploadUrl` to have the
     * glasses upload the finished clip to your own endpoint.
     *
     * @param recordingId The id returned from `startVideoRecording`.
     * @param options     Optional upload destination for the finished recording.
     */
    async stopVideoRecording(recordingId, options = {}) {
        await this.session.sendRequest({
            type: MiniappRequestType.VIDEO_RECORDING_STOP,
            recordingId,
            uploadUrl: options.uploadUrl,
            uploadAuthToken: options.uploadAuthToken,
        });
    }
}
//# sourceMappingURL=camera.js.map