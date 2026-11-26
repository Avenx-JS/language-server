import { describe, expect, it } from 'vitest';
import { AvenxDocument } from '../../src/documents/document.js';
import { UTF8 } from '../../src/documents/positions.js';

const doc = (text, encoding) =>
  new AvenxDocument({ uri: 'file:///app/home.page.js', text, version: 1, languageId: 'avenx', encoding });

const range = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

describe('AvenxDocument', () => {
  it('carries uri, version, languageId and file kind and is immutable', () => {
    const d = doc('x');
    expect(d).toMatchObject({ uri: 'file:///app/home.page.js', version: 1, languageId: 'avenx', kind: 'page' });
    expect(Object.isFrozen(d)).toBe(true);
    expect(d.lineCount).toBe(1);
    expect(d.lineStarts).toBe(d.lineStarts);
  });

  it('getText returns the whole text or a range', () => {
    const d = doc('ab\r\ncd😀e');
    expect(d.getText()).toBe('ab\r\ncd😀e');
    expect(d.getText(range(0, 1, 1, 4))).toBe('b\r\ncd😀');
  });
});

describe('rangeFromAvenx', () => {
  const source = '<state>\r\n  count: 0\r\n</state>\r\n<p>😀 {{ cuont }}</p>';

  it('converts 1-based line/column with a length to a 0-based range', () => {
    // "cuont" at line 4, column 9 (😀 is two UTF-16 columns, as avenx-core counts them).
    const d = doc(source);
    const r = d.rangeFromAvenx({ line: 4, column: 10, length: 5 });
    expect(r).toEqual(range(3, 9, 3, 14));
    expect(d.getText(r)).toBe('cuont');
  });

  it('reports the same text in UTF-8 positions', () => {
    const d = doc(source, UTF8);
    const r = d.rangeFromAvenx({ line: 4, column: 10, length: 5 });
    expect(r).toEqual(range(3, 11, 3, 16));
    expect(d.getText(r)).toBe('cuont');
  });

  it('supports endLine / endColumn across CRLF lines', () => {
    const d = doc(source);
    const r = d.rangeFromAvenx({ line: 1, column: 1, endLine: 3, endColumn: 9 });
    expect(r).toEqual(range(0, 0, 2, 8));
    expect(d.getText(r)).toBe('<state>\r\n  count: 0\r\n</state>');
  });

  it('covers one character without an end', () => {
    expect(doc(source).rangeFromAvenx({ line: 2, column: 3 })).toEqual(range(1, 2, 1, 3));
  });

  it('is empty at the end of a line without an end', () => {
    expect(doc(source).rangeFromAvenx({ line: 1, column: 8 })).toEqual(range(0, 7, 0, 7));
  });

  it.each([
    ['no location', {}, range(0, 0, 0, 1)],
    ['null line and column', { line: null, column: null }, range(0, 0, 0, 1)],
    ['line 0', { line: 0, column: 3 }, range(0, 2, 0, 3)],
    ['line past the end', { line: 99, column: 1, length: 2 }, range(3, 0, 3, 2)],
    ['column past the end of the line', { line: 1, column: 50, length: 3 }, range(0, 7, 1, 1)],
    ['negative length', { line: 1, column: 2, length: -1 }, range(0, 1, 0, 2)],
    ['end before start', { line: 2, column: 5, endLine: 1, endColumn: 1 }, range(1, 4, 1, 4)],
  ])('clamps %s', (_, location, expected) => {
    expect(doc(source).rangeFromAvenx(location)).toEqual(expected);
  });
});

describe('withChanges', () => {
  it('applies an incremental change and returns a new snapshot', () => {
    const before = doc('<p>{{ name }}</p>');
    const after = before.withChanges([{ range: range(0, 6, 0, 10), text: 'title' }], 2);
    expect(after.text).toBe('<p>{{ title }}</p>');
    expect(after.version).toBe(2);
    expect(after).not.toBe(before);
    expect(before.text).toBe('<p>{{ name }}</p>');
    expect(after.kind).toBe('page');
  });

  it('applies several changes in order, each against the previous result', () => {
    const d = doc('a\nb\nc').withChanges(
      [
        { range: range(0, 0, 0, 1), text: 'A\nA2' }, // inserts a line
        { range: range(2, 0, 2, 1), text: 'B' }, // "b" is now on line 2
        { range: range(3, 1, 3, 1), text: '!' },
      ],
      2,
    );
    expect(d.text).toBe('A\nA2\nB\nc!');
    expect(d.lineStarts).toEqual([0, 2, 5, 7]);
  });

  it('handles edits around emoji in UTF-16', () => {
    const d = doc('😀x😀').withChanges([{ range: range(0, 2, 0, 3), text: 'y' }], 2);
    expect(d.text).toBe('😀y😀');
  });

  it('interprets ranges as UTF-8 bytes when negotiated', () => {
    const d = doc('é😀x', UTF8).withChanges([{ range: range(0, 6, 0, 7), text: 'y' }], 2);
    expect(d.text).toBe('é😀y');
  });

  it('handles CRLF', () => {
    const d = doc('a\r\nb\r\nc').withChanges([{ range: range(0, 1, 1, 1), text: '' }], 2);
    expect(d.text).toBe('a\r\nc');
  });

  it('replaces the text for a full-content change', () => {
    const d = doc('old').withChanges([{ range: range(0, 0, 0, 1), text: 'x' }, { text: 'new\ntext' }], 2);
    expect(d.text).toBe('new\ntext');
    expect(d.lineCount).toBe(2);
  });

  it('treats an inverted range as an insertion at its start', () => {
    expect(doc('abc').withChanges([{ range: range(0, 2, 0, 1), text: 'X' }], 2).text).toBe('abXc');
  });
});
