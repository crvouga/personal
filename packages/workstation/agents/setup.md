# Developer fleet configuration setup

Read root AGENTS.md, the [bootstrap runbook](../../../scripts/dev/README.md),
[workstation guide](../README.md), [fleet guide](../../fleet/README.md), and
[configuration audit](audit.md). Git owns portable definitions; ws renders and
converges; fleet coordinates explicit deployments; mise owns tool versions;
Vault/OpenBao owns secrets; OpenTofu alone owns cloud infrastructure.

## Bootstrap and register a node

Use the OS-specific bootstrap commands in the machine setup section of this
published guide. From the resulting personal checkout:

```sh
bun install --frozen-lockfile
bun run ws:install
bun run fleet init
bun run fleet init --apply --yes
bun run fleet validate --json
bun run fleet onboard --node YOUR_NODE --json
```

Edit the new gitignored roster once with the real SSH alias and absolute checkout
path. Verify SSH host keys independently. Native Windows supports local operations;
remote fleet execution requires a POSIX SSH shell (macOS/Linux/WSL). Each machine
gets its own SSH key, GitHub/Vault login, coding-tool OAuth and T3 pairing. Never
copy another node's credential directories. Fleet onboarding does not provision
accounts, authorize SSH keys or authenticate tools.

## Authenticate and choose profiles

```sh
gh auth login
gh auth setup-git
vault login --method=userpass username=crvouga
bun packages/workstation/cli/index.ts --json agents inventory
bun packages/workstation/cli/index.ts --json agents audit
```

These login commands require operator interaction. The existing approved Vault
identity must be able to read the declared key; missing permission is a setup
failure, never permission to seed or change Vault outside OpenTofu.

Use the installed `ws` or `bun packages/workstation/cli/index.ts` interchangeably.
Every profile operation requires an explicit node ID; no hostname guessing:

```sh
ws agents preview --node YOUR_NODE --tool codex --profile direct --json
ws --yes agents apply --node YOUR_NODE --tool codex --profile direct --json
ws agents run --node YOUR_NODE --tool codex --profile direct -- login
ws agents status --node YOUR_NODE --tool codex --profile direct --json
ws agents preview --node YOUR_NODE --tool codex --profile proxy --json
ws --yes agents apply --node YOUR_NODE --tool codex --profile proxy --json
ws agents verify --node YOUR_NODE --tool codex --profile proxy --json
ws agents run --node YOUR_NODE --tool codex --profile proxy
```

Direct Codex login is interactive in its dedicated CODEX_HOME. Existing plain
`codex` sessions retain their original home. Profile filenames, destinations and
precedence are listed in the audit. Checked-in shared defaults apply first, then
`nodes[ID][TOOL].direct` or `.proxy` model overrides in `agents/registry.json`.
Review overrides through Git; do not edit generated profile files. Preview/status
never read required secrets or call inference. Apply writes nonsecret configuration
only; runtime launch and authenticated verification require Vault.

Claude and OpenCode use the same commands with `--tool claude` or `--tool opencode`.
Direct Claude uses native independent authentication (`claude auth login`);
OpenCode direct retains the existing `ws opencode sync` provider owner and native
`opencode auth login` where needed. The Claude proxy model is deliberately unset:
list authorized models using the existing `bun run cliproxy models`, then review
an exact model ID in the registry before applying. Do not reuse a Codex model for
Anthropic Messages. Gemini supports `--tool gemini --profile direct`; start it
through `ws agents run` and finish its own Google sign-in. Gemini proxy routing,
Cursor/Antigravity unattended inference setup and Copilot proxy routing are
unsupported by these adapters; see the audit for supported native setup sources.
No adapter is proof of authentication or protocol compatibility on every version.

## T3 connection and inference routing

```sh
t3 up --connect
t3 status --json
t3 environment list --json
ws agents t3-plan --node YOUR_NODE --json
```

Operator interaction is required for T3 Connect login and peer pairing. Use T3's
Connections screen or `t3 pair` locally; never retain pairing tokens in a receipt,
Git, shared report or another node's settings. Do not copy ~/.t3.

