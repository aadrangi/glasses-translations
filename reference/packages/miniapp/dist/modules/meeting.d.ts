/**
 * @fileoverview MeetingModule — phone-native meeting (ACS Teams).
 *
 * Workspace credentials belong to the host. Consumer token pass-through remains
 * available for older hosts and Call backends. Never persist credentials.
 */
import { MiniappSession } from "../session";
import type { UnsubscribeFn } from "./events";
export declare const MEETING_HOST_UPDATE_MESSAGE = "Update the Mentra App to use Teams calling";
export type MeetingProvider = "acs-teams";
export type MeetingPhase = "idle" | "connecting" | "lobby" | "connected" | "disconnected" | "error";
/** Glasses video reaches the phone through a Cloudflare WHEP endpoint. */
export interface MeetingWhepVideoSource {
    type: "whep";
    url: string;
}
/**
 * Glasses video reaches the phone directly over the glasses' own hotspot, with no Cloudflare hop.
 *
 * There is no URL here because the host produces one rather than consuming one: it joins the
 * hotspot, binds a local WHIP endpoint, and tells the glasses where to publish. The miniapp only
 * chooses the transport.
 *
 * Supported by current Android and iOS hosts.
 */
export interface MeetingSoftApVideoSource {
    type: "softap";
    /**
     * Reuse a hotspot the miniapp has already started, instead of letting the host start one. Both
     * are required together; omit both for the normal path.
     */
    ssid?: string;
    passphrase?: string;
}
export type MeetingVideoSource = MeetingWhepVideoSource | MeetingSoftApVideoSource;
/**
 * Validates a video source, returning the narrowed value.
 *
 * Exported because both `join` and `updateVideoSource` need it and because the invalid cases are
 * worth pinning: an unknown `type` and a WHEP source with no URL must fail here, at the call the
 * miniapp author can see, rather than as a meeting that connects and shows nothing.
 */
export declare function validateMeetingVideoSource(source: unknown): MeetingVideoSource;
/** Advertised ACS outgoing format. Omitted hosts keep 1280×720@15. */
export interface MeetingOutgoingVideo {
    width: number;
    height: number;
    fps: number;
    maxBitrateBps: number;
}
/**
 * Which path the wearer took into the call: a meeting this app created, or a link they joined.
 *
 * Diagnostic only — the host behaves identically either way — but it is stamped on the host and
 * native traces, so a quality comparison between the two paths can be made from one capture.
 */
export type MeetingOrigin = "created" | "joined";
export interface MeetingJoinOptions {
    provider: MeetingProvider;
    meetingUrl: string;
    videoSource: MeetingVideoSource;
    /** Legacy consumer credential. Omit when getConfiguration().credentialSource is runtime. */
    token?: string;
    displayName?: string;
    video?: MeetingOutgoingVideo;
    origin?: MeetingOrigin;
}
export interface MeetingCreateOptions {
    provider: MeetingProvider;
    subject?: string;
    durationMinutes?: number;
}
export interface CreatedMeeting {
    provider: MeetingProvider;
    joinUrl: string;
    /** Opaque ownership receipt. Keep it to retire this meeting later. */
    meetingRef: string;
    identityMode: MeetingIdentityMode;
    guestReason?: "no-entra-identity" | "teams-license-unavailable";
}
export type MeetingParticipantState = "idle" | "connecting" | "connected" | "lobby" | "hold" | "disconnected";
/** A remote participant as reported by the phone-native meeting client. */
export interface MeetingParticipant {
    /** Stable provider identifier (ACS raw id). */
    id: string;
    displayName: string | null;
    state: MeetingParticipantState;
    isMuted: boolean;
    isSpeaking: boolean;
}
export type MeetingIdentityMode = "guest" | "teams-user";
export type MeetingGuestReason = "no-entra-identity" | "teams-license-unavailable" | "legacy-credential";
/**
 * Identity resolved before joining. `teams-user` means Microsoft accepted the
 * Teams calling license, not that the account owns a particular M365 SKU or
 * has permission to organize every meeting. Credentials never cross this API.
 * Acquisition/consent/provider errors reject instead of reporting guest mode.
 */
