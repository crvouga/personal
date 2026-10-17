#!/usr/bin/env bash
# Superset / super.engineering: one Turborepo TUI for every dev server.
set -euo pipefail
ws="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
cd "$ws"
echo $$ > .superset/.run-pid
exec bun run dev "$@"
