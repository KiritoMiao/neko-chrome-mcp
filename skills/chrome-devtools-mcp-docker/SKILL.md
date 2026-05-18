---
name: chrome-devtools-mcp-docker
description: Use when working with the chrome-devtools-mcp-docker MCP server, especially when the user needs the browser web-control/noVNC URL or Codex has started browser automation through this MCP server.
---

# Chrome DevTools MCP Docker

Codex may hide MCP server startup stderr, so the browser web-control URL might not be visible even though the MCP server printed it.

Before the first browser-control task in a session, or whenever the user asks for the browser URL:

1. Run `npx -y chrome-devtools-mcp-docker --status`.
2. Find the `browser web control URL` line in stderr.
3. Tell the user that URL. It includes the temporary noVNC password.

If `--status` prints no URL, the MCP server has not started the shared browser container yet, the current URL file was removed, or the user is using a custom container/current-url-file setting. In that case, ask the user for their Codex MCP config or run the same command and arguments from their `mcp_servers.chrome-devtools` entry with `--status` added.

Do not write the URL to MCP stdout. The wrapped `chrome-devtools-mcp` process owns stdout for the MCP protocol.
