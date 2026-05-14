import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  containerName: 'chrome-devtools-mcp-docker',
  image: undefined,
  webHost: '127.0.0.1',
  webPort: 8080,
  devtoolsHost: '127.0.0.1',
  seleniumPort: 4444,
  seleniumContainerPort: 4444,
  seleniumSessionTimeout: 86400,
  shmSize: '2g',
  stopOnExit: true,
  waitAttempts: 80
});

const ENV_MAP = Object.freeze({
  containerName: 'CHROME_DEVTOOLS_MCP_DOCKER_CONTAINER',
  image: 'CHROME_DEVTOOLS_MCP_DOCKER_IMAGE',
  webHost: 'CHROME_DEVTOOLS_MCP_DOCKER_WEB_HOST',
  webPort: 'CHROME_DEVTOOLS_MCP_DOCKER_WEB_PORT',
  webUrl: 'CHROME_DEVTOOLS_MCP_DOCKER_WEB_URL',
  devtoolsHost: 'CHROME_DEVTOOLS_MCP_DOCKER_DEVTOOLS_HOST',
  seleniumPort: 'CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_PORT',
  seleniumContainerPort: 'CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_CONTAINER_PORT',
  seleniumSessionTimeout: 'CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_SESSION_TIMEOUT',
  shmSize: 'CHROME_DEVTOOLS_MCP_DOCKER_SHM_SIZE',
  currentUrlFile: 'CHROME_DEVTOOLS_MCP_DOCKER_CURRENT_URL_FILE',
  stopOnExit: 'CHROME_DEVTOOLS_MCP_DOCKER_STOP_CONTAINER_ON_EXIT',
  waitAttempts: 'CHROME_DEVTOOLS_MCP_DOCKER_WAIT_ATTEMPTS'
});

const FLAG_MAP = Object.freeze({
  '--container': 'containerName',
  '--container-name': 'containerName',
  '--image': 'image',
  '--web-host': 'webHost',
  '--web-port': 'webPort',
  '--web-url': 'webUrl',
  '--devtools-host': 'devtoolsHost',
  '--selenium-port': 'seleniumPort',
  '--selenium-container-port': 'seleniumContainerPort',
  '--selenium-session-timeout': 'seleniumSessionTimeout',
  '--shm-size': 'shmSize',
  '--current-url-file': 'currentUrlFile',
  '--wait-attempts': 'waitAttempts'
});

const REMOVED_FLAGS = new Set([
  '--backend',
  '--devtools-port',
  '--devtools-container-port',
  '--webrtc-port',
  '--webrtc-nat-ip',
  '--screen-width',
  '--screen-height',
  '--screen-rate'
]);

const NUMBER_KEYS = new Set([
  'webPort',
  'seleniumPort',
  'seleniumContainerPort',
  'seleniumSessionTimeout',
  'waitAttempts'
]);

export function loadConfig({ argv = process.argv.slice(2), env = process.env } = {}) {
  const options = { ...DEFAULTS };
  options.currentUrlFile = defaultCurrentUrlFile(env);

  for (const [key, envName] of Object.entries(ENV_MAP)) {
    if (env[envName] !== undefined && env[envName] !== '') {
      options[key] = coerceValue(key, env[envName]);
    }
  }

  const passthroughArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      passthroughArgs.push(...argv.slice(index + 1));
      break;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }

    if (arg === '--status' || arg === '--stop-container') {
      options.command = arg.slice(2);
      continue;
    }

    if (arg === '--no-stop-on-exit') {
      options.stopOnExit = false;
      continue;
    }

    if (arg === '--stop-on-exit') {
      options.stopOnExit = true;
      continue;
    }

    if (arg === '--web-listen') {
      const value = argv[++index];
      if (!value) {
        throw new Error('--web-listen requires host:port');
      }
      const parsed = parseHostPort(value, '--web-listen');
      options.webHost = parsed.host;
      options.webPort = parsed.port;
      continue;
    }

    const inline = arg.match(/^(--[^=]+)=(.*)$/);
    const flag = inline ? inline[1] : arg;
    if (REMOVED_FLAGS.has(flag)) {
      throw new Error(`Unsupported option: ${flag}`);
    }
    if (FLAG_MAP[flag]) {
      const key = FLAG_MAP[flag];
      const value = inline ? inline[2] : argv[++index];
      if (value === undefined) {
        throw new Error(`${flag} requires a value`);
      }
      options[key] = coerceValue(key, value);
      continue;
    }

    passthroughArgs.push(arg);
  }

  validateConfig(options);

  if (!options.image) {
    options.image = 'selenium/standalone-chrome:latest';
  }

  const webUrl = options.webUrl ?? `http://${displayHost(options.webHost)}:${options.webPort}`;
  const seleniumUrl = `http://${options.devtoolsHost}:${options.seleniumPort}`;
  const seleniumWsUrl = `ws://${options.devtoolsHost}:${options.seleniumPort}`;

  return Object.freeze({
    ...options,
    webUrl,
    seleniumUrl,
    seleniumWsUrl,
    passthroughArgs
  });
}

