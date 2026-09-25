// The browser's API client only needs `fetch` and web streams, so it's tested in Node with a stubbed `fetch`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError, consult, fetchStatus } from "../public/js/api.js";

const QUESTION = "¿Hay alguien?";
const LETTERS = { type: "letters", text: "AÑO" };
const WORD = { type: "word", word: "YES" };
const line = (event) => `${JSON.stringify(event)}\n`;

/** What `assert.rejects` expects of an ApiError with `code` (and, from the server, its `message`). */
const failure = (code, message = code) => ({ name: "ApiError", code, message });

/** Replaces `fetch` for the current test: each call gets the next response, or is rejected with it if it's an error. */
function stubFetch(t, ...responses) {
  return t.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });
}

/** Response whose body arrives one byte at a time, so every event (and the Ñ) is split across chunks. */
function trickle(text) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  return new Response(body);
}

/** Response whose body fails before anything arrives, like a dropped connection. */
const cutOff = () =>
  new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError("terminated")) }));

/** A signal that has already fired, the way AbortSignal.timeout() leaves it. */
const timedOut = () => AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError"));

/** Asks from the Spanish interface through the stubbed `fetch`, collecting the events it delivers in `events`. */
const ask = (events = [], signal) => consult(QUESTION, { lang: "es", onEvent: (event) => events.push(event), signal });

test("posts the question and the interface language to /api/ask as JSON, with the caller's signal", async (t) => {
  const fetch = stubFetch(t, new Response(""));
  const { signal } = new AbortController();
  await ask([], signal);
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, "/api/ask");
  assert.equal(init.method, "POST");
  assert.equal(new Headers(init.headers).get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(init.body), { question: QUESTION, lang: "es" });
  assert.equal(init.signal, signal);
});

test("rebuilds the events however the stream splits them, even in the middle of a character", async (t) => {
  stubFetch(t, trickle(line(LETTERS) + line(WORD)));
  const events = [];
  await ask(events);
  assert.deepEqual(events, [LETTERS, WORD]);
});

test("delivers every event in a chunk, skips blank lines and doesn't need a final newline", async (t) => {
  stubFetch(t, new Response(`${line(WORD)}\n${line(LETTERS)}${JSON.stringify(WORD)}`));
  const events = [];
  await ask(events);
  assert.deepEqual(events, [WORD, LETTERS, WORD]);
});

test("a failure halfway arrives as the last event and rejects with its code, after the earlier events", async (t) => {
  const error = { type: "error", code: "seance_timeout", message: "The spirit is taking too long to answer." };
  stubFetch(t, new Response(line(LETTERS) + line(error)));
  const events = [];
  await assert.rejects(ask(events), failure(error.code, error.message));
  assert.deepEqual(events, [LETTERS]);
});

test("an error response rejects with the code in its body, even one the page doesn't know yet", async (t) => {
  stubFetch(
    t,
    Response.json({ error: { code: "too_many_seances", message: "Too many seances are open." } }, { status: 429 }),
    Response.json({ error: { code: "from_the_future", message: "Something new." } }, { status: 400 }),
  );
  await assert.rejects(ask(), failure("too_many_seances", "Too many seances are open."));
  await assert.rejects(ask(), failure("from_the_future", "Something new."));
});

test("an error response without a code rejects as garbled", async (t) => {
  stubFetch(
    t,
    new Response("<h1>Bad Gateway</h1>", { status: 502 }),
    Response.json({ error: "Hay demasiadas sesiones abiertas." }, { status: 429 }),
  );
  await assert.rejects(ask(), failure("garbled"));
  await assert.rejects(ask(), failure("garbled"));
});

test("a line that isn't JSON rejects as garbled", async (t) => {
  stubFetch(t, new Response(`${line(WORD)}<html>\n`));
  await assert.rejects(ask(), failure("garbled"));
});

test("so does a line of JSON that isn't an event", async (t) => {
  for (const body of ["null\n", "42\n", '{"text": "LUZ"}\n']) {
    stubFetch(t, new Response(body));
    await assert.rejects(ask(), failure("garbled"), body);
  }
});

test("a request that doesn't get through rejects as offline, or as too slow if it timed out", async (t) => {
  stubFetch(t, new TypeError("fetch failed"), new TypeError("fetch failed"));
  await assert.rejects(ask(), failure("offline"));
  await assert.rejects(ask([], timedOut()), failure("too_slow"));
});

test("a connection cut while reading rejects as disconnected, or as too slow if it timed out", async (t) => {
  stubFetch(t, cutOff(), cutOff());
  await assert.rejects(ask(), failure("disconnected"));
  await assert.rejects(ask([], timedOut()), failure("too_slow"));
});

test("the failures the client detects itself are ApiErrors that keep what caused them", async (t) => {
  const cause = new TypeError("fetch failed");
  stubFetch(t, cause);
  await assert.rejects(ask(), (err) => err instanceof ApiError && err.cause === cause);
});

test("fetchStatus returns the server's mode, or rejects with an ApiError", async (t) => {
  const fetch = stubFetch(
    t,
    Response.json({ mode: "demo" }),
    Response.json({ error: { code: "internal", message: "Internal error." } }, { status: 500 }),
    new Response("<html>"),
    new TypeError("fetch failed"),
  );
  assert.deepEqual(await fetchStatus(), { mode: "demo" });
  assert.equal(fetch.mock.calls[0].arguments[0], "/api/status");
  await assert.rejects(fetchStatus(), failure("internal", "Internal error."));
  await assert.rejects(fetchStatus(), failure("garbled"));
  await assert.rejects(fetchStatus(), failure("offline"));
});
