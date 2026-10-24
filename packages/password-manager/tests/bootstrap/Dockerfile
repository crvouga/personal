# Test-only clean supported OS. Docker engine is repository/CI supplied; image
# contents are pinned, apt security package versions remain release-managed.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
ARG TARGETARCH
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl xz-utils unzip tar
RUN case "$TARGETARCH" in \
    arm64) mise_arch=arm64; mise_sha=3abbaac305a465ef038eb4ea07b961c037a8b639108005e43f8e2c00a8f67c11 ;; \
    amd64) mise_arch=x64; mise_sha=e3b186d4c70627f27037be615becaf4acfb30e41fb6a1819486717dc94e4e2a9 ;; \
    *) exit 1 ;; \
    esac && \
    curl --fail --location "https://github.com/jdx/mise/releases/download/v2026.10.15/mise-v2026.10.15-linux-${mise_arch}" -o /usr/local/bin/mise && \
    printf '%s  /usr/local/bin/mise\n' "$mise_sha" | sha256sum -c - && chmod 755 /usr/local/bin/mise
WORKDIR /workspace
COPY . .
RUN ! command -v node && ! command -v bun && mise trust mise.toml
RUN setup_code=0; sh scripts/password-manager-setup.sh --state-dir /private/password-manager --non-interactive --system-deps || setup_code=$?; test "$setup_code" -eq 2
RUN mise exec -- node packages/password-manager/tests/bootstrap/verify.mjs
