import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { componentNameFromFile } from '../../src/avenx/core.js';
import { ComponentRegistry } from '../../src/project/registry.js';

const root = resolve('/app/src');
const p = (...segments) => join(root, ...segments);

function registry() {
  const r = new ComponentRegistry();
  r.set({
    name: 'Card',
    kind: 'component',
    jsPath: p('a', 'card.component.js'),
    cssPath: p('a', 'card.component.css'),
  });
  r.set({ name: 'Card', kind: 'component', jsPath: p('b', 'card.component.js'), cssPath: null });
  r.set({ name: 'Home', kind: 'page', jsPath: p('pages', 'home.page.js'), cssPath: null });
  return r;
}

describe('ComponentRegistry', () => {
  it('maps names to entries with URIs', () => {
    const r = registry();
    expect(r.size).toBe(3);
    expect(r.get('Home')).toEqual({
      name: 'Home',
      kind: 'page',
      jsPath: p('pages', 'home.page.js'),
      cssPath: null,
      jsUri: pathToFileURL(p('pages', 'home.page.js')).href,
      cssUri: null,
    });
    expect(r.get('Missing')).toBeUndefined();
    expect(r.all().map((e) => e.name)).toEqual(['Card', 'Card', 'Home']);
  });

  it('keeps duplicate names and returns the first by path', () => {
    const r = registry();
    expect(r.get('Card').jsPath).toBe(p('a', 'card.component.js'));
    expect([...r.duplicates().keys()]).toEqual(['Card']);
    expect(r.duplicates().get('Card')).toHaveLength(2);
  });

  it('finds the entry for its .js or .css file', () => {
    const r = registry();
    expect(r.entryForPath(p('a', 'card.component.css')).jsPath).toBe(p('a', 'card.component.js'));
    expect(r.entryForPath(p('b', 'card.component.js')).cssPath).toBeNull();
    expect(r.entryForPath(p('nope.component.js'))).toBeUndefined();
  });

  it('sets and clears the companion stylesheet', () => {
    const r = registry();
    expect(r.setCss(p('b', 'card.component.js'), p('b', 'card.component.css'))).toBe(true);
    expect(r.entryForPath(p('b', 'card.component.js')).cssUri).toBe(pathToFileURL(p('b', 'card.component.css')).href);
    expect(r.setCss(p('missing.component.js'), null)).toBe(false);
  });

  it('deletes single files and whole folders', () => {
    const r = registry();
    expect(r.delete(p('b', 'card.component.js'))).toBe(true);
    expect(r.delete(p('b', 'card.component.js'))).toBe(false);
    expect(r.duplicates().size).toBe(0);

    // Deleting a stylesheet's folder clears the stylesheet only.
    r.set({
      name: 'Logo',
      kind: 'component',
      jsPath: p('logo.component.js'),
      cssPath: p('styles', 'logo.component.css'),
    });
    expect(r.deleteUnder(p('styles'))).toBe(true);
    expect(r.get('Logo').cssPath).toBeNull();

    expect(r.deleteUnder(p('a'))).toBe(true);
    expect(r.get('Card')).toBeUndefined();
    expect(r.deleteUnder(p('nothing-here'))).toBe(false);
    r.clear();
    expect(r.size).toBe(0);
  });
});

describe('componentNameFromFile (via avenx-core)', () => {
  it.each([
    ['user-card.component.js', 'UserCard'],
    ['user_card.component.js', 'UserCard'],
    ['home.page.js', 'Home'],
    ['order-history.page.js', 'OrderHistory'],
  ])('%s → %s', (file, name) => {
    expect(componentNameFromFile(file)).toBe(name);
  });
});
