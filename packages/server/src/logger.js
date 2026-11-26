import { LogMessageNotification, MessageType, Trace } from 'vscode-languageserver/node';

/** Log levels from least to most verbose. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

export const DEFAULT_LOG_LEVEL = 'info';

/**
 * @typedef {object} Logger
 * @property {(message: string) => void} error Logs at level "error".
 * @property {(message: string) => void} warn Logs at level "warn".
 * @property {(message: string) => void} info Logs at level "info".
 * @property {(message: string) => void} debug Logs at level "debug".
 * @property {(message: string, verbose?: () => string) => void} trace
 *   Sends `$/logTrace` while the client's trace setting is not `off`. `verbose`
 *   is only evaluated when the setting is `verbose`.
 * @property {(level: string) => boolean} setLevel Returns false for an unknown level.
 * @property {() => string} getLevel The current log level.
 * @property {(value: string) => void} setTrace Accepts the `TraceValues` of the protocol.
 * @property {() => string} getTrace The current trace value: "off", "messages", "compact" or "verbose".
 */

/**
 * Creates the server logger.
 *
 * Log messages go to `window/logMessage` (`connection.console`) and are filtered
 * by the log level. Trace messages go to `$/logTrace` (`connection.tracer`) and
 * follow the client's trace setting from `initialize` and `$/setTrace`.
 * @param {import('vscode-languageserver/node').Connection} connection
 * @param {string} [level]
 * @returns {Logger}
 */
export function createLogger(connection, level = DEFAULT_LOG_LEVEL) {
  let threshold = LOG_LEVELS.indexOf(level);
  let trace = Trace.Off;

  // Sent directly instead of through connection.console: when the connection
  // is closed, connection.console reports the failure via console.error, which
  // is redirected to this logger on stdio, so it would never stop.
  const send = (lvl, type, message) => {
    if (LOG_LEVELS.indexOf(lvl) > threshold) {
      return;
    }
    try {
      connection.sendNotification(LogMessageNotification.type, { type, message }).catch(ignore);
    } catch {
      // Connection already disposed.
    }
  };

  return {
    error: (message) => send('error', MessageType.Error, message),
    warn: (message) => send('warn', MessageType.Warning, message),
    info: (message) => send('info', MessageType.Info, message),
    // MessageType.Debug is only defined from LSP 3.18 on; Log is understood by every client.
    debug: (message) => send('debug', MessageType.Log, message),

    trace(message, verbose) {
      if (trace === Trace.Off) {
        return;
      }
      connection.tracer.log(message, trace === Trace.Verbose && verbose ? verbose() : undefined);
    },

    setLevel(next) {
      const index = LOG_LEVELS.indexOf(next);
      if (index === -1) {
        return false;
      }
      threshold = index;
      return true;
    },
    getLevel: () => LOG_LEVELS[threshold],

    setTrace(value) {
      trace = Trace.fromString(value);
      connection.tracer.trace = trace;
    },
    getTrace: () => Trace.toString(trace),
  };
}

const ignore = () => {};

/**
 * Formats an unknown thrown value for the log.
 * @param {unknown} error
 * @returns {string}
 */
export function formatError(error) {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}
