import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      all: true,
      // bin/ stays a thin wrapper around src/ and is exercised by a spawn test,
      // which v8 cannot instrument across processes.
      include: ['packages/*/src/**/*.js'],
      reporter: ['text', 'html', 'json-summary'],
      // Same global floors as avenx-js (.c8rc.json), see NFR-5 in #27.
      thresholds: {
        lines: 92,
        branches: 84,
        functions: 93,
        statements: 92,
      },
    },
  },
});
