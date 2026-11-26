import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Finds the `avenx-core` package Node would resolve from `fromDir`, the way a
 * project's own build would see it.
 *
 * Only `package.json` is read; nothing from the package is executed, so this
 * is safe on an untrusted workspace. `require.resolve('avenx-core/package.json')`
 * is not used because avenx-core's `exports` map does not expose it.
 * @param {string} fromDir
 * @returns {{ version: string, dir: string } | null}
 */
export function resolveAvenxCore(fromDir) {
  const lookupPaths = createRequire(join(fromDir, 'noop.js')).resolve.paths('avenx-core') ?? [];
  for (const nodeModules of lookupPaths) {
    const dir = join(nodeModules, 'avenx-core');
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) {
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name === 'avenx-core' && typeof pkg.version === 'string') {
        return { version: pkg.version, dir };
      }
    } catch {
      // An unreadable or broken manifest is not a usable avenx-core; keep looking.
    }
  }
  return null;
}
