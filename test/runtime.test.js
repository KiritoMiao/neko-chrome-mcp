import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';
import {
  buildWebControlUrlEntries,
  findInterfacePublicIp,
  parseCloudflareTrace,
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
