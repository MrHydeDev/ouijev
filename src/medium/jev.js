// Jev, through the TypeSafe SDK: how the app sets up its client, and what its errors mean to the user. The only
// module that knows the SDK's client and error classes; the medium works with anything that has a `systemOne`.
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

import { SeanceError } from "./errors.js";

/** It's an interactive page: better an early error than the planchette wandering for two minutes. */
const RETRY = Object.freeze({ maxRetries: 1, maxRetryAfterMs: 5000 });

// Most specific first: APITimeoutError is an APIConnectionError, and in this SDK APIConnectionError
// does not extend APIError.
const TRANSLATIONS = [
  [AuthenticationError, "jev_auth", 502, () => "Jev's API key is not valid."],
  [PermissionDeniedError, "jev_auth", 502, () => "Jev's API key has no access."],
  [RateLimitError, "jev_rate_limited", 429, () => "Too many summonings. Wait a little."],
  [APIError, "jev_error", 502, (err) => `Jev's API answered ${err.status}.`],
  [APITimeoutError, "jev_timeout", 504, () => "Jev takes too long to answer."],
  [APIConnectionError, "jev_unreachable", 504, () => "Could not reach Jev."],
];

/**
 * A TypeSafe SDK error as a SeanceError the user can be told about, without internals; anything else (an
 * abort, a bug) goes through as it is.
 *
 * @param {unknown} err
 */
export function fromJevError(err) {
  const translation = TRANSLATIONS.find(([type]) => err instanceof type);
  if (!translation) return err;
  const [, code, status, message] = translation;
  return new SeanceError(code, message(err), { status, cause: err });
}

/**
 * The client the medium talks to: the SDK's, with the app's retry policy and its errors already translated.
 *
 * @param {{ apiKey: string, log: import("../log.js").Logger, logLevel: string }} options
 * @returns {{ defaultModel: string, systemOne: TypeSafeClient["systemOne"] }}
 */
export function createJev({ apiKey, log, logLevel }) {
  const client = new TypeSafeClient({
    apiKey,
    retry: RETRY,
    logger: log,
    logLevel: logLevel === "debug" ? "debug" : "warn",
  });
  return {
    defaultModel: client.defaultModel,
    systemOne: (request, options) =>
      client.systemOne(request, options).catch((err) => {
        throw fromJevError(err);
      }),
  };
}
