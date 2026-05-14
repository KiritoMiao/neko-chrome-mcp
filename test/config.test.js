import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDockerRunArgs, helpText, loadConfig } from '../src/config.js';

test('loadConfig uses stable defaults for local noVNC access', () => {
  const config = loadConfig({ argv: [], env: {} });

  assert.equal(config.containerName, 'chrome-devtools-mcp-docker');
  assert.equal(config.image, 'selenium/standalone-chrome:latest');
  assert.equal(config.webHost, '127.0.0.1');
  assert.equal(config.webPort, 8080);
  assert.equal(config.webUrl, 'http://127.0.0.1:8080');
  assert.equal(config.seleniumUrl, 'http://127.0.0.1:4444');
  assert.equal(config.seleniumWsUrl, 'ws://127.0.0.1:4444');
  assert.equal(config.seleniumSessionTimeout, 86400);
  assert.equal(config.backend, undefined);
  assert.equal(config.browserUrl, undefined);
});

test('loadConfig reads renamed environment variables', () => {
  const config = loadConfig({
    argv: [],
    env: {
      CHROME_DEVTOOLS_MCP_DOCKER_WEB_HOST: '0.0.0.0',
      CHROME_DEVTOOLS_MCP_DOCKER_WEB_PORT: '18080'
    }
  });

  assert.equal(config.webHost, '0.0.0.0');
  assert.equal(config.webPort, 18080);
  assert.equal(config.webUrl, 'http://127.0.0.1:18080');
});

test('loadConfig lets CLI args override renamed environment values', () => {
  const config = loadConfig({
    argv: ['--web-host', '0.0.0.0', '--web-port', '18080'],
    env: {
      CHROME_DEVTOOLS_MCP_DOCKER_WEB_HOST: '127.0.0.1',
      CHROME_DEVTOOLS_MCP_DOCKER_WEB_PORT: '8081'
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
    adminPassword: 'admin-pass'
  });

  assert.ok(args.includes('0.0.0.0:18080:7900/tcp'));
  assert.ok(args.includes('127.0.0.1:4444:4444/tcp'));
  assert.ok(args.includes('SE_VNC_PASSWORD=admin-pass'));
  assert.ok(args.includes('SE_NODE_SESSION_TIMEOUT=86400'));
  assert.equal(args.at(-1), 'selenium/standalone-chrome:latest');
});

test('loadConfig allows Selenium session timeout override from the environment', () => {
  const config = loadConfig({
    argv: [],
    env: {
      CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_SESSION_TIMEOUT: '3600'
    }
  });

  assert.equal(config.seleniumSessionTimeout, 3600);
});

test('loadConfig rejects removed browser backend flags', () => {
  assert.throws(
    () => loadConfig({ argv: ['--backend', 'selenium'], env: {} }),
    /Unsupported option: --backend/
  );
});

test('loadConfig rejects invalid web ports', () => {
  assert.throws(
    () => loadConfig({ argv: ['--web-port', '70000'], env: {} }),
    /Invalid port/
  );
});

test('helpText documents the renamed command and supported options', () => {
  const text = helpText();

  assert.match(text, /^chrome-devtools-mcp-docker$/m);
  assert.match(text, /CHROME_DEVTOOLS_MCP_DOCKER_WEB_HOST/);
  assert.doesNotMatch(text, /--backend/);
  assert.doesNotMatch(text, /--webrtc/);
});