export interface MeetingIdentity {
    identityMode: MeetingIdentityMode;
    guestReason?: MeetingGuestReason;
    /** Present when the host has a signed-in Entra account, including unlicensed accounts. */
    account?: {
        displayName?: string;
        email?: string;
    };
}
/** Host policy; this contains no credentials or deployment endpoints. */
export interface MeetingConfiguration {
    enabled: boolean;
    credentialSource: "runtime" | "miniapp";
    externalBackendAllowed: boolean;
    managedStreams: boolean;
    /** Omitted by older hosts. Runtime creation requires Graph organizer configuration. */
    creationSource?: "runtime" | "miniapp";
}
export interface MeetingState {
    /** Omitted by older hosts. Tokens never cross this boundary. */
    identityMode?: MeetingIdentityMode;
    guestReason?: MeetingGuestReason;
    state: MeetingPhase;
    muted: boolean;
    /**
     * Whether remote participants receive the glasses camera. False after `setVideoEnabled(false)`;
     * every new join starts true. Omitted by hosts that cannot toggle outgoing video.
     */
    videoEnabled?: boolean;
    error?: string;
    /** Provider termination details, including Teams' invalid meeting-link codes. */
    endReason?: MeetingEndReason;
    meetingUrl?: string;
    provider?: MeetingProvider;
    audioSource?: "glasses" | "phone";
    audioSourceReason?: "explicit" | "current-mic" | "ranking" | "fallback-glasses-connected" | "fallback-no-glasses";
    activeStream?: "none" | "virtual" | "local";
    audioSafety?: "safe" | "degraded" | "unsafe";
    /**
     * Health of the glasses video the phone is forwarding into the meeting.
     * `live` means a frame reached the meeting client, so it is the only honest
     * "remote participants can see the camera" signal — the WHEP subscription
     * answers seconds earlier. Omitted by hosts that predate the field, which
     * must be read as "unknown", never as "not live".
     */
    mediaSource?: MeetingMediaSource;
    /** Remote roster. Omitted by hosts that predate participant reporting. */
    participants?: MeetingParticipant[];
    /**
     * What this participant is allowed to do in the meeting, as the provider reports it at runtime.
     * Omitted by hosts that predate capability reporting.
     */
    capabilities?: MeetingCapabilities;
    /**
     * SoftAP join checklist. Present only on the state events the host emits while it walks the
     * SoftAP sequence (and on the final one when it fails); absent on every other event, including
     * the native meeting client's own. Keep the last one you saw — absence is not a reset.
     */
    softap?: MeetingSoftApProgress;
    /**
     * SoftAP mid-call recovery. Omitted by hosts that predate the field, and omitted on events
     * that have no news. `active` means keep the ACS call — a lost hotspot is a media outage.
     */
    recovery?: MeetingSoftApRecovery;
}
export type MeetingMediaSource = "idle" | "connecting" | "live" | "failed";
export interface MeetingEndReason {
    code?: number;
    subcode?: number;
    message?: string;
}
/** Older hosts omit this field; malformed values must not become provider error codes. */
export declare function parseMeetingEndReason(raw: unknown): MeetingEndReason | undefined;
/**
 * One runtime capability.
 *
 * `allowed` is nullable because "you may not" and "we do not know yet" are different answers and
 * need different UI. Providers deliver capabilities asynchronously — Teams can grant a presenter
 * role mid-call — so a control gated on this should read `null` as "not yet", not as "no".
 */
export interface MeetingCapability {
    allowed: boolean | null;
    /** Provider reason, e.g. `role_restricted`, `meeting_restricted`. Null when not reported. */
    reason: string | null;
}
export interface MeetingCapabilities {
    /** Whether `meeting.end()` will be honoured: presenters only, on Teams. */
    hangUpForEveryone: MeetingCapability;
    manageLobby?: MeetingCapability;
}
/** Tolerant parse of a host `capabilities` payload. A malformed payload reads as absent. */
export declare function parseMeetingCapabilities(raw: unknown): MeetingCapabilities | undefined;
/**
 * The five SoftAP steps, in order. `hotspot`: glasses turn on their AP. `scopedJoin`: the phone
 * joins it without giving up cellular. `acsJoin`: the phone binds its video receiver and joins
 * Teams. `publish`: the glasses start the camera and publish to the phone. `live`: a frame reached
 * the meeting.
 */
export type MeetingSoftApStep = "hotspot" | "scopedJoin" | "acsJoin" | "publish" | "live";
export type MeetingSoftApStepStatus = "pending" | "running" | "done" | "failed";
export interface MeetingSoftApStepState {
    step: MeetingSoftApStep;
    status: MeetingSoftApStepStatus;
    /** What the step produced or is doing: SSID, phone address, receiver URL, glasses status. */
    detail?: string;
    /** Only on `failed`. */
    error?: string;
    durationMs?: number;
}
export interface MeetingSoftApProgress {
    /** Correlates phone and glasses logs for this attempt. */
    traceId?: string;
    phase: "idle" | "starting" | "recovering" | "live" | "stopping" | "failed";
    steps: MeetingSoftApStepState[];
    /** ms since the host started the sequence. */
    elapsedMs: number;
}
/** Host SoftAP mid-call recovery. Missing `recovery` is "no news", not "ended". */
export interface MeetingSoftApRecovery {
    active: boolean;
    generation?: number;
    deadlineAt?: number;
    phase?: string;
}
/** Tolerant parse of a host `softap` payload. Unknown steps are dropped; a malformed payload reads as absent. */
export declare function parseMeetingSoftApProgress(raw: unknown): MeetingSoftApProgress | undefined;
/** Tolerant parse of a host `recovery` payload. A malformed payload reads as absent. */
export declare function parseMeetingRecovery(raw: unknown): MeetingSoftApRecovery | undefined;
/** Tolerant parse of a host `mediaSource`. Unknown values read as unknown. */
export declare function parseMeetingMediaSource(raw: unknown): MeetingMediaSource | undefined;
/** Tolerant parse of a host `participants` payload. Unknown shapes are skipped. */
export declare function parseMeetingParticipants(raw: unknown): MeetingParticipant[] | undefined;
export type MeetingStateHandler = (state: MeetingState) => void;
/** The host resumed a photo pause because it hit the ceiling. */
export interface MeetingVideoPublisherEvent {
    pauseId: string;
    status: "expired";
}
/**
 * Why [MeetingModule.captureStill] failed. `unsupported` means this host, build, or transport
 * cannot do it at all (older Mentra App, iOS today, a non-Direct-link call): use the
 * pause-based path instead. Everything else is a failed attempt of a supported one.
 */
