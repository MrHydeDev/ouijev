import { createServer } from "node:http";
import { BlockList, isIP } from "node:net";

import { silentLogger } from "../log.js";
import { toSeanceError } from "../medium/errors.js";
import { findStaticFile, sendStaticFile } from "./static-files.js";

export const MAX_QUESTION_LENGTH = 300;
const MAX_BODY_BYTES = 4096;
/** Seances at once: plenty for a couple of tabs, and a cap if something starts asking in a loop. */
export const MAX_CONCURRENT_SEANCES = 3;

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const LOOPBACK_IPS = new BlockList();
LOOPBACK_IPS.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_IPS.addAddress("::1", "ipv6");
const SAME_ORIGIN_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * Whether `host` (to listen on, or from a `Host` header) only reaches this machine: localhost, 127.0.0.0/8 or ::1,
 * however written.
 */
export function isLoopback(host) {
  const family = isIP(host);
  return family ? LOOPBACK_IPS.check(host, `ipv${family}`) : host.toLowerCase() === "localhost";
}

/** A request the server turns down: a stable `code` for the page to translate, and an English message. */
class HttpError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status: number, headers?: Record<string, string> }} options
   */
  constructor(code, message, { status, headers = {} }) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

/** Every error the API answers has the same shape: `{ "error": { "code": "...", "message": "..." } }`. */
function sendError(res, { status, code, message, headers }) {
  sendJson(res, status, { error: { code, message } }, headers);
}

function startStream(res) {
  if (!res.headersSent) {
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
  }
}

/**
 * Against DNS rebinding: a site that points its own domain at this machine still arrives with that domain in
 * `Host`, so only requests addressed to localhost or to an IP address are served. When listening on localhost,
 * only those addressed to localhost or a loopback address, on this port.
 */
