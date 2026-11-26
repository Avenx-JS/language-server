import { stat } from 'node:fs/promises';
import { basename, dirname, relative, sep } from 'node:path';
import { FileChangeType } from 'vscode-languageserver/node';
import { CONFIG_FILE_NAME } from '../avenx/core.js';
import { formatError } from '../logger.js';
import { isInside, pathKey, uriToPath } from './paths.js';
import { IGNORED_DIR_NAMES, Project, walk } from './project.js';

/**
 * @typedef {object} ProjectChange
 * @property {Project} project The project that changed.
 * @property {'added' | 'config' | 'registry' | 'removed'} reason
 *   `config`: avenx.config.json changed (on disk or in the editor).
 * @property {import('../documents/document.js').AvenxDocument[]} openDocuments
 *   The open documents of the project. On `added` and `config` every one of
 *   them has to be validated again.
 */

/**
 * The projects of all workspace folders.
 *
 * A project is a directory that contains an avenx.config.json; a workspace
 * folder may contain several (monorepo), also nested. A file belongs to the
 * deepest project root above it.
 *
 * All changes go through one queue, so a watcher event never interleaves
 * with a scan. `ready()` resolves once everything queued so far is applied.
 */
export class ProjectModel {
  /**
   * @param {object} options
   * @param {import('../documents/store.js').DocumentStore} options.documents
   * @param {import('../logger.js').Logger} [options.logger]
   */
  constructor({ documents, logger }) {
    this._documents = documents;
    this._logger = logger;
    /** @type {Map<string, string>} pathKey → folder path */
    this._folders = new Map();
    /** @type {Map<string, Project>} pathKey(root) → project */
    this._projects = new Map();
    this._queue = Promise.resolve();
    this._listeners = new Set();
  }

  /** @returns {Promise<void>} Resolves when all queued work is done. */
  ready() {
    return this._queue;
  }

  /** @returns {Project[]} Sorted by root. */
  all() {
    return [...this._projects.values()].sort((a, b) => a.root.localeCompare(b.root));
  }

  /**
   * The project a file belongs to: the deepest root above it.
   * @param {string} uri
   * @returns {Project | undefined}
   */
  projectFor(uri) {
    const path = uriToPath(uri);
    return path === null ? undefined : this._projectForPath(path);
  }

  /**
   * @param {(change: ProjectChange) => void} listener
   * @returns {{ dispose: () => void }}
   */
  onDidChangeProject(listener) {
    this._listeners.add(listener);
    return { dispose: () => this._listeners.delete(listener) };
  }

  /**
   * Adds workspace folders and discovers their projects.
   * @param {Array<{ uri: string }>} folders
   * @returns {Promise<void>}
   */
  addFolders(folders) {
    return this._enqueue(async () => {
      const added = [];
      for (const { uri } of folders) {
        const path = uriToPath(uri);
        if (path !== null && !this._folders.has(pathKey(path))) {
          this._folders.set(pathKey(path), path);
          added.push(path);
        }
      }
      const configs = [];
      for (const folder of added) {
        await walk(
          folder,
          () => false,
          (path) => basename(path) === CONFIG_FILE_NAME && configs.push(path),
        );
      }
      await this._addProjects(configs);
    });
  }

  /**
   * Removes workspace folders and their projects.
   * @param {Array<{ uri: string }>} folders
   * @returns {Promise<void>}
   */
  removeFolders(folders) {
    return this._enqueue(async () => {
      for (const { uri } of folders) {
        const path = uriToPath(uri);
        if (path === null || !this._folders.delete(pathKey(path))) {
          continue;
        }
        for (const project of this.all()) {
          if (isInside(path, project.root) && !this._inFolder(project.root)) {
            this._removeProject(project);
          }
        }
      }
    });
  }

