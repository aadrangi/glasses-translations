// import NetInfo from "@react-native-community/netinfo"

import STTModelManager from "./STTModelManager"

export type DownloadStage = "idle" | "downloading" | "extracting" | "complete" | "failed"

export interface DownloadStatus {
  kind: "stt"
  languageCode: string
  stage: DownloadStage
  /** 0–100, only meaningful while stage is "downloading" or "extracting". */
  percent: number
}

type StatusListener = (status: DownloadStatus | null) => void

/**
 * The Speech-page download system. Every speech model download goes through
 * here (the startup background download, a miniapp that needs a missing model,
 * a tap on the Speech page), so progress always shows on the Speech page.
 */
class OfflineSpeechModelService {
  private static instance: OfflineSpeechModelService
  private started = false
  private sttPromise: Promise<void> | null = null

  private currentStatus: DownloadStatus | null = null
  private listeners = new Set<StatusListener>()

  private constructor() {}

  static getInstance(): OfflineSpeechModelService {
    if (!OfflineSpeechModelService.instance) {
      OfflineSpeechModelService.instance = new OfflineSpeechModelService()
    }
    return OfflineSpeechModelService.instance
  }

  startBackgroundDownloads(): void {
    if (this.started) return
    this.started = true

    // Wi-Fi gate (currently disabled — uncomment to skip background downloads on cellular):
    // NetInfo.fetch().then((state) => {
    //   if (state.type !== "wifi") {
    //     console.log("OFFLINE_MODELS: skipping background download — not on Wi-Fi")
    //     return
    //   }
    //   void this.ensureDefaultModels().catch((error) => {
    //     console.warn("OFFLINE_MODELS: background model setup failed:", error)
    //   })
    // })

    void this.ensureDefaultModels().catch((error) => {
      console.warn("OFFLINE_MODELS: background model setup failed:", error)
    })
  }

  /**
   * Subscribe to download status changes; fires immediately with the current
   * status. Each event names its model (`kind` + `languageCode`); downloads of
   * different models can interleave.
   */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.currentStatus)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getStatus(): DownloadStatus | null {
    return this.currentStatus
  }

  private setStatus(status: DownloadStatus | null): void {
    this.currentStatus = status
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch (e) {
        console.warn("OFFLINE_MODELS: status listener threw:", e)
      }
    }
  }

  async ensureDefaultModels(): Promise<void> {
    try {
      await this.ensureSttModel()
    } catch (error) {
      console.warn("OFFLINE_MODELS: STT model setup failed:", error)
    }
  }

  async ensureSttModel(): Promise<void> {
    if (this.sttPromise) return this.sttPromise
    this.sttPromise = this.ensureSttModelInner().finally(() => {
      this.sttPromise = null
    })
    return this.sttPromise
  }

  /**
   * Download an STT model with its progress on the Speech page. Joins a
   * download of the same model that is already running. Never changes the
   * selected model.
   */
  async downloadSttModel(code: string, onProgress?: (percent: number) => void): Promise<void> {
    if (await STTModelManager.isModelAvailable(code)) return
    await this.track("stt", code, onProgress, (progress, extraction) =>
      STTModelManager.downloadModel(code, progress, extraction),
    )
  }

  private async track(
    kind: DownloadStatus["kind"],
    code: string,
    onProgress: ((percent: number) => void) | undefined,
    download: (
      onProgress: (progress: {percentage: number}) => void,
      onExtraction: (progress: {percentage: number}) => void,
    ) => Promise<void>,
  ): Promise<void> {
    console.log(`OFFLINE_MODELS: downloading ${kind} model: ${code}`)
    this.setStatus({kind, languageCode: code, stage: "downloading", percent: 0})
    try {
      await download(
        (p) => {
          this.setStatus({kind, languageCode: code, stage: "downloading", percent: p.percentage})
          onProgress?.(p.percentage)
        },
        (p) => this.setStatus({kind, languageCode: code, stage: "extracting", percent: p.percentage}),
      )
      this.setStatus({kind, languageCode: code, stage: "complete", percent: 100})
      console.log(`OFFLINE_MODELS: ${kind} model downloaded: ${code}`)
    } catch (error) {
      this.setStatus({kind, languageCode: code, stage: "failed", percent: 0})
      throw error
    }
  }

  private async ensureSttModelInner(): Promise<void> {
    const preferred = await STTModelManager.getCurrentLanguageFromPreferences()
    const replacement = preferred ? STTModelManager.getLegacyReplacement(preferred) : undefined
    if (replacement) {
      await this.replaceLegacySttModel(preferred, replacement)
      return
    }
    const code = preferred || STTModelManager.getCurrentLanguage()

    if (await STTModelManager.isModelAvailable(code)) {
      await STTModelManager.activateLanguage(code)
      console.log(`OFFLINE_MODELS: STT model ready: ${code}`)
      return
    }

    await this.downloadSttModel(code)
    // The user can pick another language on the Speech page while this downloads.
    if (STTModelManager.getCurrentLanguage() === code) await STTModelManager.activateLanguage(code)
  }

  /**
   * A saved model that is no longer listed (the old English Zipformer) keeps
   * running while its replacement downloads; then the replacement becomes the
   * saved model and the old folder is deleted. A failed download leaves the old
   * model in place and runs again next launch. If the user picked another model
   * during the download, that choice stands and only the old folder is removed.
   */
  private async replaceLegacySttModel(legacy: string, replacement: string): Promise<void> {
    console.log(`OFFLINE_MODELS: replacing saved STT model ${legacy} with ${replacement}`)
    await this.downloadSttModel(replacement)
    if (STTModelManager.getCurrentLanguage() === legacy) await STTModelManager.activateLanguage(replacement)
    await STTModelManager.deleteModel(legacy)
    console.log(`OFFLINE_MODELS: STT model ${legacy} replaced by ${replacement}`)
  }
}

const offlineSpeechModelService = OfflineSpeechModelService.getInstance()
export {OfflineSpeechModelService}
export default offlineSpeechModelService
