import { resolveAvenxCore } from './avenxCore.js';
import { SERVER_NAME } from './server.js';
import { startServer } from './start.js';
import { version } from './version.js';

export const USAGE = `Usage: ${SERVER_NAME} [transport] [options]

Transports (default: --stdio):
  --stdio            Communicate over stdin/stdout
  --node-ipc         Communicate over the Node.js IPC channel
  --socket=<port>    Connect to a client listening on 127.0.0.1:<port>

Options:
  --clientProcessId=<pid>  Exit when the client process ends
  --version, -v            Print the server and the resolved avenx-core version
  --help, -h               Print this help`;

/**
 * @typedef {{ command: 'version' } | { command: 'help' } | { command: 'serve', transport: import('./transport.js').Transport } | { command: 'error', message: string }} ParsedArgs
 */

/**
 * Parses the command line. Pure: no output, no side effects.
 * @param {string[]} argv Arguments without `node` and the script path.
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  let transport;
  const setTransport = (next) => {
    if (transport) {
      return `Only one transport can be used, got --${transport.kind} and --${next.kind}.`;
    }
    transport = next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inlineValue] = splitOption(arg);
    let error;

    switch (name) {
      case '--version':
      case '-v':
        return { command: 'version' };
      case '--help':
      case '-h':
        return { command: 'help' };
      case '--stdio':
        error = setTransport({ kind: 'stdio' });
        break;
      case '--node-ipc':
        error = setTransport({ kind: 'node-ipc' });
        break;
      case '--socket': {
        const value = inlineValue ?? argv[++i];
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return { command: 'error', message: `--socket needs a port between 1 and 65535, got "${value ?? ''}".` };
        }
        error = setTransport({ kind: 'socket', port });
        break;
      }
      case '--clientProcessId':
        // Read by vscode-languageserver directly from process.argv.
        if (inlineValue === undefined) {
          i++;
        }
        break;
      default:
        return { command: 'error', message: `Unknown argument "${arg}".` };
    }
    if (error) {
      return { command: 'error', message: error };
    }
  }
  return { command: 'serve', transport: transport ?? { kind: 'stdio' } };
}

/**
 * The `--version` output: the server version and the avenx-core version Node
 * resolves from `cwd`.
 * @param {string} cwd
 * @returns {string}
 */
export function formatVersion(cwd) {
  const core = resolveAvenxCore(cwd);
  return [`${SERVER_NAME} ${version}`, core ? `avenx-core ${core.version} (${core.dir})` : 'avenx-core not found'].join(
    '\n',
  );
}

/**
 * Entry point of the `avenx-language-server` binary.
 * @param {string[]} argv Arguments without `node` and the script path.
 * @param {object} [options]
 * @param {(line: string) => void} [options.out]
 * @param {(line: string) => void} [options.err]
 * @param {string} [options.cwd]
 * @param {(transport: import('./transport.js').Transport) => void} [options.serve]
 * @returns {number | undefined} Exit code, or undefined while the server is running.
 */
export function run(argv, { out = console.log, err = console.error, cwd = process.cwd(), serve = startServer } = {}) {
  const parsed = parseArgs(argv);
  switch (parsed.command) {
    case 'version':
      out(formatVersion(cwd));
      return 0;
    case 'help':
      out(USAGE);
      return 0;
    case 'error':
      err(`${SERVER_NAME}: ${parsed.message}`);
      err(USAGE);
      return 1;
    default:
      serve(parsed.transport);
      return undefined;
  }
}

/**
 * Splits `--name=value` into its parts.
 * @param {string} arg
 * @returns {[string, string | undefined]}
 */
function splitOption(arg) {
  const index = arg.indexOf('=');
  return arg.startsWith('--') && index !== -1 ? [arg.slice(0, index), arg.slice(index + 1)] : [arg, undefined];
}
