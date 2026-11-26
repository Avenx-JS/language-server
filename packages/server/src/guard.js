import { ErrorCodes, ResponseError } from 'vscode-languageserver/node';
import { formatError } from './logger.js';

const methodOf = (type) => (typeof type === 'string' ? type : type.method);

/**
 * Wraps a request handler so that a thrown error (or rejected promise) is
 * logged and answered with an `InternalError` response instead of escaping.
 * A `ResponseError` thrown on purpose is passed through unchanged.
 * Each handled request is traced, with its params when the trace is `verbose`.
 * @param {string | { method: string }} type
 * @param {Function} handler
 * @param {{ logger: import('./logger.js').Logger, isShutdown: () => boolean }} options
 * @returns {Function}
 */
export function guardRequest(type, handler, { logger, isShutdown }) {
  const method = methodOf(type);
  return async (params, ...rest) => {
    if (isShutdown()) {
      throw new ResponseError(ErrorCodes.InvalidRequest, `Server is shut down, "${method}" was not handled.`);
    }
    const start = performance.now();
    try {
      return await handler(params, ...rest);
    } catch (error) {
      if (error instanceof ResponseError) {
        throw error;
      }
      logger.error(`Request "${method}" failed: ${formatError(error)}`);
      throw new ResponseError(ErrorCodes.InternalError, `Request "${method}" failed: ${messageOf(error)}`);
    } finally {
      logger.trace(`Handled request "${method}" in ${Math.round(performance.now() - start)} ms.`, () =>
        JSON.stringify(params, null, 2),
      );
    }
  };
}

/**
 * Wraps a notification handler so that a thrown error is logged and dropped.
 * Notifications have no response to carry an error.
 * @param {string | { method: string }} type
 * @param {Function} handler
 * @param {{ logger: import('./logger.js').Logger }} options
 * @returns {Function}
 */
export function guardNotification(type, handler, { logger }) {
  const method = methodOf(type);
  return async (params, ...rest) => {
    try {
      await handler(params, ...rest);
    } catch (error) {
      logger.error(`Notification "${method}" failed: ${formatError(error)}`);
    } finally {
      logger.trace(`Handled notification "${method}".`, () => JSON.stringify(params, null, 2));
    }
  };
}

const messageOf = (error) => (error instanceof Error ? error.message : String(error));
