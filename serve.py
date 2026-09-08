"""Static dev server with HTTP Range support.

The stock http.server does not answer Range requests, so a browser reports the
video as unseekable and the scroll scrub silently does nothing. Production
hosts (nginx, Vercel, Netlify) handle ranges themselves; this is only for
local preview.

    python serve.py [port]
"""

import os
import re
import sys
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        header = self.headers.get("Range")
        if not header:
            return super().send_head()

        match = RANGE_RE.fullmatch(header.strip())
        if not match:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        try:
            handle = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(handle.fileno()).st_size
        start_raw, end_raw = match.groups()

        if start_raw:
            start = int(start_raw)
            end = int(end_raw) if end_raw else size - 1
        else:  # suffix range: last N bytes
            if not end_raw:
                handle.close()
                self.send_error(400, "Malformed Range header")
                return None
            start = max(size - int(end_raw), 0)
            end = size - 1

        end = min(end, size - 1)
        if start > end:
            handle.close()
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.end_headers()
            return None

        handle.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return _Window(handle, end - start + 1)

    def end_headers(self):
        if "Accept-Ranges" not in self._headers_buffer_names():
            self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _headers_buffer_names(self):
        return b"".join(getattr(self, "_headers_buffer", []) or []).decode("latin-1")


class _Window:
    """File wrapper that stops after `remaining` bytes, for copyfile()."""

    def __init__(self, handle, remaining):
        self._handle = handle
        self._remaining = remaining

    def read(self, amount=-1):
        if self._remaining <= 0:
            return b""
        if amount is None or amount < 0 or amount > self._remaining:
            amount = self._remaining
        chunk = self._handle.read(amount)
        self._remaining -= len(chunk)
        return chunk

    def close(self):
        self._handle.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
    root = os.path.dirname(os.path.abspath(__file__))
    handler = partial(RangeHandler, directory=root)
    print("Nordholm dev server on http://localhost:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
