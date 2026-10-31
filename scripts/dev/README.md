## Machine setup: macOS, Windows and Linux

This is the shared development setup for **crvouga/personal**. One versioned
manifest, `mise.toml`, owns the developer tools; `mise.lock` and `.mise/locks/`
own resolved artifacts and dependency graphs. Both bootstraps apply that same
manifest to the current user globally. Other projects can override versions with
their own mise configuration. No paid account or cloud secrets are needed to
install the toolchain.

### New machine

macOS / Linux, in Bash (download first so the script is reviewable):

```sh
curl -fsSL https://raw.githubusercontent.com/crvouga/personal/main/scripts/dev/bootstrap.sh -o /tmp/workspace-bootstrap.sh
bash /tmp/workspace-bootstrap.sh
```

Native Windows, in x64 PowerShell (5.1 or newer):

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/crvouga/personal/main/scripts/dev/bootstrap.ps1 -OutFile "$env:TEMP\workspace-bootstrap.ps1"
& "$env:TEMP\workspace-bootstrap.ps1"
```

If script execution is blocked, use a process-scoped policy for this reviewed
script: `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\workspace-bootstrap.ps1"`.
Do not change the machine-wide execution policy. WSL is optional: run the Linux
bootstrap **inside WSL** to install Linux tools there; the native Windows and WSL
tool installations, Docker connections and credentials are separate.

Default checkout: `~/workspace`. Override with `WORKSPACE_DIR=/path/to/workspace`
on Unix or `-WorkspaceDir C:\path\workspace` on Windows. An existing checkout is
reused, never reset or implicitly pulled. From a checkout, run
`bash scripts/dev/bootstrap.sh` or `& ./scripts/dev/bootstrap.ps1`.

The scripts install checksum-verified mise **2026.10.24**, trust this repository's
configuration, install pinned Bun, install the shared tools with `--locked`, copy
the managed global config/lock/sidecars, set up persistent shims on PATH, and run
`bun install --frozen-lockfile`. Reopen your terminal/editor afterward. Unix PATH
blocks are appended once to `.profile`, `.bashrc`, `.zshrc` and fish's config;
Windows updates only the user's PATH. Existing unrelated mise config/lockfiles
are refused: back them up and move them first, then merge intentional overrides
using project configs. `MISE_CONFIG_DIR` and `XDG_CONFIG_HOME` are respected for
configuration; the PATH step also respects `MISE_DATA_DIR`, `XDG_DATA_HOME` and
`MISE_SHIMS_DIR`, including Windows' `%LOCALAPPDATA%` default.

### OS prerequisites and supported platforms

- **macOS x64 / Apple Silicon:** install Apple's Command Line Tools. If Git is
  absent, bootstrap launches `xcode-select --install`, stops, and asks you to rerun
  after installation. These tools provide Git and native compilers. `curl`, `tar`
  and `unzip` must be available.
- **Linux x64 / arm64, glibc:** Git, curl, trusted CA certificates, tar, unzip, xz
  and a C/C++ compiler/make. If Git is absent, bootstrap installs prerequisites
  with `sudo apt-get` or `sudo dnf`; other distributions receive an actionable
  error. On Debian/Ubuntu with Git already installed, use
  `sudo apt-get install git curl ca-certificates tar unzip xz-utils build-essential`.
  Alpine/musl is not in this baseline.
- **Native Windows x64:** Git for Windows (includes OpenSSH and Git Bash).
  Bootstrap installs it through WinGet if missing; without WinGet, install Git
  from https://git-scm.com/download/win. Windows ARM64 is not yet validated.
  For packages with native C/C++ addons, install Visual Studio Build Tools with
  the Desktop development with C++ workload and Windows SDK. Enable Developer
  Mode if using workstation symlink features; core toolchain setup uses copies
  and does not require symlinks or an administrator shell.

