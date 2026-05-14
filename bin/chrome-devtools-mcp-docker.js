#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { helpText, loadConfig } from '../src/config.js';
import { runServer } from '../src/runtime.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const config = loadConfig();

  if (config.help) {
    process.stdout.write(helpText());
    process.exit(0);
  }

  if (config.version) {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    process.stdout.write(`${packageJson.version}\n`);
    process.exit(0);
  }

  const exitCode = await runServer(config);
  process.exit(exitCode);
} catch (error) {
  process.stderr.write(`[chrome-devtools-mcp-docker] error: ${error.message}\n`);
  process.exit(1);
}
