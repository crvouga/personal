#!/usr/bin/env bash
# secret-store-vault-wrapper
set -euo pipefail

WRAPPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET_STORE_CLI_ROOT="$(cd "${WRAPPER_DIR}/.." && pwd)"
if [ ! -f "${SECRET_STORE_CLI_ROOT}/lib/vault-auth.sh" ]; then
  echo "ERROR: personal infra-vault requires its source checkout and shared toolchain." >&2
  exit 1
fi

# shellcheck source=../lib/vault-auth.sh
source "${SECRET_STORE_CLI_ROOT}/lib/vault-auth.sh"
# shellcheck source=../lib/config.sh
source "${SECRET_STORE_CLI_ROOT}/lib/config.sh"
# shellcheck source=../lib/run.sh
source "${SECRET_STORE_CLI_ROOT}/lib/run.sh"

subcommand="${1:-}"

case "$subcommand" in
  run)
    shift
    vault_run "$@" || exit $?
    ;;
  setup)
    shift
    vault_setup "$@" || exit $?
    ;;
  "")
    if ! resolve_vault_bin; then
      echo "ERROR: Vault CLI binary not found." >&2
      echo "       Install Vault or OpenBao CLI: https://openbao.org/docs/install/" >&2
      echo "       Or run: ./scripts/install-cli.sh" >&2
      exit 1
    fi
    exec "$VAULT_REAL_BIN"
    ;;
  -h|--help|help)
    cat <<EOF
personal infra-vault — secret injection for self-hosted OpenBao.

Usage:
  personal infra-vault run [OPTIONS] -- <command> [args...]   Run command with secrets injected
  personal infra-vault setup [OPTIONS]                        Write .vault.yaml in current directory
  personal infra-vault <command> ...                          Pass through to Vault CLI

Run 'personal infra-vault run --help' or 'personal infra-vault setup --help' for details.
EOF
    ;;
  *)
    if ! resolve_vault_bin; then
      echo "ERROR: Vault CLI binary not found." >&2
      echo "       Install Vault or OpenBao CLI: https://openbao.org/docs/install/" >&2
      echo "       Or run: ./scripts/install-cli.sh" >&2
      exit 1
    fi
    exec "$VAULT_REAL_BIN" "$@"
    ;;
esac
