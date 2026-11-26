import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCodes,
  MessageType,
  ResponseError,
  SetTraceNotification,
  ShutdownRequest,
} from 'vscode-languageserver/node';
import { features as registeredFeatures } from '../src/features/index.js';
import { resolveWorkspaceFolders, SERVER_NAME } from '../src/server.js';
import { version } from '../src/version.js';
import { startInProcess, waitFor } from './helpers/lsp.js';

let session;
afterEach(() => {
  session?.dispose();
  session = undefined;
});

const start = (options) => (session = startInProcess(options));

const throwingFeature = {
  name: 'throwing',
  register(context) {
    context.onRequest('avenx/throw', () => {
      throw new Error('boom');
    });
    context.onRequest('avenx/reject', async () => {
      throw 'plain string';
    });
    context.onRequest('avenx/responseError', () => {
      throw new ResponseError(ErrorCodes.InvalidParams, 'bad params');
    });
    context.onRequest('avenx/echo', (params) => params);
    context.onNotification('avenx/throwNotification', () => {
      throw new Error('notification boom');
    });
  },
};

describe('initialize', () => {
  it('advertises no capabilities while no feature is registered', async () => {
    const { initialize } = start({ features: [] });
    const result = await initialize();

    // vscode-languageserver always adds textDocumentSync, as "None".
    expect(result).toEqual({ capabilities: { textDocumentSync: 0 }, serverInfo: { name: SERVER_NAME, version } });
  });

  it('registers the document sync feature by default', async () => {
    expect(registeredFeatures.map((f) => f.name)).toEqual(['documents']);
    const { capabilities } = await start().initialize();
    expect(capabilities).toEqual({ textDocumentSync: { openClose: true, change: 2 } });
  });

  it('builds the capabilities from the registered features', async () => {
    const { initialize } = start({
      features: [
        { name: 'hover', capabilities: () => ({ hoverProvider: true }) },
        { name: 'completion', capabilities: () => ({ completionProvider: { triggerCharacters: ['<'] } }) },
        { name: 'completion-css', capabilities: () => ({ completionProvider: { triggerCharacters: ['@', '<'] } }) },
        { name: 'no-capabilities' },
      ],
    });
    const { capabilities } = await initialize();

    expect(capabilities).toEqual({
      hoverProvider: true,
      completionProvider: { triggerCharacters: ['<', '@'] },
      textDocumentSync: 0,
    });
  });

  it('passes initializationOptions, workspaceFolders and client capabilities to the features', async () => {
    const seen = {};
    const { initialize } = start({
      features: [
        {
          name: 'spy',
          capabilities: (context) => {
            seen.capabilities = context;
            return {};
          },
          register: (context) => (seen.register = context),
          initialized: (context) => (seen.initialized = context),
        },
      ],
    });
    const folders = [{ uri: 'file:///work/app', name: 'app' }];
    await initialize({
      initializationOptions: { feature: { enabled: true } },
      workspaceFolders: folders,
      capabilities: { workspace: { workspaceFolders: true } },
    });
    await waitFor(() => seen.initialized);

    expect(seen.capabilities).toBe(seen.register);
    expect(seen.initialized).toBe(seen.register);
    expect(seen.register.initializationOptions).toEqual({ feature: { enabled: true } });
    expect(seen.register.workspaceFolders).toEqual(folders);
    expect(seen.register.clientCapabilities).toEqual({ workspace: { workspaceFolders: true } });
  });

  it('defaults initializationOptions to an empty object', async () => {
    let options;
    const { initialize } = start({ features: [{ name: 'spy', register: (c) => (options = c.initializationOptions) }] });
    await initialize({ initializationOptions: ['not', 'an', 'object'] });
    expect(options).toEqual({});
  });

  it('answers with an error when features declare conflicting capabilities', async () => {
    const { initialize, logs } = start({
      features: [
        { name: 'a', capabilities: () => ({ hoverProvider: true }) },
        { name: 'b', capabilities: () => ({ hoverProvider: false }) },
      ],
    });
    await expect(initialize()).rejects.toMatchObject({ code: ErrorCodes.InternalError });
    expect(logs.at(-1).message).toMatch(/"hoverProvider" is declared differently by features "a" and "b"/);
  });

  it('logs the start', async () => {
    const { initialize, logs } = start();
    await initialize({ workspaceFolders: [] });
    await waitFor(() => logs.length);
    expect(logs[0]).toEqual({
      type: MessageType.Info,
      message: `${SERVER_NAME} ${version} initialized with 1 feature(s) and 0 workspace folder(s).`,
    });
  });

  it('logs a feature whose initialized hook fails and still initializes the others', async () => {
    const later = vi.fn();
    const { initialize, logs } = start({
      features: [
        {
          name: 'broken',
          initialized: () => {
            throw new Error('nope');
          },
        },
        { name: 'later', initialized: later },
      ],
    });
    await initialize();
    await waitFor(() => logs.some((l) => /Feature "broken" failed to initialize/.test(l.message)));
    expect(logs.find((l) => /Feature "broken"/.test(l.message)).type).toBe(MessageType.Error);
    expect(later).toHaveBeenCalledOnce();
  });
});

