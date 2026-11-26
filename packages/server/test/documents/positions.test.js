import { describe, expect, it } from 'vitest';
import {
  computeLineStarts,
  lineOfOffset,
  negotiatePositionEncoding,
  offsetAt,
  positionAt,
  UTF16,
  UTF8,
} from '../../src/documents/positions.js';

const at = (text, offset, encoding) => positionAt(text, computeLineStarts(text), offset, encoding);
const off = (text, line, character, encoding) => offsetAt(text, computeLineStarts(text), { line, character }, encoding);

describe('computeLineStarts', () => {
  it.each([
    ['', [0]],
    ['abc', [0]],
    ['a\nb', [0, 2]],
    ['a\r\nb', [0, 3]],
    ['a\rb', [0, 2]],
    ['a\n', [0, 2]],
    ['\r\n\r\n', [0, 2, 4]],
    ['a\r\n\nb\rc', [0, 3, 4, 6]],
    // "\n\r" is two line breaks, not one.
    ['a\n\rb', [0, 2, 3]],
  ])('%j', (text, expected) => {
    expect(computeLineStarts(text)).toEqual(expected);
  });
});

describe('lineOfOffset', () => {
  it('finds the line containing an offset', () => {
    const starts = [0, 4, 4, 10];
    expect([0, 3, 4, 9, 10, 99].map((o) => lineOfOffset(starts, o))).toEqual([0, 0, 2, 2, 3, 3]);
  });
});

describe('UTF-16 (LSP default)', () => {
  it('counts code units, so an emoji is two characters', () => {
    const text = 'a😀b';
    expect(text.length).toBe(4);
    expect(at(text, 3)).toEqual({ line: 0, character: 3 });
    expect(off(text, 0, 3)).toBe(3);
  });

  it('handles CRLF line endings', () => {
    const text = 'ab\r\ncd\r\n';
    expect(at(text, 4)).toEqual({ line: 1, character: 0 });
    expect(at(text, 5)).toEqual({ line: 1, character: 1 });
    expect(at(text, 8)).toEqual({ line: 2, character: 0 });
    expect(off(text, 1, 1)).toBe(5);
    // Past the end of line 0 clamps to before the "\r\n", not into it.
    expect(off(text, 0, 99)).toBe(2);
  });

  it('maps an offset between \\r and \\n to the end of the line', () => {
    expect(at('ab\r\ncd', 3)).toEqual({ line: 0, character: 2 });
  });

  it('handles a lone \\r as line break', () => {
    expect(at('ab\rcd', 4)).toEqual({ line: 1, character: 1 });
    expect(off('ab\rcd', 1, 1)).toBe(4);
  });

  it('clamps out-of-range positions and offsets', () => {
    const text = 'ab\ncd';
    expect(off(text, -1, 0)).toBe(0);
    expect(off(text, 5, 0)).toBe(text.length);
    expect(off(text, 0, -3)).toBe(0);
    expect(at(text, -5)).toEqual({ line: 0, character: 0 });
    expect(at(text, 99)).toEqual({ line: 1, character: 2 });
  });

  it('round-trips every offset of a mixed text', () => {
    const text = 'const 😀 = "é";\r\n<p>{{ 𝄞 }}</p>\n\r中文\r\n';
    const starts = computeLineStarts(text);
    for (let offset = 0; offset <= text.length; offset++) {
      if (text[offset - 1] === '\r' && text[offset] === '\n') {
        continue; // Between \r and \n: no position of its own.
      }
      const position = positionAt(text, starts, offset, UTF16);
      expect(offsetAt(text, starts, position, UTF16)).toBe(offset);
    }
  });
});

describe('UTF-8', () => {
  const text = 'aé中😀b';
  // byte lengths:   1 2 3 4 1

  it('counts bytes', () => {
    expect([0, 1, 2, 3, 5, 6].map((o) => at(text, o, UTF8).character)).toEqual([0, 1, 3, 6, 10, 11]);
    expect([0, 1, 3, 6, 10, 11].map((c) => off(text, 0, c, UTF8))).toEqual([0, 1, 2, 3, 5, 6]);
  });

  it('rounds a character inside a multi-byte sequence down to its start', () => {
    expect(off(text, 0, 2, UTF8)).toBe(1); // inside "é"
    expect(off(text, 0, 8, UTF8)).toBe(3); // inside "😀"
  });

  it('reports an offset inside a surrogate pair at the start of the character', () => {
    expect(at(text, 4, UTF8)).toEqual({ line: 0, character: 6 });
  });

  it('clamps past the end of the line', () => {
    expect(off('aé\r\nb', 0, 99, UTF8)).toBe(2);
    expect(at('aé\r\nb', 3, UTF8)).toEqual({ line: 0, character: 3 });
  });

  it('counts a lone surrogate as U+FFFD (3 bytes)', () => {
    const lone = 'a\ud83db';
    expect(at(lone, 3, UTF8).character).toBe(5);
    expect(off(lone, 0, 4, UTF8)).toBe(2);
  });

  it('agrees with TextEncoder on every line', () => {
    const sample = 'const 😀 = "é";\r\n<p>{{ 𝄞 }}</p>\n中文 ok\r';
    const starts = computeLineStarts(sample);
    const encoder = new TextEncoder();
    for (let offset = 0; offset <= sample.length; offset++) {
      const line = lineOfOffset(starts, offset);
      const lineText = sample.slice(starts[line]).split(/\r\n|\r|\n/)[0];
      const before = sample.slice(starts[line], offset);
      if (before.length > lineText.length || /[\ud800-\udbff]$/.test(before)) {
        continue; // inside a line break or a surrogate pair
      }
      expect(positionAt(sample, starts, offset, UTF8)).toEqual({ line, character: encoder.encode(before).length });
    }
  });
});

describe('negotiatePositionEncoding', () => {
  it.each([
    [undefined, UTF16],
    [{}, UTF16],
    [{ general: {} }, UTF16],
    [{ general: { positionEncodings: [] } }, UTF16],
    [{ general: { positionEncodings: ['utf-8', 'utf-16'] } }, UTF8],
    [{ general: { positionEncodings: ['utf-16', 'utf-8'] } }, UTF16],
    [{ general: { positionEncodings: ['utf-32', 'utf-8'] } }, UTF8],
    [{ general: { positionEncodings: ['utf-32'] } }, UTF16],
  ])('%j → %s', (capabilities, expected) => {
    expect(negotiatePositionEncoding(capabilities)).toBe(expected);
  });
});
