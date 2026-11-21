/**
 * @fileoverview MicModule — low-level audio input subscriptions.
 *
 * Mirrors cloud SDK v3's MicManager naming. Houses raw audio chunks + VAD;
 * transcription and translation hoisted to top-level (`session.transcription`
 * / `session.translation`) in the v3-alignment round so authors don't have to
 * mentally model "transcription is a microphone thing" — it's just a
 * top-level domain. This module was called `MicrophoneModule` /
 * `session.microphone` before that round.
 *
 * Audio *output* (TTS, file playback) lives on `session.speaker`.
 *
 * MICROPHONE permission must be declared in miniapp.json for any of these
 * subscriptions to succeed; the phone runtime rejects with
 * PERMISSION_NOT_DECLARED otherwise.
 */
import { MiniappRequestType, MiniappStreamType } from "../protocol";
export class MicModule {
    constructor(session) {
        this.session = session;
        /** All active unsubscribe functions for stop() to tear down at once. */
        this.unsubs = new Set();
    }
    /**
     * Subscribe to on-device voice activity detection. One event when the user
     * starts speaking (`status: true`) and one when they stop (`status: false`,
     * with `silentForMs` saying how long the audio has already been quiet). A
     * gap in microphone audio counts as silence. Requires MICROPHONE permission.
     */
    onVoiceActivity(handler) {
        return this.track(this.session._subscribe(MiniappStreamType.VAD, handler));
    }
    /**
     * Subscribe to the on-device "Hey Mentra" wake word. Every subscribed
     * miniapp receives every detection. You get the detector's current state
     * right away, then every change. The phone loads the wake-word model while
     * any miniapp subscribes and downloads it on first use. Requires MICROPHONE
     * permission.
     */
    onWakeWord(handler) {
        return this.track(this.session._subscribe(MiniappStreamType.WAKE_WORD, handler));
    }
    /** Subscribe to raw audio chunks in the phone's PCM/LC3 microphone format. */
    onAudioChunk(handler) {
        return this.track(this.session._subscribe(MiniappStreamType.AUDIO_CHUNK, handler));
    }
    /**
     * Request glasses-side voice activity detection (GX8002) for this miniapp's
     * lifetime. Enabling is subject to the user's "Allow voice activity detection"
     * setting and continuous-audio requirements from other consumers. When disabled,
     * audio frames continue; the independent loudness gate can still silence quiet
     * input. The request is released when this miniapp disconnects.
     *
     * Requires `MICROPHONE` in the miniapp manifest.
     */
    setVoiceActivityDetectionEnabled(enabled) {
        return this.session.sendRequest({
            type: MiniappRequestType.MIC_SET_VAD_ENABLED,
            enabled,
        });
    }
    /**
     * Temporarily override the center-mic loudness gate ("Barrier") for this
     * miniapp's lifetime. It blocks quiet/self-talk audio independent of VAD.
     * The Mentra App's configured value is restored when this miniapp disconnects.
     *
     * Requires `MICROPHONE` in the miniapp manifest.
     */
    setLoudnessGateEnabled(enabled) {
        return this.session.sendRequest({
            type: MiniappRequestType.MIC_SET_LOUDNESS_GATE_ENABLED,
            enabled,
        });
    }
    /**
     * Take a semantic microphone session.
     *
     * @internal Host-gated, not part of the documented miniapp surface. The
     * `voice_call` use case is restricted to an allowlist of packages and
     * `diagnostic` is engine-only; anything else is rejected with
     * `PERMISSION_DENIED`.
     *
     * You say what you are doing; the Mentra App decides what that requires of
     * the microphone hardware. There is deliberately no way to ask for a gain,
     * a gate, or a threshold from here.
     *
     * Ordering contract for a meeting: acquire *before* `meeting.join()`, and
     * release only *after* `meeting.leave()` resolves or after a terminal
     * meeting state arrives. Releasing earlier unpins the microphone while the
     * call is still reading it, and the call reports the wearer's microphone as
     * unavailable during what was a normal hang-up.
     *
     * Requires `MICROPHONE` in the miniapp manifest.
     */
    async acquire(options) {
        const result = await this.session.sendRequest({
            type: MiniappRequestType.MIC_ACQUIRE,
            source: options.source,
            useCase: options.useCase,
        });
        // A host that predates this request resolves it with nothing rather than rejecting. Say so,
        // instead of throwing a destructuring error the caller cannot act on.
        if (typeof result?.sessionId !== "number") {
            throw new Error("This version of the Mentra App does not support microphone sessions");
        }
        const { sessionId } = result;
        let released = false;
        return {
            sessionId,
            release: async () => {
                if (released)
                    return;
                released = true;
                await this.session.sendRequest({
                    type: MiniappRequestType.MIC_RELEASE,
                    sessionId,
                });
            },
        };
    }
    /**
     * Tear down every subscription this module owns. Useful when a component
     * is unmounting and wants to free everything at once without tracking
     * individual unsubscribe functions.
     */
    stop() {
        for (const u of this.unsubs) {
            try {
                u();
            }
            catch {
                /* ignore */
            }
        }
        this.unsubs.clear();
    }
    /** True iff `MICROPHONE` is declared in the miniapp's manifest. */
    get hasPermission() {
        return this.session._hasManifestPermission("MICROPHONE");
    }
    // ------------------------------------------------------------------------
    track(unsub) {
        this.unsubs.add(unsub);
        return () => {
            this.unsubs.delete(unsub);
            unsub();
        };
    }
}
//# sourceMappingURL=mic.js.map