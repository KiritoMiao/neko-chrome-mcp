# neko-chrome-mcp

Lazy Docker-backed Chromium for Chrome DevTools MCP, with a Neko web interface for watching or controlling the same browser session.

When the MCP server starts, it:

1. Starts `ghcr.io/m1k1o/neko/chromium` in Docker.
2. Generates a temporary Neko admin password.
3. Prints a web-control URL with `usr` and `pwd` embedded.
4. Connects the bundled `chrome-devtools-mcp` server to Chromium's DevTools endpoint.
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
  "github:KiritoMiao/neko-chrome-mcp",
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
[neko-chrome-mcp] Neko web control URL: http://127.0.0.1:8080/?usr=codex&pwd=<temporary-password>
```

Useful options:

```sh
npx -y github:KiritoMiao/neko-chrome-mcp --web-host 127.0.0.1 --web-port 8080
npx -y github:KiritoMiao/neko-chrome-mcp --web-listen 0.0.0.0:18080 --web-url http://YOUR_HOST:18080
```

`--web-host` controls the listen IP address for the Neko web interface and WebRTC mux port. `--web-port` controls the Neko web interface host port. DevTools stays bound to `127.0.0.1` by default.

If exposing Neko beyond localhost, set `--web-url` to the URL users should open and set `--webrtc-nat-ip` if the browser must advertise a specific public IP to WebRTC clients.

## CLI

```text
neko-chrome-mcp [options] [-- chrome-devtools-mcp args]
```

Options:

- `--web-host <ip>`: IP address for the Neko web UI to listen on. Default: `127.0.0.1`.
- `--web-port <port>`: Host port for the Neko web UI. Default: `8080`.
- `--web-listen <ip:port>`: Shorthand for `--web-host` and `--web-port`.
- `--web-url <url>`: URL printed for users. Default: `http://127.0.0.1:<web-port>`.
- `--devtools-host <ip>`: IP address for DevTools host port. Default: `127.0.0.1`.
- `--devtools-port <port>`: Host port for DevTools MCP. Default: `9222`.
- `--webrtc-port <port>`: Host/container mux port for Neko WebRTC. Default: `59000`.
- `--webrtc-nat-ip <ip>`: IP advertised to Neko WebRTC clients.
- `--image <image>`: Docker image. Default: `ghcr.io/m1k1o/neko/chromium:latest`.
- `--container <name>`: Docker container name. Default: `neko-chrome-mcp`.
- `--no-stop-on-exit`: Leave the browser container running after MCP exits.
- `--status`: Show container status without starting it.
- `--stop-container`: Stop the container.

Environment variables use the `NEKO_CHROME_MCP_` prefix, for example:

- `NEKO_CHROME_MCP_WEB_HOST`
- `NEKO_CHROME_MCP_WEB_PORT`
- `NEKO_CHROME_MCP_WEB_URL`
- `NEKO_CHROME_MCP_WEBRTC_NAT_IP`

## Development

```sh
npm install
npm test
npm pack --dry-run
```
