# Fleet

`@pkgs/fleet` is the NixOS flake for the physical machines we own and run ourselves. Every machine has one **role**, and any machine can be replaced by any other of the same role. Cloud resources stay in `@pkgs/infra`.

| Role      | What the machine does                                                      |
| --------- | -------------------------------------------------------------------------- |
| `ci`      | GitHub Actions runners for trusted private repositories                    |
| `web`     | Caddy in front of one OCI image per app                                    |
| `cache`   | The attic binary cache every other node pulls from                         |
| `netboot` | Pixiecore; machines on the network boot from their own disk unless flagged |
| `devbox`  | SSH development machine (`dev` account, persistent `/nix/devbox`, no sudo) |

## Add a machine

You need the machine, its power and a network cable. Nothing else, and no second computer.

1. Open the [`fleet-installer` release](https://github.com/crvouga/workspace/releases/tag/fleet-installer) on the machine and download the file for its operating system:

   | The machine runs       | Download                                |
   | ---------------------- | --------------------------------------- |
   | Windows (Intel/AMD)    | `fleet-installer-windows-x64.exe`       |
   | Linux (Intel/AMD)      | `fleet-installer-linux-x64.tar.gz`      |
   | macOS                  | the wizard makes a USB stick instead    |
   | nothing (a blank disk) | see [a blank machine](#a-blank-machine) |

2. Open it and answer one question: **what kind of machine is this?** (`ci`, `web`, `cache`, `netboot`, `devbox`). The installer shows the exact disk it will erase and asks you to confirm.
3. A GitHub page opens. Press **Submit new issue**, signed in as the repository owner. That click approves this machine and is the only approval anywhere. (Over SSH or without a browser, the installer prints the same link.)
4. Accept the operating system's permission prompt (Windows UAC).

That is all. The installer does the rest, unattended:

```text
download the installer image, check its sha256
ask the owner to approve (the GitHub issue)            nothing erased yet
Windows: shrink C:, write the image into the new       Windows still boots until the restart
         partition, read it back, add a one-time boot entry
restart into the installer
erase the disk, partition it, install NixOS            Windows is gone here
generate the SSH host key, install the role's age key
boot into the role; the hostname is  <role>-<4 hex>
CI: register GitHub runners with the GitHub App; every role: poll main
```

On a `ci` machine the runners appear in GitHub on their own. On every machine `fleet-node status` answers whether it came up. Nothing was typed into the machine except the role.

Windows needs two things the installer cannot change from inside Windows: **Secure Boot off** (the installer is not signed; `doctor` says so and gives the one command that opens the firmware screen) and a UEFI/GPT disk. Both are checked first, before anything is changed.

### Other ways to start the same install

| Situation                | Do this                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux or macOS, no GUI   | `curl -fsSL -o fleet-node.sh https://github.com/crvouga/workspace/releases/download/fleet-installer/fleet-node.sh && sudo bash fleet-node.sh ci`                 |
| Let an agent do it       | Tell it: `Set this machine up as a fleet <role> node by following https://raw.githubusercontent.com/crvouga/workspace/main/packages/fleet/docs/agent-install.md` |
| No questions at all      | `sudo bash fleet-node.sh ci --yes` (the confirmation is taken as typed; every disk refusal still applies)                                                        |
| Check without changing   | `sudo bash fleet-node.sh doctor ci` (`--json` for programs). Writes nothing, reports every problem at once, names the exact disk.                                |
| Install without approval | add `--no-enroll`. The node makes its own age key, so it cannot read the secrets other nodes of that role share.                                                 |
| You already have a token | `--token-file PATH` (never an argument). A token is a single-use Vault wrapping token; `just enroll <role>` prints one.                                          |

A USB, removable, hotplug or ambiguous disk is refused on every operating system. A mounted internal disk is not: the disk holding the running system is always mounted, and converting that machine is the point.

### A blank machine

A machine with no operating system cannot download anything. On any other computer run the wizard and choose **Make an install USB stick** (or `bash fleet-node.sh flash`). Boot the blank machine from the stick, pick the role in the menu (it waits for you, and every entry says it erases the disk), and it installs. A USB install cannot carry an approval, so that node makes its own age key; reinstall it from its own OS if it must share its role's secrets.

## Remove or replace a machine

- Remove: `fleet-node remove` on the node. It withdraws the runner, writes `/nix/fleet-state/withdrawn` (the runner refuses to start again, even after a reboot) and powers off once no job is running. It never stops a running job.
- Replace: add another machine of the same role. There is no host file to edit.
- Convert: run the installer again and choose another role. This erases the machine.

## One-time setup (the repository owner, once for the whole fleet)

A new machine needs none of this. It exists so a new machine can need nothing.

```sh
mise install                       # just, age, sops, opentofu, gh (repo root)
just setup --repos crvouga/private-app,crvouga/another   # in packages/fleet
```

`just setup` does four things and is safe to run twice:

1. creates one age key per role (private keys to the vault OpenTofu root's git-ignored `fleet-age-keys.auto.tfvars.json`, public recipients to `.sops.yaml`),
2. creates the **GitHub App** that registers runners, from a manifest: you press **Create GitHub App** and then **Install**, choosing the private repositories. Repositories are never guessed,
3. encrypts the App's private key into `secrets/fleet.yaml` for the `ci` role only,
4. fills `fleet.nix`: the App id, the installation id, the repositories, the secrets file.

Then two reviewed steps, because infrastructure changes through a reviewed plan:

1. Merge the pull request with `fleet.nix`, `secrets/fleet.yaml` and `.sops.yaml`. The `Fleet` workflow builds every role and publishes the installer release.
2. Apply the vault root so Vault holds the role keys and the `fleet-enroll` login:

   ```sh
   bun run infra:vault plan -out=fleet.plan     # review
   bun run infra:vault apply fleet.plan
   ```

After that, `bun run health` reports the Vault role and policy as healthy. Which repositories may use the fleet is a decision in `fleet.nix`, not something the installer guesses. Do not list public repositories: pull requests from strangers would run on your machines.

## How approval works

The installer release is public, so a machine cannot simply ask Vault for its role key. Instead a human approves it:

1. The machine makes a one-time key pair (X25519, in memory) and opens `issues/new` prefilled with its role and **public** key.
2. The owner submits the issue. The `Fleet enroll` workflow runs only for an issue whose author is the repository owner, from `main`.
3. The workflow logs in to Vault with its **GitHub OIDC identity** (no stored secret). The Vault role is bound to that exact workflow file on `main`, and its policy only allows a **response-wrapped** read of `secret/data/fleet/<role>`, so the workflow never holds the age key.
4. The workflow posts the single-use wrapping token as a comment, **sealed to the machine's public key**. Anyone can read the comment; only that machine can open it.
5. The machine opens it, checks the token with `sys/wrapping/lookup` (which does not spend it), and the installer unwraps it before the disk is touched. A refused, expired or spent token erases nothing.

If the workflow cannot help (no key in Vault yet, Vault down) it comments `fleet-error: …` with the fix, and the installer stops at once, still having erased nothing. CI and web never share an age key or a secrets file.

## What stays physical

Hardware replacement and cleaning, cabling, and one-time firmware settings (Secure Boot off, UEFI boot, power-on after AC loss). See [the checklist](docs/checklist.md). Everything else that seems to need a person at a machine is a bug in the automation.

## Day to day

Git is the only control surface. Open a pull request; `Required` and `Fleet` pass on GitHub-hosted runners; the merge lands on `main`; nodes poll `main` and switch only to a system that is already in the binary cache. A bad change is a revert pull request. `fleet-node status` on a node is read-only. See [operations](docs/runbook.md).

## What is tested, and what is not

| Layer                                                                     | How                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role selection, disk refusals, confirmation, logs, exit codes             | `tests/test_fleet_node.py` runs the shipped one-file entry on Linux, macOS and Windows disks                                                                                              |
| Windows conversion (shrink, raw write, read-back, boot entry, undo)       | `tests/test_fleet_node.py`, `tests/test_windows*.py` with stand-in `powershell`, `bcdedit`, UEFI variables; every script through the real PowerShell parser in `tests/test_powershell.py` |
| Approval (X25519 against RFC 7748, sealing, polling, the workflow's half) | `tests/test_enroll.py` against fake GitHub and fake Vault servers                                                                                                                         |
| One-time setup (manifest flow, App token, `sops` round trip, `fleet.nix`) | `tests/test_setup.py` against a fake GitHub, plus real `sops` and `age` when installed                                                                                                    |
| The wizard (server, helper, USB writer, page)                             | `tests/test_wizard.py`; `wizard/ui-e2e.cjs` in Chromium; each build's `--selftest` on 5 OSes                                                                                              |
| Role closures, installer ISO, sync, rollback, lifecycle                   | `nix flake check` and NixOS VM tests in the `Fleet` workflow                                                                                                                              |

Run the portable ones with `bun run --filter @pkgs/fleet check`. Be clear about the gaps: no change here has been run on a real machine. The Windows conversion, the unsigned-GRUB boot from a raw partition and the real GitHub App creation are covered by stand-ins, not by hardware. Run them on a spare machine before relying on them, and read [the validation record](docs/validation.md).

## Reference

- [Installer guide](docs/installer.md) for people, [agent runbook](docs/agent-install.md) for agents.
- [Operations](docs/runbook.md), [checklist](docs/checklist.md), [onboard a project](docs/onboard-project.md), [secrets](secrets/README.md), [hardware notes](docs/hardware.md).
- [Agent operating rules](AGENTS.md) and [validation record](docs/validation.md).

`fleet.nix` is the CI settings file (the historical name). Shared values are in `settings/shared.nix`. Runner slots are counted at boot: reserve 4 GiB, then one slot per 2 cores and 6 GiB, at most 8. A 16-core 32 GiB machine gets **4 slots**. The root is tmpfs; the EFI partition and `/nix` persist. `just` and the other tools are pinned in the repo-root `mise.toml`.
