import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDockerRunArgs, loadConfig } from '../src/config.js';
import { chromiumSupervisorConfig } from '../src/templates.js';

test('loadConfig uses stable defaults for localhost web access', () => {
  const config = loadConfig({ argv: [], env: {} });

  assert.equal(config.backend, 'selenium');
  assert.equal(config.image, 'selenium/standalone-chrome:latest');
  assert.equal(config.webHost, '127.0.0.1');
  assert.equal(config.webPort, 8080);
  assert.equal(config.webUrl, 'http://127.0.0.1:8080');
  assert.equal(config.browserUrl, 'http://127.0.0.1:9222');
  assert.equal(config.seleniumUrl, 'http://127.0.0.1:4444');
  assert.equal(config.seleniumSessionTimeout, 86400);
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

test('buildDockerRunArgs publishes the Selenium web interface and CDP proxy', () => {
  const config = loadConfig({
    argv: ['--web-host', '0.0.0.0', '--web-port', '18080'],
    env: {}
  });
  const args = buildDockerRunArgs(config, {
    runtimeDir: '/tmp/neko-chrome-mcp-test',
    adminPassword: 'admin-pass',
    userPassword: 'user-pass'
  });

  assert.ok(args.includes('0.0.0.0:18080:7900/tcp'));
  assert.ok(args.includes('127.0.0.1:4444:4444/tcp'));
  assert.ok(args.includes('SE_VNC_PASSWORD=admin-pass'));
  assert.ok(args.includes('SE_NODE_SESSION_TIMEOUT=86400'));
  assert.equal(args.at(-1), 'selenium/standalone-chrome:latest');
});

test('loadConfig allows Selenium session timeout override', () => {
  const config = loadConfig({
    argv: ['--selenium-session-timeout', '3600'],
    env: {}
  });

  assert.equal(config.seleniumSessionTimeout, 3600);
});

test('buildDockerRunArgs can still publish the Neko backend ports', () => {
  const config = loadConfig({
    argv: ['--backend', 'neko', '--web-host', '0.0.0.0', '--web-port', '18080'],
    env: {}
  });
  const args = buildDockerRunArgs(config, {
    runtimeDir: '/tmp/neko-chrome-mcp-test',
    adminPassword: 'admin-pass',
    userPassword: 'user-pass'
  });

  assert.ok(args.includes('0.0.0.0:18080:8080/tcp'));
  assert.ok(args.includes('127.0.0.1:9222:9223/tcp'));
  assert.equal(args.at(-1), 'ghcr.io/m1k1o/neko/chromium:latest');
});

test('chromiumSupervisorConfig disables DevTools tab targets for Puppeteer compatibility', () => {
  assert.match(chromiumSupervisorConfig(), /--disable-features=DevToolsTabTarget/);
});

test('loadConfig rejects invalid web ports', () => {
  assert.throws(
    () => loadConfig({ argv: ['--web-port', '70000'], env: {} }),
    /Invalid port/
  );
});
