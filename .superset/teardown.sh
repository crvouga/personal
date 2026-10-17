#!/usr/bin/env bash
# Stop only the recorded development task tree belonging to this workspace.
set -uo pipefail
ws="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
cd "$ws" || exit 0
ws="$(pwd -P)"
stop_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    stop_tree "$child"
  done
  kill -TERM "$1" 2>/dev/null || true
}
if [[ -f .superset/.run-pid ]]; then
  pid="$(cat .superset/.run-pid)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    process_command="$(ps -p "$pid" -o command=)"
    if [[ "$process_cwd" == "$ws" && "$process_command" == *"bun run dev"* ]]; then
      # One signal lets Turbo forward it and wait for task cleanup. Sending
      # signals to every descendant can look like a second Ctrl+C to Turbo.
      kill -TERM "$pid" 2>/dev/null || true
      for ((attempt = 0; attempt < 30; attempt++)); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        stop_tree "$pid"
      fi
    fi
  fi
fi
rm -f .superset/.run-pid .superset/.run-port
