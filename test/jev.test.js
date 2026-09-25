import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  noul,
  PermissionDeniedError,
  RateLimitError,
} from "@typesafe-ai/sdk";

import { silentLogger } from "../src/log.js";
import { SeanceError } from "../src/medium/errors.js";
import { createJev, fromJevError } from "../src/medium/jev.js";

test("every TypeSafe SDK error becomes a SeanceError with a stable code, keeping the original as its cause", () => {
  const headers = new Headers();
  const cases = [
    [new AuthenticationError(401, {}, headers), "jev_auth", 502],
    [new PermissionDeniedError(403, {}, headers), "jev_auth", 502],
    [new RateLimitError(429, {}, headers), "jev_rate_limited", 429],
    [new APIError(503, {}, headers), "jev_error", 502],
    [new APITimeoutError(10_000), "jev_timeout", 504],
    [new APIConnectionError("ECONNREFUSED"), "jev_unreachable", 504],
  ];
  for (const [err, code, status] of cases) {
    const seanceError = fromJevError(err);
    assert.ok(seanceError instanceof SeanceError, err.constructor.name);
    assert.equal(seanceError.code, code, err.constructor.name);
    assert.equal(seanceError.status, status, err.constructor.name);
    assert.doesNotMatch(seanceError.message, /ECONNREFUSED/, err.constructor.name);
    assert.equal(seanceError.cause, err);
  }
});

test("anything that isn't an SDK error goes through as it is: an abort, a bug", () => {
  for (const err of [new APIUserAbortError(), new TypeError("undefined is not a function")]) {
    assert.equal(fromJevError(err), err);
  }
});

test("the app's client already rejects with the translated error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"detail": "bad key"}', { status: 401 }));
  const jev = createJev({ apiKey: "not-a-key", log: silentLogger, logLevel: "info" });
  await assert.rejects(jev.systemOne({ state: "?", questions: { hello: noul("Is this a greeting?") } }), (err) => {
    assert.ok(err instanceof SeanceError);
    assert.equal(err.code, "jev_auth");
    assert.ok(err.cause instanceof AuthenticationError);
    return true;
  });
});
