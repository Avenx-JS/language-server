import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatError } from '../logger.js';
import { AvenxDocument } from './document.js';
import { UTF16 } from './positions.js';

/**
 * The in-memory copy of all documents open in the client.
 *
 * Open documents are kept as immutable `AvenxDocument` snapshots. A document
 * that is not open is read from disk on demand (`read`), so cross-file
 * features see the same text the compiler would.
 */
export class DocumentStore {
  /**
   * @param {object} [options]
   * @param {string} [options.encoding] Negotiated position encoding.
   * @param {import('../logger.js').Logger} [options.logger]
   * @param {{ readFile: typeof readFile, stat: typeof stat }} [options.fs] Injectable for tests.
   */
  constructor({ encoding = UTF16, logger, fs = { readFile, stat } } = {}) {
    this.encoding = encoding;
    this._logger = logger;
    this._fs = fs;
    /** @type {Map<string, AvenxDocument>} */
    this._open = new Map();
    /** @type {Map<string, { mtimeMs: number, size: number, document: AvenxDocument }>} */
    this._disk = new Map();
    this._listeners = { open: new Set(), change: new Set(), close: new Set() };
  }

  /**
   * The current snapshot of an open document.
   * @param {string} uri
   * @returns {AvenxDocument | undefined}
   */
  get(uri) {
    return this._open.get(uri);
  }

  /** @returns {AvenxDocument[]} All open documents. */
  all() {
    return [...this._open.values()];
  }

  /**
   * Handles `textDocument/didOpen`.
   * @param {import('vscode-languageserver/node').TextDocumentItem} item
   * @returns {AvenxDocument}
   */
  open({ uri, languageId, version, text }) {
    const document = new AvenxDocument({ uri, languageId, version, text, encoding: this.encoding });
    this._open.set(uri, document);
    this._emit('open', document);
    return document;
  }

  /**
   * Handles `textDocument/didChange`.
   * @param {import('vscode-languageserver/node').VersionedTextDocumentIdentifier} identifier
   * @param {ReadonlyArray<import('vscode-languageserver/node').TextDocumentContentChangeEvent>} changes
   * @returns {AvenxDocument | undefined} The new snapshot, or undefined for a document that is not open.
   */
  change({ uri, version }, changes) {
    const current = this._open.get(uri);
    if (!current) {
      this._logger?.warn(`Ignoring change to "${uri}", which is not open.`);
      return undefined;
    }
    if (current.version !== null && version <= current.version) {
      // The protocol guarantees increasing versions; apply anyway, the order of
      // the notifications is what defines the text.
      this._logger?.warn(`Version of "${uri}" went from ${current.version} to ${version}.`);
    }
    const next = current.withChanges(changes, version);
    this._open.set(uri, next);
    this._emit('change', next);
    return next;
  }

  /**
   * Handles `textDocument/didClose`. Later reads fall back to the file on disk.
   * @param {string} uri
   */
  close(uri) {
    const document = this._open.get(uri);
    if (!document) {
      return;
    }
    this._open.delete(uri);
    this._emit('close', document);
  }

  /**
   * True while `document` is the latest snapshot of its URI. A result computed
   * from a snapshot for which this is false describes outdated text and must
   * be discarded.
   * @param {AvenxDocument} document
   * @returns {boolean}
   */
  isCurrent(document) {
    return this._open.get(document.uri) === document;
  }

  /**
   * Runs `compute` on the current snapshot of an open document and returns its
   * result only if the document has not changed (or closed) meanwhile.
   * @template T
   * @param {string} uri
   * @param {(document: AvenxDocument) => T | Promise<T>} compute
   * @returns {Promise<{ document: AvenxDocument, value: T } | null>} null when not open or stale.
   */
  async computeForCurrent(uri, compute) {
    const document = this._open.get(uri);
    if (!document) {
      return null;
    }
    const value = await compute(document);
    return this.isCurrent(document) ? { document, value } : null;
  }

  /**
   * The open document, or else the file on disk (`file:` URIs only).
   * Disk reads are cached by modification time and size.
   * @param {string} uri
   * @returns {Promise<AvenxDocument | null>} null when neither exists.
   */
  async read(uri) {
    const open = this._open.get(uri);
    if (open) {
      return open;
    }
    let path;
    try {
      path = fileURLToPath(uri);
    } catch {
      return null;
    }
    try {
      const info = await this._fs.stat(path);
      if (!info.isFile()) {
        return null;
      }
      const cached = this._disk.get(uri);
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        return cached.document;
      }
      const text = await this._fs.readFile(path, 'utf8');
      const document = new AvenxDocument({ uri, text, version: null, encoding: this.encoding });
      this._disk.set(uri, { mtimeMs: info.mtimeMs, size: info.size, document });
      return document;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
        this._logger?.warn(`Could not read "${uri}": ${formatError(error)}`);
      }
      this._disk.delete(uri);
      return null;
    }
  }

  /**
   * @param {(document: AvenxDocument) => void} listener
   * @returns {{ dispose: () => void }}
   */
  onDidOpen(listener) {
    return this._subscribe('open', listener);
  }

  /**
   * @param {(document: AvenxDocument) => void} listener
   * @returns {{ dispose: () => void }}
   */
  onDidChange(listener) {
    return this._subscribe('change', listener);
  }

  /**
   * @param {(document: AvenxDocument) => void} listener Receives the last snapshot.
   * @returns {{ dispose: () => void }}
   */
  onDidClose(listener) {
    return this._subscribe('close', listener);
  }

  /**
   * @param {'open' | 'change' | 'close'} event
   * @param {Function} listener
   * @returns {{ dispose: () => void }}
   */
  _subscribe(event, listener) {
    this._listeners[event].add(listener);
    return { dispose: () => this._listeners[event].delete(listener) };
  }

  /**
   * Calls the listeners; one that throws is logged and does not stop the others.
   * @param {'open' | 'change' | 'close'} event
   * @param {AvenxDocument} document
   */
  _emit(event, document) {
    for (const listener of this._listeners[event]) {
      try {
        listener(document);
      } catch (error) {
        this._logger?.error(`A did${event} listener for "${document.uri}" failed: ${formatError(error)}`);
      }
    }
  }
}
