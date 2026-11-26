/**
 * The single place where the server touches avenx-core.
 *
 * NFR-1 asks the server to reuse avenx-core instead of re-implementing the
 * language. avenx-core 1.0.0-rc.1 does not yet offer everything the project
 * model needs, so this module bridges the gap. #5 replaces each bridged piece
 * with an upstream API and resolves the avenx-core installed in the workspace:
 *
 * - `componentNameFromFile` comes from avenx-core (`tooling/componentTagNaming`).
 * - The config schema is a copy of `schema/avenx.config.schema.json` from
 *   avenx-js main (generated from CONFIG_SCHEMA, last changed in c6d0995, 2026-11-24):
 *   the published rc.1 package does not contain it. Upstream: publish it.
 * - Project roots are found by `avenx.config.json`. avenx-core's
 *   `findProjectRoot` looks for `package.json` instead. Upstream: a root
 *   finder keyed on the config file.
 * - The component scan follows the compiler (`processComponents` /
 *   `collectComponentNames`: every `*.component.js` below `srcDir`, every
 *   `*.page.js` below `srcDir/pages`). avenx-core's `findRegisteredComponents`
 *   returns names only, scans `src/components` only and caches for 2 s.
 *   Upstream: a registry API that returns file paths.
 */
import { readFileSync } from 'node:fs';
import { componentNameFromFile as coreComponentNameFromFile } from 'avenx-core/tooling/componentTagNaming';

export const CONFIG_FILE_NAME = 'avenx.config.json';

/** Compiler defaults for the options the project model reads. */
export const CONFIG_DEFAULTS = Object.freeze({ srcDir: 'src', distDir: 'dist' });

/** Directory below `srcDir` the compiler scans for pages. */
export const PAGES_DIR = 'pages';

/**
 * The registered name of a component or page file, as the compiler derives it
 * (`user-card.component.js` → `UserCard`, `home.page.js` → `Home`).
 * @param {string} fileName A base name ending in `.component.js` or `.page.js`.
 * @returns {string}
 */
export function componentNameFromFile(fileName) {
  // avenx-core only strips ".component.js"; strip ".page.js" first so pages
  // get the same PascalCase derivation the compiler applies to them.
  return coreComponentNameFromFile(fileName.replace(/\.page\.js$/, ''));
}

let schema;

/**
 * The avenx.config.json JSON schema (draft-07).
 * @returns {object}
 */
export function configSchema() {
  schema ??= JSON.parse(readFileSync(new URL('./avenx.config.schema.json', import.meta.url), 'utf8'));
  return schema;
}
