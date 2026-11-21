/**
 * @mentra/miniapp/background — background-side SDK entry point.
 *
 * Imported from a miniapp's `src/background/index.ts` to access the
 * per-miniapp `MiniappSession` and its typed `session.*` module
 * wrappers. This is the **always-running JSContext side** of a two-layer
 * miniapp.
 *
 * What's NOT in this entry point:
 *   - `mentra` WebView global (UI-only — import from `@mentra/miniapp/ui`).
 *   - `MentraProvider` / React hooks (UI-only).
 *   - Any DOM-bound API. The JSContext has no DOM.
 *
 * Importing the wrong sub-path is caught at compile time by the
 * separate type-roots on each `exports` entry.
 */
export { MiniappSession } from "../session";
export { registerMiniapp } from "./register";
// Public envelope + protocol types so authors can write strongly-typed
// glue when they need to fall back to session.sendOneShot / sendRequest.
export { MiniappRequestType, MiniappResponseType, MiniappStreamType, MiniappErrorCode } from "../protocol";
export { MiniappValidationError, SUPPORTED_LANGUAGE_HINTS, SUPPORTED_TRANSCRIPTION_LANGUAGES, isTranscriptionLanguage, } from "../modules/languages";
export { BlobModule, BlobWriter, BlobReader, BLOB_WRITE_CHUNK_BYTES, BLOB_READ_ALL_MAX_BYTES } from "../modules/blob";
export { bytesToBase64, base64ToBytes } from "../modules/base64";
export { MEETING_HOST_UPDATE_MESSAGE, parseMeetingMediaSource, parseMeetingParticipants, validateMeetingVideoSource, } from "../modules/meeting";
export { PreviewError } from "../modules/stream";
export { MentraRpcError, MentraRpcTimeoutError } from "../modules/ui";
export { MiniappConfigurationError } from "../modules/configuration";
//# sourceMappingURL=index.js.map