describe('error handling', () => {
  it('answers a throwing handler with InternalError and keeps serving', async () => {
    const { initialize, client, logs } = start({ features: [throwingFeature] });
    await initialize();

    await expect(client.sendRequest('avenx/throw')).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'Request "avenx/throw" failed: boom',
    });
    await expect(client.sendRequest('avenx/reject')).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'Request "avenx/reject" failed: plain string',
    });
    // The connection is still alive.
    await expect(client.sendRequest('avenx/echo', { ok: 1 })).resolves.toEqual({ ok: 1 });

    const errors = logs.filter((l) => l.type === MessageType.Error).map((l) => l.message);
    expect(errors[0]).toMatch(/^Request "avenx\/throw" failed: Error: boom\n\s+at /);
    expect(errors[1]).toBe('Request "avenx/reject" failed: plain string');
  });

  it('passes a deliberate ResponseError through without logging it', async () => {
    const { initialize, client, logs } = start({ features: [throwingFeature] });
    await initialize();
    await expect(client.sendRequest('avenx/responseError')).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: 'bad params',
    });
    expect(logs.filter((l) => l.type === MessageType.Error)).toEqual([]);
  });

  it('logs a throwing notification handler and keeps serving', async () => {
    const { initialize, client, logs } = start({ features: [throwingFeature] });
    await initialize();
    await client.sendNotification('avenx/throwNotification', {});
    await waitFor(() => logs.some((l) => l.type === MessageType.Error));

    expect(logs.find((l) => l.type === MessageType.Error).message).toMatch(
      /^Notification "avenx\/throwNotification" failed: Error: notification boom/,
    );
    await expect(client.sendRequest('avenx/echo', 1)).resolves.toBe(1);
  });

  it('logs uncaught exceptions and unhandled rejections instead of exiting', () => {
    const { proc, logs } = start();
    proc.emit('uncaughtException', new Error('escaped'));
    proc.emit('unhandledRejection', 'rejected');
    return waitFor(() => logs.length === 2).then(() => {
      expect(logs[0].message).toMatch(/^Uncaught exception: Error: escaped/);
      expect(logs[1].message).toBe('Unhandled promise rejection: rejected');
    });
  });
});

describe('logging', () => {
  it('filters by initializationOptions.logLevel', async () => {
    const { initialize, logs } = start({
      features: [
        {
          name: 'chatty',
          initialized: ({ logger }) => ['debug', 'info', 'warn', 'error'].forEach((l) => logger[l](l)),
        },
      ],
    });
    await initialize({ initializationOptions: { logLevel: 'warn' } });
    await waitFor(() => logs.length === 2);
    expect(logs).toEqual([
      { type: MessageType.Warning, message: 'warn' },
      { type: MessageType.Error, message: 'error' },
    ]);
  });

  it('sends debug messages as MessageType.Log', async () => {
    const { initialize, logs } = start({
      features: [{ name: 'dbg', initialized: ({ logger }) => logger.debug('dbg') }],
    });
    await initialize({ initializationOptions: { logLevel: 'debug' } });
    await waitFor(() => logs.some((l) => l.message === 'dbg'));
    expect(logs.find((l) => l.message === 'dbg').type).toBe(MessageType.Log);
  });

  it('warns about an unknown log level and keeps the default', async () => {
    const { initialize, logs, server } = start();
    await initialize({ initializationOptions: { logLevel: 'loud' } });
    await waitFor(() => logs.length === 2);
    expect(logs[0]).toEqual({
      type: MessageType.Warning,
      message: 'Ignoring unknown initializationOptions.logLevel "loud"; use one of error, warn, info, debug.',
    });
    expect(server.logger.getLevel()).toBe('info');
  });

  it('routes console output to the client log on stdio', async () => {
    const fakeConsole = {};
    const { initialize, logs } = start({ console: fakeConsole });
    await initialize({ initializationOptions: { logLevel: 'debug' } });
    await waitFor(() => logs.length === 1);
    fakeConsole.log('a %d', 1);
    fakeConsole.info('b');
    fakeConsole.warn('c');
    fakeConsole.error('d', { e: 1 });
    fakeConsole.debug('f');
    fakeConsole.trace('g');
    await waitFor(() => logs.length === 7);
    expect(logs.slice(1)).toEqual([
      { type: MessageType.Info, message: 'a 1' },
      { type: MessageType.Info, message: 'b' },
      { type: MessageType.Warning, message: 'c' },
      { type: MessageType.Error, message: 'd { e: 1 }' },
      { type: MessageType.Log, message: 'f' },
      { type: MessageType.Log, message: 'g' },
    ]);
  });
});

