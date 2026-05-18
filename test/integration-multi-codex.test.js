import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shouldRun = process.env.RUN_DOCKER_INTEGRATION === '1';

test('two Codex wrapper processes can start against one shared browser container', {
  skip: shouldRun ? false : 'set RUN_DOCKER_INTEGRATION=1 to run Docker-backed MCP startup test',
  timeout: 90_000
}, async (t) => {
  if (!dockerAvailableToChildProcess()) {
    t.skip('Docker is not available to child Node processes');
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'chrome-devtools-mcp-docker-'));
  const containerName = `chrome-devtools-mcp-docker-test-${process.pid}-${Date.now()}`;
  const currentUrlFile = join(tempDir, 'current-url');
  const [webPort, seleniumPort] = candidatePorts();
  const bin = new URL('../bin/chrome-devtools-mcp-docker.js', import.meta.url);
  const commonArgs = [
    bin.pathname,
    '--container', containerName,
    '--current-url-file', currentUrlFile,
    '--web-port', String(webPort),
    '--selenium-port', String(seleniumPort),
    '--max-sessions', '2',
    '--selenium-session-request-timeout', '5',
    '--selenium-session-retry-interval', '1'
  ];

  const first = startWrapper(commonArgs);
  const second = startWrapper(commonArgs);

  try {
    const startedAt = Date.now();
    await Promise.all([
      waitForSession(first),
      waitForSession(second)
    ]);
    assert.ok(Date.now() - startedAt < 60_000, 'both wrappers should create sessions without a long Selenium queue');
  } finally {
    first.kill();
    second.kill();
    await stopContainer(commonArgs);
    await rm(tempDir, { recursive: true, force: true });
  }
});

function startWrapper(args) {
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1'
    }
  });
  child.stderrText = '';
  child.stderr.on('data', (chunk) => {
    child.stderrText += chunk.toString('utf8');
  });
  return child;
}

function waitForSession(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for Selenium session\n${child.stderrText}`));
    }, 60_000);

    child.stderr.on('data', () => {
      if (child.stderrText.includes('created Selenium Chrome session')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`wrapper exited before creating a session: code=${code} signal=${signal}\n${child.stderrText}`));
    });
  });
}

async function stopContainer(commonArgs) {
  const args = [
    ...commonArgs.filter((arg, index) => index === 0 || [
      '--container',
      '--current-url-file',
      '--web-port',
      '--selenium-port'
    ].includes(commonArgs[index - 1]) || [
      '--container',
      '--current-url-file',
      '--web-port',
      '--selenium-port'
    ].includes(arg)),
    '--stop-container'
  ];
  await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'ignore', 'ignore']
    });
    child.once('exit', resolve);
    child.once('error', resolve);
  });
}

function candidatePorts() {
  const base = 20_000 + (process.pid % 20_000);
  return [base, base + 1];
}

function dockerAvailableToChildProcess() {
  return commandSucceeds('docker', ['info']) ||
    commandSucceeds('sudo', ['-n', 'docker', 'info']);
}

function commandSucceeds(command, args) {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'ignore', 'ignore']
  });
  return result.status === 0;
}
