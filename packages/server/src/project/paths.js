import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Converts a `file:` URI to an absolute path; null for other schemes or
 * malformed URIs.
 * @param {string} uri
 * @returns {string | null}
 */
export function uriToPath(uri) {
  try {
    return resolve(fileURLToPath(uri));
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
export function pathToUri(path) {
  return pathToFileURL(path).href;
}

/**
 * A key under which a path is compared. Clients spell the same file
 * differently (`file:///c%3A/x` from VS Code, `file:///C:/x` from Node), and
 * Windows and macOS file systems ignore case by default, so the key is
 * case-folded there.
 * @param {string} path
 * @returns {string}
 */
export function pathKey(path) {
  const absolute = resolve(path);
  return process.platform === 'win32' || process.platform === 'darwin' ? absolute.toLowerCase() : absolute;
}

/**
 * True when `child` is `parent` or below it.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function isInside(parent, child) {
  const rel = relative(pathKey(parent), pathKey(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
