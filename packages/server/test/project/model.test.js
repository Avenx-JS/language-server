import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileChangeType } from 'vscode-languageserver/node';
import { DocumentStore } from '../../src/documents/store.js';
import { ProjectModel } from '../../src/project/model.js';
import { pathKey } from '../../src/project/paths.js';
import { createFixture, MONOREPO } from '../helpers/fixture.js';

let fixture;
let documents;
let model;
let changes;
let log;

beforeEach(async () => {
  fixture = createFixture(MONOREPO);
  log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() };
  documents = new DocumentStore({ logger: log });
  model = new ProjectModel({ documents, logger: log });
  changes = [];
  model.onDidChangeProject((change) => changes.push(change));
  await model.addFolders([{ uri: fixture.uri('') }]);
});
afterEach(() => fixture.dispose());

const shop = () => model.projectFor(fixture.uri('apps/shop/avenx.config.json'));
const admin = () => model.projectFor(fixture.uri('apps/admin/avenx.config.json'));
const names = (project) => project.registry.all().map((e) => `${e.kind}:${e.name}`);
const created = (...uris) => model.handleWatchedFiles(uris.map((uri) => ({ uri, type: FileChangeType.Created })));
const deleted = (...uris) => model.handleWatchedFiles(uris.map((uri) => ({ uri, type: FileChangeType.Deleted })));
const changed = (uri) => model.handleWatchedFiles([{ uri, type: FileChangeType.Changed }]);

describe('monorepo', () => {
  it('finds both projects and none inside node_modules', () => {
    expect(model.all().map((p) => p.rootUri)).toEqual([fixture.uri('apps/admin'), fixture.uri('apps/shop')]);
  });

  it('resolves each file to the right project', () => {
    const cases = {
      'apps/shop/src/components/product-card.component.js': 'shop',
      'apps/shop/src/pages/home.page.css': 'shop',
      'apps/shop/main.app.js': 'shop',
      'apps/shop/avenx.config.json': 'shop',
      'apps/admin/app/user-list.component.js': 'admin',
      'apps/admin/src/ignored.component.js': 'admin',
      'package.json': undefined,
      'node_modules/some-lib/src/lib.component.js': undefined,
    };
    for (const [file, expected] of Object.entries(cases)) {
      const project = model.projectFor(fixture.uri(file));
      expect([file, project && (project === shop() ? 'shop' : 'admin')]).toEqual([file, expected]);
    }
    expect(model.projectFor('untitled:Untitled-1')).toBeUndefined();
  });

  it('registers components and pages the way the compiler does, respecting ignore lists', () => {
    expect(names(shop())).toEqual(['page:Home', 'component:PriceTag', 'component:ProductCard']);
    expect(names(admin())).toEqual(['page:Settings', 'component:UserList']);
    expect(admin().registry.get('UserList').jsUri).toBe(fixture.uri('apps/admin/app/user-list.component.js'));
  });

  it('pairs each component and page with its stylesheet', () => {
    const registry = shop().registry;
    expect(registry.get('ProductCard').cssUri).toBe(fixture.uri('apps/shop/src/components/product-card.component.css'));
    expect(registry.get('Home').cssUri).toBe(fixture.uri('apps/shop/src/pages/home.page.css'));
    expect(registry.get('PriceTag').cssUri).toBeNull();
  });

  it('announces each project once', () => {
    expect(changes.map((c) => c.reason)).toEqual(['added', 'added']);
  });

  it('gives a nested project its own files', async () => {
    fixture.write('apps/shop/src/components/nested/avenx.config.json', { srcDir: '.' });
    await created(fixture.uri('apps/shop/src/components/nested/avenx.config.json'));

    const nested = model.projectFor(fixture.uri('apps/shop/src/components/nested/price-tag.component.js'));
    expect(nested.root).toBe(fixture.path('apps/shop/src/components/nested'));
    expect(names(nested)).toEqual(['component:PriceTag']);
    expect(names(shop())).toEqual(['page:Home', 'component:ProductCard']);

    fixture.remove('apps/shop/src/components/nested/avenx.config.json');
    await deleted(fixture.uri('apps/shop/src/components/nested/avenx.config.json'));
    expect(names(shop())).toEqual(['page:Home', 'component:PriceTag', 'component:ProductCard']);
  });

  it('ignores a duplicate folder and folders it cannot read', async () => {
    await model.addFolders([{ uri: fixture.uri('') }, { uri: fixture.uri('does-not-exist') }, { uri: 'untitled:x' }]);
    expect(model.all()).toHaveLength(2);
  });
});

