#!/bin/sh
# Executed over strict SSH from the selected verified Git revision. stdin is a
# base64 Git bundle. All executable content remains in this tracked source.
set -eu
umask 077
revision=$1
bundle_sha=$2
node=$3
source_mode=${4:-transfer}
case "$source_mode" in cached|transfer) ;; *) exit 2;; esac
case "$revision" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#revision}" = 40 ] || exit 2
case "$bundle_sha" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#bundle_sha}" = 64 ] || exit 2
case "$node" in *[!a-z0-9-]*|'') exit 2;; esac
phase=bootstrap
bundle=''
failure_code=REMOTE_BOOTSTRAP_INCOMPLETE
die() { failure_code=$1; exit 1; }
fail() {
  printf '{"version":1,"checks":[{"id":"bootstrap:%s","status":"fail","summary":"%s","remedy":{"action":"Inspect prerequisites and the remote operation lock, then retry the approved revision. No success receipt advanced."}}]}\n' "$phase" "$failure_code"
}
trap 'code=$?; [ -z "$bundle" ] || rm -f -- "$bundle"; if [ "$code" != 0 ]; then fail; fi' EXIT
# Preserve the lock holder if its SSH channel disappears mid-install.
trap '' HUP
trap 'exit 1' INT TERM
# No shell startup assumptions, and no implicit root development user.
[ "$(id -u)" != 0 ] || die ROOT_DEVELOPMENT_USER_REJECTED
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 26.04 ] || die UBUNTU_BASELINE_MISMATCH
case "$(uname -m)" in x86_64|aarch64) ;; *) die UBUNTU_ARCHITECTURE_UNSUPPORTED;; esac
root="$HOME/.local/share/personal/fleet"
# Refuse symlinked state roots rather than allowing writes through them.
for path in "$HOME/.local" "$HOME/.local/share" "$HOME/.local/share/personal" "$root"; do
  [ ! -L "$path" ] || die FLEET_STATE_PATH_UNSAFE
done
mkdir -p "$root"
phase=lock
command -v flock >/dev/null 2>&1 || die BOOTSTRAP_FLOCK_REQUIRED
[ ! -L "$root/remote-operation.lock" ] || exit 1
exec 9>"$root/remote-operation.lock"
flock -n 9 || die FLEET_REMOTE_LOCKED
printf '{"version":1,"pid":%s,"revision":"%s","node":"%s"}\n' "$$" "$revision" "$node" >"$root/remote-operation.json"
phase=resources
# A bootstrap floor protects source transfer and minimal prerequisites. The
# Workstation baseline subsequently enforces its stricter declared capacity.
free_kib=$(df -Pk "$root" | awk 'END {print $4}')
free_inodes=$(df -Pi "$root" | awk 'END {print $4}')
case "$free_kib:$free_inodes" in *[!0-9:]*|:*|*:) die BOOTSTRAP_CAPACITY_UNVERIFIED;; esac
[ "$free_kib" -ge 2097152 ] && [ "$free_inodes" -ge 50000 ] || die BOOTSTRAP_DISK_CAPACITY_REQUIRED
phase=source-transfer
if [ "$source_mode" = transfer ]; then
bundle=$(mktemp "$root/source.XXXXXX")
# Leave no executable payload copies; this temporary file is only Git data.
base64 -d >"$bundle"
printf '%s  %s\n' "$bundle_sha" "$bundle" | sha256sum -c - >/dev/null 2>&1 || die SOURCE_DIGEST_MISMATCH
fi
phase=prerequisites
missing=''
for package in git curl ca-certificates unzip xz-utils build-essential python3 ansible-core; do
  dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null | grep -qx installed || missing="$missing $package"
done
if [ -n "$missing" ]; then
  sudo -n true >/dev/null 2>&1 || die SUDO_AUTHORIZATION_REQUIRED
  # Never remove APT locks or kill package processes. Timeout keeps genuine
  # transactions bounded; Ubuntu archive signatures/TLS remain enabled.
  sudo -n timeout 300 apt-get -o DPkg::Lock::Timeout=120 update >/dev/null 2>&1 || die APT_UPDATE_FAILED
  # shellcheck disable=SC2086
  sudo -n timeout 600 env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 --no-install-recommends install -y $missing >/dev/null 2>&1 || die APT_INSTALL_FAILED
fi
phase=source-verification
deployment="$root/revisions/$revision"
[ ! -L "$root/revisions" ] && [ ! -L "$deployment" ] || exit 1
mkdir -p "$deployment"
if [ ! -e "$deployment/.git" ]; then
  [ -z "$(ls -A "$deployment")" ] || exit 1
  git -C "$deployment" init -q >/dev/null 2>&1 || exit 1
fi
# An interrupted initial fetch/checkout can leave an empty initialized repository.
# Resume only that state; an existing commit or untracked work is never reset.
if ! git -C "$deployment" rev-parse --verify HEAD >/dev/null 2>&1; then
  [ "$source_mode" = transfer ] || die SOURCE_CACHE_CHANGED
  [ "$(git -C "$deployment" rev-parse --show-toplevel)" = "$deployment" ] || exit 1
  clean=$(git -C "$deployment" status --porcelain) || die SOURCE_STATUS_FAILED
  [ -z "$clean" ] || die SOURCE_CHECKOUT_CONFLICT
  git -C "$deployment" fetch --no-tags "$bundle" "$revision" >/dev/null 2>&1 || exit 1
  git -C "$deployment" checkout --detach "$revision" >/dev/null 2>&1 || exit 1
fi
[ -z "$bundle" ] || rm -f "$bundle"
bundle=''
[ "$(git -C "$deployment" rev-parse HEAD)" = "$revision" ] || exit 1
[ "$(git -C "$deployment" rev-parse --show-toplevel)" = "$deployment" ] || exit 1
clean=$(git -C "$deployment" status --porcelain) || die SOURCE_STATUS_FAILED
[ -z "$clean" ] || die SOURCE_CHECKOUT_CONFLICT
phase=toolchain
cd "$deployment"
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin"
status_file="$root/toolchain-status.json"
[ ! -L "$status_file" ] || die FLEET_STATE_PATH_UNSAFE
rm -f -- "$status_file"
if ! timeout 1800 bash scripts/dev/bootstrap.sh --non-interactive --status-file "$status_file" >/dev/null 2>&1; then
  tool_phase=$(sed -n 's/.*"phase":"\([a-z0-9-]*\)".*/\1/p' "$status_file" 2>/dev/null) || tool_phase=''
  case "$tool_phase" in
    managed-config) die TOOLCHAIN_CONFIG_CONFLICT;;
    mise) die TOOLCHAIN_MISE_FAILED;;
    aws) die TOOLCHAIN_AWS_FAILED;;
    t3) die TOOLCHAIN_T3_FAILED;;
    global-config|shell) die TOOLCHAIN_PATH_CONFIGURATION_FAILED;;
    dependencies) die TOOLCHAIN_FROZEN_DEPENDENCIES_FAILED;;
    *) die TOOLCHAIN_CONVERGENCE_FAILED;;
  esac
fi
phase=configuration
trap - EXIT INT TERM
exec mise exec --locked bun -- bun packages/fleet/src/node-converge.ts "$node" "$revision"
