#!/usr/bin/env python3
"""Dev server with caching off.

python -m http.server sends Last-Modified and the browser will happily reuse a
cached ES module across reloads, which means a QA screenshot can show code that
no longer exists on disk. Every capture here is evidence, so the server must
never let that happen.

    ./serve.py [port]        default 8777
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    # Each ES module import is its own HTTP/1.0 connection, so a page load opens
    # dozens at once. The default listen backlog of 5 overflows and macOS resets
    # the extras, which kills module loading and leaves a dead page.
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(NoCacheHandler, directory=directory)
    print(f"serving {directory} on http://localhost:{port} (no-store)")
    Server(("127.0.0.1", port), handler).serve_forever()
