import { describe, expect, it } from 'vitest';
import { buildCapabilities } from '../src/capabilities.js';

const feature = (name, capabilities) => ({ name, capabilities: () => capabilities });

describe('buildCapabilities', () => {
  it('is empty without features', () => {
    expect(buildCapabilities([], {})).toEqual({});
  });

  it('passes the context to every feature', () => {
    const context = { initializationOptions: { hover: true } };
    const caps = buildCapabilities(
      [{ name: 'hover', capabilities: (ctx) => ({ hoverProvider: ctx.initializationOptions.hover }) }],
      context,
    );
    expect(caps).toEqual({ hoverProvider: true });
  });

  it('merges nested objects and joins arrays without duplicates', () => {
    const caps = buildCapabilities(
      [
        feature('a', {
          completionProvider: { triggerCharacters: ['<', '{'] },
          executeCommandProvider: { commands: ['x'] },
        }),
        feature('b', { completionProvider: { triggerCharacters: ['{', '@'], resolveProvider: true } }),
        feature('c', { executeCommandProvider: { commands: ['y'] }, hoverProvider: true }),
        feature('d', { hoverProvider: true, definitionProvider: undefined }),
      ],
      {},
    );
    expect(caps).toEqual({
      completionProvider: { triggerCharacters: ['<', '{', '@'], resolveProvider: true },
      executeCommandProvider: { commands: ['x', 'y'] },
      hoverProvider: true,
    });
    expect(caps).not.toHaveProperty('definitionProvider');
  });

  it('does not mutate what a feature returned', () => {
    const declared = { completionProvider: { triggerCharacters: ['<'] } };
    buildCapabilities([feature('a', declared), feature('b', { completionProvider: { triggerCharacters: ['@'] } })], {});
    expect(declared).toEqual({ completionProvider: { triggerCharacters: ['<'] } });
  });

  it.each([
    [{ hoverProvider: true }, { hoverProvider: false }, 'hoverProvider'],
    [{ hoverProvider: true }, { hoverProvider: { workDoneProgress: true } }, 'hoverProvider'],
    [
      { completionProvider: { resolveProvider: true } },
      { completionProvider: { resolveProvider: false } },
      'completionProvider.resolveProvider',
    ],
  ])('throws on conflicting declarations (%j vs %j)', (a, b, path) => {
    expect(() => buildCapabilities([feature('first', a), feature('second', b)], {})).toThrow(
      `Capability "${path}" is declared differently by features "first" and "second".`,
    );
  });

  it('skips features without capabilities or returning nothing', () => {
    expect(buildCapabilities([{ name: 'a' }, feature('b', undefined)], {})).toEqual({});
  });
});
