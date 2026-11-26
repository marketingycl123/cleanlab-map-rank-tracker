#!/usr/bin/env python3
"""Open the dashboard locally with browser caching switched off, so updated files always show.

    python serve.py          then open http://localhost:8000
    python serve.py 8001     use another port
"""
import functools
import http.server
import socketserver
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent / "docs"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(DOCS))) as srv:
    print(f"Open http://localhost:{PORT}   (press Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("Stopped")
