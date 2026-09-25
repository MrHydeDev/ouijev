import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { SeanceError } from "../src/medium/errors.js";
import { createApp, isLoopback, MAX_CONCURRENT_SEANCES, MAX_QUESTION_LENGTH } from "../src/server/app.js";
import { resolveStaticPath } from "../src/server/static-files.js";

let server;
let baseURL;
let sandbox;
let publicDir;
const questions = [];
const signals = [];
const languages = [];
/** Seances that hang until `release` is resolved. */
let release = () => {};

const medium = {
  async *consult(question, { signal, lang }) {
    questions.push(question);
    signals.push(signal);
    languages.push(lang);
    if (question === "fail early") throw new SeanceError("jev_timeout", "Jev takes too long.", { status: 504 });
    if (question === "weird error") throw new TypeError("undefined is not a function");
    if (question === "hang") {
      yield { type: "letters", text: "L" };
      await new Promise((resolve) => {
        release = resolve;
        signal.addEventListener("abort", resolve, { once: true });
      });
      return;
    }
    yield { type: "letters", text: "LU" };
    if (question === "fail midway") throw new SeanceError("spirit_silent", "The lights went out.");
    yield { type: "letters", text: "Z" };
  },
};

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "ouijev-app-"));
  publicDir = join(sandbox, "public");
  await mkdir(publicDir);
  await writeFile(join(publicDir, "index.html"), "<!doctype html><title>Ouijev</title>");
  await writeFile(join(publicDir, ".secret"), "no");
  await writeFile(join(publicDir, "avatar.jpg"), "not a real jpg");
  // Next to public/, not inside it: it can't be served however hard you try
  await writeFile(join(sandbox, "secret.txt"), "no");
  // Not even through a link from public/ ("junction" needs no privileges on Windows; elsewhere it's ignored)
  await mkdir(join(sandbox, "outside"));
  await writeFile(join(sandbox, "outside", "secret.txt"), "no");
  await symlink(join(sandbox, "outside"), join(publicDir, "up"), "junction");
  server = createApp({ medium, status: { mode: "live" }, publicDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  release();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(sandbox, { recursive: true, force: true });
});

/** Another app for a single test, on a port of its own that closes when the test ends. Returns the port. */
async function startApp(t, deps) {
  const app = createApp({ medium, status: { mode: "live" }, publicDir, ...deps });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    app.closeAllConnections();
    return new Promise((resolve) => app.close(resolve));
  });
  return app.address().port;
}

const ask = (body, headers = {}) =>
  fetch(`${baseURL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const events = async (res) =>
  (await res.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

/** Hand-made HTTP request, to send what `fetch` won't let you (Host header, malformed paths). */
function rawRequest(lines, port = server.address().port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    let data = "";
    socket.on("data", (chunk) => (data += chunk));
    socket.on("end", () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1])));
    socket.on("error", reject);
  });
}

test("POST /api/ask returns the events as NDJSON", async () => {
  const res = await ask({ question: "  ¿Qué ilumina?  " });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/x-ndjson/);
  assert.deepEqual(await events(res), [
    { type: "letters", text: "LU" },
    { type: "letters", text: "Z" },
  ]);
  assert.equal(questions.at(-1), "¿Qué ilumina?");
});

test("a failure before starting is answered with its HTTP status", async () => {
  const res = await ask({ question: "fail early" });
  assert.equal(res.status, 504);
  assert.deepEqual(await res.json(), { error: { code: "jev_timeout", message: "Jev takes too long." } });
});

test("an unexpected error in the seance doesn't reveal internal details", async () => {
  const res = await ask({ question: "weird error" });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: "spirit_silent", message: "The spirit doesn't answer." } });
});

test("an unexpected error in the server doesn't reveal internal details either", async (t) => {
  const status = {
    toJSON() {
      throw new Error("/home/someone/ouijev/src/secret.js exploded");
    },
  };
  const res = await fetch(`http://127.0.0.1:${await startApp(t, { status })}/api/status`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: "internal", message: "Internal error." } });
});

test("a failure midway arrives as the last event", async () => {
  const res = await ask({ question: "fail midway" });
  assert.equal(res.status, 200);
  assert.deepEqual(await events(res), [
    { type: "letters", text: "LU" },
    { type: "error", code: "spirit_silent", message: "The lights went out." },
  ]);
});

test("accepts a question right at the length limit, and strips control characters", async () => {
  const longest = await ask({ question: "x".repeat(MAX_QUESTION_LENGTH) });
  assert.equal(longest.status, 200);
  await longest.text();
  const [ESC, BELL] = [27, 7].map((code) => String.fromCharCode(code));
  await (await ask({ question: `hola${ESC}[31m${BELL}${BELL}ahí` })).text();
  assert.equal(questions.at(-1), "hola [31m ahí");
});

