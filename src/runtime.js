import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

import { buildDockerRunArgs } from './config.js';
import { containerExists, containerRunning, resolveDockerCommand, runDocker } from './docker.js';
import { chromiumSupervisorConfig, relayPythonScript, relaySupervisorConfig } from './templates.js';

const require = createRequire(import.meta.url);

export async function runServer(config, streams = process) {
  const dockerCommand = resolveDockerCommand();

  if (config.command === 'status') {
    streams.stderr.write(runDocker(dockerCommand, ['ps', '-a', '--filter', `name=^/${config.containerName}$`]));
    await printCurrentUrl(config, streams);
    return 0;
  }

  if (config.command === 'stop-container') {
    if (containerExists(dockerCommand, config.containerName)) {
      runDocker(dockerCommand, ['stop', config.containerName], { stdio: 'ignore' });
    }
    await removeCurrentUrl(config);
    return 0;
  }

  let runtimeDir;
  let startedByWrapper = false;
  let mcpProcess;
  let seleniumSession;

  const cleanup = async () => {
    if (mcpProcess && !mcpProcess.killed) {
      mcpProcess.kill('SIGTERM');
    }

    if (seleniumSession) {
      try {
        await deleteSeleniumSession(config, seleniumSession.id);
      } catch {
        // Best-effort cleanup.
      }
      seleniumSession = undefined;
    }

    if (startedByWrapper && config.stopOnExit) {
      log(streams, `stopping container: ${config.containerName}`);
      try {
        runDocker(dockerCommand, ['stop', '-t', '10', config.containerName], { stdio: 'ignore' });
      } catch {
        // Best-effort cleanup.
      }
    }

    if (runtimeDir) {
      await fs.rm(runtimeDir, { recursive: true, force: true });
    }
    await removeCurrentUrl(config);
  };

  const handleSignal = async (signal) => {
    await cleanup();
    process.kill(process.pid, signal);
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    if (containerRunning(dockerCommand, config.containerName)) {
      log(streams, `container already running: ${config.containerName}`);
    } else {
      if (containerExists(dockerCommand, config.containerName)) {
        log(streams, `removing stale container: ${config.containerName}`);
        runDocker(dockerCommand, ['rm', '-f', config.containerName], { stdio: 'ignore' });
      }

      const adminPassword = generatePassword();
      const userPassword = generatePassword();
      if (config.backend === 'neko') {
        runtimeDir = await makeRuntimeDir();
        await writeRuntimeFiles(runtimeDir, config);
      }

      log(streams, `creating and starting ${config.backend} Chrome container: ${config.containerName}`);
      runDocker(dockerCommand, buildDockerRunArgs(config, {
        runtimeDir,
        adminPassword,
        userPassword
      }), { stdio: 'ignore' });
      startedByWrapper = true;

      const controlUrlEntries = await resolveWebControlUrlEntries(config, adminPassword);
      await fs.writeFile(config.currentUrlFile, serializeWebControlUrlEntries(controlUrlEntries), { mode: 0o600 });
      logWebControlUrlEntries(streams, controlUrlEntries);
      log(streams, `temporary browser web password: ${adminPassword}`);
    }

    await waitForReady(config, dockerCommand, streams);
    await printCurrentUrl(config, streams);

    if (config.backend === 'selenium') {
      seleniumSession = await createSeleniumSession(config, streams);
    }

    mcpProcess = spawnChromeDevtoolsMcp(config, seleniumSession?.cdpWsUrl);
    return await waitForChild(mcpProcess);
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    await cleanup();
  }
}

export async function waitForReady(config, dockerCommand, streams = process) {
  if (config.backend === 'selenium') {
    const statusUrl = `${config.seleniumUrl.replace(/\/$/, '')}/status`;
    if (!(await waitForHttp(statusUrl, config.waitAttempts))) {
      log(streams, `Selenium did not become ready at ${statusUrl}`);
      dumpDockerLogs(dockerCommand, config, streams);
      throw new Error('Selenium failed to become ready');
    }
    return;
  }

  const healthUrl = `${config.webUrl.replace(/\/$/, '')}/health`;
  const devtoolsUrl = `${config.browserUrl.replace(/\/$/, '')}/json/version`;

  if (!(await waitForHttp(healthUrl, config.waitAttempts))) {
    log(streams, `Neko did not become ready at ${healthUrl}`);
    dumpDockerLogs(dockerCommand, config, streams);
    throw new Error('Neko failed to become ready');
  }

  if (!(await waitForHttp(devtoolsUrl, config.waitAttempts))) {
    log(streams, `Chrome DevTools did not become ready at ${devtoolsUrl}`);
    dumpDockerLogs(dockerCommand, config, streams);
    throw new Error('Chrome DevTools failed to become ready');
  }
}

