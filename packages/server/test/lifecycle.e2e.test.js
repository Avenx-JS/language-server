// Drives the real binary in a child process, the way an editor does.
import { fork, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProtocolConnection,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  IPCMessageReader,
  IPCMessageWriter,
  ShutdownRequest,
  SocketMessageReader,
  SocketMessageWriter,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { version } from '../src/version.js';

const bin = fileURLToPath(new URL('../bin/avenx-language-server.js', import.meta.url));
const children = [];
afterEach(() => children.splice(0).forEach((child) => child.exitCode === null && child.kill()));

function spawnStdio(args = ['--stdio']) {
  const child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const client = createProtocolConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  client.listen();
  return { child, client };
}

const exitCode = (child) =>
  child.exitCode !== null ? Promise.resolve(child.exitCode) : once(child, 'exit').then(([code]) => code);

async function initialize(client) {
  const result = await client.sendRequest(InitializeRequest.type, {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    workspaceFolders: null,
  });
  await client.sendNotification(InitializedNotification.type, {});
  return result;
}

async function shutdownAndExit(client) {
  expect(await client.sendRequest(ShutdownRequest.type)).toBeNull();
  await client.sendNotification(ExitNotification.type);
}

describe('stdio', () => {
  it('initializes, shuts down and exits with 0', async () => {
    const { child, client } = spawnStdio();
    const result = await initialize(client);
    expect(result.serverInfo).toEqual({ name: 'avenx-language-server', version });

    await shutdownAndExit(client);
    expect(await exitCode(child)).toBe(0);
    client.dispose();
  });

  it('is the default transport', async () => {
    const { child, client } = spawnStdio([]);
    await initialize(client);
    await shutdownAndExit(client);
    expect(await exitCode(child)).toBe(0);
    client.dispose();
  });

  it('exits with 1 on exit without shutdown', async () => {
    const { child, client } = spawnStdio();
    await initialize(client);
    await client.sendNotification(ExitNotification.type);
    expect(await exitCode(child)).toBe(1);
    client.dispose();
  });

  it('exits with 1 when the client closes stdin', async () => {
    const { child, client } = spawnStdio();
    await initialize(client);
    child.stdin.end();
    expect(await exitCode(child)).toBe(1);
    client.dispose();
  });

  it('answers unknown requests with an error and keeps running', async () => {
    const { child, client } = spawnStdio();
    await initialize(client);
    await expect(client.sendRequest('avenx/doesNotExist')).rejects.toMatchObject({ code: -32601 });
    await shutdownAndExit(client);
    expect(await exitCode(child)).toBe(0);
    client.dispose();
  });
});

describe('node-ipc', () => {
  it('initializes, shuts down and exits with 0', async () => {
    const child = fork(bin, ['--node-ipc'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.push(child);
    const client = createProtocolConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
    client.listen();

    await initialize(client);
    await shutdownAndExit(client);
    expect(await exitCode(child)).toBe(0);
    client.dispose();
  });
});

describe('socket', () => {
  it('connects to the client port, initializes, shuts down and exits with 0', async () => {
    const server = createNetServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const accepted = once(server, 'connection');

    const child = spawn(process.execPath, [bin, `--socket=${server.address().port}`], { stdio: 'ignore' });
    children.push(child);
    const [socket] = await accepted;
    const client = createProtocolConnection(new SocketMessageReader(socket), new SocketMessageWriter(socket));
    client.listen();

    await initialize(client);
    await shutdownAndExit(client);
    expect(await exitCode(child)).toBe(0);
    client.dispose();
    server.close();
  });
});

describe('command line', () => {
  it('prints the server and avenx-core version', () => {
    const result = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`^avenx-language-server ${version.replace(/\./g, '\\.')}\\navenx-core `));
  });

  it('exits with 1 on a bad argument', () => {
    const result = spawnSync(process.execPath, [bin, '--socket=nope'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--socket needs a port/);
  });
});
