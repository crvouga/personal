#!/busybox/busybox sh
# Zoomies reads its first-account credential only from a file, and refuses one
# that group or other can read. Railway delivers secrets as variables, so write
# the variable to a private file, drop it from the environment, then hand over.
set -eu
umask 077

secrets=/tmp/zoomies-secrets
/busybox/busybox mkdir -p "$secrets"

if [ -n "${ZOOMIES_BOOTSTRAP_TOKEN:-}" ]; then
  printf '%s' "$ZOOMIES_BOOTSTRAP_TOKEN" >"$secrets/bootstrap-token"
  /busybox/busybox chmod 0400 "$secrets/bootstrap-token"
  export ZOOMIES_BOOTSTRAP_TOKEN_FILE="$secrets/bootstrap-token"
  export ZOOMIES_BOOTSTRAP_ADMIN="${ZOOMIES_BOOTSTRAP_ADMIN:-platform}"
fi
unset ZOOMIES_BOOTSTRAP_TOKEN

exec /usr/local/bin/zoomies "$@"
