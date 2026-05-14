import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  backend: 'selenium',
  containerName: 'neko-chrome-mcp',
  image: undefined,
  webHost: '127.0.0.1',
  webPort: 8080,
  devtoolsHost: '127.0.0.1',
  devtoolsPort: 9222,
  devtoolsContainerPort: 9223,
  seleniumPort: 4444,
  seleniumContainerPort: 4444,
  seleniumSessionTimeout: 86400,
  webrtcPort: 59000,
  screenWidth: 1920,
  screenHeight: 1080,
  screenRate: 60,
  shmSize: '2g',
  stopOnExit: true,
  waitAttempts: 80
});

const ENV_MAP = Object.freeze({
  backend: 'NEKO_CHROME_MCP_BACKEND',
  containerName: 'NEKO_CHROME_MCP_CONTAINER',
  image: 'NEKO_CHROME_MCP_IMAGE',
  webHost: 'NEKO_CHROME_MCP_WEB_HOST',
  webPort: 'NEKO_CHROME_MCP_WEB_PORT',
  webUrl: 'NEKO_CHROME_MCP_WEB_URL',
  devtoolsHost: 'NEKO_CHROME_MCP_DEVTOOLS_HOST',
  devtoolsPort: 'NEKO_CHROME_MCP_DEVTOOLS_PORT',
  devtoolsContainerPort: 'NEKO_CHROME_MCP_DEVTOOLS_CONTAINER_PORT',
  seleniumPort: 'NEKO_CHROME_MCP_SELENIUM_PORT',
  seleniumContainerPort: 'NEKO_CHROME_MCP_SELENIUM_CONTAINER_PORT',
  seleniumSessionTimeout: 'NEKO_CHROME_MCP_SELENIUM_SESSION_TIMEOUT',
  webrtcPort: 'NEKO_CHROME_MCP_WEBRTC_PORT',
  webrtcNatIp: 'NEKO_CHROME_MCP_WEBRTC_NAT_IP',
  screenWidth: 'NEKO_CHROME_MCP_SCREEN_WIDTH',
  screenHeight: 'NEKO_CHROME_MCP_SCREEN_HEIGHT',
  screenRate: 'NEKO_CHROME_MCP_SCREEN_RATE',
  shmSize: 'NEKO_CHROME_MCP_SHM_SIZE',
  currentUrlFile: 'NEKO_CHROME_MCP_CURRENT_URL_FILE',
  stopOnExit: 'NEKO_CHROME_MCP_STOP_CONTAINER_ON_EXIT',
  waitAttempts: 'NEKO_CHROME_MCP_WAIT_ATTEMPTS'
});

const FLAG_MAP = Object.freeze({
  '--backend': 'backend',
  '--container': 'containerName',
  '--container-name': 'containerName',
  '--image': 'image',
  '--web-host': 'webHost',
  '--web-port': 'webPort',
  '--web-url': 'webUrl',
  '--devtools-host': 'devtoolsHost',
  '--devtools-port': 'devtoolsPort',
  '--devtools-container-port': 'devtoolsContainerPort',
  '--selenium-port': 'seleniumPort',
  '--selenium-container-port': 'seleniumContainerPort',
  '--selenium-session-timeout': 'seleniumSessionTimeout',
  '--webrtc-port': 'webrtcPort',
  '--webrtc-nat-ip': 'webrtcNatIp',
  '--screen-width': 'screenWidth',
  '--screen-height': 'screenHeight',
  '--screen-rate': 'screenRate',
  '--shm-size': 'shmSize',
  '--current-url-file': 'currentUrlFile',
  '--wait-attempts': 'waitAttempts'
});

const NUMBER_KEYS = new Set([
  'webPort',
  'devtoolsPort',
  'devtoolsContainerPort',
  'seleniumPort',
  'seleniumContainerPort',
  'seleniumSessionTimeout',
  'webrtcPort',
  'screenWidth',
  'screenHeight',
  'screenRate',
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
    options.image = options.backend === 'selenium'
      ? 'selenium/standalone-chrome:latest'
      : 'ghcr.io/m1k1o/neko/chromium:latest';
  }

  const webUrl = options.webUrl ?? `http://${displayHost(options.webHost)}:${options.webPort}`;
  const browserUrl = `http://${options.devtoolsHost}:${options.devtoolsPort}`;
  const seleniumUrl = `http://${options.devtoolsHost}:${options.seleniumPort}`;
  const seleniumWsUrl = `ws://${options.devtoolsHost}:${options.seleniumPort}`;

  return Object.freeze({
    ...options,
    webUrl,
    browserUrl,
    seleniumUrl,
    seleniumWsUrl,
    passthroughArgs
  });
}

