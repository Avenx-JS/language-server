import { basename } from 'node:path';
import { SetTraceNotification } from 'vscode-languageserver/node';
import { buildCapabilities, validateFeatures } from './capabilities.js';
import { negotiatePositionEncoding } from './documents/positions.js';
import { DocumentStore } from './documents/store.js';
import { ProjectModel } from './project/model.js';
import { features as defaultFeatures } from './features/index.js';
import { guardNotification, guardRequest } from './guard.js';
import { createLogger, formatError, LOG_LEVELS } from './logger.js';
import { version } from './version.js';

export const SERVER_NAME = 'avenx-language-server';

/**
 * Wires the LSP lifecycle (`initialize`, `initialized`, `shutdown`, `exit`) and
 * the registered features onto a connection. Does not call `connection.listen()`.
 *
 * `exit` itself is handled by `vscode-languageserver`: it ends the process with
 * code 0 after `shutdown` and 1 without it, as the specification requires.
 * @param {import('vscode-languageserver/node').Connection} connection
 * @param {{ features?: ReadonlyArray<import('./features/index.js').Feature> }} [options]
 */
export function createServer(connection, { features = defaultFeatures } = {}) {
  validateFeatures(features);

  const logger = createLogger(connection);
  const state = { initialized: false, shutdown: false, context: undefined };
  const isShutdown = () => state.shutdown;

  // Replaces the handler vscode-languageserver installs, so the logger knows
  // the trace level too; the library's tracer is updated through setTrace.
  connection.onNotification(SetTraceNotification.type, ({ value }) => logger.setTrace(value));

  connection.onInitialize(
    guardRequest(
      'initialize',
      (params) => {
        logger.setTrace(params.trace ?? 'off');
        const initializationOptions = isObject(params.initializationOptions) ? params.initializationOptions : {};
        applyLogLevel(logger, initializationOptions.logLevel);

        const clientCapabilities = params.capabilities ?? {};
        const positionEncoding = negotiatePositionEncoding(clientCapabilities);
        const documents = new DocumentStore({ encoding: positionEncoding, logger });
        const context = {
          connection,
          logger,
          clientCapabilities,
          positionEncoding,
          documents,
          projects: new ProjectModel({ documents, logger }),
          initializationOptions,
          workspaceFolders: resolveWorkspaceFolders(params),
          onRequest: (type, handler) => connection.onRequest(type, guardRequest(type, handler, { logger, isShutdown })),
          onNotification: (type, handler) =>
            connection.onNotification(type, guardNotification(type, handler, { logger })),
        };
        state.context = context;

        const capabilities = buildCapabilities(features, context);
        // Protocol negotiation, not a feature: answered whenever the client asked.
        if (clientCapabilities.general?.positionEncodings) {
          capabilities.positionEncoding = positionEncoding;
        }
        for (const feature of features) {
          feature.register?.(context);
        }

        return { capabilities, serverInfo: { name: SERVER_NAME, version } };
      },
      { logger, isShutdown },
    ),
  );

  connection.onInitialized(
    guardNotification(
      'initialized',
      async () => {
        state.initialized = true;
        const { context } = state;
        logger.info(
          `${SERVER_NAME} ${version} initialized with ${features.length} feature(s) ` +
            `and ${context.workspaceFolders.length} workspace folder(s).`,
        );
        for (const feature of features) {
          try {
            await feature.initialized?.(context);
          } catch (error) {
            logger.error(`Feature "${feature.name}" failed to initialize: ${formatError(error)}`);
          }
        }
      },
      { logger },
    ),
  );

  connection.onShutdown(
    guardRequest(
      'shutdown',
      async () => {
        logger.info('Shutdown requested.');
        for (const feature of features) {
          try {
            await feature.dispose?.();
          } catch (error) {
            logger.error(`Feature "${feature.name}" failed to dispose: ${formatError(error)}`);
          }
        }
        state.shutdown = true;
      },
      { logger, isShutdown },
    ),
  );

  return { logger, state };
}

/**
 * `workspaceFolders` from `initialize`, falling back to the deprecated
 * `rootUri` for clients that do not support workspace folders.
 * @param {import('vscode-languageserver/node').InitializeParams} params
 * @returns {import('vscode-languageserver/node').WorkspaceFolder[]}
 */
export function resolveWorkspaceFolders(params) {
  if (Array.isArray(params.workspaceFolders)) {
    return params.workspaceFolders;
  }
  if (typeof params.rootUri === 'string') {
    return [{ uri: params.rootUri, name: folderName(params.rootUri) }];
  }
  return [];
}

/**
 * @param {string} uri
 * @returns {string}
 */
function folderName(uri) {
  try {
    return basename(decodeURIComponent(new URL(uri).pathname)) || uri;
  } catch {
    return uri;
  }
}

/**
 * @param {import('./logger.js').Logger} logger
 * @param {unknown} level
 */
function applyLogLevel(logger, level) {
  if (level === undefined) {
    return;
  }
  if (!logger.setLevel(level)) {
    logger.warn(
      `Ignoring unknown initializationOptions.logLevel ${JSON.stringify(level)}; use one of ${LOG_LEVELS.join(', ')}.`,
    );
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
