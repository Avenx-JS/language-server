# Contributing to the Avenx Language Server

First of all, thank you for your interest in contributing!

The Avenx Language Server brings Avenx-JS diagnostics, completions and navigation to every LSP-capable editor. Every
contribution, whether it's code, documentation, bug reports, or ideas, helps improve the project.

## Before You Start

- Search existing issues and pull requests to avoid duplicates.
- Read the [requirements & issue index (#27)](https://github.com/Avenx-JS/language-server/issues/27). Most work is
  already split into issues there; comment on one before you start so work is not done twice.
- Open an issue for larger changes or new features before implementing them.

## Ground rules

- **Single source of truth.** The server reuses `avenx-core` (parser, compiler, tooling). Do not re-implement Avenx
  language rules here. If an API is missing, propose it upstream in
  [avenx-js](https://github.com/Avenx-JS/avenx-js) and link the two issues.
- **Never crash on broken input.** Editors send incomplete source on every keystroke. A feature that cannot handle the
  input degrades gracefully instead of throwing out of a request handler.
- **Advertise only what works.** A capability is registered with the client only once it is implemented and tested.

## Repository layout

| Path               | Contents                                                      |
| ------------------ | ------------------------------------------------------------- |
| `packages/server/` | The `avenx-language-server` package (`bin/`, `src/`, `test/`) |
| `packages/vscode/` | The VS Code client                                            |
| `.github/`         | CI workflow, Dependabot, issue and PR templates               |

## Local Development Workflow

1. **Clone and install dependencies.** From the repository root:

   ```bash
   npm install
   ```

   This installs all workspaces and links `avenx-language-server` into `packages/vscode`.

2. **Run the tests.** Vitest picks up every `packages/*/test/**/*.test.js` file:

   ```bash
   npm test
   npm run test:watch                                # rerun on change
   npx vitest run packages/server/test/cli.test.js   # a single file
   ```

3. **Check coverage.** `npm run test:coverage` writes a text summary and an HTML report to `coverage/` and fails when
   coverage drops below the thresholds in `vitest.config.js` (the same floors as avenx-js).

4. **Check code style and formatting:**

   ```bash
   npm run lint
   npm run format        # or: npm run format:check
   ```

   The ESLint and Prettier configuration is shared with avenx-js. ESLint 10 and `eslint-plugin-jsdoc` need
   **Node.js 22.13 or later**; the server itself and its tests run on Node.js 18 and later.

## Continuous integration

Every push to `main` and every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- **Test + coverage** on Node.js 18, 20 and 22
- **Lint + format** on Node.js 22
- **CI passed**: an aggregate check that fails if any of the above fails. This is the check required for merging.

## Writing tests that pass on every platform

Contributors work on Linux, macOS and Windows. Rules carried over from avenx-js:

- Use `fileURLToPath`, never `new URL(...).pathname`, to turn a module URL into a path.
- Assert paths and URIs with forward slashes; LSP URIs are always `file:///...`.
- Accept `\r\n` when a regex reads a checked-out file.
- Spawn Node scripts with `process.execPath`, not `node` or a `.cmd` shim.

## Pull requests

- Keep each pull request focused on one issue and reference it (`Closes #123`).
- Add or update tests for every behavior change.
- Fill in the pull request template, including the commands you actually ran.