export type MeetingStillFailure = "unsupported" | "not_live" | "busy" | "glasses_rejected" | "upload_timeout" | "hold_failed" | "cancelled";
/** Rejection of [MeetingModule.captureStill]. */
export interface MeetingStillError {
    code: string;
    message: string;
    reason: MeetingStillFailure;
}
/** `card` on the tile, glasses `uploading` the capture, still `shown` on the tile. */
export type MeetingStillPhase = "card" | "uploading" | "shown";
/** @internal Push correlated to one [MeetingModule.captureStill] call by `stillId`. */
export interface MeetingStillProgressEvent {
    stillId: string;
    phase: MeetingStillPhase;
}
export interface MeetingStillResult {
    ok: true;
    requestId: string;
    /** Size of the JPEG the glasses delivered. */
    bytes: number;
    /** Host clock when the first still frame reached the Teams sender. */
    shownAt: number;
    timings: {
        cardMs: number;
        stillMs: number;
        heldMs: number;
        totalMs: number;
    };
}
export declare class MeetingModule {
    private readonly session;
    private _state;
    constructor(session: MiniappSession);
    get state(): MeetingState;
    /**
     * Join a Teams meeting via the phone ACS client.
     * Resolves once the host has accepted the join (state may still be connecting/lobby).
     */
    join(options: MeetingJoinOptions): Promise<MeetingState>;
    /** Query before using a separate Call backend. Older hosts return NOT_IMPLEMENTED. */
    getConfiguration(): Promise<MeetingConfiguration>;
    /** Resolve the current calling identity without creating or joining a meeting. */
    getIdentity(): Promise<MeetingIdentity>;
    /** Create a Teams meeting in the selected Runtime without exposing provider credentials. */
    create(options: MeetingCreateOptions): Promise<CreatedMeeting>;
    /** Delete a meeting created by this caller. Does not hang up an active call. */
    retire(meetingRef: string): Promise<void>;
    leave(): Promise<void>;
    /**
     * Stop the glasses camera publisher without leaving the meeting.
     * On Direct link this stops only `start_stream`. Cloudflare callers pause their own stream.
     */
    pauseVideoPublisher(options: {
        reason: "photo";
    }): Promise<{
        pauseId: string;
    }>;
    /** A stale `pauseId` is a no-op. Leave, End, and a new join cancel the pause themselves. */
    resumeVideoPublisher(pauseId: string): Promise<void>;
    /** Resolves when the first card frame has been handed to the Teams sender. */
    showCard(options: {
        kind: "taking-photo";
    }): Promise<void>;
    /**
     * Replace the card with a still. Resolves when the first still frame is handed to the sender.
     * `durationMs` is the caller's clock, starting at `shownAt`.
     */
    showImage(options: {
        imageUrl: string;
        durationMs: number;
    }): Promise<{
        shownAt: number;
    }>;
    /** The caller's `durationMs` has elapsed. Glasses frames may reach the tile again. */
    showLive(): Promise<void>;
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
    captureStill(options: {
        durationMs: number;
        onProgress?: (phase: MeetingStillPhase) => void;
    }): Promise<MeetingStillResult>;
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
    end(): Promise<void>;
    /** Admit one guest; callers must wait for the roster to report connected. */
    admit(participantId: string): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    /**
     * Stop or resume the glasses camera the meeting receives. The call and the glasses stream stay
     * up, so a local `<StreamPreview>` keeps drawing while remote participants see the camera off.
     * Check `state.videoEnabled !== undefined` before offering it; older hosts reject.
     */
    setVideoEnabled(enabled: boolean): Promise<void>;
    /**
     * Repoint the host at a new WHEP URL mid-call, the recovery path for a re-published stream.
     *
     * WHEP only. A SoftAP source has no URL to update — the host owns the endpoint — and its
     * recovery is a full rebuild, so accepting one here would be a silent no-op.
     */
    updateVideoSource(source: MeetingWhepVideoSource): Promise<void>;
    getState(): Promise<MeetingState>;
    onState(handler: MeetingStateHandler): UnsubscribeFn;
    /** Fired when the host's pause ceiling resumes the publisher. A resume this caller sent is silent. */
    onVideoPublisher(handler: (event: MeetingVideoPublisherEvent) => void): UnsubscribeFn;
    /** @internal — applied by MiniappSession on inbound MEETING_STATE. */
    _applyState(event: MeetingState): void;
}
//# sourceMappingURL=meeting.d.ts.map