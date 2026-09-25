// The scribe: an LLM that proposes candidate answers for Jev to choose from.
// Jev can't write, but it can choose; the scribe can write, but it doesn't decide.
import { randomUUID } from "node:crypto";

import packageJson from "../../package.json" with { type: "json" };

import { deepMerge } from "./deep-merge.js";
import { parseProposal, scribeMessage, SYSTEM_PROMPT } from "./prompt.js";
import { createAnthropicProtocol } from "./protocols/anthropic.js";
import { createGeminiProtocol } from "./protocols/gemini.js";
import { createOpenAIProtocol } from "./protocols/openai.js";

/**
 * @typedef {object} ProtocolOptions
 * @property {string} label provider name, for error messages
 * @property {string} [baseURL]
 * @property {string} [apiKey]
 * @property {string} model
 * @property {Record<string, string>} headers
 * @property {object} body extra request parameters
 * @property {typeof fetch} fetch
 */

/** @typedef {{ complete(request: { system: string, user: string, signal: AbortSignal }): Promise<string> }} Protocol */

/**
 * @typedef {object} Scribe
 * @property {string} label provider and model, for logs
 * @property {(question: string, options?: { signal?: AbortSignal }) => Promise<import("./prompt.js").Proposal>} propose
 */

const USER_AGENT = `ouijev/${packageJson.version} (+${packageJson.homepage})`;

const PROTOCOLS = {
  openai: createOpenAIProtocol,
  anthropic: createAnthropicProtocol,
  gemini: createGeminiProtocol,
};

/**
 * @param {import("../config.js").ScribeConfig} config
 * @param {{ fetch?: typeof fetch }} [options]
 * @returns {Scribe}
 */
export function createScribe(
  { provider, apiKey, model, baseURL, extraBody, timeoutMs },
  { fetch = globalThis.fetch } = {},
) {
  // One stable session per start-up: OpenCode Go uses it for routing and caching
  const session = randomUUID();
  const protocol = PROTOCOLS[provider.protocol]({
    label: provider.label,
    baseURL,
    apiKey,
    model,
    headers: { "User-Agent": USER_AGENT, ...provider.headers?.({ session }) },
    body: deepMerge(provider.body, model === provider.defaultModel ? provider.tuning : undefined, extraBody),
    fetch,
  });

  return {
    label: `${provider.label} · ${model}`,
    async propose(question, { signal } = {}) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const text = await protocol.complete({
        system: SYSTEM_PROMPT,
        user: scribeMessage(question),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return parseProposal(text);
    },
  };
}
