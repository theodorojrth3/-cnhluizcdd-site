from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote


class SpaHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = unquote(self.path.split("?", 1)[0])
        if path.endswith("/") or path == "/":
            return super().do_GET()
        local_path = (Path(self.directory) / path.lstrip("/")).resolve()
        if local_path.is_file():
            return super().do_GET()
        self.path = "/index.html"
        return super().do_GET()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--dir", type=str, default=".")
    args = parser.parse_args()

    server = ThreadingHTTPServer(("0.0.0.0", args.port), SpaHandler)
    server.RequestHandlerClass.directory = args.dir
    print(f"Serving {args.dir} on http://localhost:{args.port}")
    server.serve_forever()
