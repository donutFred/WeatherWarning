#!/usr/bin/env python3
"""Serve this folder over HTTPS for local testing."""

import http.server
import os
import ssl
import subprocess
import sys


def ensure_localhost_certificate(cert_file: str, key_file: str) -> None:
    if os.path.exists(cert_file) and os.path.exists(key_file):
        return

    openssl_cmd = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        "365",
        "-nodes",
        "-keyout",
        key_file,
        "-out",
        cert_file,
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]

    try:
        subprocess.run(openssl_cmd, check=True)
    except FileNotFoundError:
        print("Error: openssl not found. Install OpenSSL and try again.", file=sys.stderr)
        raise SystemExit(1)
    except subprocess.CalledProcessError:
        print("Error: failed to create localhost certificate.", file=sys.stderr)
        raise SystemExit(1)


def main() -> None:
    port = 8082
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Error: port must be a number.", file=sys.stderr)
            raise SystemExit(1)

    cert_file = ".localhost.crt"
    key_file = ".localhost.key"
    ensure_localhost_certificate(cert_file, key_file)

    server = http.server.ThreadingHTTPServer(
        ("0.0.0.0", port), http.server.SimpleHTTPRequestHandler
    )

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_file, key_file)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)

    print(f"Open: https://localhost:{port}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