describe('tracing ($/setTrace)', () => {
  it('sends no trace while the trace is off', async () => {
    const { initialize, client, traces } = start({ features: [throwingFeature] });
    await initialize();
    await client.sendRequest('avenx/echo', 1);
    expect(traces).toEqual([]);
  });

  it('follows the initial trace value and $/setTrace', async () => {
    const { initialize, client, traces, server } = start({ features: [throwingFeature] });
    const echoes = () => traces.filter((t) => t.message.includes('"avenx/echo"'));
    await initialize({ trace: 'messages' });
    expect(server.logger.getTrace()).toBe('messages');
    await waitFor(() => traces.some((t) => t.message.startsWith('Handled request "initialize"')));

    await client.sendRequest('avenx/echo', { a: 1 });
    await waitFor(() => echoes().length === 1);
    expect(echoes()[0].message).toMatch(/^Handled request "avenx\/echo" in \d+ ms\.$/);
    expect(echoes()[0].verbose).toBeUndefined();

    await client.sendNotification(SetTraceNotification.type, { value: 'verbose' });
    await waitFor(() => server.logger.getTrace() === 'verbose');
    await client.sendRequest('avenx/echo', { a: 2 });
    await waitFor(() => echoes().length === 2);
    expect(JSON.parse(echoes()[1].verbose)).toEqual({ a: 2 });

    await client.sendNotification(SetTraceNotification.type, { value: 'off' });
    await waitFor(() => server.logger.getTrace() === 'off');
    await client.sendRequest('avenx/echo', 3);
    expect(echoes()).toHaveLength(2);
  });
});

describe('shutdown', () => {
  it('disposes the features, logs failures and rejects later requests', async () => {
    const dispose = vi.fn();
    const { initialize, client, logs, server } = start({
      features: [
        throwingFeature,
        {
          name: 'bad-dispose',
          dispose: () => {
            throw new Error('x');
          },
        },
        { name: 'good-dispose', dispose },
      ],
    });
    await initialize();
    await expect(client.sendRequest(ShutdownRequest.type)).resolves.toBeNull();

    expect(dispose).toHaveBeenCalledOnce();
    expect(server.state.shutdown).toBe(true);
    expect(logs.some((l) => /Feature "bad-dispose" failed to dispose/.test(l.message))).toBe(true);
    await expect(client.sendRequest('avenx/echo', 1)).rejects.toMatchObject({ code: ErrorCodes.InvalidRequest });
  });

  it('exits with 0 when the transport closes after shutdown', async () => {
    const exit = vi.fn();
    const { initialize, client, clientToServer } = start({ exit });
    await initialize();
    await client.sendRequest(ShutdownRequest.type);
    clientToServer.end();
    await waitFor(() => exit.mock.calls.length);
    expect(exit.mock.calls).toEqual([[0]]);
  });

  it('exits with 1 when the transport closes without shutdown', async () => {
    const exit = vi.fn();
    const { initialize, clientToServer } = start({ exit });
    await initialize();
    clientToServer.end();
    await waitFor(() => exit.mock.calls.length);
    // "end" and "close" both fire; exit is called once.
    await new Promise((r) => setTimeout(r, 20));
    expect(exit.mock.calls).toEqual([[1]]);
  });
});

describe('feature validation', () => {
  it.each([
    [[{}], /non-empty "name"/],
    [[null], /non-empty "name"/],
    [[{ name: 'a' }, { name: 'a' }], /"a" is registered twice/],
  ])('rejects invalid feature lists', (features, message) => {
    expect(() => startInProcess({ features })).toThrow(message);
  });
});

describe('resolveWorkspaceFolders', () => {
  it.each([
    [{ workspaceFolders: [{ uri: 'file:///a', name: 'a' }] }, [{ uri: 'file:///a', name: 'a' }]],
    [{ workspaceFolders: null, rootUri: 'file:///c%3A/my%20app' }, [{ uri: 'file:///c%3A/my%20app', name: 'my app' }]],
    [{ rootUri: 'file:///' }, [{ uri: 'file:///', name: 'file:///' }]],
    [{ rootUri: 'not a uri' }, [{ uri: 'not a uri', name: 'not a uri' }]],
    [{ rootUri: null }, []],
    [{}, []],
  ])('%j', (params, expected) => {
    expect(resolveWorkspaceFolders(params)).toEqual(expected);
  });
});
