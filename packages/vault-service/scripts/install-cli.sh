#!/usr/bin/env bash
# Compatibility bootstrap task; never install a second repository-owned executable.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.."
bash scripts/dev/bootstrap.sh
exec mise exec -- bun run personal:install "$@"