function spawnChromeDevtoolsMcp(config, cdpWsUrl) {
  const packageJsonPath = require.resolve('chrome-devtools-mcp/package.json');
  const binPath = path.join(path.dirname(packageJsonPath), 'build/src/bin/chrome-devtools-mcp.js');
  const connectionArgs = cdpWsUrl
    ? ['--wsEndpoint', cdpWsUrl]
    : ['--browserUrl', config.browserUrl];

  return spawn(process.execPath, [
    binPath,
    ...connectionArgs,
    '--no-usage-statistics',
    '--no-performance-crux',
    ...config.passthroughArgs
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1'
    }
  });
}

async function createSeleniumSession(config, streams) {
  const response = await requestJson(`${config.seleniumUrl.replace(/\/$/, '')}/session`, {
    method: 'POST',
    body: {
      capabilities: {
        alwaysMatch: {
          browserName: 'chrome',
          'goog:chromeOptions': {
            args: ['--remote-allow-origins=*']
          }
        }
      }
    }
  });
  const sessionId = response.value?.sessionId;
  if (!sessionId) {
    throw new Error('Selenium did not return a session id');
  }

  const cdpWsUrl = `${config.seleniumWsUrl.replace(/\/$/, '')}/session/${sessionId}/se/cdp`;
  log(streams, `created Selenium Chrome session: ${sessionId}`);
  return { id: sessionId, cdpWsUrl };
}

async function deleteSeleniumSession(config, sessionId) {
  await requestJson(`${config.seleniumUrl.replace(/\/$/, '')}/session/${sessionId}`, {
    method: 'DELETE',
    allowEmpty: true
  });
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        resolve(128);
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

async function writeRuntimeFiles(runtimeDir, config) {
  await fs.writeFile(path.join(runtimeDir, 'chromium.conf'), chromiumSupervisorConfig());
  await fs.writeFile(path.join(runtimeDir, 'devtools-relay.conf'), relaySupervisorConfig());
  await fs.writeFile(path.join(runtimeDir, 'devtools-relay.py'), relayPythonScript({
    listenPort: config.devtoolsContainerPort,
    targetPort: 9222
  }), { mode: 0o755 });
}

async function makeRuntimeDir() {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-chrome-mcp.'));
  await fs.chmod(runtimeDir, 0o755);
  return runtimeDir;
}

function waitForHttp(url, attempts) {
  return new Promise((resolve) => {
    let remaining = attempts;

    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
          resolve(true);
        } else {
          retry();
        }
      });

      request.setTimeout(2000, () => {
        request.destroy();
        retry();
      });

      request.once('error', retry);
    };

    const retry = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve(false);
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

