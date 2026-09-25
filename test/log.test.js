import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createLogger, describeError } from "../src/log.js";

/** What `fn` writes to stdout and to stderr, kept off the terminal. */
function capture(fn) {
  const stdout = mock.method(process.stdout, "write", () => true);
  const stderr = mock.method(process.stderr, "write", () => true);
  try {
    fn();
  } finally {
    // Right away: the test runner reports through these same streams
    stdout.mock.restore();
    stderr.mock.restore();
  }
  const lines = (spy) => spy.mock.calls.map((call) => call.arguments[0]);
  return { stdout: lines(stdout), stderr: lines(stderr) };
}

test("errors and warnings go to stderr and the rest to stdout, formatted like console.log", () => {
  const log = createLogger("debug");
  const out = capture(() => {
    log.error("boom %d", 1);
    log.warn("careful");
    log.info("hello", { a: 1 });
    log.debug("noise");
  });
  assert.deepEqual(out, { stdout: ["hello { a: 1 }\n", "noise\n"], stderr: ["boom 1\n", "careful\n"] });
});

test("drops what's below its level, but not the level itself", () => {
  const out = capture(() => {
    createLogger("error").error("still here");
    const log = createLogger("warn");
    log.warn("careful");
    log.info("hello");
    log.debug("noise");
  });
  assert.deepEqual(out, { stdout: [], stderr: ["still here\n", "careful\n"] });
});

test("control characters other than tab and newline don't reach the terminal", () => {
  // A provider's error could carry a window title change (OSC 0), or a CR to overwrite the line
  const out = capture(() => createLogger("warn").warn("a\u001b]0;owned\u0007b\rc\td\ne"));
  assert.deepEqual(out.stderr, ["a\uFFFD]0;owned\uFFFDb\uFFFDc\td\ne\n"]);
});

test("describeError puts an error and its causes on one line, messageless AggregateErrors included", () => {
  const refused = new AggregateError([new Error("ECONNREFUSED ::1"), new Error("ECONNREFUSED 127.0.0.1")]);
  assert.equal(
    describeError(new TypeError("fetch failed", { cause: refused })),
    "fetch failed: ECONNREFUSED ::1, ECONNREFUSED 127.0.0.1",
  );
  assert.equal(describeError("a thrown string"), "a thrown string");
});
