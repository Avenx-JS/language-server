import { readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { componentNameFromFile, PAGES_DIR } from '../avenx/core.js';
import { parseConfig } from './config.js';
import { isInside, pathKey, pathToUri } from './paths.js';
import { ComponentRegistry } from './registry.js';

/** Directory names never scanned, anywhere. */
export const IGNORED_DIR_NAMES = new Set(['node_modules', '.git']);

const SOURCES = [
  { suffix: '.component.js', css: '.component.css', kind: 'component' },
  { suffix: '.page.js', css: '.page.css', kind: 'page' },
];

/**
 * One Avenx project: a directory with an avenx.config.json, its parsed
 * config and its component registry.
 */
export class Project {
  /**
   * @param {string} configPath Absolute path of the avenx.config.json.
   */
  constructor(configPath) {
    this.configPath = configPath;
    this.root = dirname(configPath);
    this.rootUri = pathToUri(this.root);
    /** The URI the config diagnostics are published under (the client's spelling when open). */
    this.configUri = pathToUri(configPath);
    this.registry = new ComponentRegistry();
    /** @type {import('./config.js').ConfigResult['config']} */
    this.config = parseConfig('{}').config;
    /** @type {import('./config.js').ConfigProblem[]} */
    this.problems = [];
    /** @type {import('../documents/document.js').AvenxDocument | null} The config text the problems refer to. */
    this.configDocument = null;
  }

  /** @returns {string} */
  get srcPath() {
    return join(this.root, this.config.srcDir);
  }

  /** @returns {string} */
  get pagesPath() {
    return join(this.srcPath, PAGES_DIR);
  }

  /** @returns {string} */
  get distPath() {
    return join(this.root, this.config.distDir);
  }

  /**
   * Applies new config text.
   * @param {import('../documents/document.js').AvenxDocument} document
   * @returns {boolean} Whether a directory the registry depends on changed.
   */
  applyConfig(document) {
    const before = [pathKey(this.srcPath), pathKey(this.distPath)].join('\0');
    const { config, problems } = parseConfig(document.text);
    this.config = config;
    this.problems = problems;
    this.configDocument = document;
    this.configUri = document.uri;
    return before !== [pathKey(this.srcPath), pathKey(this.distPath)].join('\0');
  }

  /**
   * True for paths this project never looks at: below `node_modules` or
   * `.git`, or in the configured output directory.
   * @param {string} path
   * @returns {boolean}
   */
  isIgnored(path) {
    if (isInside(this.distPath, path)) {
      return true;
    }
    return relative(this.root, path)
      .split(sep)
      .some((segment) => IGNORED_DIR_NAMES.has(segment));
  }

  /**
   * How the compiler would register `path`: as a component (any
   * `*.component.js` below `srcDir`), a page (`*.page.js` below
   * `srcDir/pages`), or not at all.
   * @param {string} path
   * @returns {{ kind: 'component' | 'page', name: string, cssPath: string } | null}
   */
  classify(path) {
    const name = basename(path);
    for (const source of SOURCES) {
      if (name.length <= source.suffix.length || !name.endsWith(source.suffix)) {
        continue;
      }
      const scope = source.kind === 'page' ? this.pagesPath : this.srcPath;
      if (!isInside(scope, path) || this.isIgnored(path)) {
        return null;
      }
      return {
        kind: source.kind,
        name: componentNameFromFile(name),
        cssPath: path.slice(0, -source.suffix.length) + source.css,
      };
    }
    return null;
  }

  /**
   * If `path` is a companion stylesheet, the `.js` file it belongs to.
   * @param {string} path
   * @returns {string | null}
   */
  static jsPathForCss(path) {
    for (const source of SOURCES) {
      if (path.endsWith(source.css) && basename(path).length > source.css.length) {
        return path.slice(0, -source.css.length) + source.suffix;
      }
    }
    return null;
  }

  /**
   * Scans `dir` (default: `srcDir`) and adds what it finds to the registry.
   * A full rescan clears the registry first.
   * @param {object} [options]
   * @param {string} [options.dir]
   * @param {(path: string) => boolean} [options.skip] Directories owned by another project.
   */
  async scan({ dir = this.srcPath, skip = () => false } = {}) {
    if (dir === this.srcPath) {
      this.registry.clear();
    }
    const files = [];
    const css = new Set();
    await walk(
      dir,
      (path) => this.isIgnored(path) || skip(path),
      (path) => {
        files.push(path);
        if (path.endsWith('.css')) {
          css.add(pathKey(path));
        }
      },
    );
    for (const path of files) {
      const found = this.classify(path);
      if (found) {
        this.registry.set({
          name: found.name,
          kind: found.kind,
          jsPath: path,
          cssPath: css.has(pathKey(found.cssPath)) ? found.cssPath : null,
        });
      }
    }
  }
}

/**
 * Walks a directory tree; unreadable directories are skipped.
 * @param {string} dir
 * @param {(path: string) => boolean} skipDir
 * @param {(path: string) => void} onFile
 */
export async function walk(dir, skipDir, onFile) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIR_NAMES.has(entry.name) && !skipDir(path)) {
        await walk(path, skipDir, onFile);
      }
    } else if (entry.isFile()) {
      onFile(path);
    }
  }
}
