import { describe, expect, it } from 'vitest';
import { closest, parseConfig } from '../../src/project/config.js';

/** The text a problem's range covers. */
const covered = (text, problem) => text.slice(problem.start, problem.end);

describe('parseConfig', () => {
  it('fills in the compiler defaults', () => {
    expect(parseConfig('{}')).toEqual({ config: { srcDir: 'src', distDir: 'dist' }, problems: [] });
  });

  it('keeps valid options', () => {
    const { config, problems } = parseConfig('{ "srcDir": "app", "distDir": "out", "server": { "port": 8080 } }');
    expect(problems).toEqual([]);
    expect(config).toMatchObject({ srcDir: 'app', distDir: 'out', server: { port: 8080 } });
  });

  it('reports invalid JSON at its position and falls back to defaults', () => {
    const text = '{\n  "srcDir": "app",\n  "distDir" "out"\n}';
    const { config, problems } = parseConfig(text);
    expect(config).toEqual({ srcDir: 'src', distDir: 'dist' });
    expect(problems[0]).toMatchObject({
      severity: 'error',
      code: 'config-syntax',
      message: 'Invalid JSON: colon expected.',
    });
    expect(covered(text, problems[0])).toBe('"out"');
  });

  it('rejects comments, as the compiler reads plain JSON', () => {
    const { problems } = parseConfig('{ // note\n}');
    expect(problems[0]).toMatchObject({ code: 'config-syntax', message: 'Invalid JSON: invalid comment token.' });
  });

  it('reports an empty file', () => {
    expect(parseConfig('  ').problems).toEqual([
      { start: 2, end: 2, message: 'Invalid JSON: value expected.', severity: 'error', code: 'config-syntax' },
    ]);
  });

  it('warns about an unknown option on its key, with a suggestion', () => {
    const text = '{ "srcDri": "app" }';
    const [problem] = parseConfig(text).problems;
    expect(problem).toMatchObject({
      severity: 'warning',
      code: 'config-schema',
      message: 'Unknown option "srcDri". Did you mean "srcDir"? It has no effect.',
    });
    expect(covered(text, problem)).toBe('"srcDri"');
  });

  it('warns about an unknown nested option', () => {
    const text = '{ "server": { "prot": 3000 } }';
    const [problem] = parseConfig(text).problems;
    expect(problem.message).toBe('Unknown option "server.prot". Did you mean "port"? It has no effect.');
    expect(covered(text, problem)).toBe('"prot"');
  });

  it('omits the suggestion when nothing is close', () => {
    expect(parseConfig('{ "zzzzzzzz": 1 }').problems[0].message).toBe('Unknown option "zzzzzzzz". It has no effect.');
  });

  it('reports a wrong value as an error on the value', () => {
    const text = '{ "srcDir": 42, "server": { "port": "eighty" } }';
    const problems = parseConfig(text).problems;
    expect(problems.map((p) => [p.severity, p.message, covered(text, p)])).toEqual([
      ['error', '"srcDir" must be a string.', '42'],
      [
        'error',
        '"server.port" must be an integer from 0 to 65535 or an environment variable reference like "${NAME}".',
        '"eighty"',
      ],
    ]);
  });

  it('accepts an environment variable reference where the schema allows one', () => {
    expect(parseConfig('{ "server": { "port": "${PORT}" }, "mode": "$MODE" }').problems).toEqual([]);
  });

  it('lists the allowed values of an enum', () => {
    const text = '{ "style": { "preprocessor": "stylus" } }';
    const [problem] = parseConfig(text).problems;
    expect(problem.message).toBe(
      '"style.preprocessor" must be one of "none", "sass", "scss", "less", "postcss" or an environment variable reference like "${NAME}".',
    );
    expect(covered(text, problem)).toBe('"stylus"');
  });

  it('describes every alternative of an anyOf once', () => {
    const problems = parseConfig('{ "mode": "staging" }').problems;
    expect(problems.map((p) => p.message)).toEqual([
      '"mode" must be one of "production", "development" or an environment variable reference like "${NAME}".',
    ]);
  });

  it('reports a root that is not an object', () => {
    const { config, problems } = parseConfig('[]');
    expect(problems[0]).toMatchObject({
      severity: 'error',
      message: 'The configuration must be an object.',
      start: 0,
      end: 2,
    });
    expect(config).toEqual({ srcDir: 'src', distDir: 'dist' });
  });

  it.each([
    ['an absolute srcDir', { srcDir: '/abs' }],
    ['a Windows absolute srcDir', { srcDir: 'C:\\abs' }],
    ['an empty srcDir', { srcDir: '' }],
  ])('falls back to the default directory for %s', (_, options) => {
    expect(parseConfig(JSON.stringify(options)).config.srcDir).toBe('src');
  });
});

describe('closest', () => {
  it.each([
    ['srcDri', ['srcDir', 'distDir'], 'srcDir'],
    ['DISTDIR', ['srcDir', 'distDir'], 'distDir'],
    ['xyz', ['srcDir'], undefined],
    ['a', [], undefined],
  ])('%s', (key, candidates, expected) => {
    expect(closest(key, candidates)).toBe(expected);
  });
});
