#!/usr/bin/env bash
# Superset / super.engineering: one Turborepo TUI for every dev server.
set -euo pipefail
ws="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
cd "$ws"
echo $$ > .superset/.run-pid
# The managed auth relay is not deployed yet, so its dev server cannot start
# from Vault. Select the documented local fixtures explicitly (mock sign-in,
# not Google). Remove this once the relay passes `bun run health -- --only auth`.
export AUTH_DEV_MODE="${AUTH_DEV_MODE:-local}"
exec bun run dev "$@"
