import { describe, expect, it } from 'vitest';
import { detectFileKind } from '../../src/documents/fileKind.js';

describe('detectFileKind', () => {
  it.each([
    ['file:///app/src/components/user-card.component.js', 'component'],
    ['file:///app/src/pages/home.page.js', 'page'],
    ['file:///app/src/components/user-card.component.css', 'componentCss'],
    ['file:///app/src/pages/home.page.css', 'pageCss'],
    ['file:///app/src/main.app.js', 'app'],
    ['file:///app/src/bridges/user-prefs.bridge.js', 'bridge'],
    ['file:///app/src/guards/auth.guard.js', 'guard'],
    ['file:///app/avenx.config.json', 'config'],
  ])('every Avenx suffix: %s → %s', (uri, kind) => {
    expect(detectFileKind(uri)).toBe(kind);
  });

  it.each([
    ['file:///c%3A/Users/me/My%20App/src/a%20b.component.js', 'component'],
    ['file:///C:/app/home.page.css', 'pageCss'],
    ['untitled:Untitled-1.component.js', 'component'],
    ['vscode-vfs://github/org/repo/src/home.page.js', 'page'],
    ['file:///app/home.page.js?query=1#frag', 'page'],
    ['file:///app/packages/web/avenx.config.json', 'config'],
    ['file:///app/a.b.component.js', 'component'],
  ])('URI forms: %s → %s', (uri, kind) => {
    expect(detectFileKind(uri)).toBe(kind);
  });

  it.each([
    'file:///app/src/index.js',
    'file:///app/styles.css',
    'file:///app/component.js',
    'file:///app/.component.js',
    'file:///app/home.page.ts',
    'file:///app/home.component.js.map',
    'file:///app/Home.Component.js',
    'file:///app/avenx.config.json.bak',
    'file:///app/my-avenx.config.json',
    'file:///app/package.json',
    'file:///app/',
    'not a uri',
    'file:///app/%E0%A4%A.component.jsx',
  ])('other: %s', (uri) => {
    expect(detectFileKind(uri)).toBe('other');
  });

  it('falls back to the raw string for an unparsable URI', () => {
    expect(detectFileKind('relative/home.page.js')).toBe('page');
    expect(detectFileKind('relative/home.page.js?x')).toBe('page');
  });

  it('keeps an undecodable name as is', () => {
    expect(detectFileKind('file:///app/%E0%A4%A.component.js')).toBe('component');
  });
});