Git, OS compilers/SDKs, Docker Engine/Desktop, desktop apps, and kernel versions
are **OS prerequisites**, not covered by the mise lock. The same tool versions
are selected across OSes, using different platform binaries; this does not make
all OS behavior or every project command identical. Existing infrastructure
scripts may require Bash/Unix tooling; use Git Bash where supported or WSL for
Linux-specific workflows. Exact container builds should pin base image digests.

### Included toolchain

The generated guide includes the exact tool table from `mise.toml` below. Scope:

- **Source control:** OS Git/OpenSSH, pinned GitHub CLI and Git LFS.
- **JavaScript/TypeScript:** Node **with npm**, Bun, pnpm, Yarn and Deno.
  TypeScript, ESLint, Prettier, Turbo and test frameworks remain project
  dependencies installed from `bun.lock`; do not install duplicate global copies.
- **Languages:** Python (precompiled), uv and Go. `uv tool`/project environments
  isolate Python dependencies. Java, Rust, .NET, mobile SDKs and databases belong
  in the projects that need them rather than the default machine setup.
- **CLI utilities:** ripgrep (`rg`), fd, fzf, bat, delta, jq and Mike Farah yq.
- **Delivery/infra:** Vercel, Wrangler, Railway, OpenTofu, Vault CLI (for the OpenBao-compatible secret service), Docker CLI,
  ShellCheck and actionlint. Installing provider CLIs does not authorize agents
  to provision resources; shared infrastructure is still OpenTofu-owned.
