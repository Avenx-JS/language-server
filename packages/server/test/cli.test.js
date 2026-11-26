import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run, version } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bin = fileURLToPath(new URL('../bin/avenx-language-server.js', import.meta.url));

function capture(argv) {
  const out = [];
  const err = [];
  const code = run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('version', () => {
  it('matches package.json', () => {
    expect(version).toBe(pkg.version);
  });
});

describe('run', () => {
  it.each(['--version', '-v'])('prints the version for %s', (flag) => {
    expect(capture([flag])).toEqual({ code: 0, out: pkg.version, err: '' });
  });

  it.each(['--help', '-h'])('prints usage for %s', (flag) => {
    const result = capture([flag]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^Usage: avenx-language-server/);
  });

  it('fails with usage when no transport is available', () => {
    const result = capture([]);
    expect(result.code).toBe(1);
    expect(result.out).toBe('');
    expect(result.err).toMatch(/not implemented yet/);
  });

  it('writes to the console by default', () => {
    const lines = [];
    const original = console.log;
    console.log = (l) => lines.push(l);
    try {
      expect(run(['--version'])).toBe(0);
    } finally {
      console.log = original;
    }
    expect(lines).toEqual([pkg.version]);
  });
});

describe('bin', () => {
  it('runs as an executable and forwards the exit code', () => {
    const ok = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe(pkg.version);

    const fail = spawnSync(process.execPath, [bin], { encoding: 'utf8' });
    expect(fail.status).toBe(1);
  });
});
