#!/bin/sh
# Cold-start entry: POSIX sh, OS installation of mise, no Node/Bun dependency.
set -eu
cd "$(dirname "$0")/.."
if ! command -v mise >/dev/null 2>&1; then
  cat >&2 <<'ACTION'
1. Install the declared checksum-verified mise bootstrap using the exact numbered
   commands in packages/password-manager/docs/bootstrap.md. They require only the
   declared OS HTTPS/core utilities, with no Node/Bun/Homebrew dependency.
2. Review this repository's mise.toml, then run: mise trust mise.toml
3. Continue: sh scripts/password-manager-setup.sh
These OS installer/trust actions cannot run through a missing tool manager.
ACTION
  exit 2
fi
mise install node@22.22.3 bun@1.3.11
mise exec -- bun install --frozen-lockfile
exec mise exec -- bun run password-manager setup "$@"
