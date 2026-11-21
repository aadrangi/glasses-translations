import type { MiniappSession } from "../session";
export declare class MiniappConfigurationError extends Error {
    readonly key: string;
    constructor(key: string);
}
/** Read-only package configuration supplied by the Mentra App host. */
export declare class ConfigurationModule {
    private readonly session;
    constructor(session: MiniappSession);
    /** Return one configured value, or undefined when the host supplied no override. */
    get(key: string): Promise<string | undefined>;
    /** Return one configured value or reject with a typed error when it is absent. */
    require(key: string): Promise<string>;
    /** Return a defensive snapshot of every value supplied to this package. */
    getAll(): Promise<Readonly<Record<string, string>>>;
}
//# sourceMappingURL=configuration.d.ts.map