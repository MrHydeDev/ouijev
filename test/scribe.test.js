import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import packageJson from "../package.json" with { type: "json" };

import { deepMerge } from "../src/scribe/deep-merge.js";
import { scribeMessage } from "../src/scribe/prompt.js";
import { PROVIDERS } from "../src/scribe/providers.js";
import { createScribe } from "../src/scribe/scribe.js";
import { fakeFetch, hangUntilAborted } from "./helpers.js";

const CANDIDATES = '{"candidates": ["Azul", "gris"], "unknown": "No lo sé"}';
const PROPOSAL = { candidates: ["AZUL", "GRIS"], unknown: "NO LO SE" };
const openAIReply = (content = CANDIDATES) => ({ json: { choices: [{ message: { role: "assistant", content } }] } });

const scribeFor = (id, overrides = {}, fetch) =>
  createScribe(
    {
      provider: PROVIDERS[id],
      apiKey: "test-key",
      model: PROVIDERS[id].defaultModel,
      baseURL: PROVIDERS[id].baseURL,
      timeoutMs: 5000,
      ...overrides,
    },
    { fetch },
  );

test("every provider in the catalog is complete", () => {
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    assert.ok(["openai", "anthropic", "gemini"].includes(provider.protocol), id);
    assert.ok(provider.label, id);
    if (provider.requiresKey) assert.ok(provider.keysURL, `${id}: requires a key but doesn't say where to get one`);
    if (provider.protocol !== "anthropic" && id !== "custom") assert.ok(provider.baseURL, id);
    if (provider.tuning) assert.ok(provider.defaultModel, `${id}: has tuning but no default model`);
  }
});

test("OpenAI-compatible: URL, headers, messages and the default model's tuning", async () => {
  const { fetch, calls } = fakeFetch(() => openAIReply());
  const scribe = scribeFor("opencode-go", {}, fetch);
  assert.deepEqual(await scribe.propose("¿De qué color es el cielo?"), PROPOSAL);

  const [call] = calls;
  assert.equal(call.url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(call.headers.get("authorization"), "Bearer test-key");
  assert.equal(call.headers.get("user-agent"), `ouijev/${packageJson.version} (+${packageJson.homepage})`);
  assert.ok(call.headers.get("x-opencode-session"));
  assert.equal(call.body.model, "deepseek-v4.1-flash");
  assert.deepEqual(call.body.thinking, { type: "disabled" });
  assert.deepEqual(
    call.body.messages.map((m) => m.role),
    ["system", "user"],
  );
  assert.equal(call.body.messages[1].content, scribeMessage("¿De qué color es el cielo?"));
});

test("with another model the default model's tuning isn't applied, but LLM_EXTRA_BODY is", async () => {
  const { fetch, calls } = fakeFetch(() => openAIReply());
  await scribeFor("openai", { model: "other-model", extraBody: { temperature: 0.5 } }, fetch).propose("?");
  assert.equal(calls[0].body.reasoning_effort, undefined);
  assert.equal(calls[0].body.temperature, 0.5);
  assert.equal(calls[0].body.response_format.type, "json_schema");
});

test("without an API key no Authorization header is sent (Ollama, LM Studio)", async () => {
  const { fetch, calls } = fakeFetch(() => openAIReply());
  await scribeFor("ollama", { apiKey: undefined }, fetch).propose("?");
  assert.equal(calls[0].headers.get("authorization"), null);
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
});

test("accepts chunked content (Mistral with reasoning)", async () => {
  const content = [
    { type: "thinking", thinking: [] },
    { type: "text", text: CANDIDATES },
  ];
  const { fetch } = fakeFetch(() => openAIReply(content));
  assert.deepEqual(await scribeFor("mistral", {}, fetch).propose("?"), PROPOSAL);
});

test("an HTTP error becomes an error with the status and a snippet of the response", async () => {
  const { fetch } = fakeFetch(() => ({ status: 401, json: { error: "invalid key" } }));
  await assert.rejects(scribeFor("deepseek", {}, fetch).propose("?"), /DeepSeek answered 401: .*invalid key/);
});

test("a 200 that isn't JSON (a proxy's HTML page, say) says which provider sent it", async () => {
  const fetch = async () => new Response("<html>Bad gateway</html>", { status: 200 });
  await assert.rejects(scribeFor("groq", {}, fetch).propose("?"), /Groq answered something that isn't JSON/);
});

test("Gemini: generateContent with a system instruction, JSON and minimal reasoning", async () => {
  const { fetch, calls } = fakeFetch(() => ({
    json: { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: CANDIDATES }] } }] },
  }));
  assert.deepEqual(await scribeFor("gemini", {}, fetch).propose("?"), PROPOSAL);
  const [call] = calls;
  assert.equal(
    call.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
  );
  assert.equal(call.headers.get("x-goog-api-key"), "test-key");
  assert.match(call.body.systemInstruction.parts[0].text, /answers of a Ouija board/);
  assert.deepEqual(call.body.generationConfig, {
    responseMimeType: "application/json",
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingLevel: "minimal" },
  });
});

const claudeMessage = (overrides = {}) => ({
  json: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: CANDIDATES }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...overrides,
  },
});

