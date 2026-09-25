import { format } from "node:util";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
// Every control character except tab and newline
const CONTROL_CHARS = /[^\P{Cc}\t\n]/gu;

/** @typedef {keyof typeof LEVELS} LogLevel */
/** @typedef {(...args: unknown[]) => void} LogFn */
/** @typedef {{ error: LogFn, warn: LogFn, info: LogFn, debug: LogFn }} Logger */

/**
 * Minimal leveled logger: errors and warnings go to stderr, everything else to stdout. Control characters (other
 * than tab and newline) come out as U+FFFD: logged errors can quote a provider's response, and an escape sequence in
 * it would reach the terminal.
 *
 * @param {LogLevel} level
 * @returns {Logger}
 */
export function createLogger(level) {
  const threshold = LEVELS[level];
  const writer =
    (name, stream) =>
    (...args) => {
      if (LEVELS[name] <= threshold) stream.write(`${format(...args).replace(CONTROL_CHARS, "\uFFFD")}\n`);
    };
  return {
    error: writer("error", process.stderr),
    warn: writer("warn", process.stderr),
    info: writer("info", process.stdout),
    debug: writer("debug", process.stdout),
  };
}

/**
 * An error on one line, with its causes. A failed request often says just "fetch failed": the reason
 * (ECONNREFUSED, ENOTFOUND, a TLS error…) is down the cause chain. For `localhost` it's an AggregateError with no
 * message, one error per address tried.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
  const message = err?.message || err?.errors?.map(describeError).join(", ") || String(err);
  return err?.cause ? `${message}: ${describeError(err.cause)}` : message;
}

/** A logger that writes nothing (for tests and defaults). */
export const silentLogger = Object.freeze({ error() {}, warn() {}, info() {}, debug() {} });

export const LOG_LEVELS = Object.keys(LEVELS);
