export function chromiumSupervisorConfig() {
  return `[program:chromium]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s"
command=/usr/bin/chromium
  --no-sandbox
  --window-position=0,0
  --display=%(ENV_DISPLAY)s
  --user-data-dir=/home/neko/.config/chromium
  --no-first-run
  --start-maximized
  --bwsi
  --force-dark-mode
  --disable-file-system
  --disable-gpu
  --disable-software-rasterizer
  --disable-dev-shm-usage
  --remote-debugging-address=127.0.0.1
  --remote-debugging-port=9222
  --remote-allow-origins=*
stopsignal=INT
autorestart=true
priority=800
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/chromium.log
stdout_logfile_maxbytes=100MB
stdout_logfile_backups=10
redirect_stderr=true

[program:openbox]
environment=HOME="/home/%(ENV_USER)s",USER="%(ENV_USER)s",DISPLAY="%(ENV_DISPLAY)s"
command=/usr/bin/openbox --config-file /etc/neko/openbox.xml
autorestart=true
priority=300
user=%(ENV_USER)s
stdout_logfile=/var/log/neko/openbox.log
stdout_logfile_maxbytes=100MB
stdout_logfile_backups=10
redirect_stderr=true
`;
}

export function relaySupervisorConfig() {
  return `[program:devtools-relay]
command=/usr/bin/python3 /tmp/neko-chrome-mcp-devtools-relay.py
autorestart=true
priority=850
stdout_logfile=/var/log/neko/devtools-relay.log
stdout_logfile_maxbytes=20MB
stdout_logfile_backups=3
redirect_stderr=true
`;
}

export function relayPythonScript({ listenPort = 9223, targetPort = 9222 } = {}) {
  return `#!/usr/bin/env python3
import socket
import socketserver
import threading

LISTEN = ("0.0.0.0", ${listenPort})
TARGET = ("127.0.0.1", ${targetPort})

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            upstream = socket.create_connection(TARGET, timeout=10)
        except OSError:
            return

        sockets = (self.request, upstream)
        done = threading.Event()

        def pipe(src, dst):
            try:
                while not done.is_set():
                    data = src.recv(65536)
                    if not data:
                        break
                    dst.sendall(data)
            except OSError:
                pass
            finally:
                done.set()
                for sock in sockets:
                    try:
                        sock.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    try:
                        sock.close()
                    except OSError:
                        pass

        left = threading.Thread(target=pipe, args=(self.request, upstream), daemon=True)
        right = threading.Thread(target=pipe, args=(upstream, self.request), daemon=True)
        left.start()
        right.start()
        left.join()
        right.join()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

with Server(LISTEN, Handler) as server:
    server.serve_forever()
`;
}
