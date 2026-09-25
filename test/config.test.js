import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ConfigError, loadEnvFile, readConfig } from "../src/config.js";
import { PROVIDERS } from "../src/scribe/providers.js";

/** With Jev's API key: otherwise the scribe isn't even set up. */
const live = (env) => readConfig({ TYPESAFE_API_KEY: "k", ...env });

test("with nothing configured: demo mode on localhost:3666", () => {
  const config = readConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3666);
  assert.equal(config.jev, null);
  assert.equal(config.scribe, null);
});

test("in demo mode the scribe is ignored, even if it's half-configured", () => {
  assert.equal(readConfig({ LLM_PROVIDER: "groq" }).scribe, null);
});

test("with the TypeSafe API key, Jev is summoned", () => {
  assert.deepEqual(readConfig({ TYPESAFE_API_KEY: " k " }).jev, { apiKey: "k" });
});

test("the scribe picks up the provider's conventional API key and its default model", () => {
  const { scribe } = live({ LLM_PROVIDER: "OpenAI", OPENAI_API_KEY: "sk-test" });
  assert.equal(scribe.provider, PROVIDERS.openai);
  assert.equal(scribe.apiKey, "sk-test");
  assert.equal(scribe.model, "gpt-6-luna");
  assert.equal(scribe.timeoutMs, 20_000);
});

test("LLM_API_KEY, LLM_MODEL, LLM_BASE_URL and LLM_EXTRA_BODY override the defaults", () => {
  const { scribe } = live({
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "from-env",
    LLM_API_KEY: "explicit",
    LLM_MODEL: "google/gemini-3.5-flash-lite",
    LLM_BASE_URL: "https://proxy.example/v1",
    LLM_EXTRA_BODY: '{"temperature": 0.2}',
  });
  assert.equal(scribe.apiKey, "explicit");
  assert.equal(scribe.model, "google/gemini-3.5-flash-lite");
  assert.equal(scribe.baseURL, "https://proxy.example/v1");
  assert.deepEqual(scribe.extraBody, { temperature: 0.2 });
});

test("HOST, PORT and LLM_TIMEOUT_MS override the defaults", () => {
  const config = readConfig({ HOST: "0.0.0.0", PORT: "8080" });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.equal(readConfig({ HOST: "::1" }).host, "::1");
  assert.equal(readConfig({ HOST: "LocalHost" }).host, "localhost");
  assert.equal(live({ LLM_PROVIDER: "ollama", LLM_TIMEOUT_MS: "30000" }).scribe.timeoutMs, 30_000);
});

test("local providers don't need an API key, nor Anthropic a base URL (its SDK finds its own)", () => {
  assert.equal(live({ LLM_PROVIDER: "ollama" }).scribe.apiKey, undefined);
  assert.equal(live({ LLM_PROVIDER: "anthropic" }).scribe.baseURL, undefined);
  assert.equal(live({ LLM_PROVIDER: "none" }).scribe, null);
});

test("configuration errors come with messages that say what to do", () => {
  const fails = (env, pattern) =>
    assert.throws(
      () => live(env),
      (err) => err instanceof ConfigError && pattern.test(err.message),
      JSON.stringify(env),
    );
  fails({ LLM_PROVIDER: "ouija-ai" }, /does not exist\. Options: opencode-go, .*none/);
  // Names inherited from Object are not providers
  fails({ LLM_PROVIDER: "constructor" }, /does not exist/);
  fails({ LLM_PROVIDER: "__proto__" }, /does not exist/);
  fails({ LLM_PROVIDER: "groq" }, /LLM_API_KEY or GROQ_API_KEY .*console\.groq\.com/);
  fails({ LLM_PROVIDER: "lmstudio" }, /LLM_MODEL/);
  fails({ LLM_PROVIDER: "custom", LLM_MODEL: "m" }, /LLM_BASE_URL/);
  fails({ LLM_PROVIDER: "custom", LLM_MODEL: "m", LLM_BASE_URL: "ftp://x" }, /is not a valid http\(s\)/);
  fails({ LLM_PROVIDER: "ollama", LLM_EXTRA_BODY: "[1]" }, /must be a JSON object/);
  fails({ LLM_PROVIDER: "ollama", LLM_EXTRA_BODY: "{" }, /LLM_EXTRA_BODY is not valid JSON/);
  fails({ LLM_PROVIDER: "ollama", LLM_TIMEOUT_MS: "5" }, /LLM_TIMEOUT_MS must be an integer between 1000/);
  // Any longer and Jev wouldn't have time to answer on its own before the seance times out
  fails({ LLM_PROVIDER: "ollama", LLM_TIMEOUT_MS: "30001" }, /between 1000 and 30000/);
  fails({ PORT: "ninety" }, /PORT must be an integer/);
  fails({ PORT: "0x10" }, /PORT must be an integer/);
  fails({ PORT: "1e3" }, /PORT must be an integer/);
  fails({ PORT: "70000" }, /PORT must be an integer between 0 and 65535/);
  fails({ HOST: "http://localhost" }, /HOST must be a hostname or IP address, without scheme, port/);
  fails({ HOST: "127.0.0.1:8080" }, /HOST must be/);
  fails({ HOST: "[::1]" }, /HOST must be/);
  fails({ LOG_LEVEL: "chatty" }, /LOG_LEVEL must be one of: error, warn, info, debug \(got "chatty"\)/);
});

test("loadEnvFile: a missing .env is fine, and an existing one doesn't overwrite what's already set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ouijev-"));
  const file = join(dir, ".env");
  try {
    // Without a .env the server must still start (in demo mode)
    assert.doesNotThrow(() => loadEnvFile(file));
    await writeFile(file, "OUIJEV_TEST_NEW=from-file\nOUIJEV_TEST_SET=from-file\n");
    process.env.OUIJEV_TEST_SET = "already set";
    loadEnvFile(file);
    assert.equal(process.env.OUIJEV_TEST_NEW, "from-file");
    assert.equal(process.env.OUIJEV_TEST_SET, "already set");
    // Unreadable (a directory) is not the same as missing
    assert.throws(() => loadEnvFile(dir), ConfigError);
  } finally {
    delete process.env.OUIJEV_TEST_NEW;
    delete process.env.OUIJEV_TEST_SET;
    await rm(dir, { recursive: true, force: true });
  }
});

test("readConfigOrExit: an invalid configuration exits with what to do, not with a stack trace", () => {
  const script = 'import("./src/config.js").then(({ readConfigOrExit }) => readConfigOrExit("missing.env"))';
  const { status, stderr } = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: "ninety" },
    encoding: "utf8",
  });
  assert.equal(status, 1);
  assert.match(stderr, /^✖ PORT must be an integer/);
});
