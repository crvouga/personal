export const HELP = `
fleet configure --node ID --revision FULL_SHA [--tool codex|claude|opencode|gemini] [--profile direct|proxy] [--apply --yes]
Preview or deploy a reviewed configuration revision through ws. Use one canary first.
Rollback: repeat configure with a previous reviewed full SHA.
Developer fleet tooling — read-only diagnostics by default

Usage: bun run fleet COMMAND [options]

Commands:
  help          Show this help without config, credentials or network
  schema        Print the JSON Schema for the local roster
  init          Preview a starter roster; --apply --yes writes it exclusively
  validate      Validate the roster without contacting nodes
  nodes         List configured developer SSH aliases and checkout paths
  onboard       Produce per-node SSH/VS Code/auth/bootstrap instructions
  doctor        Check controller and selected nodes; compare checkout/lock hashes
  sync          Preview toolchain/dependency sync; --apply --yes authorizes it

Options:
  --config PATH     Local roster (default .fleet.local.json in current directory)
  --node ID         Select a node; repeatable. Omit to select the whole roster
  --local           doctor/sync only: this checkout, without SSH or a roster
  --workspace PATH  Controller/local reference checkout (default this repository)
  --json            One versioned JSON document on stdout, no progress/log output
  --strict          doctor: fail on warnings/skips as well as failures
  --require LIST    Controller checks: github,vault,t3,vscode,toolchain (or none)
  --timeout MS      Per-node SSH deadline (default 120000; 1000–1800000)
  --pull            sync only: clean-tree guarded git pull --ff-only first
  --apply --yes     Explicit noninteractive authorization for init/sync mutation
  --non-interactive Accepted; fleet never prompts or opens login flows

Exit codes: 0 no failures (warnings/skips remain visible), 1 health/operation
failure, 2 usage/config error. --strict also treats warnings/skips as failure.
Sync defaults to a PLAN; a plan is not evidence of health or completed work.
No credential copying, host-key bypasses, forced Git updates or provisioning.
Remote nodes require macOS/Linux/WSL with a POSIX SSH shell and Node or Bun. Native
Windows supports local commands. Read packages/fleet/README.md for limitations.
`;

// Configuration deployment is explicit and uses the workstation owner.
