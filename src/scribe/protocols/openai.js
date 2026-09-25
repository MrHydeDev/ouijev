import { ensureOk, joinURL, readJson, snippet } from "./http.js";

/**
 * OpenAI's Chat Completions, the protocol almost everybody imitates (OpenRouter, DeepSeek, Groq, Mistral,
 * Ollama, LM Studio, OpenCode…).
 *
 * @param {import("../scribe.js").ProtocolOptions} options
 * @returns {import("../scribe.js").Protocol}
 */
export function createOpenAIProtocol({ label, baseURL, apiKey, model, headers, body, fetch }) {
  const url = joinURL(baseURL, "chat/completions");
  return {
    async complete({ system, user, signal }) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
          ...headers,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...body,
        }),
        signal,
      });
      await ensureOk(res, label);
      const choice = (await readJson(res, label)).choices?.[0];
      const message = choice?.message;
      if (message?.refusal) throw new Error(`${label} declined the request: ${snippet(message.refusal)}`);
      if (choice?.finish_reason === "length") {
        throw new Error(`${label} cut the response off at the token limit (is reasoning on?)`);
      }
      if (choice?.finish_reason === "content_filter") {
        throw new Error(`${label} withheld the response (content_filter)`);
      }
      // Some providers (Mistral with reasoning) return the content in chunks
      const content = message?.content ?? "";
      return Array.isArray(content)
        ? content.map((part) => (part?.type === "text" ? part.text : "")).join("")
        : String(content);
    },
  };
}
