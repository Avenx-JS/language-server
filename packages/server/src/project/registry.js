import { isInside, pathKey, pathToUri } from './paths.js';

/**
 * @typedef {object} ComponentEntry
 * @property {string} name Registered name, e.g. `UserCard`.
 * @property {'component' | 'page'} kind Pages are `*.page.js` below `srcDir/pages`.
 * @property {string} jsUri The `.component.js` / `.page.js` file.
 * @property {string | null} cssUri The companion stylesheet, null when there is none.
 * @property {string} jsPath Absolute path of `jsUri`.
 * @property {string | null} cssPath Absolute path of `cssUri`.
 */

/**
 * Component and page files of one project, by name and by file.
 *
 * Two files can derive the same name (`a/card.component.js`,
 * `b/card.component.js`); the compiler refuses such a build. Both are kept so
 * a later diagnostic can point at the clash; `get` returns the first by path.
 */
export class ComponentRegistry {
  constructor() {
    /** @type {Map<string, ComponentEntry>} pathKey(jsPath) → entry */
    this._byFile = new Map();
    /** @type {Map<string, Set<string>>} name → pathKeys */
    this._byName = new Map();
  }

  /** @returns {number} */
  get size() {
    return this._byFile.size;
  }

  /**
   * @param {string} name
   * @returns {ComponentEntry | undefined}
   */
  get(name) {
    return this.getAll(name)[0];
  }

  /**
   * Every entry registered under `name`, sorted by path.
   * @param {string} name
   * @returns {ComponentEntry[]}
   */
  getAll(name) {
    const keys = this._byName.get(name);
    if (!keys) {
      return [];
    }
    return [...keys].map((key) => this._byFile.get(key)).sort((a, b) => a.jsPath.localeCompare(b.jsPath));
  }

  /** @returns {ComponentEntry[]} All entries, sorted by name then path. */
  all() {
    return [...this._byFile.values()].sort((a, b) => a.name.localeCompare(b.name) || a.jsPath.localeCompare(b.jsPath));
  }

  /** @returns {Map<string, ComponentEntry[]>} Names registered by more than one file. */
  duplicates() {
    const result = new Map();
    for (const name of this._byName.keys()) {
      const entries = this.getAll(name);
      if (entries.length > 1) {
        result.set(name, entries);
      }
    }
    return result;
  }

  /**
   * The entry whose `.js` or `.css` file is `path`.
   * @param {string} path
   * @returns {ComponentEntry | undefined}
   */
  entryForPath(path) {
    const key = pathKey(path);
    const direct = this._byFile.get(key);
    if (direct) {
      return direct;
    }
    for (const entry of this._byFile.values()) {
      if (entry.cssPath && pathKey(entry.cssPath) === key) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Adds or replaces the entry for a `.js` file.
   * @param {{ name: string, kind: 'component' | 'page', jsPath: string, cssPath: string | null }} entry
   * @returns {ComponentEntry}
   */
  set({ name, kind, jsPath, cssPath }) {
    this.delete(jsPath);
    const key = pathKey(jsPath);
    const entry = Object.freeze({
      name,
      kind,
      jsPath,
      cssPath,
      jsUri: pathToUri(jsPath),
      cssUri: cssPath ? pathToUri(cssPath) : null,
    });
    this._byFile.set(key, entry);
    if (!this._byName.has(name)) {
      this._byName.set(name, new Set());
    }
    this._byName.get(name).add(key);
    return entry;
  }

  /**
   * Sets or clears the companion stylesheet of the entry for `jsPath`.
   * @param {string} jsPath
   * @param {string | null} cssPath
   * @returns {boolean} Whether an entry was updated.
   */
  setCss(jsPath, cssPath) {
    const entry = this._byFile.get(pathKey(jsPath));
    if (!entry) {
      return false;
    }
    this.set({ ...entry, cssPath });
    return true;
  }

  /**
   * @param {string} jsPath
   * @returns {boolean}
   */
  delete(jsPath) {
    const key = pathKey(jsPath);
    const entry = this._byFile.get(key);
    if (!entry) {
      return false;
    }
    this._byFile.delete(key);
    const names = this._byName.get(entry.name);
    names.delete(key);
    if (names.size === 0) {
      this._byName.delete(entry.name);
    }
    return true;
  }

  /**
   * Removes every entry whose `.js` file is `path` or below it, and clears
   * stylesheets that are. Used for deleted files and folders.
   * @param {string} path
   * @returns {boolean} Whether anything changed.
   */
  deleteUnder(path) {
    let changed = false;
    for (const entry of [...this._byFile.values()]) {
      if (isInside(path, entry.jsPath)) {
        changed = this.delete(entry.jsPath) || changed;
      } else if (entry.cssPath && isInside(path, entry.cssPath)) {
        changed = this.setCss(entry.jsPath, null) || changed;
      }
    }
    return changed;
  }

  /** Removes all entries. */
  clear() {
    this._byFile.clear();
    this._byName.clear();
  }
}
