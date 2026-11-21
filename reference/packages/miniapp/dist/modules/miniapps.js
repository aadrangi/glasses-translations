/**
 * @fileoverview MiniappsModule — `session.miniapps`.
 *
 * Discover and control the lifecycle of OTHER miniapps: list, start, open,
 * stop. SYSTEM-only — every call rejects with NOT_PERMITTED unless the caller
 * is a system app (Mentra AI is the first consumer). The action *capability*
 * layer (invoke / handle) lives on `session.actions`, not here — these are
 * operations on the app as a whole, not on a declared action.
 *
 * Installing (`install`, `checkInstallCompatibility`, `uninstall`) is
 * narrower still: only a miniapp on the Mentra App's system list, running the
 * release the Mentra App installed for it, may install miniapps. Development
 * builds, which may use the calls above, may not. The host installs from a
 * miniapp URL through the same installer as every other way in, with no install
 * sheet: the caller asks the person first.
 */
import { MiniappRequestType } from "../protocol";
export class MiniappsModule {
    constructor(session) {
        this.session = session;
    }
    /**
     * List installed miniapps. Compatible-only by default; pass
     * `{includeIncompatible: true}` to include the rest (each carries a
     * `compatibility` result with the missing hardware). SYSTEM-only.
     */
    async list(opts) {
        const result = await this.session.sendRequest({
            type: MiniappRequestType.MINIAPPS_LIST,
            includeIncompatible: opts?.includeIncompatible ?? false,
        });
        return result ?? [];
    }
    /**
     * Start another miniapp in the **background** — spawns its background JS
     * context without changing the user's phone navigation or foregrounding
     * anything. The app reports as running and can handle actions / drive the
     * glasses immediately; its WebView only mounts if the user later opens it.
     * SYSTEM-only.
     */
    async start(packageName) {
        await this.session.sendRequest({
            type: MiniappRequestType.MINIAPPS_START,
            packageName,
        });
    }
    /** Start another miniapp and foreground its phone UI. SYSTEM-only. */
    async open(packageName) {
        await this.session.sendRequest({
            type: MiniappRequestType.MINIAPPS_START,
            packageName,
            foreground: true,
        });
    }
    /** Stop another miniapp. SYSTEM-only. */
    async stop(packageName) {
        await this.session.sendRequest({
            type: MiniappRequestType.MINIAPPS_STOP,
            packageName,
        });
    }
    /**
     * Install the miniapp at a miniapp URL, with no install sheet: ask the person first. The host fetches its
     * `miniapp.json`, checks the package name against the URL's domain, registers the URL with Mentra, checks the
     * phone can run it, and downloads, verifies and installs its bundle.
     *
     * Only a miniapp on the Mentra App's system list may install; any other caller gets NOT_PERMITTED. A failed
     * install rejects with INSTALL_FAILED, whose `reason` is an {@link InstallMiniappFailureReason}.
     */
    async install(request) {
        return this.session.sendRequest({
            type: MiniappRequestType.MINIAPPS_INSTALL,
            url: request.url,
            ...(request.packageName !== undefined ? { packageName: request.packageName } : {}),
        }, 
        // Fetching, registering, downloading and installing can legitimately outlast the SDK's default request
        // timeout. The request still settles on the host response or session disconnect.
        { timeoutMs: 0 });
    }
    /** Check a release's Mentra App, SDK and glasses requirements against this phone. System-list miniapps only. */
    async checkInstallCompatibility(request) {
        return this.session.sendRequest({
            type: MiniappRequestType.MINIAPPS_INSTALL_CHECK,
            minHostVersion: request.minHostVersion ?? undefined,
            sdkVersion: request.sdkVersion ?? undefined,
            hardwareRequirements: request.hardwareRequirements ?? [],
        });
    }
    /**
     * Uninstall a miniapp installed from a miniapp URL. A miniapp the Mentra App bundles, one a workspace manages and a
     * development build stay, with NOT_PERMITTED. System-list miniapps only.
     */
    async uninstall(packageName) {
        await this.session.sendRequest({
            type: MiniappRequestType.MINIAPPS_UNINSTALL,
            packageName,
        });
    }
}
//# sourceMappingURL=miniapps.js.map