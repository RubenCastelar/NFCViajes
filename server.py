#!/usr/bin/env python3
import argparse
import base64
import json
import subprocess
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote


class LocalHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/convert-heic":
            self.send_error(HTTPStatus.NOT_FOUND, "Ruta no encontrada")
            return

        try:
            payload = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            filename = unquote(self.headers.get("X-File-Name", "imagen.heic"))
            result = convert_heic_bytes(payload, filename)
        except subprocess.CalledProcessError as error:
            self.send_response(HTTPStatus.BAD_REQUEST)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "error": "No se pudo convertir el archivo HEIC.",
                        "details": error.stderr.decode("utf-8", errors="ignore"),
                    }
                ).encode("utf-8")
            )
            return
        except Exception as error:  # noqa: BLE001
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(error)}).encode("utf-8"))
            return

        body = json.dumps(result).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def convert_heic_bytes(payload: bytes, filename: str) -> dict:
    suffix = Path(filename).suffix or ".heic"
    stem = Path(filename).stem or "imagen"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        input_path = tmp_path / f"input{suffix}"
        output_path = tmp_path / f"{stem}.jpg"
        input_path.write_bytes(payload)

        subprocess.run(
            ["sips", "-s", "format", "jpeg", str(input_path), "--out", str(output_path)],
            check=True,
            capture_output=True,
        )

        encoded = base64.b64encode(output_path.read_bytes()).decode("ascii")

    return {
        "src": f"data:image/jpeg;base64,{encoded}",
        "name": f"{stem}.jpg",
        "type": "image/jpeg",
    }


def main():
    parser = argparse.ArgumentParser(description="Servidor local para Recuerdos NFC")
    parser.add_argument("port", nargs="?", type=int, default=4177)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), LocalHandler)
    print(f"Recuerdos NFC en http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
