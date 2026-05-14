import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
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

  const cleanup = async () => {
    if (mcpProcess && !mcpProcess.killed) {
      mcpProcess.kill('SIGTERM');
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
      runtimeDir = await makeRuntimeDir();
      await writeRuntimeFiles(runtimeDir, config);

      log(streams, `creating and starting Neko Chromium container: ${config.containerName}`);
      runDocker(dockerCommand, buildDockerRunArgs(config, {
        runtimeDir,
        adminPassword,
        userPassword
      }), { stdio: 'ignore' });
      startedByWrapper = true;

      const controlUrl = `${config.webUrl.replace(/\/$/, '')}/?usr=codex&pwd=${adminPassword}`;
      await fs.writeFile(config.currentUrlFile, `${controlUrl}\n`, { mode: 0o600 });
      log(streams, `Neko web control URL: ${controlUrl}`);
      log(streams, `temporary Neko admin password: ${adminPassword}`);
    }

    await waitForReady(config, dockerCommand, streams);
    await printCurrentUrl(config, streams);

    mcpProcess = spawnChromeDevtoolsMcp(config);
    return await waitForChild(mcpProcess);
  } finally {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    await cleanup();
  }
}

export async function waitForReady(config, dockerCommand, streams = process) {
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

function spawnChromeDevtoolsMcp(config) {
  const packageJsonPath = require.resolve('chrome-devtools-mcp/package.json');
  const binPath = path.join(path.dirname(packageJsonPath), 'build/src/bin/chrome-devtools-mcp.js');

  return spawn(process.execPath, [
    binPath,
    '--browserUrl',
    config.browserUrl,
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

function dumpDockerLogs(dockerCommand, config, streams) {
  try {
    streams.stderr.write(runDocker(dockerCommand, ['logs', '--tail=160', config.containerName]));
  } catch {
    // Ignore log collection errors.
  }
}

async function printCurrentUrl(config, streams) {
  try {
    const url = (await fs.readFile(config.currentUrlFile, 'utf8')).trim();
    if (url) {
      log(streams, `Neko web control URL: ${url}`);
    }
  } catch {
    // No current URL yet.
  }
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
