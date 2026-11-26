import { createServer as createNetServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createTransport } from '../src/transport.js';
import { fakeProcess, waitFor } from './helpers/lsp.js';

const message = { jsonrpc: '2.0', method: 'test', params: { n: 1 } };
const disposables = [];
afterEach(() => disposables.splice(0).forEach((d) => d()));

describe('createTransport', () => {
  it('stdio reads and writes LSP-framed messages', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const { reader, writer } = createTransport({ kind: 'stdio' }, { stdin, stdout });
    disposables.push(() => reader.dispose());

    const received = [];
    reader.listen((m) => received.push(m));
    const body = JSON.stringify(message);
    stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    await waitFor(() => received.length);
    expect(received[0]).toEqual(message);

    await writer.write(message);
    expect(stdout.read().toString()).toBe(`Content-Length: ${body.length}\r\n\r\n${body}`);
  });

  it('node-ipc uses the process message channel', async () => {
    const proc = fakeProcess();
    const sent = [];
    proc.send = (m, callback) => {
      sent.push(m);
      callback?.(null);
      return true;
    };
    const { reader, writer } = createTransport({ kind: 'node-ipc' }, { proc });

    const received = [];
    reader.listen((m) => received.push(m));
    proc.emit('message', message);
    expect(received).toEqual([message]);

    await writer.write(message);
    expect(sent).toEqual([message]);
  });

  it('socket connects to the port the client listens on', async () => {
    const accepted = new Promise((resolve) => {
      const server = createNetServer(resolve);
      disposables.push(() => server.close());
      server.listen(0, '127.0.0.1');
      disposables.port = new Promise((r) => server.on('listening', () => r(server.address().port)));
    });
    const port = await disposables.port;
    const { reader, writer } = createTransport({ kind: 'socket', port });
    disposables.push(() => reader.dispose());

    const socket = await accepted;
    disposables.push(() => socket.destroy());
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    await writer.write(message);
    await waitFor(() => Buffer.concat(chunks).toString().includes('"method":"test"'));
  });

  it('rejects an unknown transport', () => {
    expect(() => createTransport({ kind: 'pipe' })).toThrow('Unknown transport "pipe".');
  });
});