function requestJson(url, { method = 'GET', body, allowEmpty = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(url, {
      method,
      headers: payload
        ? {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload)
          }
        : undefined
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(text || `HTTP ${response.statusCode} from ${url}`));
          return;
        }
        if (!text && allowEmpty) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.once('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function dumpDockerLogs(dockerCommand, config, streams) {
  try {
    streams.stderr.write(runDocker(dockerCommand, ['logs', '--tail=160', config.containerName]));
  } catch {
    // Ignore log collection errors.
  }
}

async function printCurrentUrl(config, streams) {
  try {
    const text = (await fs.readFile(config.currentUrlFile, 'utf8')).trim();
    if (!text) {
      return;
    }
    logWebControlUrlEntries(streams, parseSerializedWebControlUrlEntries(text));
  } catch {
    // No current URL yet.
  }
}

export function buildWebControlUrlEntries(config, password, { cloudflarePublicIp, interfacePublicIp } = {}) {
  const entries = [
    {
      label: 'configured',
      url: webControlUrl(config, password)
    }
  ];

  if (cloudflarePublicIp) {
    entries.push({
      label: `cloudflare public IP ${cloudflarePublicIp}`,
      url: webControlUrlForHost(config, password, cloudflarePublicIp)
    });
  }

  if (interfacePublicIp) {
    entries.push({
      label: `interface IP ${interfacePublicIp}`,
      url: webControlUrlForHost(config, password, interfacePublicIp)
    });
  }

  return entries;
}

export function serializeWebControlUrlEntries(entries) {
  if (entries.length === 0) {
    return '';
  }
  const [primary, ...rest] = entries;
  return [
    primary.url,
    ...rest.map((entry) => `${entry.label}=${entry.url}`)
  ].join('\n') + '\n';
}

export function parseCloudflareTrace(text) {
  for (const line of text.split(/\r?\n/)) {
    const [key, value] = line.split('=', 2);
    if (key === 'ip' && value && net.isIP(value)) {
      return value;
    }
  }
  return undefined;
}

export function findInterfacePublicIp(networkInterfaces = os.networkInterfaces()) {
  for (const addresses of Object.values(networkInterfaces)) {
    for (const address of addresses ?? []) {
      const family = typeof address.family === 'string' ? address.family : `IPv${address.family}`;
      if (family !== 'IPv4' || address.internal || !net.isIPv4(address.address)) {
        continue;
      }
      if (!isPrivateOrLocalIPv4(address.address)) {
        return address.address;
      }
    }
  }
  return undefined;
}

async function resolveWebControlUrlEntries(config, password) {
  const [cloudflarePublicIp, interfacePublicIp] = await Promise.all([
    fetchCloudflarePublicIp().catch(() => undefined),
    Promise.resolve(findInterfacePublicIp())
  ]);

  return buildWebControlUrlEntries(config, password, {
    cloudflarePublicIp,
    interfacePublicIp
  });
}

function webControlUrl(config, password) {
  const baseUrl = config.webUrl.replace(/\/$/, '');
  return webControlUrlFromBase(config, password, baseUrl);
}

function webControlUrlForHost(config, password, host) {
  const base = new URL(config.webUrl);
  return webControlUrlFromBase(config, password, `${base.protocol}//${urlHost(host)}:${config.webPort}`);
}

function webControlUrlFromBase(config, password, baseUrl) {
  if (config.backend === 'selenium') {
    return `${baseUrl}/?autoconnect=1&resize=scale&password=${encodeURIComponent(password)}`;
  }
  return `${baseUrl}/?usr=codex&pwd=${encodeURIComponent(password)}`;
}

function parseSerializedWebControlUrlEntries(text) {
  return text.split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      if (index === 0) {
        return { label: 'configured', url: line };
      }
      const separator = line.indexOf('=');
      if (separator === -1) {
        return { label: `url ${index + 1}`, url: line };
      }
      return {
        label: line.slice(0, separator),
        url: line.slice(separator + 1)
      };
    });
}

function logWebControlUrlEntries(streams, entries) {
  for (const entry of entries) {
    log(streams, `browser web control URL (${entry.label}): ${entry.url}`);
  }
}

function fetchCloudflarePublicIp() {
  return new Promise((resolve, reject) => {
    const request = https.get('https://www.cloudflare.com/cdn-cgi/trace', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} from Cloudflare trace`));
          return;
        }
        resolve(parseCloudflareTrace(Buffer.concat(chunks).toString('utf8')));
      });
    });

    request.setTimeout(3000, () => {
      request.destroy(new Error('Cloudflare trace timed out'));
    });
    request.once('error', reject);
  });
}

function isPrivateOrLocalIPv4(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function urlHost(host) {
  return net.isIPv6(host) ? `[${host}]` : host;
}

async function removeCurrentUrl(config) {
  await fs.rm(config.currentUrlFile, { force: true });
}

function generatePassword() {
  return crypto.randomBytes(18).toString('hex');
}

function log(streams, message) {
  streams.stderr.write(`[neko-chrome-mcp] ${message}\n`);
}
