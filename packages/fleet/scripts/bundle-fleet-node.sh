#!/usr/bin/env bash
# Rebuild scripts/fleet-node.sh so the downloaded file contains decide.py.
set -euo pipefail
cd "$(dirname "$0")/.."
out=scripts/fleet-node.sh
tmp=$(mktemp)
{
  cat <<'WRAPPER'
#!/usr/bin/env bash
# Download this one file and run it. No Nix, no git checkout, no just.
# The Python program is embedded below so the file runs by itself.
set -euo pipefail

py=$(command -v python3 || command -v python || true)
if [ -z "$py" ]; then
  echo 'Next: Python 3 is not installed, so nothing was written. Install Python 3 and run this program again.' >&2
  exit 1
fi

payload=$(mktemp)
cleanup() { rm -f "$payload"; }
trap cleanup EXIT

here=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
if [ -f "$here/decide.py" ]; then
  cp "$here/decide.py" "$payload"
else
  sed -n '/^# __DECIDE_PY__$/,/^# __DECIDE_END__$/p' "$0" | sed '1d;$d;s/^# //' > "$payload"
fi

exec "$py" "$payload" "$@"
WRAPPER
  printf '%s\n' '# __DECIDE_PY__'
  sed 's/^/# /' scripts/decide.py
  printf '%s\n' '# __DECIDE_END__'
} > "$tmp"
mv "$tmp" "$out"
chmod +x "$out"
