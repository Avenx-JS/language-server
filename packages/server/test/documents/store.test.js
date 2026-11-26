import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DocumentStore } from '../../src/documents/store.js';
import { UTF8 } from '../../src/documents/positions.js';

const uri = 'file:///app/home.page.js';
const item = (text = 'a', version = 1) => ({ uri, languageId: 'avenx', version, text });
const logger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() });
const insertAtStart = (text) => [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text }];

/** A promise with its resolve function, to control when a computation ends. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe('open / change / close', () => {
  it('tracks the current snapshot and version', () => {
    const store = new DocumentStore();
    const opened = store.open(item('b'));
    expect(store.get(uri)).toBe(opened);
    expect(opened.version).toBe(1);

    const changed = store.change({ uri, version: 2 }, insertAtStart('a'));
    expect(changed.text).toBe('ab');
    expect(store.get(uri)).toBe(changed);
    expect(store.all()).toEqual([changed]);

    store.close(uri);
    expect(store.get(uri)).toBeUndefined();
    expect(store.all()).toEqual([]);
  });

  it('uses the negotiated encoding for every snapshot', () => {
    const store = new DocumentStore({ encoding: UTF8 });
    expect(store.open(item('é')).encoding).toBe(UTF8);
    expect(store.change({ uri, version: 2 }, insertAtStart('x')).encoding).toBe(UTF8);
  });

  it('ignores a change to a document that is not open', () => {
    const log = logger();
    const store = new DocumentStore({ logger: log });
    expect(store.change({ uri, version: 2 }, insertAtStart('x'))).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(`Ignoring change to "${uri}", which is not open.`);
  });

  it('warns about a non-increasing version but applies the change', () => {
    const log = logger();
    const store = new DocumentStore({ logger: log });
    store.open(item('b', 5));
    expect(store.change({ uri, version: 5 }, insertAtStart('a')).text).toBe('ab');
    expect(log.warn).toHaveBeenCalledWith(`Version of "${uri}" went from 5 to 5.`);
  });

  it('ignores closing a document that is not open', () => {
    const listener = vi.fn();
    const store = new DocumentStore();
    store.onDidClose(listener);
    store.close(uri);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies listeners, isolates a failing one and supports dispose', () => {
    const log = logger();
    const store = new DocumentStore({ logger: log });
    const events = [];
    store.onDidOpen(() => {
      throw new Error('bad listener');
    });
    store.onDidOpen((d) => events.push(['open', d.version]));
    const change = store.onDidChange((d) => events.push(['change', d.version]));
    store.onDidClose((d) => events.push(['close', d.version]));

    store.open(item());
    store.change({ uri, version: 2 }, insertAtStart('x'));
    change.dispose();
    store.change({ uri, version: 3 }, insertAtStart('y'));
    store.close(uri);

    expect(events).toEqual([
      ['open', 1],
      ['change', 2],
      ['close', 3],
    ]);
    expect(log.error.mock.calls[0][0]).toMatch(
      /^A didopen listener for "file:\/\/\/app\/home.page.js" failed: Error: bad listener/,
    );
  });
});

describe('stale results', () => {
  it('isCurrent is true only for the latest snapshot', () => {
    const store = new DocumentStore();
    const v1 = store.open(item());
    expect(store.isCurrent(v1)).toBe(true);
    const v2 = store.change({ uri, version: 2 }, insertAtStart('x'));
    expect(store.isCurrent(v1)).toBe(false);
    expect(store.isCurrent(v2)).toBe(true);
    store.close(uri);
    expect(store.isCurrent(v2)).toBe(false);
  });

  it('discards a result whose document changed during the computation', async () => {
    const store = new DocumentStore();
    store.open(item('a'));
    const gate = deferred();
    const pending = store.computeForCurrent(uri, async (document) => {
      await gate.promise;
      return document.text;
    });
    store.change({ uri, version: 2 }, insertAtStart('x'));
    gate.resolve();
    expect(await pending).toBeNull();

    const fresh = await store.computeForCurrent(uri, (document) => document.text);
    expect(fresh).toEqual({ document: store.get(uri), value: 'xa' });
  });

  it('discards a result whose document closed during the computation', async () => {
    const store = new DocumentStore();
    store.open(item());
    const gate = deferred();
    const pending = store.computeForCurrent(uri, () => gate.promise);
    store.close(uri);
    gate.resolve('value');
    expect(await pending).toBeNull();
  });

  it('discards a result after close and reopen with the same version', async () => {
    const store = new DocumentStore();
    store.open(item('a', 1));
    const gate = deferred();
    const pending = store.computeForCurrent(uri, () => gate.promise);
    store.close(uri);
    store.open(item('a', 1));
    gate.resolve('value');
    expect(await pending).toBeNull();
  });

  it('returns null for a document that is not open', async () => {
    const compute = vi.fn();
    expect(await new DocumentStore().computeForCurrent(uri, compute)).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it('delivers only the latest of many overlapping computations', async () => {
    const store = new DocumentStore();
    store.open(item('', 1));
    const gates = [];
    const results = [];
    for (let version = 2; version <= 20; version++) {
      store.change({ uri, version }, insertAtStart(String(version % 10)));
      const gate = deferred();
      gates.push(gate);
      results.push(store.computeForCurrent(uri, async (d) => (await gate.promise, d.version)));
    }
    // Finish in reverse order: the newest completes first, the oldest last.
    gates.reverse().forEach((g) => g.resolve());
    const settled = await Promise.all(results);
    expect(settled.slice(0, -1).every((r) => r === null)).toBe(true);
    expect(settled.at(-1).value).toBe(20);
  });
});

describe('disk fallback', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'avenx-ls-store-')));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const fileUri = (name) => pathToFileURL(join(dir, name)).href;

  it('reads a closed document from disk and the open one from memory', async () => {
    writeFileSync(join(dir, 'card.component.js'), 'on disk');
    const target = fileUri('card.component.js');
    const store = new DocumentStore({ encoding: UTF8 });

    const fromDisk = await store.read(target);
    expect(fromDisk).toMatchObject({ text: 'on disk', version: null, kind: 'component', encoding: UTF8 });

    const open = store.open({ uri: target, languageId: 'avenx', version: 1, text: 'in memory' });
    expect(await store.read(target)).toBe(open);

    store.close(target);
    expect((await store.read(target)).text).toBe('on disk');
  });

  it('caches by modification time and size', async () => {
    const path = join(dir, 'cached.page.js');
    writeFileSync(path, 'one');
    const store = new DocumentStore();
    const first = await store.read(fileUri('cached.page.js'));
    expect(await store.read(fileUri('cached.page.js'))).toBe(first);

    writeFileSync(path, 'two!');
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    expect((await store.read(fileUri('cached.page.js'))).text).toBe('two!');
  });

  it.each([
    ['a missing file', () => fileUri('missing.page.js')],
    ['a directory', () => (mkdirSync(join(dir, 'folder.page.js'), { recursive: true }), fileUri('folder.page.js'))],
    ['a path below a file', () => (writeFileSync(join(dir, 'f'), ''), fileUri('f/x.page.js'))],
    ['a non-file URI', () => 'untitled:Untitled-1'],
  ])('returns null for %s', async (_, target) => {
    const log = logger();
    expect(await new DocumentStore({ logger: log }).read(target())).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs other read errors and returns null', async () => {
    const log = logger();
    const error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const fs = {
      stat: async () => ({ isFile: () => true, mtimeMs: 1, size: 1 }),
      readFile: async () => Promise.reject(error),
    };
    const store = new DocumentStore({ logger: log, fs });
    expect(await store.read(fileUri('locked.page.js'))).toBeNull();
    expect(log.warn.mock.calls[0][0]).toMatch(/^Could not read ".*locked\.page\.js": Error: EACCES/);
  });

  it('forgets the cached copy when the file disappears', async () => {
    const path = join(dir, 'gone.page.js');
    writeFileSync(path, 'x');
    const store = new DocumentStore();
    expect(await store.read(fileUri('gone.page.js'))).not.toBeNull();
    rmSync(path);
    expect(await store.read(fileUri('gone.page.js'))).toBeNull();
    expect(store._disk.has(fileUri('gone.page.js'))).toBe(false);
  });
});