describe('watched files', () => {
  it('adds a created component without restart', async () => {
    const uri = fixture.write('apps/shop/src/components/cart-badge.component.js', '');
    await created(uri);
    expect(shop().registry.get('CartBadge')).toMatchObject({ kind: 'component', jsUri: uri, cssUri: null });
    expect(changes.at(-1)).toMatchObject({ reason: 'registry', project: shop() });
  });

  it('pairs a stylesheet that exists when the component is created', async () => {
    fixture.write('apps/shop/src/components/badge.component.css', '');
    const uri = fixture.write('apps/shop/src/components/badge.component.js', '');
    await created(uri);
    expect(shop().registry.get('Badge').cssUri).toBe(fixture.uri('apps/shop/src/components/badge.component.css'));
  });

  it('follows a renamed component (delete + create)', async () => {
    const oldUri = fixture.remove('apps/shop/src/components/product-card.component.js');
    const newUri = fixture.write('apps/shop/src/components/product-tile.component.js', '');
    await model.handleWatchedFiles([
      { uri: oldUri, type: FileChangeType.Deleted },
      { uri: newUri, type: FileChangeType.Created },
    ]);
    expect(shop().registry.get('ProductCard')).toBeUndefined();
    expect(shop().registry.get('ProductTile').jsUri).toBe(newUri);
  });

  it('removes a deleted component', async () => {
    await deleted(fixture.remove('apps/admin/app/user-list.component.js'));
    expect(admin().registry.get('UserList')).toBeUndefined();
  });

  it('tracks a stylesheet appearing and disappearing', async () => {
    const css = fixture.write('apps/shop/src/components/nested/price-tag.component.css', '');
    await created(css);
    expect(shop().registry.get('PriceTag').cssUri).toBe(css);
    await deleted(fixture.remove('apps/shop/src/components/nested/price-tag.component.css'));
    expect(shop().registry.get('PriceTag').cssUri).toBeNull();
  });

  it('handles a deleted and a moved-in folder', async () => {
    await deleted(fixture.remove('apps/shop/src/components'));
    expect(names(shop())).toEqual(['page:Home']);

    fixture.write('apps/shop/src/ui/button.component.js', '');
    fixture.write('apps/shop/src/ui/button.component.css', '');
    await created(fixture.uri('apps/shop/src/ui'));
    expect(shop().registry.get('Button').cssUri).toBe(fixture.uri('apps/shop/src/ui/button.component.css'));
  });

  it('removes a project whose folder is deleted', async () => {
    await deleted(fixture.remove('apps/admin'));
    expect(model.all().map((p) => p.root)).toEqual([fixture.path('apps/shop')]);
    expect(changes.at(-1)).toMatchObject({ reason: 'removed', openDocuments: [] });
  });

  it.each([
    ['a page outside srcDir/pages', 'apps/shop/src/widgets/late.page.js'],
    ['a component in the output directory', 'apps/admin/app/build/late.component.js'],
    ['a component below node_modules', 'apps/shop/node_modules/x/late.component.js'],
    ['a component outside every project', 'tools/late.component.js'],
    ['a plain file', 'apps/shop/src/util.js'],
    ['a stylesheet without component', 'apps/shop/src/components/lonely.component.css'],
  ])('ignores %s', async (_, file) => {
    const before = model.all().map(names);
    await created(fixture.write(file, ''));
    expect(model.all().map(names)).toEqual(before);
  });

  it('ignores events outside the workspace, for vanished files and for non-file URIs', async () => {
    const outside = createFixture({ 'x.component.js': '' });
    try {
      await created(outside.uri('x.component.js'));
      await created(fixture.uri('apps/shop/src/components/vanished.component.js'));
      await created('untitled:Untitled-1');
      await changed(fixture.uri('apps/shop/src/components/product-card.component.js'));
      expect(names(shop())).toEqual(['page:Home', 'component:PriceTag', 'component:ProductCard']);
    } finally {
      outside.dispose();
    }
  });

  it('does not register a created component twice', async () => {
    await created(fixture.uri('apps/shop/src/components/product-card.component.js'));
    expect(shop().registry.getAll('ProductCard')).toHaveLength(1);
  });
});

