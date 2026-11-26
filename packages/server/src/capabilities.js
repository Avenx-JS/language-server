/**
 * Builds the `ServerCapabilities` sent in the `initialize` response from the
 * registered features. Nothing is advertised that no feature declares.
 *
 * Objects are merged recursively and arrays are joined without duplicates, so
 * two features may both add `triggerCharacters` or `executeCommandProvider.commands`.
 * Two different values for the same scalar are a programming error and throw.
 * @param {ReadonlyArray<import('./features/index.js').Feature>} features
 * @param {import('./features/index.js').FeatureContext} context
 * @returns {import('vscode-languageserver/node').ServerCapabilities}
 */
export function buildCapabilities(features, context) {
  const capabilities = {};
  const owners = new Map();
  for (const feature of features) {
    const declared = feature.capabilities?.(context);
    if (declared) {
      merge(capabilities, declared, '', feature.name, owners);
    }
  }
  return capabilities;
}

/**
 * Checks the feature list: every feature needs a unique name.
 * @param {ReadonlyArray<import('./features/index.js').Feature>} features
 */
export function validateFeatures(features) {
  const seen = new Set();
  for (const feature of features) {
    if (!feature || typeof feature.name !== 'string' || feature.name === '') {
      throw new TypeError('Every feature needs a non-empty "name".');
    }
    if (seen.has(feature.name)) {
      throw new Error(`Feature "${feature.name}" is registered twice.`);
    }
    seen.add(feature.name);
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 * @param {string} path
 * @param {string} owner
 * @param {Map<string, string>} owners
 */
function merge(target, source, path, owner, owners) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    const keyPath = path ? `${path}.${key}` : key;
    const existing = target[key];

    if (existing === undefined) {
      target[key] = isPlainObject(value) ? merge({}, value, keyPath, owner, owners) : clone(value);
      owners.set(keyPath, owner);
    } else if (isPlainObject(existing) && isPlainObject(value)) {
      merge(existing, value, keyPath, owner, owners);
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      for (const item of value) {
        if (!existing.includes(item)) {
          existing.push(item);
        }
      }
    } else if (existing !== value) {
      throw new Error(
        `Capability "${keyPath}" is declared differently by features "${owners.get(keyPath)}" and "${owner}".`,
      );
    }
  }
  return target;
}

const clone = (value) => (Array.isArray(value) ? [...value] : value);
