import {
  createServerSocketTransport,
  IPCMessageReader,
  IPCMessageWriter,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';

/**
 * @typedef {{ kind: 'stdio' } | { kind: 'node-ipc' } | { kind: 'socket', port: number }} Transport
 */

/**
 * Creates the message reader and writer for a transport.
 *
 * Readers and writers (not raw streams) are handed to `createConnection` on
 * purpose: given a raw stream, vscode-languageserver calls `process.exit()`
 * itself when it ends, which makes the server untestable in-process.
 * `startServer` handles the end of the transport instead.
 * @param {Transport} transport
 * @param {{ stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream, proc?: NodeJS.Process }} [io]
 * @returns {{ reader: import('vscode-languageserver/node').MessageReader, writer: import('vscode-languageserver/node').MessageWriter }}
 */
export function createTransport(transport, { stdin = process.stdin, stdout = process.stdout, proc = process } = {}) {
  switch (transport.kind) {
    case 'stdio':
      return { reader: new StreamMessageReader(stdin), writer: new StreamMessageWriter(stdout) };
    case 'node-ipc':
      return { reader: new IPCMessageReader(proc), writer: new IPCMessageWriter(proc) };
    case 'socket': {
      // The client listens on the port and the server connects to it (LSP spec, "--socket").
      const [reader, writer] = createServerSocketTransport(transport.port);
      return { reader, writer };
    }
    default:
      throw new TypeError(`Unknown transport "${transport.kind}".`);
  }
}
