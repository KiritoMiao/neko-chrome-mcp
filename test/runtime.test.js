import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';
import {
  buildWebControlUrlEntries,
  ensureContainerRunning,
  findInterfacePublicIp,
  parseCloudflareTrace,
  resolveWebControlUrlEntries,
  seleniumSessionRequestTimeoutMs,
  serializeWebControlUrlEntries
} from '../src/runtime.js';

test('buildWebControlUrlEntries includes configured, Cloudflare, and interface URLs', () => {
  const config = loadConfig({
    argv: [
      '--web-host', '0.0.0.0',
      '--web-port', '18080',
      '--web-url', 'http://vm.example:18080'
    ],
    env: {}
  });

  const entries = buildWebControlUrlEntries(config, 'pass value', {
    cloudflarePublicIp: '203.0.113.10',
    interfacePublicIp: '198.51.100.20'
  });

  assert.deepEqual(entries, [
    {
      label: 'configured',
      url: 'http://vm.example:18080/?autoconnect=1&resize=scale&password=pass%20value'
    },
    {
      label: 'cloudflare public IP 203.0.113.10',
      url: 'http://203.0.113.10:18080/?autoconnect=1&resize=scale&password=pass%20value'
    },
    {
      label: 'interface IP 198.51.100.20',
      url: 'http://198.51.100.20:18080/?autoconnect=1&resize=scale&password=pass%20value'
    }
  ]);
});

test('buildWebControlUrlEntries keeps Cloudflare and interface labels even for the same IP', () => {
  const config = loadConfig({
    argv: ['--web-host', '0.0.0.0', '--web-port', '18080'],
    env: {}
  });

  const entries = buildWebControlUrlEntries(config, 'pass', {
    cloudflarePublicIp: '203.0.113.10',
    interfacePublicIp: '203.0.113.10'
  });

  assert.deepEqual(entries.map((entry) => entry.label), [
    'configured',
    'cloudflare public IP 203.0.113.10',
    'interface IP 203.0.113.10'
  ]);
});

test('serializeWebControlUrlEntries keeps the first line URL-compatible', () => {
  const text = serializeWebControlUrlEntries([
    { label: 'configured', url: 'http://127.0.0.1:8080/?password=abc' },
    { label: 'cloudflare public IP 203.0.113.10', url: 'http://203.0.113.10:8080/?password=abc' }
  ]);

  assert.equal(
    text,
    'http://127.0.0.1:8080/?password=abc\ncloudflare public IP 203.0.113.10=http://203.0.113.10:8080/?password=abc\n'
  );
});

test('parseCloudflareTrace extracts the ip field', () => {
  assert.equal(
    parseCloudflareTrace('fl=123\nip=203.0.113.10\ncolo=SJC\n'),
    '203.0.113.10'
  );
});

test('findInterfacePublicIp prefers public non-internal IPv4 addresses', () => {
  assert.equal(
    findInterfacePublicIp({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
      ens18: [{ address: '198.51.100.30', family: 'IPv4', internal: false }]
    }),
    '198.51.100.30'
  );
});

test('resolveWebControlUrlEntries does not fetch public IPs by default', async () => {
  const config = loadConfig({ argv: [], env: {} });
  let cloudflareCalled = false;

  const entries = await resolveWebControlUrlEntries(config, 'pass', {
    fetchCloudflarePublicIp: async () => {
      cloudflareCalled = true;
      return '203.0.113.10';
    },
    networkInterfaces: {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
    }
  });

  assert.equal(cloudflareCalled, false);
  assert.deepEqual(entries, [
    {
      label: 'configured',
      url: 'http://127.0.0.1:8080/?autoconnect=1&resize=scale&password=pass'
    }
  ]);
});

test('resolveWebControlUrlEntries fetches public IPs only when enabled', async () => {
  const config = loadConfig({ argv: ['--detect-public-urls'], env: {} });

  const entries = await resolveWebControlUrlEntries(config, 'pass', {
    fetchCloudflarePublicIp: async () => '203.0.113.10',
    networkInterfaces: {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
    }
  });

  assert.deepEqual(entries.map((entry) => entry.label), [
    'configured',
    'cloudflare public IP 203.0.113.10'
  ]);
});

test('ensureContainerRunning reuses the shared container when another Codex wins startup race', async () => {
  const config = loadConfig({ argv: [], env: {} });
  const messages = [];
  let runningChecks = 0;
  let dockerRunCalls = 0;

  const result = await ensureContainerRunning(config, ['docker'], {
    stderr: {
      write(message) {
        messages.push(message);
      }
    }
  }, {
    containerRunning() {
      runningChecks += 1;
      return runningChecks > 1;
    },
    containerExists() {
      return false;
    },
    runDocker(command, args) {
      dockerRunCalls += 1;
      assert.deepEqual(command, ['docker']);
      assert.equal(args[0], 'run');
      throw new Error('Conflict. The container name "/chrome-devtools-mcp-docker" is already in use by container "abc".');
    }
  });

  assert.deepEqual(result, { started: false, adminPassword: undefined });
  assert.equal(dockerRunCalls, 1);
  assert.match(messages.join(''), /container already running after concurrent start/);
});

test('ensureContainerRunning rechecks the container after a generic Docker start failure', async () => {
  const config = loadConfig({ argv: [], env: {} });
  let runningChecks = 0;

  const result = await ensureContainerRunning(config, ['docker'], {
    stderr: {
      write() {}
    }
  }, {
    containerRunning() {
      runningChecks += 1;
      return runningChecks > 1;
    },
    containerExists() {
      return false;
    },
    runDocker() {
      throw new Error('docker run failed with status 125');
    }
  });

  assert.deepEqual(result, { started: false, adminPassword: undefined });
});

test('ensureContainerRunning treats an existing not-yet-running container as a concurrent start', async () => {
  const config = loadConfig({ argv: [], env: {} });
  let existsChecks = 0;

  const result = await ensureContainerRunning(config, ['docker'], {
    stderr: {
      write() {}
    }
  }, {
    containerRunning() {
      return false;
    },
    containerExists() {
      existsChecks += 1;
      return existsChecks > 1;
    },
    runDocker() {
      throw new Error('docker run failed with status 125');
    }
  });

  assert.deepEqual(result, { started: false, adminPassword: undefined });
});

test('ensureContainerRunning reports when this process starts the shared container', async () => {
  const config = loadConfig({ argv: [], env: {} });
  let dockerRunCalls = 0;

  const result = await ensureContainerRunning(config, ['docker'], {
    stderr: {
      write() {}
    }
  }, {
    containerRunning() {
      return false;
    },
    containerExists() {
      return false;
    },
    runDocker(command, args, options) {
      dockerRunCalls += 1;
      assert.deepEqual(command, ['docker']);
      assert.equal(args[0], 'run');
      assert.equal(options.stdio, 'ignore');
    }
  }, () => 'fixed-password');

  assert.deepEqual(result, { started: true, adminPassword: 'fixed-password' });
  assert.equal(dockerRunCalls, 1);
});

test('seleniumSessionRequestTimeoutMs keeps session creation bounded near Selenium queue timeout', () => {
  assert.equal(
    seleniumSessionRequestTimeoutMs(loadConfig({ argv: [], env: {} })),
    13000
  );
  assert.equal(
    seleniumSessionRequestTimeoutMs(loadConfig({
      argv: [
        '--selenium-session-request-timeout', '5',
        '--selenium-session-retry-interval', '2'
      ],
      env: {}
    })),
    9000
  );
});
