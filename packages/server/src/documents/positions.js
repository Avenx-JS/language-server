/**
 * Conversion between string offsets and LSP positions.
 *
 * Offsets are indices into the JavaScript string, i.e. UTF-16 code units.
 * Positions are `{ line, character }` with 0-based lines and a character
 * counted in the negotiated position encoding: UTF-16 code units (the LSP
 * default) or UTF-8 bytes. Line breaks are `\n`, `\r\n` and `\r`, as the LSP
 * specification defines them.
 */

export const UTF16 = 'utf-16';
export const UTF8 = 'utf-8';
export const SUPPORTED_ENCODINGS = [UTF16, UTF8];

/**
 * Picks the position encoding: the first entry of the client's
 * `general.positionEncodings` (ordered by preference) that the server
 * supports, otherwise UTF-16, which every client must support.
 * @param {import('vscode-languageserver/node').ClientCapabilities} [clientCapabilities]
 * @returns {'utf-16' | 'utf-8'}
 */
export function negotiatePositionEncoding(clientCapabilities) {
  const offered = clientCapabilities?.general?.positionEncodings;
  if (Array.isArray(offered)) {
    const match = offered.find((encoding) => SUPPORTED_ENCODINGS.includes(encoding));
    if (match) {
      return match;
    }
  }
  return UTF16;
}

/**
 * Offsets at which each line starts. Always contains at least `[0]`.
 * @param {string} text
 * @returns {number[]}
 */
export function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10 /* \n */) {
        i++;
      }
      starts.push(i + 1);
    } else if (code === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * The offset where `line` ends, excluding its line break.
 * @param {string} text
 * @param {number[]} lineStarts
 * @param {number} line A valid 0-based line.
 * @returns {number}
 */
export function lineEndOffset(text, lineStarts, line) {
  let end = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
  if (end > lineStarts[line] && text.charCodeAt(end - 1) === 10) {
    end--;
  }
  if (end > lineStarts[line] && text.charCodeAt(end - 1) === 13) {
    end--;
  }
  return end;
}

/**
 * Converts a position to an offset. Out-of-range values are clamped, as the
 * specification asks: a line past the end maps to the end of the text, a
 * character past the end of its line maps to the end of that line. A UTF-8
 * character pointing inside a multi-byte sequence maps to the start of it.
 * @param {string} text
 * @param {number[]} lineStarts
 * @param {{ line: number, character: number }} position
 * @param {string} [encoding]
 * @returns {number}
 */
export function offsetAt(text, lineStarts, { line, character }, encoding = UTF16) {
  if (line < 0) {
    return 0;
  }
  if (line >= lineStarts.length) {
    return text.length;
  }
  const start = lineStarts[line];
  const end = lineEndOffset(text, lineStarts, line);
  const wanted = Math.max(0, character);

  if (encoding !== UTF8) {
    return Math.min(start + wanted, end);
  }

  let bytes = 0;
  let offset = start;
  while (offset < end) {
    const { length, units } = codePointAt(text, offset);
    if (bytes + length > wanted) {
      break;
    }
    bytes += length;
    offset += units;
  }
  return offset;
}

/**
 * Converts an offset to a position. The offset is clamped to the text; an
 * offset between `\r` and `\n` maps to the end of that line.
 * @param {string} text
 * @param {number[]} lineStarts
 * @param {number} offset
 * @param {string} [encoding]
 * @returns {{ line: number, character: number }}
 */
export function positionAt(text, lineStarts, offset, encoding = UTF16) {
  const target = Math.max(0, Math.min(offset, text.length));
  const line = lineOfOffset(lineStarts, target);
  const start = lineStarts[line];
  const clamped = Math.min(target, lineEndOffset(text, lineStarts, line));

  if (encoding !== UTF8) {
    return { line, character: clamped - start };
  }

  let bytes = 0;
  let index = start;
  while (index < clamped) {
    const { length, units } = codePointAt(text, index);
    if (index + units > clamped) {
      // Inside a surrogate pair: report the start of the character.
      break;
    }
    bytes += length;
    index += units;
  }
  return { line, character: bytes };
}

/**
 * Binary search for the line that contains `offset`.
 * @param {number[]} lineStarts
 * @param {number} offset
 * @returns {number}
 */
export function lineOfOffset(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

/**
 * UTF-8 length and UTF-16 length of the code point at `index`.
 * A lone surrogate counts as U+FFFD (3 bytes), which is how it is encoded.
 * @param {string} text
 * @param {number} index
 * @returns {{ length: number, units: number }}
 */
function codePointAt(text, index) {
  const code = text.charCodeAt(index);
  if (code < 0x80) {
    return { length: 1, units: 1 };
  }
  if (code < 0x800) {
    return { length: 2, units: 1 };
  }
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { length: 4, units: 2 };
    }
  }
  return { length: 3, units: 1 };
}