export function buildDockerRunArgs(config, { adminPassword }) {
  return [
    'run',
    '-d',
    '--rm',
    '--name',
    config.containerName,
    '--shm-size',
    config.shmSize,
    '-p',
    `${config.webHost}:${config.webPort}:7900/tcp`,
    '-p',
    `${config.devtoolsHost}:${config.seleniumPort}:${config.seleniumContainerPort}/tcp`,
    '-e',
    `SE_VNC_PASSWORD=${adminPassword}`,
    '-e',
    'SE_NODE_MAX_SESSIONS=1',
    '-e',
    `SE_NODE_SESSION_TIMEOUT=${config.seleniumSessionTimeout}`,
    config.image
  ];
}

export function helpText() {
  return `chrome-devtools-mcp-docker

Starts a Docker-backed browser with a web UI and proxies chrome-devtools-mcp to it.

Usage:
  chrome-devtools-mcp-docker [options] [-- chrome-devtools-mcp args]

Options:
  --web-host <ip>            IP address for the browser web UI to listen on. Default: 127.0.0.1
  --web-port <port>          Host port for the browser web UI. Default: 8080
  --web-listen <ip:port>     Shorthand for --web-host and --web-port
  --web-url <url>            URL printed for users. Default: http://127.0.0.1:<web-port>
  --selenium-port <port>     Host port for Selenium/CDP proxy. Default: 4444
  --selenium-session-timeout <seconds>
                              Selenium browser session timeout. Default: 86400
  --devtools-host <ip>       IP address for DevTools host port. Default: 127.0.0.1
  --image <image>            Docker image. Default: selenium/standalone-chrome:latest
  --container <name>         Docker container name. Default: chrome-devtools-mcp-docker
  --no-stop-on-exit          Leave the browser container running after MCP exits
  --status                   Show the browser container status
  --stop-container           Stop the browser container
  --help                     Show this help

Environment:
  CHROME_DEVTOOLS_MCP_DOCKER_WEB_HOST
  CHROME_DEVTOOLS_MCP_DOCKER_WEB_PORT
  CHROME_DEVTOOLS_MCP_DOCKER_WEB_URL
  CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_PORT
  CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_SESSION_TIMEOUT
`;
}

function defaultCurrentUrlFile(env) {
  const base =
    env.XDG_RUNTIME_DIR ||
    env.TMPDIR ||
    os.tmpdir();
  return path.join(base, 'chrome-devtools-mcp-docker-current-url');
}

function coerceValue(key, value) {
  if (NUMBER_KEYS.has(key)) {
    return parsePortishNumber(key, value);
  }

  if (key === 'stopOnExit') {
    return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
  }

  return value;
}

function parseHostPort(value, label) {
  const lastColon = value.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === value.length - 1) {
    throw new Error(`${label} requires host:port`);
  }

  return {
    host: value.slice(0, lastColon),
    port: parsePort(value.slice(lastColon + 1))
  };
}

function parsePortishNumber(key, value) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  if (key.toLowerCase().includes('port')) {
    return parsePort(value);
  }
  if (number <= 0) {
    throw new Error(`Invalid positive number for ${key}: ${value}`);
  }
  return number;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function validateConfig(config) {
  for (const key of ['webHost', 'devtoolsHost']) {
    if (!config[key] || typeof config[key] !== 'string') {
      throw new Error(`${key} is required`);
    }
  }
}

function displayHost(host) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}
