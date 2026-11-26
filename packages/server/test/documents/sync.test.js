// Text synchronization over a real LSP connection (in-process).
import { afterEach, describe, expect, it } from 'vitest';
import {
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { documentsFeature } from '../../src/features/documents.js';
import { startInProcess, waitFor } from '../helpers/lsp.js';

const uri = 'file:///app/src/home.page.js';
let session;
afterEach(() => {
  session?.dispose();
  session = undefined;
});

/** Captures the feature context so tests can look at the store. */
function probe() {
  const seen = {};
  return { seen, feature: { name: 'probe', register: (context) => Object.assign(seen, context) } };
}

const change = (version, line, character, text) => ({
  textDocument: { uri, version },
  contentChanges: [{ range: { start: { line, character }, end: { line, character } }, text }],
});

describe('text document sync', () => {
  it('advertises incremental sync and no positionEncoding unless the client asks', async () => {
    session = startInProcess({ features: [documentsFeature] });
    const { capabilities } = await session.initialize();
    expect(capabilities).toEqual({ textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental } });
  });

  it('keeps the store in sync with didOpen, didChange and didClose', async () => {
    const { seen, feature } = probe();
    session = startInProcess({ features: [documentsFeature, feature] });
    await session.initialize();
    const { client } = session;

    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: 'avenx', version: 1, text: '<p>😀</p>\r\n' },
    });
    await client.sendNotification(DidChangeTextDocumentNotification.type, change(2, 0, 5, ' hi'));
    await waitFor(() => seen.documents.get(uri)?.version === 2);
    expect(seen.documents.get(uri)).toMatchObject({ text: '<p>😀 hi</p>\r\n', kind: 'page' });

    await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } });
    await waitFor(() => !seen.documents.get(uri));
  });

  it('negotiates UTF-8 and applies edits in bytes', async () => {
    const { seen, feature } = probe();
    session = startInProcess({ features: [documentsFeature, feature] });
    const { capabilities } = await session.initialize({
      capabilities: { general: { positionEncodings: ['utf-8', 'utf-16'] } },
    });
    expect(capabilities.positionEncoding).toBe('utf-8');
    expect(seen.positionEncoding).toBe('utf-8');

    await session.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: 'avenx', version: 1, text: '<p>😀</p>' },
    });
    // Byte 7 is right after the emoji (3 + 4 bytes).
    await session.client.sendNotification(DidChangeTextDocumentNotification.type, change(2, 0, 7, '!'));
    await waitFor(() => seen.documents.get(uri)?.version === 2);
    expect(seen.documents.get(uri).text).toBe('<p>😀!</p>');
  });

  it('answers UTF-16 when the client prefers it', async () => {
    session = startInProcess({ features: [documentsFeature] });
    const { capabilities } = await session.initialize({
      capabilities: { general: { positionEncodings: ['utf-16', 'utf-8'] } },
    });
    expect(capabilities.positionEncoding).toBe('utf-16');
  });
});

describe('rapid edits', () => {
  it('never delivers a result for a stale version', async () => {
    // A feature that recomputes on every change with a random delay, the way
    // diagnostics will, and publishes only results for the current version.
    const published = [];
    const feature = {
      name: 'slow-analysis',
      register({ documents }) {
        documents.onDidChange(async (document) => {
          const result = await documents.computeForCurrent(document.uri, async (snapshot) => {
            await new Promise((r) => setTimeout(r, Math.random() * 15));
            return snapshot.text;
          });
          if (result) {
            published.push({
              version: result.document.version,
              text: result.value,
              currentAtDelivery: documents.get(uri).version,
            });
          }
        });
      },
    };
    const { seen, feature: p } = probe();
    session = startInProcess({ features: [documentsFeature, feature, p] });
    await session.initialize();
    const { client } = session;

    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: 'avenx', version: 1, text: '' },
    });
    const last = 41;
    for (let version = 2; version <= last; version++) {
      // Each keystroke appends one character at the end of the line.
      await client.sendNotification(DidChangeTextDocumentNotification.type, change(version, 0, version - 2, 'x'));
      if (version % 7 === 0) {
        await new Promise((r) => setTimeout(r, 10)); // pauses in typing
      }
    }
    await waitFor(() => published.some((r) => r.version === last));
    await new Promise((r) => setTimeout(r, 30));

    expect(seen.documents.get(uri).text).toBe('x'.repeat(last - 1));
    for (const result of published) {
      expect(result.version).toBe(result.currentAtDelivery);
      expect(result.text).toBe('x'.repeat(result.version - 1));
    }
    expect(published.at(-1)).toMatchObject({ version: last });
  });
});
