import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const codexConfigExample = readFileSync(new URL('../examples/codex-config.toml', import.meta.url), 'utf8');

test('package exposes the renamed npm command', () => {
  assert.equal(packageJson.name, 'chrome-devtools-mcp-docker');
  assert.equal(packageJson.version, '0.1.7');
  assert.deepEqual(packageJson.bin, {
    'chrome-devtools-mcp-docker': 'bin/chrome-devtools-mcp-docker.js'
  });
  assert.equal(packageJson.scripts.start, 'node ./bin/chrome-devtools-mcp-docker.js');
  assert.ok(packageJson.files.includes('skills/'));
});

test('Codex example uses the current MCP startup timeout key', () => {
  assert.match(codexConfigExample, /startup_timeout_sec\s*=/);
  assert.doesNotMatch(codexConfigExample, /startup_timeout_ms\s*=/);
});
