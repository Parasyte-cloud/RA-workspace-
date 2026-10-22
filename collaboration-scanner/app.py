import hmac
import os
import subprocess
import tempfile
from flask import Flask, jsonify, request

app = Flask(__name__)
MAX_BYTES = 25 * 1024 * 1024


def authorized() -> bool:
    expected = os.environ.get("SCAN_TOKEN", "")
    supplied = request.headers.get("Authorization", "")
    if not expected or not supplied.startswith("Bearer "):
        return False
    return hmac.compare_digest(supplied[7:], expected)


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/scan")
def scan():
    if not authorized():
        return jsonify(error="unauthorized"), 401

    upload = request.files.get("file")
    if upload is None:
        return jsonify(error="file_required"), 400

    with tempfile.NamedTemporaryFile(prefix="ra-scan-", delete=True) as tmp:
        total = 0
        while True:
            chunk = upload.stream.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_BYTES:
                return jsonify(error="file_too_large"), 413
            tmp.write(chunk)
        tmp.flush()

        result = subprocess.run(
            ["clamscan", "--no-summary", "--stdout", tmp.name],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    output = (result.stdout + "\n" + result.stderr).strip()[-4000:]
    if result.returncode == 0:
        return jsonify(verdict="clean", provider="clamav", detail=output)
    if result.returncode == 1:
        return jsonify(verdict="infected", provider="clamav", detail=output), 200
    return jsonify(verdict="error", provider="clamav", detail=output), 503
