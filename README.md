# neko-chrome-mcp

Lazy Docker-backed Chrome for Chrome DevTools MCP, with a web interface for watching or controlling the same browser session. The default backend is Selenium standalone Chrome because its noVNC and CDP proxy work reliably with `chrome-devtools-mcp`; the original Neko Chromium backend is still available with `--backend neko`.

When the MCP server starts, it:

1. Starts a Chrome web UI container in Docker.
2. Generates a temporary web UI password.
3. Prints a web-control URL with the password embedded.
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
  "git+ssh://git@github.com/KiritoMiao/neko-chrome-mcp.git",
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
args = ["-y", "neko-chrome-mcp"]
startup_timeout_ms = 60_000
```

## Web Interface

The temporary URL is printed to MCP stderr on startup:

```text
[neko-chrome-mcp] browser web control URL: http://127.0.0.1:8080/?autoconnect=1&resize=scale&password=<temporary-password>
```

Useful options:

```sh
npx -y git+ssh://git@github.com/KiritoMiao/neko-chrome-mcp.git --web-host 127.0.0.1 --web-port 8080
npx -y git+ssh://git@github.com/KiritoMiao/neko-chrome-mcp.git --web-listen 0.0.0.0:18080 --web-url http://YOUR_HOST:18080
```

`--web-host` controls the listen IP address for the browser web interface. `--web-port` controls the browser web interface host port. Selenium/CDP stays bound to `127.0.0.1:4444` by default.

If exposing the web interface beyond localhost, set `--web-url` to the URL users should open. For the legacy Neko backend, also set `--webrtc-nat-ip` if the browser must advertise a specific public IP to WebRTC clients.

## CLI

```text
neko-chrome-mcp [options] [-- chrome-devtools-mcp args]
```

Options:

- `--web-host <ip>`: IP address for the browser web UI to listen on. Default: `127.0.0.1`.
- `--web-port <port>`: Host port for the browser web UI. Default: `8080`.
- `--web-listen <ip:port>`: Shorthand for `--web-host` and `--web-port`.
- `--web-url <url>`: URL printed for users. Default: `http://127.0.0.1:<web-port>`.
- `--backend <backend>`: Browser container backend: `selenium` or `neko`. Default: `selenium`.
- `--selenium-port <port>`: Host port for the Selenium/CDP proxy. Default: `4444`.
- `--devtools-host <ip>`: IP address for DevTools host port. Default: `127.0.0.1`.
- `--devtools-port <port>`: Host port for the legacy Neko DevTools relay. Default: `9222`.
- `--webrtc-port <port>`: Host/container mux port for legacy Neko WebRTC. Default: `59000`.
- `--webrtc-nat-ip <ip>`: IP advertised to legacy Neko WebRTC clients.
- `--image <image>`: Docker image. Default depends on backend.
- `--container <name>`: Docker container name. Default: `neko-chrome-mcp`.
- `--no-stop-on-exit`: Leave the browser container running after MCP exits.
- `--status`: Show container status without starting it.
- `--stop-container`: Stop the container.

Environment variables use the `NEKO_CHROME_MCP_` prefix, for example:

- `NEKO_CHROME_MCP_WEB_HOST`
- `NEKO_CHROME_MCP_WEB_PORT`
- `NEKO_CHROME_MCP_WEB_URL`
- `NEKO_CHROME_MCP_BACKEND`
- `NEKO_CHROME_MCP_SELENIUM_PORT`
- `NEKO_CHROME_MCP_WEBRTC_NAT_IP`

## Development

```sh
npm install
npm test
npm pack --dry-run
```

## Publishing

Publishing is handled by GitHub Actions through npm trusted publishing. Configure npm before the first release:

1. Create or claim the `neko-chrome-mcp` package on npm.
2. In npm package settings, add a trusted publisher:
   - Provider: GitHub Actions
   - Organization/user: `KiritoMiao`
   - Repository: `neko-chrome-mcp`
   - Workflow filename: `publish.yml`
   - Environment: leave empty
3. Push a version bump to `main`.
4. Create a GitHub release for that version.

The workflow runs tests and `npm pack --dry-run`, then publishes to npm with provenance. Published prereleases use the `next` dist-tag by default; normal releases use `latest`. You can also run the workflow manually and choose `latest` or `next`.
