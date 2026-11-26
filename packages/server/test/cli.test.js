import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveAvenxCore } from '../src/avenxCore.js';
import { formatVersion, parseArgs, run, USAGE } from '../src/cli.js';
import { version } from '../src/version.js';

const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'avenx-ls-cli-')));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Creates <dir>/node_modules/avenx-core with the given package.json content. */
function installCore(dir, manifest) {
  const coreDir = join(dir, 'node_modules', 'avenx-core');
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(join(coreDir, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return coreDir;
}

function capture(argv, options = {}) {
  const out = [];
  const err = [];
  const code = run(argv, { out: (l) => out.push(l), err: (l) => err.push(l), cwd: tmp, ...options });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('parseArgs', () => {
  it.each([
    [[], { command: 'serve', transport: { kind: 'stdio' } }],
    [['--stdio'], { command: 'serve', transport: { kind: 'stdio' } }],
    [['--node-ipc'], { command: 'serve', transport: { kind: 'node-ipc' } }],
    [['--socket=6009'], { command: 'serve', transport: { kind: 'socket', port: 6009 } }],
    [['--socket', '6009'], { command: 'serve', transport: { kind: 'socket', port: 6009 } }],
    [['--node-ipc', '--clientProcessId=42'], { command: 'serve', transport: { kind: 'node-ipc' } }],
    [['--clientProcessId', '42', '--stdio'], { command: 'serve', transport: { kind: 'stdio' } }],
    [['--version'], { command: 'version' }],
    [['--stdio', '-v'], { command: 'version' }],
    [['--help'], { command: 'help' }],
    [['-h'], { command: 'help' }],
  ])('%j', (argv, expected) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it.each([
    [['--socket'], '--socket needs a port between 1 and 65535, got "".'],
    [['--socket=abc'], '--socket needs a port between 1 and 65535, got "abc".'],
    [['--socket=0'], '--socket needs a port between 1 and 65535, got "0".'],
    [['--socket=70000'], '--socket needs a port between 1 and 65535, got "70000".'],
    [['--stdio', '--node-ipc'], 'Only one transport can be used, got --stdio and --node-ipc.'],
    [['--stdio', '--stdio'], 'Only one transport can be used, got --stdio and --stdio.'],
    [['--bogus'], 'Unknown argument "--bogus".'],
    [['stdio'], 'Unknown argument "stdio".'],
  ])('rejects %j', (argv, message) => {
    expect(parseArgs(argv)).toEqual({ command: 'error', message });
  });
});

describe('run', () => {
  it('prints the server version and "not found" without avenx-core', () => {
    expect(capture(['--version'])).toEqual({
      code: 0,
      out: `avenx-language-server ${version}\navenx-core not found`,
      err: '',
    });
  });

  it('prints usage for --help', () => {
    expect(capture(['--help'])).toEqual({ code: 0, out: USAGE, err: '' });
  });

  it('fails with the reason and usage on bad arguments', () => {
    const result = capture(['--bogus']);
    expect(result.code).toBe(1);
    expect(result.out).toBe('');
    expect(result.err).toBe(`avenx-language-server: Unknown argument "--bogus".\n${USAGE}`);
  });

  it('starts the server on the parsed transport', () => {
    const serve = vi.fn();
    expect(capture(['--socket=7000'], { serve }).code).toBeUndefined();
    expect(serve).toHaveBeenCalledWith({ kind: 'socket', port: 7000 });
  });

  it('writes to the console by default', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(run(['--help'])).toBe(0);
      expect(run(['--bogus'])).toBe(1);
      expect(log).toHaveBeenCalledWith(USAGE);
      expect(error).toHaveBeenCalledWith('avenx-language-server: Unknown argument "--bogus".');
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});

describe('resolveAvenxCore', () => {
  it('finds avenx-core in a parent node_modules, like Node would', () => {
    const project = join(tmp, 'project');
    const coreDir = installCore(project, { name: 'avenx-core', version: '1.2.3' });
    const nested = join(project, 'src', 'components');
    mkdirSync(nested, { recursive: true });

    expect(resolveAvenxCore(nested)).toEqual({ version: '1.2.3', dir: coreDir });
    expect(formatVersion(nested)).toBe(`avenx-language-server ${version}\navenx-core 1.2.3 (${coreDir})`);
  });

  it('prefers the nearest installation', () => {
    const outer = join(tmp, 'outer');
    installCore(outer, { name: 'avenx-core', version: '1.0.0' });
    const inner = join(outer, 'packages', 'app');
    const innerCore = installCore(inner, { name: 'avenx-core', version: '2.0.0' });
    expect(resolveAvenxCore(inner)).toEqual({ version: '2.0.0', dir: innerCore });
  });

  it.each([
    ['a broken manifest', '{ not json'],
    ['a different package', { name: 'not-avenx', version: '1.0.0' }],
    ['a manifest without version', { name: 'avenx-core' }],
  ])('skips %s and keeps looking', (_, manifest) => {
    const outer = join(tmp, `skip-${Math.random().toString(36).slice(2)}`);
    const outerCore = installCore(outer, { name: 'avenx-core', version: '0.9.0' });
    const inner = join(outer, 'app');
    installCore(inner, manifest);
    expect(resolveAvenxCore(inner)).toEqual({ version: '0.9.0', dir: outerCore });
  });
});
