# chrome-devtools-mcp-docker

Lazy Docker-backed Chrome for Chrome DevTools MCP, with a noVNC web interface for watching or controlling the same browser session.

When the MCP server starts, it:

1. Starts a Selenium standalone Chrome container in Docker.
2. Generates a temporary noVNC password.
3. Prints web-control URLs with the password embedded.
4. Creates a Chrome session and connects the bundled `chrome-devtools-mcp` server to its CDP endpoint.
5. Stops the container when the MCP server exits, unless configured otherwise.

## Requirements

- Node.js 20.19 or newer.
- Docker Engine.
- Permission to run Docker as the current user, or passwordless `sudo docker`.

## Codex Config

From GitHub:

```toml
[mcp_servers.chrome-devtools]
command = "npx"
args = [
  "-y",
  "git+ssh://git@github.com/KiritoMiao/chrome-devtools-mcp-docker.git",
  "--web-host",
  "127.0.0.1",
  "--web-port",
  "8080"
]
startup_timeout_ms = 60_000
```

From npm, after publishing:

```toml
[mcp_servers.chrome-devtools]
command = "npx"
args = ["-y", "chrome-devtools-mcp-docker"]
startup_timeout_ms = 60_000
```

## Web Interface

The temporary URL is printed to MCP stderr on startup:

```text
[chrome-devtools-mcp-docker] browser web control URL (configured): http://127.0.0.1:8080/?autoconnect=1&resize=scale&password=<temporary-password>
[chrome-devtools-mcp-docker] browser web control URL (cloudflare public IP <detected-ip>): http://<detected-ip>:8080/?autoconnect=1&resize=scale&password=<temporary-password>
[chrome-devtools-mcp-docker] browser web control URL (interface IP <detected-ip>): http://<detected-ip>:8080/?autoconnect=1&resize=scale&password=<temporary-password>
```

The Cloudflare line is detected from `https://www.cloudflare.com/cdn-cgi/trace`. The interface line is detected from the host network interfaces. If a detector cannot find an address, that line is omitted.

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
- `--devtools-host <ip>`: IP address for the Selenium/CDP host port. Default: `127.0.0.1`.
- `--image <image>`: Docker image. Default: `selenium/standalone-chrome:latest`.
- `--container <name>`: Docker container name. Default: `chrome-devtools-mcp-docker`.
- `--no-stop-on-exit`: Leave the browser container running after MCP exits.
- `--status`: Show container status without starting it.
- `--stop-container`: Stop the container.

Environment variables use the `CHROME_DEVTOOLS_MCP_DOCKER_` prefix, for example:

- `CHROME_DEVTOOLS_MCP_DOCKER_WEB_HOST`
- `CHROME_DEVTOOLS_MCP_DOCKER_WEB_PORT`
- `CHROME_DEVTOOLS_MCP_DOCKER_WEB_URL`
- `CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_PORT`
- `CHROME_DEVTOOLS_MCP_DOCKER_SELENIUM_SESSION_TIMEOUT`

## Development

```sh
npm install
npm test
npm pack --dry-run
```

## Publishing

Publishing is handled by GitHub Actions through npm trusted publishing. Configure npm before the first release:

1. Create or claim the `chrome-devtools-mcp-docker` package on npm.
2. In npm package settings, add a trusted publisher:
   - Provider: GitHub Actions
   - Organization/user: `KiritoMiao`
   - Repository: `chrome-devtools-mcp-docker`
   - Workflow filename: `publish.yml`
   - Environment: leave empty
3. Push a version bump to `main`.
4. Create a GitHub release for that version.

The workflow runs tests and `npm pack --dry-run`, then publishes to npm with provenance. Published prereleases use the `next` dist-tag by default; normal releases use `latest`. You can also run the workflow manually and choose `latest` or `next`.
