#!/usr/bin/env bash
# Upstream OpenBao is managed by the same locked mise toolchain as all other tools.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.."
exec bash scripts/dev/bootstrap.sh --tools-only "$@"
