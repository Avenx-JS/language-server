# Avenx Language Server

Editor support for [Avenx-JS](https://github.com/Avenx-JS/avenx-js) projects through the
[Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

> **Status:** early development (milestone M0 – Foundation). Nothing is usable in an editor yet.

## Goal

Any LSP-capable editor (VS Code, Neovim, Zed, Helix, JetBrains via an LSP plugin) should get the same diagnostics,
completions and navigation the Avenx compiler already knows about. That covers `*.component.js` / `*.page.js` files,
their `*.css` companions with `<@css>` blocks, and `avenx.config.json`.

The server reuses `avenx-core` (parser, compiler, tooling) instead of re-implementing the language. APIs it is missing
are added upstream in avenx-js.

**Requirements, milestones and the full issue index:**
[#27 – Avenx Language Server – Requirements & Issue Index](https://github.com/Avenx-JS/language-server/issues/27)

## Repository layout

This is an npm workspaces monorepo:

| Package                              | npm name                | Description                                                                       |
| ------------------------------------ | ----------------------- | --------------------------------------------------------------------------------- |
| [`packages/server`](packages/server) | `avenx-language-server` | The language server, binary `avenx-language-server`                               |
| [`packages/vscode`](packages/vscode) | `avenx-vscode`          | The VS Code client ([#21](https://github.com/Avenx-JS/language-server/issues/21)) |

## Development

Requires Node.js 18 or later. Linting needs Node.js 22.13 or later (see [CONTRIBUTING.md](CONTRIBUTING.md)).

```bash
npm install
npm test               # run all tests (Vitest)
npm run test:coverage  # tests + coverage thresholds
npm run lint           # ESLint
npm run format         # Prettier
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
