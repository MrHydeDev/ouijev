// Configuration from environment variables (and from the .env file, if there is one).
import { isIP } from "node:net";

import { LOG_LEVELS } from "./log.js";
import { SEANCE_TIMEOUT_MS } from "./medium/medium.js";
import { PROVIDER_IDS, PROVIDERS } from "./scribe/providers.js";

/** Configuration error with a message meant for whoever starts the server. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * @typedef {object} ScribeConfig
 * @property {import("./scribe/providers.js").Provider} provider
 * @property {string} [apiKey]
 * @property {string} model
 * @property {string} [baseURL]
 * @property {object} [extraBody]
 * @property {number} timeoutMs
 */

/**
 * @typedef {object} Config
 * @property {string} host
 * @property {number} port
 * @property {import("./log.js").LogLevel} logLevel
 * @property {{ apiKey: string } | null} jev `null` = demo mode
 * @property {ScribeConfig | null} scribe `null` = Jev answers on its own, from its phrasebooks and word lists
 */

/** Loads a `.env` file into `process.env` if it exists (without overwriting what's already set). */
export function loadEnvFile(path) {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if (err.code !== "ENOENT") throw new ConfigError(`Could not read ${path}: ${err.message}`);
  }
}

const value = (raw) => {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
};

function integer(name, raw, fallback, { min, max }) {
  if (value(raw) === undefined) return fallback;
  // Digits only: Number() would also accept "0x10" or "1e3"
  const n = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max} (got "${raw}").`);
  }
  return n;
}

function url(name, raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return raw;
  } catch {
    throw new ConfigError(`${name} is not a valid http(s) URL: "${raw}".`);
  }
}

function json(name, raw) {
  if (value(raw) === undefined) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${name} is not valid JSON.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(`${name} must be a JSON object.`);
  }
  return parsed;
}

/** @returns {ScribeConfig | null} */
function readScribe(env) {
  const id = value(env.LLM_PROVIDER)?.toLowerCase();
  if (!id || id === "none") return null;

  const provider = Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : undefined;
  if (!provider) {
    throw new ConfigError(`LLM_PROVIDER="${id}" does not exist. Options: ${PROVIDER_IDS.join(", ")} or none.`);
  }

  const keyNames = ["LLM_API_KEY", ...provider.keyEnv];
  const apiKey = keyNames.map((name) => value(env[name])).find(Boolean);
  if (provider.requiresKey && !apiKey) {
    throw new ConfigError(
      `Missing API key for ${provider.label}: set ${keyNames.join(" or ")} (get one at ${provider.keysURL}).`,
    );
  }

  const model = value(env.LLM_MODEL) ?? provider.defaultModel;
  if (!model) throw new ConfigError(`${provider.label} has no default model: set LLM_MODEL.`);

  const baseURL = value(env.LLM_BASE_URL) ?? provider.baseURL;
  // The Anthropic SDK finds its own (and pinning one would override ANTHROPIC_BASE_URL or the `ant` profile's)
  if (!baseURL && provider.protocol !== "anthropic") throw new ConfigError(`${provider.label} needs LLM_BASE_URL.`);

  return {
    provider,
    apiKey,
    model,
    baseURL: baseURL && url("LLM_BASE_URL", baseURL),
    extraBody: json("LLM_EXTRA_BODY", env.LLM_EXTRA_BODY),
    // At most half the seance's time: if the scribe times out, Jev still has time to answer on its own
    timeoutMs: integer("LLM_TIMEOUT_MS", env.LLM_TIMEOUT_MS, 20_000, { min: 1000, max: SEANCE_TIMEOUT_MS / 2 }),
  };
}

/**
 * For the entry points (the server, the eval): the configuration, with `envFile` loaded first. If it isn't valid,
 * it says why on stderr and exits.
 *
 * @param {string} envFile
 * @returns {Config}
 */
export function readConfigOrExit(envFile) {
  try {
    loadEnvFile(envFile);
    return readConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
}

/**
 * Reads and validates the configuration.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Config}
 * @throws {ConfigError}
 */
export function readConfig(env = process.env) {
  const logLevel = value(env.LOG_LEVEL)?.toLowerCase() ?? "info";
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")} (got "${logLevel}").`);
  }

  // Lowercase, so LOCALHOST counts as loopback too; isIP is for IPv6, whose colons would otherwise pass for a port
  const host = value(env.HOST)?.toLowerCase() ?? "127.0.0.1";
  if (!isIP(host) && !/^[a-z0-9.-]+$/.test(host)) {
    throw new ConfigError(`HOST must be a hostname or IP address, without scheme, port or brackets (got "${host}").`);
  }

  const jevKey = value(env.TYPESAFE_API_KEY);
  return Object.freeze({
    host,
    port: integer("PORT", env.PORT, 3666, { min: 0, max: 65_535 }),
    logLevel,
    // The TypeSafe SDK reads the model itself: TYPESAFE_DEFAULT_MODEL, or jev-latest
    jev: jevKey ? { apiKey: jevKey } : null,
    // In demo mode there's nobody to propose candidates to: the scribe isn't even set up (or validated)
    scribe: jevKey ? readScribe(env) : null,
  });
}