test("Anthropic: official SDK with structured output, low effort and fallbacks on Opus 5", async () => {
  const { fetch, calls } = fakeFetch(() => claudeMessage());
  assert.deepEqual(await scribeFor("anthropic", {}, fetch).propose("?"), PROPOSAL);
  const [call] = calls;
  assert.match(call.url, /\/v1\/messages/);
  assert.equal(call.headers.get("x-api-key"), "test-key");
  assert.match(call.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  assert.equal(call.body.fallbacks, "default");
  assert.equal(call.body.output_config.effort, "low");
  assert.equal(call.body.output_config.format.type, "json_schema");
});

test("Anthropic: with another model, structured output but none of the default model's tuning", async () => {
  const { fetch, calls } = fakeFetch(() => claudeMessage({ model: "claude-haiku-4-5" }));
  await scribeFor("anthropic", { model: "claude-haiku-4-5" }, fetch).propose("?");
  const [call] = calls;
  assert.equal(call.body.max_tokens, 4096);
  assert.deepEqual(Object.keys(call.body.output_config), ["format"]);
  assert.equal(call.body.fallbacks, undefined);
  assert.equal(call.headers.get("anthropic-beta"), null);
});

test("Anthropic: a safety refusal isn't taken as an answer", async () => {
  const { fetch } = fakeFetch(() =>
    claudeMessage({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }),
  );
  await assert.rejects(scribeFor("anthropic", {}, fetch).propose("?"), /declined the request \(cyber\)/);
});

const hangingFetch = (_url, { signal }) => hangUntilAborted(signal);

const PROTOCOL_IDS = ["openai", "anthropic", "gemini"];

/** `promise`, or a rejection if it hasn't settled within a second: a scribe that never gives up fails fast. */
const withinASecond = (promise) =>
  Promise.race([promise, sleep(1000).then(() => Promise.reject(new Error("The scribe never gave up")))]);

test("the scribe gives up when it runs out of time, whatever the protocol, also with the seance's signal", async () => {
  for (const id of PROTOCOL_IDS) {
    const scribe = scribeFor(id, { timeoutMs: 20 }, hangingFetch);
    await assert.rejects(withinASecond(scribe.propose("?")), { name: "TimeoutError" }, id);
    // The medium always passes its own signal, and the time limit has to hold anyway
    const seance = new AbortController();
    try {
      await assert.rejects(withinASecond(scribe.propose("?", { signal: seance.signal })), { name: "TimeoutError" }, id);
    } finally {
      seance.abort();
    }
  }
});

test("canceling the seance cancels the scribe's request, whatever the protocol", async () => {
  for (const id of PROTOCOL_IDS) {
    const abort = new AbortController();
    const pending = scribeFor(id, {}, hangingFetch).propose("?", { signal: abort.signal });
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" }, id);
  }
});

test("time running out while the response arrives is a timeout, not a response that isn't JSON", async () => {
  // Headers first, then a body that never ends: fetch errors it with the signal's reason
  const slowBody = async (_url, { signal }) =>
    new Response(
      new ReadableStream({ start: (body) => signal.addEventListener("abort", () => body.error(signal.reason)) }),
    );
  for (const id of ["openai", "gemini"]) {
    await assert.rejects(scribeFor(id, { timeoutMs: 20 }, slowBody).propose("?"), { name: "TimeoutError" }, id);
  }
});

test("a base URL may end in a slash", async () => {
  const { fetch, calls } = fakeFetch(() => openAIReply());
  await scribeFor("custom", { baseURL: "http://localhost:8080/v1/", model: "any" }, fetch).propose("?");
  assert.equal(calls[0].url, "http://localhost:8080/v1/chat/completions");
});

test("truncated or refused responses, or errors inside a 200, are explained, not taken as answers", async () => {
  const cases = [
    ["openai", { json: { choices: [{ finish_reason: "length", message: { content: "" } }] } }, /token limit/],
    ["openai", { json: { choices: [{ message: { content: null, refusal: "I can't" } }] } }, /declined.*I can't/],
    [
      "deepseek",
      { json: { choices: [{ finish_reason: "content_filter", message: { content: null } }] } },
      /content_filter/,
    ],
    ["openrouter", { json: { error: { message: "provider down" } } }, /returned an error: provider down/],
    ["gemini", { json: { promptFeedback: { blockReason: "SAFETY" } } }, /blocked the question \(SAFETY\)/],
    [
      "gemini",
      { json: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"candidates": ["AZ' }] } }] } },
      /MAX_TOKENS/,
    ],
    ["anthropic", claudeMessage({ content: [], stop_reason: "max_tokens" }), /token limit/],
  ];
  for (const [id, reply, pattern] of cases) {
    const { fetch } = fakeFetch(() => reply);
    await assert.rejects(scribeFor(id, {}, fetch).propose("?"), pattern, id);
  }
});

test("a refusal is cut down to a snippet, like the rest of the provider's text", async () => {
  const refusal = "I can't help with that. ".repeat(100);
  const { fetch } = fakeFetch(() => ({ json: { choices: [{ message: { content: null, refusal } }] } }));
  await assert.rejects(scribeFor("openai", {}, fetch).propose("?"), ({ message }) => message.length < 400);
});

test("deepMerge merges nested objects, replaces arrays and plain values, and null deletes at any depth", () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] }, d: 1 }, undefined, { a: { c: [2], e: 3 }, d: 2 }), {
    a: { b: 1, c: [2], e: 3 },
    d: 2,
  });
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, d: 1 }, { a: { b: null }, d: null }), { a: { c: 2 } });
  assert.deepEqual(deepMerge({ a: "x" }, { a: { b: null }, c: { d: null, e: 1 } }), { a: {}, c: { e: 1 } });
});

test("LLM_EXTRA_BODY can remove a parameter the model doesn't accept", async () => {
  const { fetch, calls } = fakeFetch(() => openAIReply());
  await scribeFor("openai", { extraBody: { response_format: null } }, fetch).propose("?");
  assert.equal("response_format" in calls[0].body, false);
});
