import { format } from 'node:util';
import { createConnection } from 'vscode-languageserver/node';
import { formatError } from './logger.js';
import { createServer } from './server.js';
import { createTransport } from './transport.js';

/**
 * Starts the language server on a transport and begins listening.
 *
 * Everything that touches the process is injectable so the full lifecycle can
 * be tested in-process.
 * @param {import('./transport.js').Transport} transport
 * @param {object} [deps]
 * @param {NodeJS.ReadableStream} [deps.stdin]
 * @param {NodeJS.WritableStream} [deps.stdout]
 * @param {NodeJS.Process} [deps.proc] Receives the error handlers and, for node-ipc, carries the messages.
 * @param {(code: number) => void} [deps.exit] Called when the transport closes.
 * @param {Console} [deps.console] Redirected to the client log for the stdio transport.
 * @param {ReadonlyArray<import('./features/index.js').Feature>} [deps.features]
 */
export function startServer(transport, deps = {}) {
  const { proc = process, exit = (code) => process.exit(code), console: target = console, features } = deps;
  const { reader, writer } = createTransport(transport, deps);
  const connection = createConnection(reader, writer);
  const server = createServer(connection, features ? { features } : {});
  const { logger, state } = server;

  // stdout is the protocol channel: a stray console.log would corrupt it.
  if (transport.kind === 'stdio') {
    redirectConsole(target, logger);
  }
  installProcessErrorHandlers(proc, logger);

  // The client went away without "exit". Same exit codes as the "exit" notification.
  let closed = false;
  const onClose = () => {
    if (!closed) {
      closed = true;
      exit(state.shutdown ? 0 : 1);
    }
  };
  reader.onClose(onClose);
  if (transport.kind === 'stdio') {
    (deps.stdin ?? process.stdin).on('end', onClose);
  } else if (transport.kind === 'node-ipc') {
    proc.on('disconnect', onClose);
  }

  connection.listen();
  return { connection, ...server };
}

/**
 * Routes console output to `window/logMessage`.
 * @param {Console} target
 * @param {import('./logger.js').Logger} logger
 */
export function redirectConsole(target, logger) {
  /**
   * @param {(message: string) => void} log
   * @returns {(...args: unknown[]) => void}
   */
  function to(log) {
    return (...args) => log(format(...args));
  }
  target.error = to(logger.error);
  target.warn = to(logger.warn);
  target.info = to(logger.info);
  target.log = to(logger.info);
  target.debug = to(logger.debug);
  target.trace = to(logger.debug);
}

/**
 * Logs errors that escaped every handler instead of letting them end the
 * process: broken input must never crash the server (NFR-3).
 * @param {NodeJS.EventEmitter} proc
 * @param {import('./logger.js').Logger} logger
 */
export function installProcessErrorHandlers(proc, logger) {
  proc.on('uncaughtException', (error) => logger.error(`Uncaught exception: ${formatError(error)}`));
  proc.on('unhandledRejection', (reason) => logger.error(`Unhandled promise rejection: ${formatError(reason)}`));
}
