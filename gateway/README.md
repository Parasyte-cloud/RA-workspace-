# ParAsYtE Linux Gateway

Authenticated engineering sessions for RideArrivo engineers. The gateway validates each employee's Supabase access token, asks the database RPC to verify an active `engineer` or `admin` role, then attaches that employee to a dedicated non-root container with a persistent `/workspace` volume. The same isolated container now powers the ParAsYtE terminal, an embedded code-server VS Code workbench, and local web-app previews.

## Security boundary

- The gateway accepts the public Supabase publishable/anon key only. Never put a service-role, secret, production database password or production application credential in `gateway.env`, the tooling image or a workspace volume.
- Authorization is enforced by `authorize_parasyte_linux()` in the database, not by the browser navigation.
- The long-running engineer container runs as UID/GID `10001`, drops all Linux capabilities, uses `no-new-privileges`, a read-only root filesystem and configured CPU, memory, PID and file limits.
- A short-lived, network-disabled initializer gets only `CAP_CHOWN` when a new volume is created so the non-root shell can write to it.
- Every engineer gets a separately labeled Docker network, so tooling keeps outbound access without sharing a container network with another employee.
- Use a dedicated unprivileged Linux account with rootless Docker. That account must not own unrelated containers.
- One active terminal session per employee is allowed. The embedded IDE uses a separate short-lived, HttpOnly, Secure cookie issued only after the same server-side engineer/admin authorization check.
- code-server is pinned from the official Coder image, runs as UID/GID `10001`, and starts with browser file downloads and uploads disabled.
- GitHub integration uses a GitHub App on the gateway only. Never place the GitHub App private key or an installation token in Vite, browser storage, the tooling image or an engineer workspace volume.
- Idle containers stop automatically; terminal and IDE sessions have hard lifetimes and reconnect with freshly verified authorization.

## Build and test

```bash
cd gateway
npm ci
npm test
docker build -t parasyte-linux-tooling:1.0.0 tooling
```

The image contains Git, Node.js 22, Python 3, a checksum-verified Supabase CLI and code-server pinned to the official multi-architecture Coder image manifest. The engineer installs project dependencies into the persistent workspace; nothing is installed with elevated privileges in a session.

## Linux server setup

1. Create a dedicated `parasyte-gateway` Linux user and install Node.js 22 plus rootless Docker for that account using [Docker's official rootless instructions](https://docs.docker.com/engine/security/rootless/).
2. Enable lingering for the account so its user services and Docker daemon survive logout:

   ```bash
   sudo loginctl enable-linger parasyte-gateway
   ```

3. As `parasyte-gateway`, build the tooling image. Per-engineer networks are created automatically:

   ```bash
   cd /opt/ridearrivo-workspace/gateway
   npm ci
   npm run build
   docker build -t parasyte-linux-tooling:1.0.0 tooling
   ```

4. Copy `.env.example` to `~/.config/parasyte-linux/gateway.env`, set the real Supabase URL, publishable/anon key, `PARASYTE_PUBLIC_ORIGIN`, exact workspace origin and rootless Docker socket, then restrict it:

   ```bash
   mkdir -p ~/.config/parasyte-linux ~/.config/systemd/user
   chmod 700 ~/.config/parasyte-linux
   chmod 600 ~/.config/parasyte-linux/gateway.env
   ```

5. Install `deploy/parasyte-linux-gateway.service` as a user unit, adjust `/opt/ridearrivo-workspace` if needed, then start it:

   ```bash
   cp deploy/parasyte-linux-gateway.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now parasyte-linux-gateway
   curl --fail http://127.0.0.1:8787/health
   ```

6. Install the Nginx template, issue the TLS certificate, validate with `nginx -t`, and reload Nginx. The template proxies `/ws`, `/api/` and `/ide/` to the loopback-only gateway. Keep port `8787` and every dynamically allocated IDE port bound to loopback; expose only HTTPS/WSS port `443`.
7. Apply `supabase/migrations/20260828223000_parasyte_linux_gateway.sql`, set the frontend variable to `wss://linux.ridearrivo.com/ws`, and rebuild the workspace.

## Native GitHub console

The Engineering workspace deliberately does **not** iframe `github.com`. Instead, the gateway renders repository, pull-request and Actions data through the GitHub REST API so GitHub credentials never enter the browser.

Create a dedicated RideArrivo GitHub App, install it only on the repositories the workspace should expose, and grant the minimum read permissions required for the dashboard:

- Metadata: read
- Pull requests: read
- Actions: read

Then set `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` and `GITHUB_APP_PRIVATE_KEY_BASE64` together in `gateway.env`. `GITHUB_ORG` defaults to `Parasyte-cloud`. Keep the private key only in the gateway environment file with mode `0600`.

The native dashboard is intentionally read-only. Engineers who need to clone, push, review or merge should authenticate their own GitHub identity inside the embedded IDE/terminal; do not hand a shared organization write token to the browser or workspace.

## Operations

```bash
journalctl --user -u parasyte-linux-gateway -f
systemctl --user restart parasyte-linux-gateway
docker ps --filter label=com.ridearrivo.parasyte.managed=true
docker volume ls --filter label=com.ridearrivo.parasyte.managed=true
```

Back up the managed workspace volumes according to company retention policy. Removing an engineer's container is recoverable because `/workspace` is a named volume; removing that volume deletes their persisted workspace and must be an explicitly approved operation.
