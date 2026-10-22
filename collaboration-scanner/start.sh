#!/bin/sh
set -eu
# Refresh signatures at startup. If the mirror is temporarily unavailable,
# ClamAV still starts with the image's available database and the service
# remains fail-closed for scan errors.
freshclam || true
exec gunicorn --bind "0.0.0.0:${PORT:-8080}" --workers 2 --threads 2 --timeout 90 app:app
