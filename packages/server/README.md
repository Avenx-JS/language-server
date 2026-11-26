# avenx-language-server

The [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server for Avenx-JS projects.

> Work in progress: the server speaks LSP but does not provide language features yet. See the
> [issue index (#27)](https://github.com/Avenx-JS/language-server/issues/27).

## Usage

```bash
avenx-language-server [--stdio | --node-ipc | --socket=<port>]
avenx-language-server --version   # server and resolved avenx-core version
```

`--stdio` is the default. With `--socket=<port>` the client listens on `127.0.0.1:<port>` and the server connects to it.

### Initialization options

| Option     | Values                           | Default |
| ---------- | -------------------------------- | ------- |
| `logLevel` | `error`, `warn`, `info`, `debug` | `info`  |

Log messages are sent as `window/logMessage`. Per-request traces are sent as `$/logTrace` and follow the client's
trace setting (`initialize.trace` and `$/setTrace`).

## Adding a feature

Features are registered in [`src/features/index.js`](src/features/index.js). The `initialize` capabilities are built
from that list alone, so a capability is advertised only when the feature implementing it is registered. Register
handlers through `context.onRequest` / `context.onNotification`: a thrown error is logged and answered with an LSP
error instead of ending the process.

See the [repository README](../../README.md) for the project goal and roadmap.
