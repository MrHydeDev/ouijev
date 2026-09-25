// Helpers for the protocols that go through `fetch`. Errors carry a snippet of the response for debugging.

const MAX_SNIPPET = 300;
/** A provider's text as it goes in an error message: on one line, and capped. */
export const snippet = (text) => String(text).replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET);

/** @param {Response} res @param {string} label */
export async function ensureOk(res, label) {
  if (res.ok) return;
  const body = snippet(await res.text().catch(() => ""));
  throw new Error(`${label} answered ${res.status}${body ? `: ${body}` : ""}`);
}

/**
 * Reads the JSON of a successful response. Some providers (OpenRouter, for one) return a 200 with
 * `{ "error": ... }` inside when the model behind them fails.
 *
 * @param {Response} res @param {string} label
 */
export async function readJson(res, label) {
  let data;
  try {
    data = await res.json();
  } catch (err) {
    // Time running out (or the seance being canceled) while the body arrives isn't the provider's fault
    if (err?.name === "AbortError" || err?.name === "TimeoutError") throw err;
    throw new Error(`${label} answered something that isn't JSON`, { cause: err });
  }
  if (data?.error) {
    const detail = typeof data.error === "string" ? data.error : (data.error.message ?? JSON.stringify(data.error));
    throw new Error(`${label} returned an error: ${snippet(detail)}`);
  }
  return data;
}

export const joinURL = (base, path) => `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
