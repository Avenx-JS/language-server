import { describe, expect, it, vi } from 'vitest';
import * as api from '../src/index.js';
import { startServer } from '../src/start.js';
import { fakeProcess } from './helpers/lsp.js';

describe('public API', () => {
  it('exports the entry points', () => {
    expect(Object.keys(api).sort()).toEqual(
      ['SERVER_NAME', 'createServer', 'features', 'parseArgs', 'run', 'startServer', 'version'].sort(),
    );
  });
});

describe('startServer over node-ipc', () => {
  it('exits with 1 when the IPC channel disconnects before shutdown', () => {
    const proc = fakeProcess();
    proc.send = () => true;
    const exit = vi.fn();
    const target = {};
    const { connection } = startServer({ kind: 'node-ipc' }, { proc, exit, console: target });

    proc.emit('disconnect');
    proc.emit('disconnect');
    expect(exit.mock.calls).toEqual([[1]]);
    // The console is only redirected on stdio, where stdout is the protocol channel.
    expect(target).toEqual({});
    connection.dispose();
  });
});
