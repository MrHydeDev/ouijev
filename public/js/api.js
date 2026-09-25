// Client for the server API. Responses from /api/ask arrive as NDJSON: one event per line.
// Every failure is an ApiError with a code, which the page puts into words in its own language: the server's
// messages are in English, for whoever uses the API directly.

/**
 * @typedef {{ type: "word", word: "YES" | "NO" | "GOODBYE" } | { type: "letters", text: string }} SeanceEvent
 */

/**
 * A failure named by its code, the server's or one the client detects itself: `offline` (the request didn't get
 * through), `disconnected` (the connection was cut while reading), `too_slow` (the caller's timeout) and
 * `garbled` (a response that isn't what the API sends).
 */
export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {{ message?: string, cause?: unknown }} [options] `message` defaults to the code
   */
  constructor(code, { message = code, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.code = code;
  }
}

const isTimeout = (signal) => signal?.aborted && signal.reason?.name === "TimeoutError";

/** The server's `{ code, message }` (an error response's `error`, or an `error` event) as an ApiError. */
const serverError = (error) =>
  typeof error?.code === "string" ? new ApiError(error.code, { message: error.message }) : new ApiError("garbled");

async function responseError(res) {
  const body = await res.json().catch(() => null);
  return serverError(body?.error);
}

function parseEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (err) {
    throw new ApiError("garbled", { cause: err });
  }
  // Valid JSON that isn't an event (null, 42…) isn't anything the server sends either
  if (typeof event?.type !== "string") throw new ApiError("garbled");
  // A failure halfway arrives as a last `error` event: it's thrown like any other failure
  if (event.type === "error") throw serverError(event);
  return event;
}

/**
 * Asks a question and delivers the events as they arrive. If anything fails, even halfway through, it
 * rejects with an ApiError.
 *
 * @param {string} question
 * @param {{ lang: "en" | "es", onEvent: (event: SeanceEvent) => void, signal?: AbortSignal }} options `lang` is
 *   the interface language (in demo mode, the canned answers come in it)
 */
export async function consult(question, { lang, onEvent, signal }) {
  let res;
  try {
    res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, lang }),
      signal,
    });
  } catch (err) {
    throw new ApiError(isTimeout(signal) ? "too_slow" : "offline", { cause: err });
  }
  if (!res.ok) throw await responseError(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw new ApiError(isTimeout(signal) ? "too_slow" : "disconnected", { cause: err });
      }
      if (chunk.done) break;
      buffer += chunk.value;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) onEvent(parseEvent(line));
    }
    if (buffer.trim()) onEvent(parseEvent(buffer));
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** @returns {Promise<{ mode: "live" | "demo" }>} */
export async function fetchStatus() {
  let res;
  try {
    res = await fetch("/api/status");
  } catch (err) {
    throw new ApiError("offline", { cause: err });
  }
  if (!res.ok) throw await responseError(res);
  return res.json().catch((err) => {
    throw new ApiError("garbled", { cause: err });
  });
}
