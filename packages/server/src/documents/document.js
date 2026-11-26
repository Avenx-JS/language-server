import { detectFileKind } from './fileKind.js';
import { computeLineStarts, lineEndOffset, offsetAt, positionAt, UTF16 } from './positions.js';

/**
 * An immutable snapshot of a text document.
 *
 * Every edit produces a new snapshot, so a snapshot captured before an async
 * computation still describes exactly the text that computation saw, and the
 * store can tell by identity whether it is still the current one.
 */
export class AvenxDocument {
  /**
   * @param {object} init
   * @param {string} init.uri
   * @param {string} init.text
   * @param {number | null} init.version The client's version; null for a file read from disk.
   * @param {string} [init.languageId]
   * @param {string} [init.encoding] Position encoding used by offsetAt / positionAt.
   */
  constructor({ uri, text, version, languageId = '', encoding = UTF16 }) {
    this.uri = uri;
    this.text = text;
    this.version = version;
    this.languageId = languageId;
    this.encoding = encoding;
    /** @type {import('./fileKind.js').FileKind} */
    this.kind = detectFileKind(uri);
    Object.freeze(this);
  }

  /**
   * Offsets at which each line starts, computed on first use.
   * @returns {number[]}
   */
  get lineStarts() {
    // The snapshot is frozen, so the cache lives in a WeakMap beside it.
    let starts = lineStartsCache.get(this);
    if (!starts) {
      starts = computeLineStarts(this.text);
      lineStartsCache.set(this, starts);
    }
    return starts;
  }

  /** @returns {number} */
  get lineCount() {
    return this.lineStarts.length;
  }

  /**
   * @param {{ line: number, character: number }} position In this document's encoding.
   * @returns {number}
   */
  offsetAt(position) {
    return offsetAt(this.text, this.lineStarts, position, this.encoding);
  }

  /**
   * @param {number} offset
   * @returns {{ line: number, character: number }} In this document's encoding.
   */
  positionAt(offset) {
    return positionAt(this.text, this.lineStarts, offset, this.encoding);
  }

  /**
   * @param {number} start
   * @param {number} end
   * @returns {import('vscode-languageserver/node').Range}
   */
  rangeAt(start, end) {
    return { start: this.positionAt(start), end: this.positionAt(end) };
  }

  /**
   * @param {import('vscode-languageserver/node').Range} [range]
   * @returns {string}
   */
  getText(range) {
    if (!range) {
      return this.text;
    }
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  /**
   * Converts an avenx-core location (1-based `line` / `column` in UTF-16 code
   * units, optional `length` or `endLine` / `endColumn`) into an LSP range.
   * Without an end the range covers one character. Missing or out-of-range
   * values are clamped instead of throwing.
   * @param {{ line?: number | null, column?: number | null, length?: number, endLine?: number, endColumn?: number }} location
   * @returns {import('vscode-languageserver/node').Range}
   */
  rangeFromAvenx(location) {
    const start = this.offsetOfAvenx(location.line, location.column);
    let end;
    if (Number.isFinite(location.length) && location.length >= 0) {
      end = start + location.length;
    } else if (Number.isFinite(location.endLine)) {
      end = this.offsetOfAvenx(location.endLine, location.endColumn);
    } else {
      end = Math.min(start + 1, lineEndOffset(this.text, this.lineStarts, this.lineOfAvenx(location.line)));
    }
    return this.rangeAt(start, Math.max(start, end));
  }

  /**
   * @param {number | null | undefined} line 1-based.
   * @param {number | null | undefined} column 1-based, UTF-16 code units.
   * @returns {number}
   */
  offsetOfAvenx(line, column) {
    const index = this.lineOfAvenx(line);
    const start = this.lineStarts[index];
    const end = lineEndOffset(this.text, this.lineStarts, index);
    const col = Number.isFinite(column) && column >= 1 ? column - 1 : 0;
    return Math.min(start + col, end);
  }

  /**
   * @param {number | null | undefined} line 1-based.
   * @returns {number} A valid 0-based line.
   */
  lineOfAvenx(line) {
    if (!Number.isFinite(line) || line < 1) {
      return 0;
    }
    return Math.min(line - 1, this.lineStarts.length - 1);
  }

  /**
   * Returns a new snapshot with `didChange` content changes applied in order.
   * Ranges are interpreted in this document's encoding against the text as it
   * is after the preceding changes.
   * @param {ReadonlyArray<import('vscode-languageserver/node').TextDocumentContentChangeEvent>} changes
   * @param {number} version
   * @returns {AvenxDocument}
   */
  withChanges(changes, version) {
    let text = this.text;
    let lineStarts = this.lineStarts;
    for (const change of changes) {
      if ('range' in change && change.range) {
        const start = offsetAt(text, lineStarts, change.range.start, this.encoding);
        const end = Math.max(start, offsetAt(text, lineStarts, change.range.end, this.encoding));
        text = text.slice(0, start) + change.text + text.slice(end);
      } else {
        text = change.text;
      }
      lineStarts = computeLineStarts(text);
    }
    const next = new AvenxDocument({
      uri: this.uri,
      text,
      version,
      languageId: this.languageId,
      encoding: this.encoding,
    });
    lineStartsCache.set(next, lineStarts);
    return next;
  }
}

/** @type {WeakMap<AvenxDocument, number[]>} */
const lineStartsCache = new WeakMap();