The emitted t3-plan is a field-level setup recipe for a **new Codex provider
instance** in T3 Settings. Set its binary path, CODEX_HOME and WS_AGENT_NODE
environment field exactly as emitted. These values are machine-derived from the
reviewed checkout and chosen node. The binary points to the Git-tracked adapter,
which obtains the proxy key from this node's Vault session at every launch. Leave
the ordinary Codex provider instance available for direct sessions. Existing T3
secret references, other instances, pairing and runtime state stay app-owned.
The adapter does not rewrite a running application's settings file; the supported
T3 UI performs the merge. Unattended T3 settings convergence and native Windows
adapter execution are not implemented or verified. Repoint binaryPath when its
reviewed checkout moves. CLI usage tracking settings do not change inference routing.

Create a T3 thread using the new instance, submit a bounded request, and confirm
the chosen model and a real tool invocation. Test from a paired peer too. A local
API response, valid settings or a proxy HTTP 200 does not pass this end-to-end gate.

## Verification, migration and drift

```sh
ws doctor --json
ws agents status --node YOUR_NODE --tool codex --profile proxy --json
ws agents verify --node YOUR_NODE --tool codex --profile proxy --json
# Explicit opt-in: one inference request, at most 16 requested output tokens,
# 15s model-list deadline and 30s inference deadline; provider billing still applies.
ws agents verify --node YOUR_NODE --tool codex --profile proxy --smoke --json
```

Verify reports static, endpoint, authenticated model-list, inference, streaming,
tool-call and T3 evidence separately. Streaming/tool calls/T3 remain unverified by
the simple smoke request. Direct-provider verification is static only. Full provider
protocol exercises remain available in the existing CLI Proxy tests/runbook.

Preview never prints file contents. Apply refuses changed/unmanaged dedicated
profile files and symlinks. Inspect conflicts locally, reconcile intentional
settings into Git, then deliberately adopt with
`ws --yes agents apply --node YOUR_NODE --tool codex --profile proxy --adopt`.
Adoption backs up only replaced profile files under the private ROOT/backups;
it does not import home-directory settings. Reapplying unchanged inputs leaves
configuration and receipt unchanged. If a process died with `.apply-lock` present,
confirm no apply is running before removing that lock. There is no daemon or schedule.

Legacy `codex-fleet`/`claude-fleet`/`opencode-fleet` launchers remain available during
migration. Test the new profiles before changing T3; stop using old launchers only
after acceptance. Their cached credentials remain local until explicitly retired;
new ws profiles never copy them. Native sessions and application databases are
outside this convergence contract.

## Reviewed rollout and rollback

Commit/review changes and pass CI before rollout. Fetch the reviewed commit into
each node's existing checkout using normal authenticated Git. Fleet never fetches
an unreviewed moving branch implicitly. Substitute a full 40-character commit SHA:

```sh
bun run fleet configure --node CANARY --revision FULL_SHA --tool codex --profile proxy --json
bun run fleet configure --node CANARY --revision FULL_SHA --tool codex --profile proxy --apply --yes --json
bun run fleet doctor --node CANARY --json
# After the canary's authenticated and T3 acceptance gates:
bun run fleet configure --node NODE_A --node NODE_B --revision FULL_SHA --tool codex --profile proxy --apply --yes --json
```

The command creates/reuses a clean pinned deployment Git worktree, delegates to
existing mise/bootstrap and ws, then records revision and configuration fingerprint
only after success. It preserves the developer branch and dirty working files.
Nodes run serially and failures remain per-node; offline nodes receive no success
receipt. Re-run failed nodes explicitly. Node setup can partially install tools
before failing; no tool-install rollback is claimed. No recurring rollout is created.
Receipts are historical evidence; `ws agents status` checks current file contents.

Rollback uses the same preview/apply commands with a previous reviewed full SHA.
Only revisions containing the configure/profile implementation support this path.
Keep old deployment worktrees and receipts until rollback is no longer needed.
A configuration rollback does not restore OAuth sessions, databases, or provider
state. Complete native logins again where needed; never restore another node's identity.

## Publish the setup guide

Edit this runbook and canonical sources, then run `bun run llms:sync` and
`bun run check:llms`. Root llms.txt and portfolio public/llms-infra.txt are generated.
The portfolio's recruiter-facing llms.txt links prominently to this setup section.
Use the repository PR/Check/main deployment workflow; after deployment fetch both
live URLs and confirm this runbook is present. A generated local guide does not
prove publication or live fleet convergence.
