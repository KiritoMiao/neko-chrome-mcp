import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDockerRunArgs, loadConfig } from '../src/config.js';

test('loadConfig uses stable defaults for localhost web access', () => {
  const config = loadConfig({ argv: [], env: {} });

  assert.equal(config.webHost, '127.0.0.1');
  assert.equal(config.webPort, 8080);
  assert.equal(config.webUrl, 'http://127.0.0.1:8080');
  assert.equal(config.browserUrl, 'http://127.0.0.1:9222');
});

test('loadConfig lets CLI args override environment values', () => {
  const config = loadConfig({
    argv: ['--web-host', '0.0.0.0', '--web-port', '18080'],
    env: {
      NEKO_CHROME_MCP_WEB_HOST: '127.0.0.1',
      NEKO_CHROME_MCP_WEB_PORT: '8081'
    }
  });

  assert.equal(config.webHost, '0.0.0.0');
  assert.equal(config.webPort, 18080);
  assert.equal(config.webUrl, 'http://127.0.0.1:18080');
});

test('loadConfig accepts --web-listen as host:port shorthand', () => {
  const config = loadConfig({
    argv: ['--web-listen', '0.0.0.0:28080'],
    env: {}
  });

  assert.equal(config.webHost, '0.0.0.0');
  assert.equal(config.webPort, 28080);
  assert.equal(config.webUrl, 'http://127.0.0.1:28080');
});

test('buildDockerRunArgs publishes the Neko web interface on configured host and port', () => {
  const config = loadConfig({
    argv: ['--web-host', '0.0.0.0', '--web-port', '18080'],
    env: {}
  });
  const args = buildDockerRunArgs(config, {
    runtimeDir: '/tmp/neko-chrome-mcp-test',
    adminPassword: 'admin-pass',
    userPassword: 'user-pass'
  });

  assert.ok(args.includes('0.0.0.0:18080:8080/tcp'));
  assert.ok(args.includes('127.0.0.1:9222:9223/tcp'));
});

test('loadConfig rejects invalid web ports', () => {
  assert.throws(
    () => loadConfig({ argv: ['--web-port', '70000'], env: {} }),
    /Invalid port/
  );
});
