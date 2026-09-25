import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

/** The file types in public/ (anything else goes out as application/octet-stream). */
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
};

/** `file` is inside `root` and no segment of the path is hidden (starts with a dot). */
function isInside(root, file) {
  const inside = relative(root, file);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return false;
  return !inside.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

/**
 * Resolves the requested path inside `root`, or returns `null` if it tries to get out, points at a hidden
 * file or an NTFS stream, or can't be decoded. This is a check on the path text; `findStaticFile` checks again
 * where the real path lands.
 *
 * @param {string} root absolute directory
 * @param {string} pathname URL path (no query)
 */
export function resolveStaticPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // On Windows, "file:name" opens the file's alternate data stream "name", and realpath keeps it that way
  if (decoded.includes("\0") || decoded.includes(":")) return null;
  const file = resolve(root, `.${decoded.endsWith("/") ? `${decoded}index.html` : decoded}`);
  return isInside(root, file) ? file : null;
}

/** @typedef {{ real: string, info: import("node:fs").Stats }} StaticFile */

/**
 * Looks up the file `pathname` names inside `root`. Returns `null` if it doesn't exist (or can't be served), so
 * the caller can answer 404.
 *
 * @param {string} root
 * @param {string} pathname
 * @returns {Promise<StaticFile | null>}
 */
export async function findStaticFile(root, pathname) {
  const file = resolveStaticPath(root, pathname);
  if (!file) return null;
  let realRoot;
  let real;
  let info;
  try {
    [realRoot, real, info] = await Promise.all([realpath(root), realpath(file), stat(file)]);
  } catch {
    return null;
  }
  // Once symlinks and Windows short names (SECRET~1 for .secret) are resolved, the real path must still
  // be inside `root` and free of hidden files
  if (!info.isFile() || !isInside(realRoot, real)) return null;
  return { real, info };
}

/**
 * Sends a file found by `findStaticFile`.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {StaticFile} file
 */
export async function sendStaticFile(req, res, { real, info }) {
  // Local project: the browser always revalidates (so changes show up on reload) and, if the file
  // hasn't changed, gets a bodyless 304
  const headers = { "Last-Modified": info.mtime.toUTCString(), "Cache-Control": "no-cache" };
  const since = Date.parse(req.headers["if-modified-since"] ?? "");
  if (Math.floor(info.mtimeMs / 1000) * 1000 <= since) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  const body = await readFile(real);
  res.writeHead(200, {
    ...headers,
    "Content-Type": CONTENT_TYPES[extname(real).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": body.length,
  });
  // To a HEAD request, Node sends only the headers
  res.end(body);
}
