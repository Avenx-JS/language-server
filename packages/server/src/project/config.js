import Ajv from 'ajv';
import { findNodeAtLocation, parseTree, printParseErrorCode } from 'jsonc-parser';
import { CONFIG_DEFAULTS, configSchema } from '../avenx/core.js';

/**
 * @typedef {object} ConfigProblem
 * @property {number} start Offset in the config text.
 * @property {number} end Offset after the problem.
 * @property {string} message Human-readable text for the diagnostic.
 * @property {'error' | 'warning'} severity Unknown options warn, wrong values are errors.
 * @property {string} code `config-syntax` or `config-schema`.
 */

/**
 * @typedef {object} ConfigResult
 * @property {{ srcDir: string, distDir: string } & Record<string, unknown>} config
 *   The parsed options with compiler defaults filled in. An unusable `srcDir` /
 *   `distDir` falls back to the default, so the project model keeps working.
 * @property {ConfigProblem[]} problems Syntax and schema problems, in document order.
 */

let validator;

/**
 * Parses and validates the text of an avenx.config.json.
 *
 * Unknown options are warnings and wrong values are errors, matching how the
 * compiler treats them (it warns about the former and refuses the latter).
 * Never throws: a broken file yields problems and the default config.
 * @param {string} text
 * @returns {ConfigResult}
 */
export function parseConfig(text) {
  const parseErrors = [];
  const tree = parseTree(text, parseErrors, { disallowComments: true, allowTrailingComma: false });

  // An empty or whitespace-only text is reported as "value expected".
  if (parseErrors.length > 0) {
    const problems = parseErrors.map((error) => ({
      start: error.offset,
      end: error.offset + error.length,
      message: `Invalid JSON: ${humanize(printParseErrorCode(error.error))}.`,
      severity: 'error',
      code: 'config-syntax',
    }));
    return { config: { ...CONFIG_DEFAULTS }, problems };
  }

  const value = JSON.parse(text);
  validator ??= new Ajv({ allErrors: true, strict: false }).compile(configSchema());
  const valid = validator(value);
  const problems = valid ? [] : collapseAlternatives(validator.errors).map((error) => toProblem(error, tree));

  const config = isObject(value) ? { ...CONFIG_DEFAULTS, ...value } : { ...CONFIG_DEFAULTS };
  for (const key of ['srcDir', 'distDir']) {
    if (!isRelativeDir(config[key])) {
      config[key] = CONFIG_DEFAULTS[key];
    }
  }
  return { config, problems };
}

/**
 * @param {import('ajv').ErrorObject} error
 * @param {import('jsonc-parser').Node} tree
 * @returns {ConfigProblem}
 */
function toProblem(error, tree) {
  const path = error.instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
  const node = findNodeAtLocation(tree, path) ?? tree;
  const label = path.length ? `"${path.join('.')}"` : 'The configuration';

  if (error.keyword === 'additionalProperties') {
    const key = error.params.additionalProperty;
    const property = node.children?.find((child) => child.children?.[0]?.value === key)?.children[0] ?? node;
    const suggestion = closest(key, allowedKeys(path));
    const where = path.length ? `"${[...path, key].join('.')}"` : `"${key}"`;
    return {
      ...rangeOf(property),
      message: `Unknown option ${where}.${suggestion ? ` Did you mean "${suggestion}"?` : ''} It has no effect.`,
      severity: 'warning',
      code: 'config-schema',
    };
  }

  let message = `${label} ${error.message}.`;
  if (error.keyword === 'type') {
    message = `${label} must be ${describe({ type: error.params.type.split(',') })}.`;
  } else if (error.keyword === 'enum') {
    message = `${label} must be ${describe({ enum: error.params.allowedValues })}.`;
  } else if (error.keyword === 'anyOf' || error.keyword === 'oneOf') {
    const branches = schemaAt(error.schemaPath) ?? [];
    message = `${label} must be ${branches.map(describe).join(' or ')}.`;
  }
  return { ...rangeOf(node), message, severity: 'error', code: 'config-schema' };
}

/**
 * ajv reports every failed branch of an `anyOf` / `oneOf` plus the
 * alternative itself. Keep only the alternative, which then lists what the
 * branches accept, so one wrong value is one problem.
 * @param {import('ajv').ErrorObject[]} errors
 * @returns {import('ajv').ErrorObject[]}
 */
function collapseAlternatives(errors) {
  const alternatives = errors.filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf');
  return errors.filter(
    (error) =>
      !alternatives.some(
        (alt) =>
          alt !== error &&
          error.schemaPath.startsWith(`${alt.schemaPath}/`) &&
          (error.instancePath === alt.instancePath || error.instancePath.startsWith(`${alt.instancePath}/`)),
      ),
  );
}

/** The `${NAME}` / `$NAME` environment reference pattern used throughout the schema. */
const ENV_PATTERN = '^\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?$';

/**
 * A short English description of what a schema accepts.
 * @param {object} schema
 * @returns {string}
 */
function describe(schema) {
  if (Array.isArray(schema.enum)) {
    return schema.enum.length === 1
      ? JSON.stringify(schema.enum[0])
      : `one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  if (schema.pattern === ENV_PATTERN) {
    return 'an environment variable reference like "${NAME}"';
  }
  const types = [].concat(schema.type ?? []);
  if (types.length === 0) {
    return 'a valid value';
  }
  const text = types.map((type) => (/^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`)).join(' or ');
  if (Number.isFinite(schema.minimum) && Number.isFinite(schema.maximum)) {
    return `${text} from ${schema.minimum} to ${schema.maximum}`;
  }
  return text;
}

/**
 * Resolves an ajv `schemaPath` (`#/properties/server/...`) in the config schema.
 * @param {string} schemaPath
 * @returns {any}
 */
function schemaAt(schemaPath) {
  return schemaPath
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment.replace(/~1/g, '/').replace(/~0/g, '~')))
    .reduce((node, segment) => node?.[segment], configSchema());
}

/**
 * @param {import('jsonc-parser').Node} node
 * @returns {{ start: number, end: number }}
 */
function rangeOf(node) {
  return { start: node.offset, end: node.offset + node.length };
}

/**
 * Property names the schema allows at `path`.
 * @param {Array<string | number>} path
 * @returns {string[]}
 */
function allowedKeys(path) {
  let schema = configSchema();
  for (const segment of path) {
    schema = typeof segment === 'number' ? schema?.items : schema?.properties?.[segment];
  }
  return Object.keys(schema?.properties ?? {});
}

/**
 * The closest allowed key within a small edit distance, for "did you mean".
 * @param {string} key
 * @param {string[]} candidates
 * @returns {string | undefined}
 */
export function closest(key, candidates) {
  let best;
  let bestDistance = Math.max(2, Math.floor(key.length / 3)) + 1;
  for (const candidate of candidates) {
    const distance = levenshtein(key.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// "PropertyNameExpected" → "property name expected".
const humanize = (code) => code.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const isRelativeDir = (value) =>
  typeof value === 'string' && value.trim() !== '' && !/^([a-zA-Z]:)?[\\/]/.test(value.trim()) && !value.includes('\0');
