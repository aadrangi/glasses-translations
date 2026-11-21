export class MiniappConfigurationError extends Error {
    constructor(key) {
        super(`Required miniapp configuration is missing: ${key}`);
        this.key = key;
        this.name = "MiniappConfigurationError";
    }
}
/** Read-only package configuration supplied by the Mentra App host. */
export class ConfigurationModule {
    constructor(session) {
        this.session = session;
    }
    /** Return one configured value, or undefined when the host supplied no override. */
    async get(key) {
        await this.session.waitForReady();
        const configuration = this.session._getConfiguration();
        return Object.prototype.hasOwnProperty.call(configuration, key) ? configuration[key] : undefined;
    }
    /** Return one configured value or reject with a typed error when it is absent. */
    async require(key) {
        const value = await this.get(key);
        if (value === undefined)
            throw new MiniappConfigurationError(key);
        return value;
    }
    /** Return a defensive snapshot of every value supplied to this package. */
    async getAll() {
        await this.session.waitForReady();
        return Object.assign(Object.create(null), this.session._getConfiguration());
    }
}
//# sourceMappingURL=configuration.js.map