- **Agent harnesses:** Claude Code (`claude`), Codex (`codex`), Gemini CLI
  (`gemini`), GitHub Copilot CLI (`copilot`) and OpenCode (`opencode`).
  Installed versions are checked by doctor on all three OSes. Start the CLI you
  want to use and complete its interactive sign-in; installation does not copy
  tokens, choose paid plans or grant agent permissions. OpenCode's optional
  settings remain managed by `ws` and Vault. Codex sign-in follows the
  [official CLI guide](https://learn.chatgpt.com/docs/codex/cli).
  Claude/Copilot background self-updaters are disabled through mise environment
  settings so they cannot silently replace locked versions; update through this
  repository instead.
- **On demand:** Atlas (macOS/Linux) and Azure CLI are retained as lazy tools;
  install with `mise install --locked atlas` / `mise install --locked azure-cli`.
  Lazy tools are not part of the base doctor's required checks.

**nvm is intentionally replaced by mise's Node version management.** Unix nvm
and nvm-windows are different implementations. Use `mise use node@<version>` in
a project instead of `nvm install/use`; root `.nvmrc` remains a compatibility pin
for existing CI. Remove/disable old nvm, fnm, asdf or Volta shell initialization
if it shadows managed tools. Never silently delete another manager's files.
Do not independently upgrade npm, Corepack shims, or globally npm-install tools
already owned by mise. The npm version comes from the pinned Node release.

### Verify, authenticate and configure

After reopening the shell:

```sh
cd ~/workspace
mise exec -- bun scripts/dev/doctor.ts
mise exec -- bun scripts/dev/doctor.ts --json
# Require a working container runtime and both plugins:
mise exec -- bun scripts/dev/doctor.ts --docker
```

Doctor fails missing/wrong required tool versions and missing Git/npm. Missing
GitHub authentication and Docker runtime/plugins are warnings unless Docker is
explicitly required. `--json` emits structured checks without credential values.
`mise doctor` diagnoses mise itself. Use `where.exe node` / `Get-Command node -All`
on Windows, or `type -a node` on Unix, to find conflicting installations.

Authentication remains per-machine and interactive; never copy tokens into Git:

```sh
gh auth login
gh auth setup-git
gh auth status
vercel login
wrangler login
railway login
```

Only sign into providers the task actually needs. Git identity is personal:
set `git config --global user.name` and `git config --global user.email` after
confirming the desired name/email. Do not guess an email or overwrite an existing
identity. Enable Git LFS hooks when needed with `git lfs install`.

Optional existing workstation/agent settings:

```sh
bun run ws:install
ws doctor
# Only for tasks needing the workspace's managed secrets:
vault login --method=userpass username=crvouga
ws sync
```

The machine bootstrap installs tools/dependencies only. `ws:install` additionally
installs the existing workstation launcher and converges OpenCode configuration;
it may need platform permissions and a Vault login for credential-backed
features. `bun run setup` remains dependency installation only.

### Containers: CLI versus engine

The manifest installs the **Docker client**. Containers also require a local or
remote Docker engine, Compose v2 and Buildx plugins. These cannot be installed as
one identical unprivileged binary on all OSes.

- **macOS:** install/start Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/.
- **Windows:** install/start Docker Desktop from https://docs.docker.com/desktop/setup/install/windows-install/.
  `winget install --exact --id Docker.DockerDesktop` is the package-manager route.
  Enable its WSL2 backend/virtualization prerequisites and finish any reboot.
- **Linux:** follow https://docs.docker.com/engine/install/ for the distribution.
  Install Engine plus `docker-buildx-plugin` and `docker-compose-plugin`, then
  start the daemon (usually `sudo systemctl enable --now docker`). Use Docker's
  documented rootless mode when appropriate. Adding a user to the `docker` group
  grants root-equivalent access; do not do so silently in bootstrap.
- **Remote/headless:** select a preconfigured Docker context instead. Do not
  overwrite an existing context or expose an unauthenticated TCP daemon.

Docker Desktop supplies Compose/Buildx. On Linux they must be installed as CLI
plugins. The pinned mise client should discover plugins in standard Docker
locations; if not, check `docker info` and configure Docker's `cliPluginsExtraDirs`
for that installation. Verify with `docker version`, `docker compose version`,
`docker buildx version`, and optionally `docker run --rm hello-world` (downloads
an image). CLI pinning does not pin or upgrade your engine/plugins.

### Keep machines synchronized

From the checkout, on any platform:

```sh
git pull --ff-only
mise install --locked bun
mise exec --locked bun -- bun scripts/dev/setup.ts
```

For an installed workstation CLI, `ws update` pulls with a clean-tree/fast-forward
guard, refreshes the toolchain/global config and frozen dependencies, and runs the
existing workstation convergence. `ws tools sync` reapplies tool pins/global config
without pulling or touching project dependencies; `ws tools check --json` verifies
them. Sync is explicit; Git commits do not silently update other machines.

To change versions: edit pins with `mise use --pin <tool>@<version>` (or edit
`mise.toml`), run `mise lock`, review `mise.toml`, `mise.lock` and any `.mise/locks/`
changes, and test. Keep Bun's pin in `package.json` and the setup action aligned;
keep Node's `.nvmrc` aligned. Run `bun run llms:sync` to regenerate the served
agent guide, then commit. Do not use `mise upgrade` independently on each machine.
Version policy: use the newest stable compatible releases, with the newest Node
LTS rather than an untested Current release. The current compatibility exceptions
are delta 0.18.2 (newer releases omit Intel macOS), OpenTofu 1.13.0 (all infrastructure
roots and deployment gates require that exact version), and OpenCode 1.19.5
(the workspace's notification/provider plugins still target the 1.x API). Their
major/platform migrations must be validated before moving those pins. Python
and other standalone tools use their latest stable releases at the last update.

Locked downloads still need network access; GitHub limits may require an
authenticated `gh` session. Never disable verification to bypass a failing lock.

### Agent entry point and ownership

Start at https://www.chrisvouga.dev/llms.txt, which links to the complete guide at
https://www.chrisvouga.dev/llms-infra.txt#machine-setup-macos-windows-and-linux.
The root `llms.txt` and served `/llms-infra.txt` are generated by
`bun run llms:sync` from `scripts/llms-txt.template.md`, this file, `mise.toml` and
infrastructure sources. Never edit generated copies. Read root `AGENTS.md` before
working in the repo. Bootstrap is authorized only when the user requests machine
setup; fetching a public guide alone does not authorize installs or logins.