export function buildDockerRunArgs(config, { runtimeDir, adminPassword, userPassword }) {
  if (config.backend === 'selenium') {
    return buildSeleniumDockerRunArgs(config, { adminPassword });
  }

  return [
    'run',
    '-d',
    '--rm',
    '--name',
    config.containerName,
    '--shm-size',
    config.shmSize,
    '-p',
    `${config.webHost}:${config.webPort}:8080/tcp`,
    '-p',
    `${config.devtoolsHost}:${config.devtoolsPort}:${config.devtoolsContainerPort}/tcp`,
    '-p',
    `${config.webHost}:${config.webrtcPort}:${config.webrtcPort}/tcp`,
    '-p',
    `${config.webHost}:${config.webrtcPort}:${config.webrtcPort}/udp`,
    '-e',
    `NEKO_DESKTOP_SCREEN=${config.screenWidth}x${config.screenHeight}@${config.screenRate}`,
    '-e',
    `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${adminPassword}`,
    '-e',
    `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${userPassword}`,
    '-e',
    `NEKO_WEBRTC_NAT1TO1=${config.webrtcNatIp ?? displayHost(config.webHost)}`,
    '-e',
    `NEKO_WEBRTC_UDPMUX=${config.webrtcPort}`,
    '-e',
    `NEKO_WEBRTC_TCPMUX=${config.webrtcPort}`,
    '-v',
    `${path.join(runtimeDir, 'chromium.conf')}:/etc/neko/supervisord/chromium.conf:ro`,
    '-v',
    `${path.join(runtimeDir, 'devtools-relay.conf')}:/etc/neko/supervisord/devtools-relay.conf:ro`,
    '-v',
    `${path.join(runtimeDir, 'devtools-relay.py')}:/tmp/neko-chrome-mcp-devtools-relay.py:ro`,
    config.image
  ];
}

function buildSeleniumDockerRunArgs(config, { adminPassword }) {
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
  return `neko-chrome-mcp

Starts a Docker-backed browser with a web UI and proxies chrome-devtools-mcp to it.

Usage:
  neko-chrome-mcp [options] [-- chrome-devtools-mcp args]

Options:
  --web-host <ip>            IP address for the browser web UI to listen on. Default: 127.0.0.1
  --web-port <port>          Host port for the browser web UI. Default: 8080
  --web-listen <ip:port>     Shorthand for --web-host and --web-port
  --web-url <url>            URL printed for users. Default: http://127.0.0.1:<web-port>
  --backend <backend>        Browser container backend: selenium or neko. Default: selenium
  --selenium-port <port>     Host port for Selenium/CDP proxy. Default: 4444
  --selenium-session-timeout <seconds>
                              Selenium browser session timeout. Default: 86400
  --devtools-host <ip>       IP address for DevTools host port. Default: 127.0.0.1
  --devtools-port <port>     Host port for Neko DevTools relay. Default: 9222
  --webrtc-port <port>       Host/container mux port for Neko WebRTC. Default: 59000
  --webrtc-nat-ip <ip>       IP advertised to Neko WebRTC clients. Default: display web host
  --image <image>            Docker image. Default depends on backend
  --container <name>         Docker container name. Default: neko-chrome-mcp
  --no-stop-on-exit          Leave the browser container running after MCP exits
  --status                   Show the browser container status
  --stop-container           Stop the browser container
  --help                     Show this help
`;
}

function defaultCurrentUrlFile(env) {
  const base =
    env.XDG_RUNTIME_DIR ||
    env.TMPDIR ||
    os.tmpdir();
  return path.join(base, 'neko-chrome-mcp-current-url');
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
  if (!['selenium', 'neko'].includes(config.backend)) {
    throw new Error(`Invalid backend: ${config.backend}`);
  }

  for (const key of ['webHost', 'devtoolsHost']) {
    if (!config[key] || typeof config[key] !== 'string') {
      throw new Error(`${key} is required`);
    }
  }
}

function displayHost(host) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}
