/**
 * Avenx file kinds, detected from the file name the same way the avenx-core
 * compiler does: by suffix, case-sensitive.
 * @typedef {'component' | 'page' | 'componentCss' | 'pageCss' | 'app' | 'bridge' | 'guard' | 'config' | 'other'} FileKind
 */

/** Suffixes in match order. */
const SUFFIXES = [
  ['.component.js', 'component'],
  ['.page.js', 'page'],
  ['.component.css', 'componentCss'],
  ['.page.css', 'pageCss'],
  ['.app.js', 'app'],
  ['.bridge.js', 'bridge'],
  ['.guard.js', 'guard'],
];

export const CONFIG_FILE_NAME = 'avenx.config.json';

/**
 * Detects the Avenx file kind from a document URI.
 * Works for any scheme (`file:`, `untitled:`, …); query and fragment are ignored.
 * @param {string} uri
 * @returns {FileKind}
 */
export function detectFileKind(uri) {
  const name = fileName(uri);
  if (name === CONFIG_FILE_NAME) {
    return 'config';
  }
  for (const [suffix, kind] of SUFFIXES) {
    // ".component.js" alone has no base name and is not a component.
    if (name.length > suffix.length && name.endsWith(suffix)) {
      return kind;
    }
  }
  return 'other';
}

/**
 * The last path segment of a URI, percent-decoded.
 * @param {string} uri
 * @returns {string}
 */
function fileName(uri) {
  let path;
  try {
    path = new URL(uri).pathname;
  } catch {
    path = uri.split(/[?#]/)[0];
  }
  const segment = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
