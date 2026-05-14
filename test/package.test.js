import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package exposes the renamed npm command', () => {
  assert.equal(packageJson.name, 'chrome-devtools-mcp-docker');
  assert.equal(packageJson.version, '0.1.6');
  assert.deepEqual(packageJson.bin, {
    'chrome-devtools-mcp-docker': 'bin/chrome-devtools-mcp-docker.js'
  });
  assert.equal(packageJson.scripts.start, 'node ./bin/chrome-devtools-mcp-docker.js');
});
