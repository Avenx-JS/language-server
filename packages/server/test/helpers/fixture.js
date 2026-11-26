import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A temporary directory tree. `files` maps relative paths to contents; an
 * object value is written as JSON.
 */
export function createFixture(files = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'avenx-ls-fixture-')));
  const fixture = {
    root,
    path: (relative) => join(root, ...relative.split('/')),
    uri: (relative) => pathToFileURL(fixture.path(relative)).href,
    write(relative, content = '') {
      const target = fixture.path(relative);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return fixture.uri(relative);
    },
    remove(relative) {
      rmSync(fixture.path(relative), { recursive: true, force: true });
      return fixture.uri(relative);
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
  for (const [relative, content] of Object.entries(files)) {
    fixture.write(relative, content);
  }
  return fixture;
}

/**
 * Two Avenx projects in one workspace, plus files each must ignore.
 */
export const MONOREPO = {
  'package.json': { name: 'monorepo', private: true },
  // shop: default srcDir "src", distDir "dist".
  'apps/shop/avenx.config.json': {},
  'apps/shop/src/components/product-card.component.js': '<p>card</p>',
  'apps/shop/src/components/product-card.component.css': '<@css card>p {}</@css>',
  'apps/shop/src/components/nested/price-tag.component.js': '<span></span>',
  'apps/shop/src/pages/home.page.js': '<h1>home</h1>',
  'apps/shop/src/pages/home.page.css': '',
  'apps/shop/src/widgets/not-a.page.js': '', // pages only count below src/pages
  'apps/shop/src/node_modules/lib/vendored.component.js': '',
  'apps/shop/dist/stale.component.js': '',
  'apps/shop/main.app.js': '',
  // admin: custom srcDir and an output directory inside it.
  'apps/admin/avenx.config.json': { srcDir: 'app', distDir: 'app/build' },
  'apps/admin/app/user-list.component.js': '<ul></ul>',
  'apps/admin/app/pages/settings.page.js': '',
  'apps/admin/app/build/user-list.component.js': '', // build output
  'apps/admin/src/ignored.component.js': '', // not the configured srcDir
  // Not projects: inside node_modules.
  'node_modules/some-lib/avenx.config.json': {},
  'node_modules/some-lib/src/lib.component.js': '',
};
