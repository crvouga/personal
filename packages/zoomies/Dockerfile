# Official Zoomies controller, pinned by release and digest. The wrapper adds
# only a static shell so the entrypoint can turn Vault-injected environment
# variables into the 0400 credential file Zoomies requires.
FROM busybox:1.37.0-musl@sha256:6162febc22b2dc1466ba2a46381c68cfe662f0e41ddc2a54e1b224d76422cc25 AS busybox

FROM ghcr.io/eyupio/zoomies:v1.3.8@sha256:8d34af4a4f87d4811ddb8b429304fbc7d47352dafe12f5af58553e7de3449784
LABEL org.opencontainers.image.source=https://github.com/crvouga/personal
LABEL org.opencontainers.image.description="Zoomies GitHub Actions runner controller for chrisvouga.dev"
COPY --from=busybox /bin/busybox /busybox/busybox
COPY --chmod=0555 entrypoint.sh /usr/local/bin/zoomies-entrypoint
# Railway mounts the volume at /data and starts the container as root (see the
# service's RAILWAY_RUN_UID) so SQLite can write to the root-owned mount.
ENV ZOOMIES_STATE_DIR=/data \
    ZOOMIES_CONFIG_DIR=/data \
    ZOOMIES_DB_PATH=/data/zoomies.db
ENTRYPOINT ["/busybox/busybox", "sh", "/usr/local/bin/zoomies-entrypoint"]
CMD ["controller"]
