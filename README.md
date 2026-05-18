# chrome-devtools-mcp-docker

Lazy Docker-backed Chrome for Chrome DevTools MCP, with a noVNC web interface for watching or controlling the same browser session.

When the MCP server starts, it:

1. Starts or reuses a Selenium standalone Chrome container in Docker.
2. Generates a temporary noVNC password.
3. Prints web-control URLs with the password embedded.
4. Creates a Chrome session and connects the bundled `chrome-devtools-mcp` server to its CDP endpoint.
5. Leaves the shared container running for reuse by other Codex sessions, unless `--stop-on-exit` is configured.

## Requirements

- Node.js 20.19 or newer.
- Docker Engine.
- Permission to run Docker as the current user, or passwordless `sudo docker`.

## Codex Config

From npm:

```toml
[mcp_servers.chrome-devtools]
command = "npx"
args = ["-y", "chrome-devtools-mcp-docker"]
startup_timeout_sec = 60
```

Codex may not display MCP server startup stderr. To show the browser control URL at any time, run:

```sh
npx -y chrome-devtools-mcp-docker --status
```

This prints the saved noVNC URL, including the temporary password, when the shared container has been started.

## Web Interface

The temporary URL is printed to MCP stderr on startup:

```text
[chrome-devtools-mcp-docker] browser web control URL (configured): http://127.0.0.1:8080/?autoconnect=1&resize=scale&password=<temporary-password>
[chrome-devtools-mcp-docker] browser web control URL (interface IP <detected-ip>): http://<detected-ip>:8080/?autoconnect=1&resize=scale&password=<temporary-password>
```

The interface line is detected from the host network interfaces. If no public interface address is found, that line is omitted. Use `--detect-public-urls` to also query `https://www.cloudflare.com/cdn-cgi/trace` and print a Cloudflare public-IP URL; this is opt-in so MCP startup does not wait on external network detection by default.

Useful options:

```sh
npx -y chrome-devtools-mcp-docker --web-host 127.0.0.1 --web-port 8080
npx -y chrome-devtools-mcp-docker --web-listen 0.0.0.0:18080 --web-url http://YOUR_HOST:18080
```

`--web-host` controls the listen IP address for the browser web interface. `--web-port` controls the browser web interface host port. Selenium/CDP stays bound to `127.0.0.1:4444` by default.

If exposing the web interface beyond localhost, set `--web-url` to the URL users should open.

## CLI

```text
chrome-devtools-mcp-docker [options] [-- chrome-devtools-mcp args]
```

Options:

- `--web-host <ip>`: IP address for the browser web UI to listen on. Default: `127.0.0.1`.
- `--web-port <port>`: Host port for the browser web UI. Default: `8080`.
- `--web-listen <ip:port>`: Shorthand for `--web-host` and `--web-port`.
- `--web-url <url>`: URL printed for users. Default: `http://127.0.0.1:<web-port>`.
- `--selenium-port <port>`: Host port for the Selenium/CDP proxy. Default: `4444`.
- `--selenium-session-timeout <seconds>`: Selenium browser session timeout. Default: `86400`.
- `--selenium-session-request-timeout <seconds>`: Maximum time Selenium queues a new browser session when all slots are busy. Default: `10`.
- `--selenium-session-retry-interval <seconds>`: Selenium queued-session retry interval. Default: `1`.
- `--max-sessions <count>`: Maximum concurrent Selenium browser sessions in the shared container. Default: `4`.
- `--devtools-host <ip>`: IP address for the Selenium/CDP host port. Default: `127.0.0.1`.
- `--image <image>`: Docker image. Default: `selenium/standalone-chrome:latest`.
- `--container <name>`: Docker container name. Default: `chrome-devtools-mcp-docker`.
- `--stop-on-exit`: Stop the browser container when the MCP server process that created it exits.
- `--no-stop-on-exit`: Leave the browser container running after MCP exits. This is the default so multiple Codex sessions can share the container.
- `--detect-public-urls`: Also detect and print public-IP browser URLs. Disabled by default to avoid slow startup on blocked networks.
- `--status`: Show container status without starting it.
- `--stop-container`: Stop the container.

Environment variables use the `CHROME_DEVTOOLS_MCP_DOCKER_` prefix, for example:

- `CHROME_DEVTOOLS_MCP_DOCKER_WEB_HOST`
- `CHROME_DEVTOOLS_MCP_DOCKER_WEB_PORT`
- `CHROME_DEVTOOLS_MCP_DOCKER_WEB_URL`
- `CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_PORT`
- `CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_SESSION_TIMEOUT`
- `CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_SESSION_REQUEST_TIMEOUT`
- `CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_SESSION_RETRY_INTERVAL`
- `CHROME_DEVTOOLS_MCP_DOCKER_MAX_SESSIONS`
- `CHROME_DEVTOOLS_MCP_DOCKER_DETECT_PUBLIC_URLS`

## Codex Skill

An optional Codex skill is included at `skills/chrome-devtools-mcp-docker/SKILL.md`. Install or copy it into your Codex skills directory if you want Codex to proactively retrieve the current browser URL with `npx -y chrome-devtools-mcp-docker --status` before browser-control work.

## Development

```sh
npm install
npm test
npm pack --dry-run
```
