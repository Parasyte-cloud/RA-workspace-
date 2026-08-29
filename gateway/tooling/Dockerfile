# Pin code-server to the current audited multi-architecture release manifest.
FROM ghcr.io/coder/code-server:4.133.0-trixie@sha256:e073a441c61c85821a7f16b64cf93b4e77b4092899bb1f3bed906fbd558afd62 AS code_server

FROM node:22.23.2-bookworm-slim

ARG SUPABASE_CLI_VERSION=2.116.0
ARG TARGETARCH
ARG SUPABASE_AMD64_SHA256=82cb424bc13cd029a66cb43bc537315cee9068cc6237b7d4b7f8f8949800d251
ARG SUPABASE_ARM64_SHA256=fcae51275698a749d3636106c8d3bf7d27bfd9c8629cccc96d4fb149fc9a20b2

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    git-lfs \
    jq \
    less \
    openssh-client \
    python3 \
    python3-pip \
    python3-venv \
  && git lfs install --system \
  && rm -rf /var/lib/apt/lists/*

# Copy the signed/published code-server package from the pinned official image.
COPY --from=code_server /usr/bin/code-server /usr/bin/code-server
COPY --from=code_server /usr/lib/code-server /usr/lib/code-server

RUN code-server --version

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) expected="${SUPABASE_AMD64_SHA256}" ;; \
    arm64) expected="${SUPABASE_ARM64_SHA256}" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl --fail --location --show-error \
    --output /tmp/supabase.deb \
    "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_${SUPABASE_CLI_VERSION}_linux_${TARGETARCH}.deb"; \
  echo "${expected}  /tmp/supabase.deb" | sha256sum --check -; \
  apt-get update; \
  apt-get install -y --no-install-recommends /tmp/supabase.deb; \
  rm -f /tmp/supabase.deb; \
  rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 engineer \
  && useradd \
    --uid 10001 \
    --gid 10001 \
    --home-dir /workspace/.home \
    --shell /bin/bash \
    engineer \
  && git config --system init.defaultBranch main \
  && git config --system safe.directory '*'

COPY parasyte-profile.sh /etc/profile.d/parasyte.sh

ENV HOME=/workspace/.home \
  LANG=C.UTF-8 \
  LC_ALL=C.UTF-8 \
  NODE_ENV=development \
  NPM_CONFIG_CACHE=/workspace/.home/.npm-cache \
  PIP_CACHE_DIR=/workspace/.home/.cache/pip \
  CS_DISABLE_GETTING_STARTED_OVERRIDE=1

WORKDIR /workspace
USER 10001:10001

CMD ["code-server","--bind-addr","0.0.0.0:3000","--auth","none","--disable-file-downloads","--disable-file-uploads","--disable-telemetry","--disable-update-check","--disable-getting-started-override","--app-name","RideArrivo Engineering IDE","/workspace"]
