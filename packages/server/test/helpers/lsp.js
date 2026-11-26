import { PassThrough } from 'node:stream';
import {
  createProtocolConnection,
  InitializedNotification,
  InitializeRequest,
  LogMessageNotification,
  LogTraceNotification,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { startServer } from '../../src/start.js';

/**
 * Starts the server in-process over a pair of in-memory streams and returns a
 * connected client. Never send "exit" through it: vscode-languageserver
 * answers that with process.exit().
 */
export function startInProcess({ features, console: target = {}, exit = () => {} } = {}) {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const proc = fakeProcess();

  const server = startServer(
    { kind: 'stdio' },
    { stdin: clientToServer, stdout: serverToClient, proc, exit, console: target, features },
  );

  const client = createProtocolConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
  );
  const logs = [];
  const traces = [];
  client.onNotification(LogMessageNotification.type, (params) => logs.push(params));
  client.onNotification(LogTraceNotification.type, (params) => traces.push(params));
  client.listen();

  return {
    client,
    server,
    proc,
    logs,
    traces,
    clientToServer,
    initialize: async (params = {}) => {
      const result = await client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
        ...params,
      });
      await client.sendNotification(InitializedNotification.type, {});
      return result;
    },
    dispose: () => {
      client.dispose();
      server.connection.dispose();
    },
  };
}

/** Minimal stand-in for `process` that records listeners. */
export function fakeProcess() {
  const listeners = {};
  return {
    listeners,
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
      return this;
    },
    off() {
      return this;
    },
    emit(event, ...args) {
      for (const listener of listeners[event] ?? []) {
        listener(...args);
      }
    },
  };
}

/** Resolves once `predicate()` is truthy, polling the event loop. */
export async function waitFor(predicate, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
