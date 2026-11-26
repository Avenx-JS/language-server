import { version } from './version.js';

const USAGE = `Usage: avenx-language-server [options]

Options:
  --version  Print the server version
  --help     Print this help`;

/**
 * Entry point of the `avenx-language-server` binary.
 *
 * The LSP transports (--stdio, --node-ipc, --socket) are added in #2.
 * @param {string[]} argv Command line arguments without `node` and the script path.
 * @param {{ out: (line: string) => void, err: (line: string) => void }} [io] Output sinks.
 * @returns {number} Process exit code.
 */
export function run(argv, io = { out: console.log, err: console.error }) {
  if (argv.includes('--version') || argv.includes('-v')) {
    io.out(version);
    return 0;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE);
    return 0;
  }
  io.err('avenx-language-server: the LSP transports are not implemented yet.');
  io.err(USAGE);
  return 1;
}
