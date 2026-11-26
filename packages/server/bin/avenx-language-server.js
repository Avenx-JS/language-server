#!/usr/bin/env node
import { run } from '../src/cli.js';

const code = run(process.argv.slice(2));
if (code !== undefined) {
  process.exitCode = code;
}