  /**
   * Applies `workspace/didChangeWatchedFiles` events. A rename arrives as a
   * delete followed by a create.
   * @param {ReadonlyArray<import('vscode-languageserver/node').FileEvent>} changes
   * @returns {Promise<void>}
   */
  handleWatchedFiles(changes) {
    return this._enqueue(async () => {
      for (const { uri, type } of changes) {
        const path = uriToPath(uri);
        // "npm install" sends thousands of events; drop them before any stat.
        if (path === null || !this._inFolder(path) || this._belowIgnoredDir(path)) {
          continue;
        }
        if (basename(path) === CONFIG_FILE_NAME) {
          await this._configEvent(path, type);
        } else if (type === FileChangeType.Deleted) {
          this._deleted(path);
        } else if (type === FileChangeType.Created) {
          await this._created(path);
        }
      }
    });
  }

  /**
   * Re-reads a project's config after its avenx.config.json was edited,
   * opened or closed in the editor (the open text wins over the file).
   * @param {string} uri
   * @returns {Promise<void>}
   */
  configDocumentChanged(uri) {
    const path = uriToPath(uri);
    if (path === null || basename(path) !== CONFIG_FILE_NAME) {
      return this._queue;
    }
    return this._enqueue(async () => {
      const project = this._projects.get(pathKey(dirname(path)));
      if (project) {
        await this._reloadConfig(project);
      }
    });
  }

  // ---- internals: only called from inside the queue ----

  /**
   * @param {() => Promise<void>} task
   * @returns {Promise<void>}
   */
  _enqueue(task) {
    this._queue = this._queue.then(task).catch((error) => {
      this._logger?.error(`Updating the project model failed: ${formatError(error)}`);
    });
    return this._queue;
  }

  /**
   * @param {string} path
   * @param {number} type
   */
  async _configEvent(path, type) {
    const project = this._projects.get(pathKey(dirname(path)));
    if (type === FileChangeType.Deleted) {
      if (project) {
        this._removeProject(project);
        await this._rescanAround(project.root);
      }
    } else if (project) {
      await this._reloadConfig(project);
    } else if (!this._ignoredForDiscovery(path)) {
      await this._addProjects([path]);
    }
  }

  /**
   * @param {string[]} configPaths
   */
  async _addProjects(configPaths) {
    const created = [];
    for (const configPath of configPaths) {
      if (this._ignoredForDiscovery(configPath)) {
        continue;
      }
      const project = new Project(configPath);
      const document = await this._readConfig(project);
      if (!document) {
        continue;
      }
      project.applyConfig(document);
      this._projects.set(pathKey(project.root), project);
      created.push(project);
    }
    if (created.length === 0) {
      return;
    }
    // A new root can take files over from a project above it; rescan those too.
    const affected = new Set(created);
    for (const project of created) {
      for (const other of this._projects.values()) {
        if (isInside(other.root, project.root)) {
          affected.add(other);
        }
      }
    }
    for (const project of affected) {
      await this._scan(project);
    }
    for (const project of affected) {
      this._emit(project, created.includes(project) ? 'added' : 'registry');
    }
  }

  /**
   * @param {Project} project
   */
  _removeProject(project) {
    this._projects.delete(pathKey(project.root));
    project.registry.clear();
    this._emit(project, 'removed');
  }

  /**
   * Rescans the projects above `root`, which may own its files now.
   * @param {string} root
   */
  async _rescanAround(root) {
    for (const project of this._projects.values()) {
      if (isInside(project.root, root)) {
        await this._scan(project);
        this._emit(project, 'registry');
      }
    }
  }

  /**
   * @param {Project} project
   */
  async _reloadConfig(project) {
    const document = await this._readConfig(project);
    if (!document) {
      this._removeProject(project);
      await this._rescanAround(project.root);
      return;
    }
    if (project.applyConfig(document)) {
      await this._scan(project);
    }
    this._emit(project, 'config');
  }

  /**
   * Full rescan of a project, leaving out nested project roots.
   * @param {Project} project
   */
  async _scan(project) {
    const nested = this.all().filter((other) => other !== project && isInside(project.root, other.root));
    await project.scan({ skip: (dir) => nested.some((other) => isInside(other.root, dir)) });
  }