describe('avenx.config.json', () => {
  it('re-validates the open documents of the project when its config changes', async () => {
    const card = documents.open({
      uri: fixture.uri('apps/shop/src/components/product-card.component.js'),
      languageId: 'avenx',
      version: 1,
      text: '',
    });
    const home = documents.open({
      uri: fixture.uri('apps/shop/src/pages/home.page.js'),
      languageId: 'avenx',
      version: 1,
      text: '',
    });
    documents.open({
      uri: fixture.uri('apps/admin/app/user-list.component.js'),
      languageId: 'avenx',
      version: 1,
      text: '',
    });

    fixture.write('apps/shop/avenx.config.json', { warnings: {} });
    await changed(fixture.uri('apps/shop/avenx.config.json'));

    const change = changes.at(-1);
    expect(change.reason).toBe('config');
    expect(change.project).toBe(shop());
    expect(change.openDocuments).toEqual([card, home]);
  });

  it('rescans when srcDir changes', async () => {
    fixture.write('apps/admin/avenx.config.json', { srcDir: 'src' });
    await changed(fixture.uri('apps/admin/avenx.config.json'));
    expect(names(admin())).toEqual(['component:Ignored']);
  });

  it('keeps an invalid config as problems, with defaults, instead of failing', async () => {
    fixture.write('apps/admin/avenx.config.json', '{ "srcDir": ');
    await changed(fixture.uri('apps/admin/avenx.config.json'));
    expect(admin().problems[0]).toMatchObject({ code: 'config-syntax', severity: 'error' });
    expect(admin().config.srcDir).toBe('src');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('prefers the open editor text over the file on disk', async () => {
    const uri = fixture.uri('apps/admin/avenx.config.json');
    documents.open({ uri, languageId: 'json', version: 3, text: '{ "srcDri": "app" }' });
    await model.configDocumentChanged(uri);
    expect(admin().problems.map((p) => p.message)).toEqual([
      'Unknown option "srcDri". Did you mean "srcDir"? It has no effect.',
    ]);
    expect(admin().configDocument.version).toBe(3);

    documents.close(uri);
    await model.configDocumentChanged(uri);
    expect(admin().problems).toEqual([]);
  });

  it('finds the open config under a different URI spelling', async () => {
    const path = fixture.path('apps/admin/avenx.config.json');
    const spelled =
      'file:///' +
      encodeURI(path.replace(/\\/g, '/').replace(/^\//, '')).replace(/^([A-Za-z]):/, (_, d) => `${d.toLowerCase()}%3A`);
    documents.open({ uri: spelled, languageId: 'json', version: 1, text: '{}' });
    await model.configDocumentChanged(spelled);
    expect(pathKey(admin().configPath)).toBe(pathKey(path));
    expect(admin().configUri).toBe(spelled);
  });

  it('ignores document events for other files', async () => {
    const before = changes.length;
    await model.configDocumentChanged(fixture.uri('apps/shop/main.app.js'));
    await model.configDocumentChanged('untitled:avenx.config.json');
    await model.configDocumentChanged(fixture.uri('tools/avenx.config.json'));
    expect(changes).toHaveLength(before);
  });

  it('adds a project when a config is created and removes it on delete', async () => {
    fixture.write('apps/blog/avenx.config.json', {});
    fixture.write('apps/blog/src/post.component.js', '');
    await created(fixture.uri('apps/blog/avenx.config.json'));
    const blog = model.projectFor(fixture.uri('apps/blog/src/post.component.js'));
    expect(names(blog)).toEqual(['component:Post']);
    expect(changes.at(-1)).toMatchObject({ reason: 'added', project: blog });

    // "Changed" for a config the model does not know yet also adds it.
    fixture.write('apps/docs/avenx.config.json', {});
    await changed(fixture.uri('apps/docs/avenx.config.json'));
    expect(model.all()).toHaveLength(4);

    await deleted(fixture.remove('apps/blog/avenx.config.json'));
    expect(model.projectFor(fixture.uri('apps/blog/src/post.component.js'))).toBeUndefined();
  });

  it('drops a project whose config vanished before it could be read', async () => {
    fixture.remove('apps/admin/avenx.config.json');
    await changed(fixture.uri('apps/admin/avenx.config.json'));
    expect(admin()).toBeUndefined();
    await created(fixture.uri('apps/ghost/avenx.config.json'));
    expect(model.all()).toHaveLength(1);
  });

  it('does not treat a config in an output directory or node_modules as a project', async () => {
    await created(fixture.write('apps/admin/app/build/avenx.config.json', {}));
    await created(fixture.write('node_modules/other/avenx.config.json', {}));
    expect(model.all()).toHaveLength(2);
  });
});

describe('workspace folders', () => {
  it('removes the projects of a removed folder', async () => {
    await model.removeFolders([{ uri: fixture.uri('') }, { uri: fixture.uri('never-added') }, { uri: 'untitled:y' }]);
    expect(model.all()).toEqual([]);
    expect(changes.slice(-2).map((c) => c.reason)).toEqual(['removed', 'removed']);
  });

  it('keeps projects still covered by another folder', async () => {
    await model.addFolders([{ uri: fixture.uri('apps/shop') }]);
    await model.removeFolders([{ uri: fixture.uri('') }]);
    expect(model.all().map((p) => p.root)).toEqual([fixture.path('apps/shop')]);
  });
});

describe('robustness', () => {
  it('logs a failing listener and a failing task without breaking the queue', async () => {
    model.onDidChangeProject(() => {
      throw new Error('listener');
    });
    await created(fixture.write('apps/shop/src/components/x.component.js', ''));
    expect(log.error.mock.calls[0][0]).toMatch(/^A project change listener failed: Error: listener/);

    const original = shop().scan;
    shop().scan = () => Promise.reject(new Error('scan failed'));
    fixture.write('apps/shop/avenx.config.json', { srcDir: 'other' });
    await changed(fixture.uri('apps/shop/avenx.config.json'));
    expect(log.error.mock.calls.at(-1)[0]).toMatch(/^Updating the project model failed: Error: scan failed/);
    shop().scan = original;

    await created(fixture.write('apps/admin/app/late.component.js', ''));
    expect(admin().registry.get('Late')).toBeDefined();
  });
});
