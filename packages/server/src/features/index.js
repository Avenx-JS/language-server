import { documentsFeature } from './documents.js';
import { projectsFeature } from './projects.js';

/**
 * The central feature registry.
 *
 * Every language feature (diagnostics, completion, hover, …) is one entry in
 * `features`. The server builds the `initialize` capabilities from this list
 * alone, so a capability is advertised exactly when the feature implementing it
 * is registered here.
 *
 * A feature registers its handlers through `context.onRequest` and
 * `context.onNotification`, never on the connection directly: those wrappers
 * log a thrown error and answer it with an LSP error instead of letting it
 * escape (NFR-3).
 * @example
 * export const hoverFeature = {
 *   name: 'hover',
 *   capabilities: () => ({ hoverProvider: true }),
 *   register(context) {
 *     context.onRequest(HoverRequest.type, (params) => computeHover(params));
 *   },
 * };
 */

/**
 * @typedef {object} FeatureContext
 * @property {import('vscode-languageserver/node').Connection} connection
 *   The raw connection, e.g. for sending notifications. Register handlers via onRequest/onNotification.
 * @property {import('../logger.js').Logger} logger The server logger.
 * @property {import('vscode-languageserver/node').ClientCapabilities} clientCapabilities
 *   What the client supports, from `initialize`.
 * @property {'utf-16' | 'utf-8'} positionEncoding
 *   The negotiated position encoding; every position sent or received uses it.
 * @property {import('../documents/store.js').DocumentStore} documents
 *   Open documents, with a fallback to the file on disk.
 * @property {import('../project/model.js').ProjectModel} projects
 *   The Avenx projects of the workspace and their component registries.
 * @property {Record<string, unknown>} initializationOptions
 *   The client's `initializationOptions`, always an object.
 * @property {import('vscode-languageserver/node').WorkspaceFolder[]} workspaceFolders
 *   `workspaceFolders`, falling back to the deprecated `rootUri`; possibly empty.
 * @property {(type: string | { method: string }, handler: Function) => import('vscode-languageserver/node').Disposable} onRequest
 *   Registers a request handler whose errors are logged and answered with an LSP error.
 * @property {(type: string | { method: string }, handler: Function) => import('vscode-languageserver/node').Disposable} onNotification
 *   Registers a notification handler whose errors are logged.
 */

/**
 * @typedef {object} Feature
 * @property {string} name Unique name, used in logs and capability conflict errors.
 * @property {(context: FeatureContext) => import('vscode-languageserver/node').ServerCapabilities} [capabilities]
 *   The capabilities this feature implements. Called once during `initialize`.
 * @property {(context: FeatureContext) => void} [register]
 *   Registers the feature's handlers. Called during `initialize`, after `capabilities`.
 * @property {(context: FeatureContext) => void | Promise<void>} [initialized]
 *   Called on the client's `initialized` notification, e.g. for dynamic registration.
 * @property {() => void | Promise<void>} [dispose] Called on `shutdown`.
 */

/** @type {ReadonlyArray<Feature>} */
export const features = Object.freeze([documentsFeature, projectsFeature]);