test("the interface's language reaches the medium, if it looks like a language code", async () => {
  for (const [lang, expected] of [
    ["es", "es"],
    ["fr", "fr"],
    ["english", undefined],
    [42, undefined],
    [undefined, undefined],
  ]) {
    await (await ask({ question: "hola", lang })).text();
    assert.equal(languages.at(-1), expected, String(lang));
  }
});

test("every error has a stable code for the page to translate, and an English message", async () => {
  const cases = [
    [() => fetch(`${baseURL}/api/ask`, { method: "POST", body: '{"question":"hola"}' }), 415, "not_json"],
    [() => ask("{not json"), 400, "bad_request"],
    [() => ask({ question: "   " }), 400, "empty_question"],
    [() => ask({ question: 42 }), 400, "empty_question"],
    [() => ask({ question: "x".repeat(MAX_QUESTION_LENGTH + 1) }), 400, "question_too_long"],
    [() => ask({ question: "x".repeat(10_000) }), 413, "question_too_long"],
    [() => ask({ question: "hola" }, { Origin: "https://evil.example" }), 403, "forbidden"],
    [() => fetch(`${baseURL}/api/ask`), 405, "method_not_allowed"],
    [() => fetch(`${baseURL}/missing.js`), 404, "not_found"],
  ];
  for (const [request, status, code] of cases) {
    const res = await request();
    assert.equal(res.status, status, code);
    const { error } = await res.json();
    assert.equal(error.code, code);
    assert.match(error.message, /^[A-Z][^áéíóúñ¿¡]+$/, code);
  }
});

test("an oversized body is a 413 that closes the connection, since the rest of it goes unread", async () => {
  const res = await ask({ question: "x".repeat(10_000) });
  assert.equal(res.status, 413);
  assert.equal(res.headers.get("connection"), "close");
});

test("the page limits the question to the same length the server accepts", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`maxlength="${MAX_QUESTION_LENGTH}"`));
});

