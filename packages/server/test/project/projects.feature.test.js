// The projects feature over a real LSP connection (in-process).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidChangeWorkspaceFoldersNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  FileChangeType,
  PublishDiagnosticsNotification,
  RegistrationRequest,
} from 'vscode-languageserver/node';
import { documentsFeature } from '../../src/features/documents.js';
import { projectsFeature, WATCHERS } from '../../src/features/projects.js';
import { createFixture, MONOREPO } from '../helpers/fixture.js';
import { startInProcess, waitFor } from '../helpers/lsp.js';

let fixture;
let session;
let seen;
let registrations;
let diagnostics;

beforeEach(() => {
  fixture = createFixture(MONOREPO);
  seen = {};
  registrations = [];
  diagnostics = new Map();
});
afterEach(() => {
  session?.dispose();
  fixture.dispose();
});

async function start(capabilities = { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } }) {
  session = startInProcess({
    features: [
      documentsFeature,
      projectsFeature,
      { name: 'probe', register: (context) => Object.assign(seen, context) },
    ],
  });
  session.client.onRequest(RegistrationRequest.type, (params) => {
    registrations.push(...params.registrations);
    return null;
  });
  session.client.onNotification(PublishDiagnosticsNotification.type, (params) => diagnostics.set(params.uri, params));
  await session.initialize({ capabilities, workspaceFolders: [{ uri: fixture.uri(''), name: 'repo' }] });
  await waitFor(() => session.logs.some((l) => /Found \d+ Avenx project/.test(l.message)));
}

const shop = () => seen.projects.projectFor(fixture.uri('apps/shop/avenx.config.json'));

describe('projects feature', () => {
  it('registers the file watchers and discovers the projects', async () => {
    await start();
    expect(registrations).toEqual([
      expect.objectContaining({
        method: DidChangeWatchedFilesNotification.method,
        registerOptions: { watchers: WATCHERS },
      }),
    ]);
    expect(seen.projects.all()).toHaveLength(2);
    expect(session.logs.some((l) => l.message === 'Found 2 Avenx project(s).')).toBe(true);
  });

  it('logs when the client cannot register watchers', async () => {
    await start({});
    expect(registrations).toEqual([]);
    expect(session.logs.some((l) => /cannot register file watchers/.test(l.message))).toBe(true);
  });

  it('publishes empty diagnostics for a valid config', async () => {
    await start();
    await waitFor(() => diagnostics.size === 2);
    expect(diagnostics.get(fixture.uri('apps/shop/avenx.config.json')).diagnostics).toEqual([]);
  });

  it('updates the registry from didChangeWatchedFiles', async () => {
    await start();
    const uri = fixture.write('apps/shop/src/components/cart.component.js', '');
    await session.client.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: [{ uri, type: FileChangeType.Created }],
    });
    await waitFor(() => shop().registry.get('Cart'));

    fixture.remove('apps/shop/src/components/cart.component.js');
    await session.client.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: [{ uri, type: FileChangeType.Deleted }],
    });
    await waitFor(() => !shop().registry.get('Cart'));
  });

  it('publishes config problems as diagnostics and clears them when fixed', async () => {
    const configUri = fixture.write('apps/shop/avenx.config.json', '{\n  "srcDri": "src",\n  "distDir": 5\n}');
    await start({
      workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
      general: { positionEncodings: ['utf-8'] },
    });
    await waitFor(() => diagnostics.get(configUri)?.diagnostics.length === 2);
    expect(diagnostics.get(configUri).diagnostics).toEqual([
      {
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 10 } },
        severity: 2,
        source: 'avenx',
        code: 'config-schema',
        message: 'Unknown option "srcDri". Did you mean "srcDir"? It has no effect.',
      },
      {
        range: { start: { line: 2, character: 13 }, end: { line: 2, character: 14 } },
        severity: 1,
        source: 'avenx',
        code: 'config-schema',
        message: '"distDir" must be a string.',
      },
    ]);

    fixture.write('apps/shop/avenx.config.json', '{}');
    await session.client.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: [{ uri: configUri, type: FileChangeType.Changed }],
    });
    await waitFor(() => diagnostics.get(configUri).diagnostics.length === 0);
  });

  it('validates the open config while it is edited, with its version', async () => {
    await start();
    const uri = fixture.uri('apps/admin/avenx.config.json');
    const text = '{ "srcDir": "app", "distDir": "app/build" }';
    await session.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: 'json', version: 1, text },
    });
    await session.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: '{ "srcDir": 1 }' }],
    });
    await waitFor(() => diagnostics.get(uri)?.version === 2);
    expect(diagnostics.get(uri).diagnostics.map((d) => d.message)).toEqual(['"srcDir" must be a string.']);

    await session.client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } });
    await waitFor(() => diagnostics.get(uri)?.version === undefined && diagnostics.get(uri).diagnostics.length === 0);
  });

  it('clears the diagnostics of a removed project and follows workspace folder changes', async () => {
    const configUri = fixture.write('apps/admin/avenx.config.json', '{ "nope": 1 }');
    await start();
    await waitFor(() => diagnostics.get(configUri)?.diagnostics.length === 1);

    await session.client.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
      event: {
        removed: [{ uri: fixture.uri(''), name: 'repo' }],
        added: [{ uri: fixture.uri('apps/shop'), name: 'shop' }],
      },
    });
    await waitFor(() => diagnostics.get(configUri).diagnostics.length === 0);
    await waitFor(() => seen.projects.all().length === 1);
    expect(seen.projects.all()[0].root).toBe(fixture.path('apps/shop'));
  });
});
