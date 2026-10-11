"""Real NTLM handshakes checked by Samba's domain controller, per TCP connection."""
import base64
import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path('/var/www/html/protected/file.bin').read_bytes()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.helper = None

    def finish(self):
        if self.helper:
            self.helper.terminate()
            try:
                self.helper.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.helper.kill()
                self.helper.wait()
        super().finish()

    def log_message(self, *_args):
        pass  # Never log Authorization headers or credentials.

    def do_GET(self):
        self.respond(False)

    def do_HEAD(self):
        self.respond(True)

    def respond(self, head):
        if self.path != '/file.bin':
            self.send_error(404)
            return
        auth = self.headers.get('Authorization', '')
        challenge = 'NTLM'
        accepted = False
        if auth.startswith('NTLM ') and len(auth) < 32768:
            try:
                token = auth[5:]
                raw = base64.b64decode(token, validate=True)
                if raw[:8] != b'NTLMSSP\0' or len(raw) < 12:
                    raise ValueError('invalid NTLM message')
                kind = int.from_bytes(raw[8:12], 'little')
                if kind == 1:
                    if self.helper:
                        self.helper.terminate()
                        self.helper.wait(timeout=3)
                    self.helper = subprocess.Popen(
                        ['ntlm_auth', '--helper-protocol=squid-2.5-ntlmssp',
                         '--domain=DOWNLOADER'], stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                    command = 'YR ' + token
                elif kind == 3 and self.helper:
                    command = 'KK ' + token
                else:
                    raise ValueError('invalid NTLM sequence')
                self.helper.stdin.write(command + '\n')
                self.helper.stdin.flush()
                reply = self.helper.stdout.readline().strip()
                if reply.startswith('TT '):
                    challenge = 'NTLM ' + reply[3:]
                elif reply.startswith('AF '):
                    accepted = True
            except (ValueError, OSError, subprocess.TimeoutExpired):
                accepted = False
        self.send_response(200 if accepted else 401)
        if not accepted:
            self.send_header('WWW-Authenticate', challenge)
        self.send_header('Content-Length', str(len(DATA) if accepted else 0))
        self.end_headers()
        if accepted and not head:
            self.wfile.write(DATA)
        print(json.dumps({'method': self.command, 'authenticated': accepted}), flush=True)


ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
