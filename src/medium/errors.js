/**
 * A seance error that is safe to show: a stable `code` (the page shows its own translation of it), an English
 * message for API users, and the HTTP status that goes with it.
 */
export class SeanceError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [options]
   */
  constructor(code, message, { status = 500, cause } = {}) {
    super(message, { cause });
    this.name = "SeanceError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Any error as something the user can be told without leaking internals: a SeanceError as it is, anything else
 * (a bug, say) as "the spirit doesn't answer", keeping the original as the cause for the log.
 *
 * @param {unknown} err
 * @returns {SeanceError}
 */
export function toSeanceError(err) {
  return err instanceof SeanceError
    ? err
    : new SeanceError("spirit_silent", "The spirit doesn't answer.", { cause: err });
}
