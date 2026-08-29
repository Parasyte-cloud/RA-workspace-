# RideArrivo Engineering Workspace - Critical Security Audit

Date: 2026-08-29

## Release objective

Keep engineering work inside the authenticated RideArrivo workspace: persistent browser VS Code, ParAsYtE terminal, local web-app preview, and a native GitHub engineering console. General-use brand/company images remain visible as safe internal previews while original downloads stay behind Admin approval.

## Green - implemented controls

- Engineer/Admin authorization is revalidated server-side through the existing Supabase authorization RPC before terminal, IDE, or GitHub gateway APIs are used.
- Every engineer keeps an isolated persistent `/workspace` Docker volume and separately labelled network.
- Long-running tooling runs as UID/GID 10001 with all Linux capabilities dropped, `no-new-privileges`, a read-only root filesystem, CPU/memory/PID/file limits, and loopback-only dynamic IDE port publishing.
- code-server is taken from the pinned official Coder image and runs with browser file downloads and uploads disabled.
- IDE access uses a random short-lived HttpOnly, Secure, SameSite=Strict host-only cookie after bearer-token authorization. The Docker-published IDE port is never public.
- Cross-origin API access is restricted to the configured RideArrivo workspace origin. IDE write requests and IDE WebSocket upgrades require the expected `https://linux.ridearrivo.com` origin.
- GitHub App credentials and installation tokens stay on the gateway. The browser receives only the fields required for repository, pull-request, and Actions views.
- The GitHub dashboard is read-only and validates repository names before building API paths.
- GitHub App identifiers, organization name, and RSA private key are validated at gateway startup.
- Existing image assets without preview derivatives can be backfilled by Admin. Employees receive only reduced, watermarked `workspace-previews` derivatives; the protected original still uses the download-approval flow.
- New image uploads create the preview derivative at upload time.
- Company-file metadata and preview visibility is now audience-aware: company-wide files are visible to all active employees; department files are limited to that department plus Legal/Manager/Admin custodians. Guessed file IDs cannot be used to request or retrieve another department's file.

## Yellow - deployment/operational controls required

1. **The screenshot is a deployment-state warning, not a terminal rendering defect.** VS Code and the terminal cannot become live until the dedicated Linux gateway is deployed at `linux.ridearrivo.com`, rootless Docker is running for `parasyte-gateway`, Nginx/TLS is configured, and the frontend points to the gateway.
2. Install the GitHub App only on repositories that every authorized RideArrivo Engineer/Admin user is allowed to see. An installation access token is governed by the App installation permissions, not by each engineer's personal GitHub permissions.
3. Keep the GitHub dashboard read-only. Push/merge/write operations must use each engineer's own GitHub identity in VS Code/terminal. Never inject a shared organization write token into the IDE.
4. Restrict outbound container networking at the VPS/firewall layer as appropriate. Engineers need internet egress for package registries and source control, but egress also creates an intentional higher-trust engineering boundary.
5. Back up the labelled engineer workspace volumes. Replacing a container preserves the volume; deleting the volume destroys persisted engineering work.
6. Monitor the gateway user service and rootless Docker service, and alert on repeated authorization failures, abnormal container creation, or resource exhaustion.

## Important data-loss/exfiltration limitation

`--disable-file-downloads` and the RideArrivo download approval system prevent normal browser download of protected assets, but they cannot make a privileged engineering environment non-exfiltratable. An engineer who can read source code in an editor/terminal and has outbound network access can copy text, take screenshots, or transmit data through permitted developer tooling. Treat Engineer/Admin as privileged roles, use least privilege, selected GitHub repositories, audit logs, contractual controls, and host/network monitoring.

## GitHub permission baseline

For the native in-workspace dashboard, use the minimum GitHub App repository permissions required by the current implementation:

- Metadata: read
- Pull requests: read
- Actions: read

Do not grant Contents write, Administration, Secrets, or organization-wide write permissions merely for this dashboard.

## Production acceptance tests

- Engineer can start VS Code from Engineering -> Workspace and reconnect to the same persistent `/workspace`.
- Another engineer receives a different volume and cannot access the first engineer's files.
- Employee/manager/non-engineer roles are rejected by the gateway even if they manually call the API.
- VS Code's browser Download and Upload commands are disabled.
- A local project served on a selected port opens in Engineering -> App Preview through `/ide/proxy/<port>/`.
- GitHub repository/PR/Actions data appears only for repositories selected in the GitHub App installation.
- No GitHub private key or installation token appears in browser DevTools, Vite output, container environment, or `/workspace`.
- Existing Brand Library and Company Files image cards show the watermarked internal preview after Admin opens the library/backfill runs.
- An ordinary employee can see the safe preview but cannot retrieve the original until Admin approves the download request.
