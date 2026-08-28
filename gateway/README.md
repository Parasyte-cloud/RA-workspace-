# ParAsYtE Linux Gateway

Authenticated WebSocket terminals for RideArrivo engineers. The gateway validates each employee's Supabase access token, asks the database RPC to verify an active `engineer` or `admin` role, then attaches that employee to a dedicated non-root container with a persistent `/workspace` volume.

## Security boundary

- The gateway accepts the public Supabase publishable/anon key only. Never put a service-role, secret, production database password or production application credential in `gateway.env`, the tooling image or a workspace volume.
- Authorization is enforced by `authorize_parasyte_linux()` in the database, not by the browser navigation.
- The long-running engineer container runs as UID/GID `10001`, drops all Linux capabilities, uses `no-new-privileges`, a read-only root filesystem and configured CPU, memory, PID and file limits.
- A short-lived, network-disabled initializer gets only `CAP_CHOWN` when a new volume is created so the non-root shell can write to it.
- Every engineer gets a separately labeled Docker network, so tooling keeps outbound access without sharing a container network with another employee.
- Use a dedicated unprivileged Linux account with rootless Docker. That account must not own unrelated containers.
- One active shell per employee is allowed. Idle containers stop automatically; sessions have a hard lifetime and reconnect with a freshly verified token.

## Build and test

```bash
cd gateway
npm ci
npm test
docker build -t parasyte-linux-tooling:1.0.0 tooling
```

The image contains Git, Node.js 22, Python 3 and a checksum-verified Supabase CLI. The engineer installs project dependencies into the persistent workspace; nothing is installed with elevated privileges in a session.

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

4. Copy `.env.example` to `~/.config/parasyte-linux/gateway.env`, set the real Supabase URL, publishable/anon key, exact workspace origin and rootless Docker socket, then restrict it:

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

6. Install the Nginx template, issue the TLS certificate, validate with `nginx -t`, and reload Nginx. Keep port `8787` bound to loopback; expose only HTTPS/WSS port `443`.
7. Apply `supabase/migrations/20260828223000_parasyte_linux_gateway.sql`, set the frontend variable to `wss://linux.ridearrivo.com/ws`, and rebuild the workspace.

## Operations

```bash
journalctl --user -u parasyte-linux-gateway -f
systemctl --user restart parasyte-linux-gateway
docker ps --filter label=com.ridearrivo.parasyte.managed=true
docker volume ls --filter label=com.ridearrivo.parasyte.managed=true
```

Back up the managed workspace volumes according to company retention policy. Removing an engineer's container is recoverable because `/workspace` is a named volume; removing that volume deletes their persisted workspace and must be an explicitly approved operation.