  /**
   * A file or folder was deleted: forget everything at or below it.
   * @param {string} path
   */
  _deleted(path) {
    for (const project of this.all()) {
      if (isInside(path, project.root)) {
        this._removeProject(project);
      } else if (project.registry.deleteUnder(path)) {
        this._emit(project, 'registry');
      }
    }
  }

  /**
   * A file or folder was created.
   * @param {string} path
   */
  async _created(path) {
    let info;
    try {
      info = await stat(path);
    } catch {
      return; // Already gone again.
    }
    if (info.isDirectory()) {
      const configs = [];
      const sources = [];
      await walk(
        path,
        () => false,
        (file) => (basename(file) === CONFIG_FILE_NAME ? configs : sources).push(file),
      );
      await this._addProjects(configs);
      for (const file of sources) {
        await this._fileCreated(file);
      }
      return;
    }
    await this._fileCreated(path);
  }

  /**
   * @param {string} path
   */
  async _fileCreated(path) {
    const project = this._projectForPath(path);
    if (!project) {
      return;
    }
    const jsForCss = Project.jsPathForCss(path);
    if (jsForCss) {
      if (!project.isIgnored(path) && project.registry.setCss(jsForCss, path)) {
        this._emit(project, 'registry');
      }
      return;
    }
    const found = project.classify(path);
    if (!found || project.registry.entryForPath(path)) {
      return;
    }
    const css = (await isFile(found.cssPath)) ? found.cssPath : null;
    project.registry.set({ name: found.name, kind: found.kind, jsPath: path, cssPath: css });
    this._emit(project, 'registry');
  }

  /**
   * The open document for the config (whatever URI spelling the client
   * used), else the file on disk.
   * @param {Project} project
   * @returns {Promise<import('../documents/document.js').AvenxDocument | null>}
   */
  async _readConfig(project) {
    const key = pathKey(project.configPath);
    const open = this._documents.all().find((d) => {
      const path = uriToPath(d.uri);
      return path !== null && pathKey(path) === key;
    });
    return open ?? (await this._documents.read(project.configUri));
  }

  /**
   * @param {string} path
   * @returns {Project | undefined}
   */
  _projectForPath(path) {
    let best;
    for (const project of this._projects.values()) {
      if (isInside(project.root, path) && (!best || project.root.length > best.root.length)) {
        best = project;
      }
    }
    return best;
  }

  /**
   * @param {string} path
   * @returns {boolean}
   */
  _inFolder(path) {
    for (const folder of this._folders.values()) {
      if (isInside(folder, path)) {
        return true;
      }
    }
    return false;
  }

  /**
   * True when a segment of `path` below its workspace folder is
   * `node_modules` or `.git`.
   * @param {string} path
   * @returns {boolean}
   */
  _belowIgnoredDir(path) {
    for (const folder of this._folders.values()) {
      if (
        isInside(folder, path) &&
        relative(folder, path)
          .split(sep)
          .some((s) => IGNORED_DIR_NAMES.has(s))
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * A config below node_modules / .git, or in another project's output
   * directory, is not a project of its own.
   * @param {string} configPath
   * @returns {boolean}
   */
  _ignoredForDiscovery(configPath) {
    if (!this._inFolder(configPath) || this._belowIgnoredDir(configPath)) {
      return true;
    }
    return [...this._projects.values()].some(
      (project) => isInside(project.distPath, configPath) && pathKey(project.configPath) !== pathKey(configPath),
    );
  }

  /**
   * @param {Project} project
   * @param {ProjectChange['reason']} reason
   */
  _emit(project, reason) {
    const openDocuments =
      reason === 'removed' ? [] : this._documents.all().filter((document) => this.projectFor(document.uri) === project);
    for (const listener of this._listeners) {
      try {
        listener({ project, reason, openDocuments });
      } catch (error) {
        this._logger?.error(`A project change listener failed: ${formatError(error)}`);
      }
    }
  }
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
