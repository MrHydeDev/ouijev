/**
 * Claude through the official SDK. The SDK is only loaded when this provider is in use.
 *
 * It always goes through the beta endpoint (the same Messages API, plus `betas`), so the catalog or
 * LLM_EXTRA_BODY can turn beta features on without any code here knowing about them.
 *
 * @param {import("../scribe.js").ProtocolOptions} options
 * @returns {import("../scribe.js").Protocol}
 */
export function createAnthropicProtocol({ label, baseURL, apiKey, model, headers, body, fetch }) {
  // Keep the promise, not the client: two simultaneous questions share the same one
  const client = import("@anthropic-ai/sdk").then(
    // Without an explicit API key, the SDK looks for ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant` profile
    // One attempt, like the other protocols: if it fails, Jev answers on its own
    ({ default: Anthropic }) => new Anthropic({ apiKey, baseURL, fetch, maxRetries: 0, defaultHeaders: headers }),
  );
  // If the SDK fails to load, the error surfaces on each question, not as a stray rejection
  client.catch(() => {});

  return {
    async complete({ system, user, signal }) {
      const anthropic = await client;
      const response = await anthropic.beta.messages
        .create({ model, system, messages: [{ role: "user", content: user }], ...body }, { signal })
        .catch((err) => {
          // The SDK reports every abort as "Request was aborted.": like fetch, reject with the signal's reason
          throw signal.aborted ? signal.reason : err;
        });
      if (response.stop_reason === "refusal") {
        throw new Error(`${label} declined the request (${response.stop_details?.category ?? "no category"})`);
      }
      if (response.stop_reason === "max_tokens") {
        throw new Error(`${label} cut the response off at the token limit`);
      }
      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    },
  };
}