test("against CSRF: only from the page itself, however the browser says where a request comes from", async () => {
  // Plain text and another site's Origin are in the table above; this is what sandboxed iframes, file:// pages and cross-origin redirects send
  assert.equal((await ask({ question: "hola" }, { Origin: "null" })).status, 403);
  assert.equal((await ask({ question: "hola" }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const own = await ask({ question: "hola" }, { Origin: baseURL, "Sec-Fetch-Site": "same-origin" });
  assert.equal(own.status, 200);
  await own.text();
});

test("isLoopback recognizes loopback however it's written", () => {
  const loopback = ["localhost", "LOCALHOST", "127.0.0.1", "127.0.0.2", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"];
  for (const host of loopback) assert.ok(isLoopback(host), host);
  for (const host of ["0.0.0.0", "::", "192.168.1.10", "example.com"]) assert.ok(!isLoopback(host), host);
});

test("against DNS rebinding: when listening on localhost, it only serves localhost on its port", async () => {
  const port = server.address().port;
  for (const [host, status] of [
    [`evil.example:${port}`, 403],
    [`192.168.1.5:${port}`, 403],
    [`127.0.0.1:${port + 1}`, 403],
    [`localhost:${port}`, 200],
    [`LOCALHOST:${port}`, 200],
    [`127.0.0.2:${port}`, 200],
    [`[::1]:${port}`, 200],
  ]) {
    assert.equal(await rawRequest(["GET / HTTP/1.1", `Host: ${host}`, "Connection: close"]), status, host);
  }
});

test("against DNS rebinding: beyond localhost, it only serves localhost and IP addresses", async (t) => {
  const port = await startApp(t, { loopbackOnly: false });
  for (const [host, status] of [
    [`evil.example:${port}`, 403],
    [`localhost:${port}`, 200],
    [`192.168.1.5:${port}`, 200],
    [`[fe80::1]:${port}`, 200],
    ["192.168.1.5:8080", 200], // forwarded from another port
  ]) {
    assert.equal(await rawRequest(["GET / HTTP/1.1", `Host: ${host}`, "Connection: close"], port), status, host);
  }
});

test("a malformed path is a 400, not a server error", async () => {
  assert.equal(await rawRequest(["GET http://[ HTTP/1.1", "Host: 127.0.0.1", "Connection: close"]), 400);
});

test("a path that starts with // is still a path, not a host", async () => {
  // Resolved against a base URL, "//missing.js" would be the host "missing.js" and the path "/", the home page
  const host = `Host: 127.0.0.1:${server.address().port}`;
  assert.equal(await rawRequest(["GET //missing.js HTTP/1.1", host, "Connection: close"]), 404);
});

test("cancels the seance when the browser goes away", async () => {
  const abort = new AbortController();
  const res = await fetch(`${baseURL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "hang" }),
    signal: abort.signal,
  });
  const reader = res.body.getReader();
  await reader.read(); // first event: the seance is under way
  const signal = signals.at(-1);
  assert.equal(signal.aborted, false);
  abort.abort();
  await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  assert.ok(signal.aborted);
});

test(`allows no more than ${MAX_CONCURRENT_SEANCES} seances at once`, async () => {
  const readers = [];
  for (let i = 0; i < MAX_CONCURRENT_SEANCES; i++) {
    const res = await ask({ question: "hang" });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    await reader.read();
    readers.push(reader);
  }
  assert.equal((await ask({ question: "one more" })).status, 429);
  for (const reader of readers) await reader.cancel();
});

test("an upload still on its way already counts toward the cap", async () => {
  const port = server.address().port;
  const body = JSON.stringify({ question: "slow" });
  const uploads = [];
  for (let i = 0; i < MAX_CONCURRENT_SEANCES; i++) {
    const socket = connect(port, "127.0.0.1");
    // Listening from the start: an upload that is turned down gets its answer and is hung up on right away
    let response = "";
    socket.on("data", (chunk) => (response += chunk));
    const ended = once(socket, "end").then(() => response);
    const headers = [
      "POST /api/ask HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      `Content-Length: ${body.length}`,
      "Expect: 100-continue",
      "Connection: close",
    ];
    socket.write(`${headers.join("\r\n")}\r\n\r\n`);
    await once(socket, "data"); // "100 Continue": the server has taken the request, but not the body yet
    uploads.push({ socket, ended });
  }
  assert.equal((await ask({ question: "one more" })).status, 429);
  for (const { socket, ended } of uploads) {
    socket.write(body);
    // Node sends that "100 Continue" before the handler runs, even to an upload it then turns down
    assert.match(await ended, /HTTP\/1\.1 200 /);
  }
});

test("GET and HEAD /api/status, and methods that aren't allowed", async () => {
  assert.deepEqual(await (await fetch(`${baseURL}/api/status`)).json(), { mode: "live" });
  assert.equal((await fetch(`${baseURL}/api/status`, { method: "HEAD" })).status, 200);
  for (const [method, path, allow] of [
    ["GET", "/api/ask", "POST"],
    ["POST", "/api/status", "GET, HEAD"],
    ["DELETE", "/", "GET, HEAD"],
  ]) {
    const res = await fetch(`${baseURL}${path}`, { method });
    assert.equal(res.status, 405, `${method} ${path}`);
    assert.equal(res.headers.get("allow"), allow);
  }
  // What doesn't exist has no methods to allow
  for (const path of ["/missing.js", "/api/asks"]) {
    assert.equal((await fetch(`${baseURL}${path}`, { method: "POST" })).status, 404, path);
  }
});

test("serves static files (HEAD too) with security and revalidation headers", async () => {
  const index = await fetch(`${baseURL}/`);
  assert.equal(index.status, 200);
  assert.equal(await index.text(), await readFile(join(publicDir, "index.html"), "utf8"));
  assert.match(index.headers.get("content-type"), /text\/html/);
  assert.match(index.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(index.headers.get("x-content-type-options"), "nosniff");
  assert.equal(index.headers.get("cross-origin-resource-policy"), "same-origin");
  const head = await fetch(`${baseURL}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), index.headers.get("content-length"));
  assert.equal(await head.text(), "");
  const lastModified = index.headers.get("last-modified");
  assert.ok(lastModified);
  const cached = await fetch(`${baseURL}/`, { headers: { "If-Modified-Since": lastModified } });
  assert.equal(cached.status, 304);
  assert.equal((await fetch(`${baseURL}/avatar.jpg`)).headers.get("content-type"), "image/jpeg");
});

test("doesn't escape public/ or serve hidden files", async () => {
  for (const path of [
    "/.secret",
    "/SECRET~1",
    "/..%2fsecret.txt",
    "/%2e%2e%2fsecret.txt",
    "/up/secret.txt",
    "/missing.js",
  ]) {
    assert.equal((await fetch(`${baseURL}${path}`)).status, 404, path);
  }
});

test("resolveStaticPath rejects paths outside the root, hidden files, NTFS streams and garbage", () => {
  const root = join(tmpdir(), "root");
  assert.equal(resolveStaticPath(root, "/js/main.js"), join(root, "js", "main.js"));
  assert.equal(resolveStaticPath(root, "/"), join(root, "index.html"));
  for (const bad of [
    "/../secret",
    "/..%2f..%2fsecret",
    "/.env",
    "/js/.hidden",
    "/index.html:x",
    "/index.html::$DATA",
    "/index.html%3a%3a%24DATA",
    "/%E0%A4%A",
    "/a%00b",
  ]) {
    assert.equal(resolveStaticPath(root, bad), null, bad);
  }
});