function isAllowedHost(hostHeader, { loopbackOnly, port }) {
  if (!hostHeader) return false;
  let url;
  try {
    url = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (loopbackOnly) return isLoopback(hostname) && Number(url.port || 80) === port;
  // Beyond localhost the port isn't checked: a container or a router may forward the board from another one
  return hostname === "localhost" || isIP(hostname) !== 0;
}

/**
 * Against CSRF: the API can only be called from the page itself (or from outside a browser, like curl).
 * Otherwise any site you visited could spend your tokens.
 */
function isCrossSite(req) {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && !SAME_ORIGIN_FETCH_SITES.has(fetchSite)) return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

/** Turns the request down with a 405 unless its method is one of `allowed`. */
function requireMethod(req, ...allowed) {
  if (!allowed.includes(req.method)) {
    throw new HttpError("method_not_allowed", "Method not allowed.", {
      status: 405,
      headers: { Allow: allowed.join(", ") },
    });
  }
}

async function readJsonBody(req) {
  // Requiring JSON forces browsers into a CORS preflight that a foreign site cannot pass
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    throw new HttpError("not_json", "The request has to be JSON.", { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      // The rest of the body is left unread, so the connection can't carry another request
      throw new HttpError("question_too_long", "The question is too long.", {
        status: 413,
        headers: { Connection: "close" },
      });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError("bad_request", "The body isn't valid JSON.", { status: 400 });
  }
}

function readQuestion(body) {
  // No control characters: the question ends up printed in the server's terminal
  const raw = typeof body?.question === "string" ? body.question : "";
  const question = raw.replace(/\p{Cc}+/gu, " ").trim();
  if (!question) throw new HttpError("empty_question", "The question is empty.", { status: 400 });
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new HttpError("question_too_long", `The question can't be longer than ${MAX_QUESTION_LENGTH} characters.`, {
      status: 400,
    });
  }
  return question;
}

/** The interface's language, if it looks like a language code (only the demo uses it, and falls back to English). */
const readLanguage = (body) => (typeof body?.lang === "string" && /^[a-z]{2}$/.test(body.lang) ? body.lang : undefined);

/** The browser hung up halfway (upload or response): nobody to answer and nothing worth logging. */
const clientWentAway = (res, err) => !res.socket || res.socket.destroyed || err?.code === "ECONNRESET";

/**
 * Creates the board's HTTP server (without listening yet).
 *
 * - `GET /api/status`: `{ "mode": "live" }`, or `"demo"` without a TypeSafe API key.
 * - `POST /api/ask` with `{ "question": "...", "lang": "en" }` (as JSON; `lang` is the interface's language,
 *   which only the demo uses): the answer streams as NDJSON, one event per line (see `SeanceEvent` in
 *   `medium/medium.js`), as Jev decides. If something fails halfway, the last event is
 *   `{ "type": "error", "code": "...", "message": "..." }`.
 * - Everything else: static files from `publicDir`.
 *
 * Any other failure (a request turned down, or a seance that fails before its first event) is answered with
 * `{ "error": { "code": "...", "message": "..." } }` and its HTTP status. The code is stable and the page shows
 * its own translation of it; the message is English, for whoever uses the API directly.
 *
 * @param {object} deps
 * @param {import("../medium/medium.js").Medium} deps.medium
 * @param {{ mode: "live" | "demo" }} deps.status what `GET /api/status` returns
 * @param {string} deps.publicDir absolute path of the static files
 * @param {boolean} [deps.loopbackOnly] when listening on localhost only: `Host` must be localhost or a loopback
 *   address, on this port (otherwise, localhost or any IP address)
 * @param {import("../log.js").Logger} [deps.log]
 * @returns {import("node:http").Server}
 */
export function createApp({ medium, status, publicDir, loopbackOnly = true, log = silentLogger }) {
  let activeSeances = 0;

  async function ask(req, res) {
    if (activeSeances >= MAX_CONCURRENT_SEANCES) {
      throw new HttpError("too_many_seances", "Too many seances at once.", { status: 429 });
    }
    // The slot is taken before reading the body, so slow uploads count toward the cap too
    activeSeances++;
    try {
      const body = await readJsonBody(req);
      await stream(readQuestion(body), readLanguage(body), res);
    } finally {
      activeSeances--;
    }
  }

  /** Streams the seance's events; if it fails halfway, the error arrives as the last event. */
  async function stream(question, lang, res) {
    // If the browser leaves (reload, closed tab), everything in flight is canceled.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      for await (const event of medium.consult(question, { signal: abort.signal, lang })) {
        startStream(res);
        res.write(`${JSON.stringify(event)}\n`);
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      const failure = toSeanceError(err);
      log.error("  The seance failed:", failure.cause ?? failure.message);
      if (!res.headersSent) return sendError(res, failure);
      res.write(`${JSON.stringify({ type: "error", code: failure.code, message: failure.message })}\n`);
    }
    startStream(res);
    res.end();
  }

  async function route(req, res) {
    let pathname;
    try {
      // Glued on, not resolved against a base: "//style.css" is a path, not the host "style.css"
      ({ pathname } = new URL(req.url.startsWith("/") ? `http://localhost${req.url}` : req.url));
    } catch {
      throw new HttpError("bad_request", "Invalid path.", { status: 400 });
    }
    if (!isAllowedHost(req.headers.host, { loopbackOnly, port: req.socket.localPort })) {
      throw new HttpError("forbidden", "Host not allowed.", { status: 403 });
    }

    if (pathname.startsWith("/api/") && isCrossSite(req)) {
      throw new HttpError("forbidden", "Origin not allowed.", { status: 403 });
    }
    if (pathname === "/api/ask") {
      requireMethod(req, "POST");
      return ask(req, res);
    }
    if (pathname === "/api/status") {
      requireMethod(req, "GET", "HEAD");
      return sendJson(res, 200, status, { "Cache-Control": "no-store" });
    }
    // A path that doesn't exist is a 404 whatever the method: it has no methods to allow
    const file = await findStaticFile(publicDir, pathname);
    if (!file) return sendError(res, { status: 404, code: "not_found", message: "Not found." });
    requireMethod(req, "GET", "HEAD");
    await sendStaticFile(req, res, file);
  }

  return createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    route(req, res).catch((err) => {
      if (clientWentAway(res, err)) return;
      if (err instanceof HttpError) return sendError(res, err);
      log.error("Unexpected error:", err);
      if (!res.headersSent) sendError(res, { status: 500, code: "internal", message: "Internal error." });
      else res.destroy(err);
    });
  });
}
