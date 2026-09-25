// Provider catalog for the scribe (the LLM that proposes candidate answers).
//
// Each provider speaks one of three protocols: `openai` (Chat Completions, the one almost everybody
// imitates), `anthropic` (official SDK) or `gemini` (native generateContent).
//
// `body` is always sent; `tuning` holds the settings meant for `defaultModel` (reasoning level and, on
// Anthropic, server-side fallbacks), and it only applies to that model: another model from the same provider
// may reject them. LLM_EXTRA_BODY is there to tune a different model.
//
// Models and parameters checked against each provider's official docs in September 2026.

import packageJson from "../../package.json" with { type: "json" };
import { CANDIDATES_SCHEMA } from "./prompt.js";

/** Generous: on reasoning models, the thinking also counts against the limit. */
const MAX_TOKENS = 4096;
const JSON_OBJECT = { type: "json_object" };
const JSON_SCHEMA = {
  type: "json_schema",
  json_schema: { name: "candidates", strict: true, schema: CANDIDATES_SCHEMA },
};

/**
 * @typedef {object} Provider
 * @property {string} label
 * @property {"openai" | "anthropic" | "gemini"} protocol
 * @property {string} [baseURL]
 * @property {string[]} keyEnv environment variables searched for the API key (besides LLM_API_KEY)
 * @property {boolean} requiresKey
 * @property {string} [defaultModel]
 * @property {object} [body] parameters always sent
 * @property {object} [tuning] extra parameters for `defaultModel` only
 * @property {(context: { session: string }) => Record<string, string>} [headers]
 * @property {string} [keysURL] where to get the API key (for the error message when it's missing)
 */

/** @type {Record<string, Provider>} */
export const PROVIDERS = {
  "opencode-go": {
    label: "OpenCode Go",
    protocol: "openai",
    baseURL: "https://opencode.ai/zen/go/v1",
    keyEnv: ["OPENCODE_API_KEY"],
    requiresKey: true,
    defaultModel: "deepseek-v4.1-flash",
    body: { max_tokens: MAX_TOKENS },
    // With reasoning on it takes three times as long and the candidates come out the same
    tuning: { thinking: { type: "disabled" } },
    // Go routes by session: without this header it answers 400 MissingSessionID
    headers: ({ session }) => ({ "x-opencode-session": session }),
    keysURL: "https://opencode.ai/auth",
  },
  "opencode-zen": {
    label: "OpenCode Zen",
    protocol: "openai",
    baseURL: "https://opencode.ai/zen/v1",
    keyEnv: ["OPENCODE_API_KEY"],
    requiresKey: true,
    defaultModel: "deepseek-v4.1-flash",
    body: { max_tokens: MAX_TOKENS },
    tuning: { thinking: { type: "disabled" } },
    keysURL: "https://opencode.ai/auth",
  },
  openai: {
    label: "OpenAI",
    protocol: "openai",
    baseURL: "https://api.openai.com/v1",
    keyEnv: ["OPENAI_API_KEY"],
    requiresKey: true,
    defaultModel: "gpt-6-luna",
    body: { max_completion_tokens: MAX_TOKENS, response_format: JSON_SCHEMA },
    tuning: { reasoning_effort: "none" },
    keysURL: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic",
    protocol: "anthropic",
    // No baseURL: the SDK picks it (ANTHROPIC_BASE_URL or the one in your `ant` profile)
    keyEnv: ["ANTHROPIC_API_KEY"],
    // The SDK can also use ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile
    requiresKey: false,
    defaultModel: "claude-opus-5",
    body: {
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: "json_schema", schema: CANDIDATES_SCHEMA } },
    },
    tuning: {
      output_config: { effort: "low" },
      // Opus 5 can decline a request because of its safety classifiers; with `fallbacks` the API retries it
      // on the model Anthropic recommends for that case
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    },
  },
  gemini: {
    label: "Google Gemini",
    protocol: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    requiresKey: true,
    defaultModel: "gemini-3.5-flash-lite",
    body: { generationConfig: { responseMimeType: "application/json", maxOutputTokens: MAX_TOKENS } },
    tuning: { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } },
    keysURL: "https://aistudio.google.com/apikey",
  },
  openrouter: {
    label: "OpenRouter",
    protocol: "openai",
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: ["OPENROUTER_API_KEY"],
    requiresKey: true,
    defaultModel: "openai/gpt-6-luna",
    body: { max_tokens: MAX_TOKENS, response_format: JSON_OBJECT },
    tuning: { reasoning: { effort: "none" } },
    // App attribution on OpenRouter
    headers: () => ({ "HTTP-Referer": packageJson.homepage, "X-OpenRouter-Title": "Ouijev" }),
    keysURL: "https://openrouter.ai/settings/keys",
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    baseURL: "https://api.deepseek.com",
    keyEnv: ["DEEPSEEK_API_KEY"],
    requiresKey: true,
    defaultModel: "deepseek-flash",
    body: { max_tokens: MAX_TOKENS, response_format: JSON_OBJECT },
    tuning: { thinking: { type: "disabled" } },
    keysURL: "https://platform.deepseek.com/api_keys",
  },
  groq: {
    label: "Groq",
    protocol: "openai",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: ["GROQ_API_KEY"],
    requiresKey: true,
    defaultModel: "openai/gpt-oss-20b",
    body: { max_tokens: MAX_TOKENS, response_format: JSON_OBJECT },
    // gpt-oss always reasons: keep it to the minimum and don't return the reasoning
    tuning: { reasoning_effort: "low", include_reasoning: false },
    keysURL: "https://console.groq.com/keys",
  },
  mistral: {
    label: "Mistral",
    protocol: "openai",
    baseURL: "https://api.mistral.ai/v1",
    keyEnv: ["MISTRAL_API_KEY"],
    requiresKey: true,
    defaultModel: "mistral-small-latest",
    body: { max_tokens: MAX_TOKENS, response_format: JSON_OBJECT },
    tuning: { reasoning_effort: "none" },
    keysURL: "https://console.mistral.ai/api-keys",
  },
  ollama: {
    label: "Ollama",
    protocol: "openai",
    baseURL: "http://localhost:11434/v1",
    keyEnv: [],
    requiresKey: false,
    defaultModel: "llama3.2:3b",
    body: { max_tokens: MAX_TOKENS, response_format: JSON_OBJECT },
  },
  lmstudio: {
    label: "LM Studio",
    protocol: "openai",
    baseURL: "http://localhost:1234/v1",
    keyEnv: ["LM_API_TOKEN"],
    requiresKey: false,
    // No default model: it's whichever one you have loaded (LLM_MODEL)
    // LM Studio rejects `json_object`; `json_schema` works
    body: { max_tokens: MAX_TOKENS, response_format: JSON_SCHEMA },
  },
  custom: {
    label: "OpenAI-compatible",
    protocol: "openai",
    // LLM_BASE_URL and LLM_MODEL are required
    keyEnv: [],
    requiresKey: false,
    body: { max_tokens: MAX_TOKENS },
  },
};

for (const provider of Object.values(PROVIDERS)) Object.freeze(provider);
Object.freeze(PROVIDERS);

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));
