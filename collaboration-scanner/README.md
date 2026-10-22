# RA Collaboration malware scanner

Private HTTP scanner for `collaboration-file-ingest`.

Required environment variable:

- `SCAN_TOKEN` — long random bearer token. Use the same value as Supabase secret `COLLAB_FILE_SCAN_TOKEN`.

Endpoints:

- `GET /health`
- `POST /scan` with `Authorization: Bearer <SCAN_TOKEN>` and multipart field `file`.

The response contract is `{ "verdict": "clean|infected|error", "provider": "clamav" }`.

Keep this service private where possible. If it must have a public URL, the bearer token is mandatory and should be rotated periodically.
