/**
 * @fileoverview Where speech is processed: on the phone or in the cloud.
 *
 * Transcription listeners (`session.transcription.on` / `forLanguage`) and
 * speech requests (`session.speaker.speak`) take the same `processing` option.
 */
import { MiniappValidationError } from "./languages";
const SPEECH_PROCESSING = ["preferCloud", "preferLocal", "localOnly"];
/**
 * @internal The processing an options object asks for. `processing` wins;
 * without it, the deprecated `forceLocal: true` means `"localOnly"`.
 * Throws `MiniappValidationError` for an unknown `processing` value.
 */
export function resolveSpeechProcessing(options, where) {
    const { processing } = options;
    if (processing === undefined)
        return options.forceLocal === true ? "localOnly" : "preferCloud";
    if (SPEECH_PROCESSING.includes(processing))
        return processing;
    throw new MiniappValidationError(`${where}: unknown processing ${JSON.stringify(processing)}. Use ${SPEECH_PROCESSING.map((value) => `"${value}"`).join(", ")}.`);
}
//# sourceMappingURL=speechProcessing.js.map