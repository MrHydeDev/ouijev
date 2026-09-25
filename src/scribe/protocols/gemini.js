import { ensureOk, joinURL, readJson } from "./http.js";

/**
 * Gemini's native API (`generateContent`).
 *
 * @param {import("../scribe.js").ProtocolOptions} options
 * @returns {import("../scribe.js").Protocol}
 */
export function createGeminiProtocol({ label, baseURL, apiKey, model, headers, body, fetch }) {
  const url = joinURL(baseURL, `models/${encodeURIComponent(model)}:generateContent`);
  return {
    async complete({ system, user, signal }) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, ...headers },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          ...body,
        }),
        signal,
      });
      await ensureOk(res, label);
      const data = await readJson(res, label);
      const blocked = data.promptFeedback?.blockReason;
      if (blocked) throw new Error(`${label} blocked the question (${blocked})`);

      const candidate = data.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== "STOP") {
        throw new Error(`${label} didn't finish the response (${candidate.finishReason})`);
      }
      // Parts with `thought: true` are reasoning, not the answer
      return (candidate?.content?.parts ?? [])
        .filter((part) => !part.thought)
        .map((part) => part.text ?? "")
        .join("");
    },
  };
}
