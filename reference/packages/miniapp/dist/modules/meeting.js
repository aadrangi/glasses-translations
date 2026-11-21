/**
 * @fileoverview MeetingModule — phone-native meeting (ACS Teams).
 *
 * Workspace credentials belong to the host. Consumer token pass-through remains
 * available for older hosts and Call backends. Never persist credentials.
 */
import { MiniappErrorCode, MiniappRequestType } from "../protocol";
export const MEETING_HOST_UPDATE_MESSAGE = "Update the Mentra App to use Teams calling";
/**
 * Validates a video source, returning the narrowed value.
 *
 * Exported because both `join` and `updateVideoSource` need it and because the invalid cases are
 * worth pinning: an unknown `type` and a WHEP source with no URL must fail here, at the call the
 * miniapp author can see, rather than as a meeting that connects and shows nothing.
 */
export function validateMeetingVideoSource(source) {
    const value = (source ?? {});
    if (value.type === "whep") {
        const url = typeof value.url === "string" ? value.url.trim() : "";
        if (!url) {
            throw { code: MiniappErrorCode.INVALID_ARGUMENT, message: "videoSource.url is required for a WHEP source" };
        }
        return { type: "whep", url };
    }
    if (value.type === "softap") {
        const ssid = typeof value.ssid === "string" ? value.ssid.trim() : "";
        const passphrase = typeof value.passphrase === "string" ? value.passphrase : "";
        // Half a credential pair is a misconfiguration that would otherwise present as a failed
        // hotspot join several seconds later.
        if (Boolean(ssid) !== Boolean(passphrase)) {
            throw {
                code: MiniappErrorCode.INVALID_ARGUMENT,
                message: "videoSource.ssid and videoSource.passphrase must be provided together",
            };
        }
        return ssid ? { type: "softap", ssid, passphrase } : { type: "softap" };
    }
    throw {
        code: MiniappErrorCode.INVALID_ARGUMENT,
        message: `videoSource must be {type: "whep", url} or {type: "softap"}`,
    };
}
/** Older hosts omit this field; malformed values must not become provider error codes. */
export function parseMeetingEndReason(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const value = raw;
    const number = (field) => typeof field === "number" && Number.isFinite(field) ? field : undefined;
    const code = number(value.code);
    const subcode = number(value.subcode);
    const message = typeof value.message === "string" && value.message ? value.message : undefined;
    if (code === undefined && subcode === undefined && message === undefined)
        return undefined;
    return {
        ...(code !== undefined ? { code } : {}),
        ...(subcode !== undefined ? { subcode } : {}),
        ...(message !== undefined ? { message } : {}),
    };
}
/** Tolerant parse of a host `capabilities` payload. A malformed payload reads as absent. */
export function parseMeetingCapabilities(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const value = raw.hangUpForEveryone;
    if (!value || typeof value !== "object")
        return undefined;
    const capability = value;
    const rawLobby = raw.manageLobby;
    const lobby = rawLobby && typeof rawLobby === "object" ? rawLobby : undefined;
    return {
        ...(lobby
            ? {
                manageLobby: {
                    allowed: typeof lobby.allowed === "boolean" ? lobby.allowed : null,
                    reason: typeof lobby.reason === "string" && lobby.reason ? lobby.reason : null,
                },
            }
            : {}),
        hangUpForEveryone: {
            allowed: typeof capability.allowed === "boolean" ? capability.allowed : null,
            reason: typeof capability.reason === "string" && capability.reason ? capability.reason : null,
        },
    };
}
const SOFTAP_STEPS = new Set(["hotspot", "scopedJoin", "acsJoin", "publish", "live"]);
const SOFTAP_STEP_STATUSES = new Set(["pending", "running", "done", "failed"]);
const SOFTAP_PHASES = new Set(["idle", "starting", "recovering", "live", "stopping", "failed"]);
/** Tolerant parse of a host `softap` payload. Unknown steps are dropped; a malformed payload reads as absent. */
export function parseMeetingSoftApProgress(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const value = raw;
    if (!SOFTAP_PHASES.has(String(value.phase)) || !Array.isArray(value.steps))
        return undefined;
    const steps = [];
    for (const entry of value.steps) {
        if (!entry || typeof entry !== "object")
            continue;
        const step = entry;
        if (!SOFTAP_STEPS.has(String(step.step)) || !SOFTAP_STEP_STATUSES.has(String(step.status)))
            continue;
        steps.push({
            step: step.step,
            status: step.status,
            detail: typeof step.detail === "string" && step.detail ? step.detail : undefined,
            error: typeof step.error === "string" && step.error ? step.error : undefined,
            durationMs: typeof step.durationMs === "number" && Number.isFinite(step.durationMs) ? step.durationMs : undefined,
        });
    }
    return {
        traceId: typeof value.traceId === "string" && value.traceId ? value.traceId : undefined,
        phase: value.phase,
        steps,
        elapsedMs: typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) ? value.elapsedMs : 0,
    };
}
/** Tolerant parse of a host `recovery` payload. A malformed payload reads as absent. */
export function parseMeetingRecovery(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const value = raw;
    if (typeof value.active !== "boolean")
        return undefined;
    const generation = typeof value.generation === "number" && Number.isFinite(value.generation) ? value.generation : undefined;
    const deadlineAt = typeof value.deadlineAt === "number" && Number.isFinite(value.deadlineAt) ? value.deadlineAt : undefined;
    const phase = typeof value.phase === "string" && value.phase ? value.phase : undefined;
    return {
        active: value.active,
        ...(generation !== undefined ? { generation } : {}),
        ...(deadlineAt !== undefined ? { deadlineAt } : {}),
        ...(phase ? { phase } : {}),
    };
}
const PARTICIPANT_STATES = new Set([
    "idle",
    "connecting",
    "connected",
    "lobby",
    "hold",
    "disconnected",
]);
const MEDIA_SOURCES = new Set(["idle", "connecting", "live", "failed"]);
/** Tolerant parse of a host `mediaSource`. Unknown values read as unknown. */
export function parseMeetingMediaSource(raw) {
    return MEDIA_SOURCES.has(String(raw)) ? raw : undefined;
}
/** Tolerant parse of a host `participants` payload. Unknown shapes are skipped. */
export function parseMeetingParticipants(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const result = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object")
            continue;
        const value = entry;
        if (typeof value.id !== "string" || !value.id)
            continue;
        result.push({
            id: value.id,
            displayName: typeof value.displayName === "string" && value.displayName ? value.displayName : null,
            state: PARTICIPANT_STATES.has(String(value.state)) ? value.state : "idle",
            isMuted: Boolean(value.isMuted),
            isSpeaking: Boolean(value.isSpeaking),
        });
    }
    return result;
}
let stillSeq = 0;
function mintStillId() {
    stillSeq = (stillSeq + 1) % 0xffff;
    return `still-${Date.now().toString(36)}-${stillSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
const STILL_FAILURES = new Set([
    "unsupported",
    "not_live",
    "busy",
    "glasses_rejected",
    "upload_timeout",
    "hold_failed",
    "cancelled",
]);
function toStillError(error) {
    const raw = (error && typeof error === "object" ? error : {});
    const code = typeof raw.code === "string" ? raw.code : MiniappErrorCode.INTERNAL;
    const message = typeof raw.message === "string" ? raw.message : String(error);
    let reason;
    if (typeof raw.reason === "string" && STILL_FAILURES.has(raw.reason))
        reason = raw.reason;
    else if (code === MiniappErrorCode.NOT_IMPLEMENTED)
        reason = "unsupported";
    else if (code === MiniappErrorCode.REQUEST_ABORTED)
        reason = "cancelled";
    else
        reason = "glasses_rejected";
    return { code, message, reason };
}
function isMiniappRequestError(error) {
    return Boolean(error && typeof error === "object" && "code" in error);
}
function mapHostError(error) {
    if (isMiniappRequestError(error) && error.code === MiniappErrorCode.NOT_IMPLEMENTED) {
        throw { code: MiniappErrorCode.NOT_IMPLEMENTED, message: MEETING_HOST_UPDATE_MESSAGE };
    }
    throw error;
}
export class MeetingModule {
    constructor(session) {
        this.session = session;
        this._state = { state: "idle", muted: false };
    }
    get state() {
        return { ...this._state };
    }
    /**
     * Join a Teams meeting via the phone ACS client.
     * Resolves once the host has accepted the join (state may still be connecting/lobby).
     */
    async join(options) {
        if (options.provider !== "acs-teams") {
            throw { code: MiniappErrorCode.INVALID_ARGUMENT, message: `Unsupported meeting provider: ${options.provider}` };
        }
        if (!options.meetingUrl?.trim()) {
            throw { code: MiniappErrorCode.INVALID_ARGUMENT, message: "meetingUrl is required" };
        }
        const videoSource = validateMeetingVideoSource(options.videoSource);
        try {
            const result = await this.session.sendRequest({
                type: MiniappRequestType.MEETING_JOIN,
                provider: options.provider,
                meetingUrl: options.meetingUrl,
                videoSource,
                ...(options.token ? { token: options.token } : {}),
                displayName: options.displayName,
                ...(options.origin ? { origin: options.origin } : {}),
                ...(options.video ? { video: options.video } : {}),
            }, { timeoutMs: 0 });
            if (result)
                this._applyState(result);
            return this.state;
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /** Query before using a separate Call backend. Older hosts return NOT_IMPLEMENTED. */
    async getConfiguration() {
        return this.session.sendRequest({ type: MiniappRequestType.MEETING_GET_CONFIGURATION });
    }
    /** Resolve the current calling identity without creating or joining a meeting. */
    async getIdentity() {
        try {
            return await this.session.sendRequest({ type: MiniappRequestType.MEETING_GET_IDENTITY }, { timeoutMs: 30000 });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /** Create a Teams meeting in the selected Runtime without exposing provider credentials. */
    async create(options) {
        if (options.provider !== "acs-teams") {
            throw { code: MiniappErrorCode.INVALID_ARGUMENT, message: "Unsupported meeting provider" };
        }
        try {
            return await this.session.sendRequest({
                type: MiniappRequestType.MEETING_CREATE,
                provider: options.provider,
                subject: options.subject,
                durationMinutes: options.durationMinutes,
            }, { timeoutMs: 0 });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /** Delete a meeting created by this caller. Does not hang up an active call. */
    async retire(meetingRef) {
        try {
            await this.session.sendRequest({ type: MiniappRequestType.MEETING_RETIRE, meetingRef }, { timeoutMs: 0 });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    async leave() {
        try {
            await this.session.sendRequest({ type: MiniappRequestType.MEETING_LEAVE });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /**
     * Stop the glasses camera publisher without leaving the meeting.
     * On Direct link this stops only `start_stream`. Cloudflare callers pause their own stream.
     */
    async pauseVideoPublisher(options) {
        try {
            return await this.session.sendRequest({
                type: MiniappRequestType.MEETING_PAUSE_VIDEO_PUBLISHER,
                reason: options.reason,
            });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /** A stale `pauseId` is a no-op. Leave, End, and a new join cancel the pause themselves. */
    async resumeVideoPublisher(pauseId) {
        try {
            await this.session.sendRequest({
                type: MiniappRequestType.MEETING_RESUME_VIDEO_PUBLISHER,
                pauseId,
            });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /** Resolves when the first card frame has been handed to the Teams sender. */
    async showCard(options) {
        try {
            await this.session.sendRequest({
                type: MiniappRequestType.MEETING_SHOW_CARD,
                kind: options.kind,
            });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /**
     * Replace the card with a still. Resolves when the first still frame is handed to the sender.
     * `durationMs` is the caller's clock, starting at `shownAt`.
     */
    async showImage(options) {
        try {
            return await this.session.sendRequest({
                type: MiniappRequestType.MEETING_SHOW_IMAGE,
                imageUrl: options.imageUrl,
                durationMs: options.durationMs,
            });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /** The caller's `durationMs` has elapsed. Glasses frames may reach the tile again. */
    async showLive() {
        try {
            await this.session.sendRequest({ type: MiniappRequestType.MEETING_SHOW_LIVE });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /**
     * Share one full-size glasses photo on the outgoing video of a Direct link call, without
     * stopping the glasses camera stream. The host shows the "Taking a photo..." card, has the glasses
     * shoot and upload straight to the phone, holds the still for `durationMs`, then returns to live
     * video. Do not combine with [pauseVideoPublisher] or [showCard]/[showImage]; this replaces them.
     *
     * `onProgress` reports each phase as the host reaches it, so a caller can say "taking",
     * "sharing" and "on the call" at the right moments; the promise itself settles after the hold.
     *
     * Rejects with a [MeetingStillError]. `reason: "unsupported"` means use the pause-based path.
     */
    async captureStill(options) {
        const stillId = mintStillId();
        const onProgress = options.onProgress;
        const unsubscribe = onProgress
            ? this.session.on("meetingStill", (event) => {
                if (event.stillId === stillId)
                    onProgress(event.phase);
            })
            : undefined;
        try {
            return await this.session.sendRequest({ type: MiniappRequestType.MEETING_CAPTURE_STILL, durationMs: options.durationMs, stillId }, 
            // Capture, upload, and the hold itself; the host bounds each step.
            { timeoutMs: options.durationMs + 75000 });
        }
        catch (error) {
            throw toStillError(error);
        }
        finally {
            unsubscribe?.();
        }
    }
    /**
     * End the meeting for everyone, then leave.
     *
     * Different from [leave] in what happens to the other participants: leaving takes this device out
     * of a meeting that carries on, ending terminates the group call. Only a presenter may do it, so
     * check `state.capabilities?.hangUpForEveryone.allowed` before offering it.
     *
     * A rejection means the meeting may still be live — it never means the wearer is still in the
     * call. The host always completes local teardown, so the honest thing to tell the user is "you
     * left, but the meeting may still be active".
     */
    async end() {
        try {
            await this.session.sendRequest({ type: MiniappRequestType.MEETING_END }, { timeoutMs: 0 });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /** Admit one guest; callers must wait for the roster to report connected. */
    async admit(participantId) {
        if (!participantId.trim())
            throw new Error("A participant ID is required");
        try {
            await this.session.sendRequest({ type: MiniappRequestType.MEETING_ADMIT, participantId });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    async setMuted(muted) {
        try {
            const result = await this.session.sendRequest({
                type: MiniappRequestType.MEETING_SET_MUTED,
                muted,
            });
            if (result)
                this._applyState(result);
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /**
     * Stop or resume the glasses camera the meeting receives. The call and the glasses stream stay
     * up, so a local `<StreamPreview>` keeps drawing while remote participants see the camera off.
     * Check `state.videoEnabled !== undefined` before offering it; older hosts reject.
     */
    async setVideoEnabled(enabled) {
        try {
            const result = await this.session.sendRequest({
                type: MiniappRequestType.MEETING_SET_VIDEO_ENABLED,
                enabled,
            });
            if (result)
                this._applyState(result);
        }
        catch (error) {
            mapHostError(error);
        }
    }
    /**
     * Repoint the host at a new WHEP URL mid-call, the recovery path for a re-published stream.
     *
     * WHEP only. A SoftAP source has no URL to update — the host owns the endpoint — and its
     * recovery is a full rebuild, so accepting one here would be a silent no-op.
     */
    async updateVideoSource(source) {
        const validated = validateMeetingVideoSource(source);
        if (validated.type !== "whep") {
            throw {
                code: MiniappErrorCode.INVALID_ARGUMENT,
                message: "updateVideoSource accepts a WHEP source; a SoftAP call recovers by rejoining",
            };
        }
        try {
            await this.session.sendRequest({
                type: MiniappRequestType.MEETING_UPDATE_VIDEO_SOURCE,
                videoSource: validated,
            });
        }
        catch (error) {
            mapHostError(error);
        }
    }
    async getState() {
        try {
            const result = await this.session.sendRequest({
                type: MiniappRequestType.MEETING_GET_STATE,
            });
            if (result)
                this._applyState(result);
            return this.state;
        }
        catch (error) {
            mapHostError(error);
        }
    }
    onState(handler) {
        return this.session.on("meetingState", handler);
    }
    /** Fired when the host's pause ceiling resumes the publisher. A resume this caller sent is silent. */
    onVideoPublisher(handler) {
        return this.session.on("meetingVideoPublisher", handler);
    }
    /** @internal — applied by MiniappSession on inbound MEETING_STATE. */
    _applyState(event) {
        this._state = {
            identityMode: event.identityMode === "guest" || event.identityMode === "teams-user"
                ? event.identityMode
                : this._state.identityMode,
            guestReason: event.identityMode === "guest"
                ? event.guestReason
                : event.identityMode === "teams-user"
                    ? undefined
                    : this._state.guestReason,
            state: event.state,
            muted: Boolean(event.muted),
            videoEnabled: typeof event.videoEnabled === "boolean" ? event.videoEnabled : undefined,
            error: event.error,
            endReason: parseMeetingEndReason(event.endReason),
            meetingUrl: event.meetingUrl,
            provider: event.provider,
            audioSource: event.audioSource,
            audioSourceReason: event.audioSourceReason,
            activeStream: event.activeStream,
            audioSafety: event.audioSafety,
            mediaSource: parseMeetingMediaSource(event.mediaSource),
            participants: parseMeetingParticipants(event.participants),
            // Absent means unknown, so the last known verdict stands. Clearing it would make End flicker
            // out of the UI on every native state event that does not carry capabilities.
            capabilities: parseMeetingCapabilities(event.capabilities) ?? this._state.capabilities,
            softap: parseMeetingSoftApProgress(event.softap),
            // Absence is "no news", never "recovery ended". The host must send `active: false`.
            recovery: parseMeetingRecovery(event.recovery) ?? this._state.recovery,
        };
    }
}
//# sourceMappingURL=meeting.js.map