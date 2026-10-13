# Onboard any trusted private project

1. Commit a project `flake.nix` and `flake.lock` with a `devShell` containing its language toolchain and test dependencies. Check locally with `nix develop --command bash -euo pipefail -c 'YOUR_CHECK'`. The host only supplies git, Nix, nix-ld and operational tools; NixOS runner internals also provide their required Node runtime, not a project SDK.
2. With approval, include the repository in the organization runner group's selected private repositories, or add its `owner/name` to `fleet.nix.github.repositories` and deploy. Personal-account repositories cannot share an organization-level group. Repository mode distributes the configured total slot count round-robin; if repositories outnumber slots, some have no runner and need hosted fallback or more slots/nodes.
3. Call `.github/workflows/runner-check.yml` at a reviewed commit SHA in this workspace (replace `OWNER/REPO` below), or copy [the example](../workflows/project-example.yml). Change `runs-on` in existing jobs to `[self-hosted, nixos, ci]` and run commands inside the project's devShell. Protect workflow changes. The reusable entrypoint permits private same-repository PRs on self-hosted execution; forks must explicitly select hosted fallback, and `pull_request_target` is never sent to the fleet.

   ```yaml
   jobs:
     check:
       uses: OWNER/REPO/.github/workflows/runner-check.yml@COMMIT_SHA
       with:
         nix_command: bun run check
         use_github_hosted: false
   ```

4. Projects opt into disposable persistence using `CI_CACHE_DIR` (per slot) or `CI_PROJECT_CACHE_DIR` (namespaced by repository). Point `XDG_CACHE_HOME`, compiler caches or package caches there deliberately. Never put credentials, essential artifacts or authoritative data in them. For example `nix develop --command bash -c 'export XDG_CACHE_HOME="$CI_PROJECT_CACHE_DIR"; YOUR_CHECK'`. Concurrent slots have separate directories; within one slot use explicit project namespaces. The Nix store is cached automatically and periodically collected.
5. Set `use_github_hosted: true` to route to Ubuntu when the fleet is unavailable. This is an explicit scheduling choice; GitHub cannot automatically fall back after a self-hosted job queues. Hosted Nix installation is performed by the reusable workflow. GitHub-hosted fallback needs outbound downloads and may incur normal account usage; no billing settings are changed here.
6. Set a project matrix's `max-parallel` to its available total slots (node count × slots in organization mode, or the smaller per-repository allocation). One initial MS-A2 supplies 4 total slots, not 32 jobs. Cancel outdated PR runs with concurrency; cap compiler/Turbo parallelism so four memory-heavy jobs do not each assume all 32 threads and 32 GiB.

`apt-get` and Playwright `--with-deps` are Ubuntu-specific: replace them with devShell packages. Pin browsers and Playwright together; a browser downloaded for Ubuntu may lack compatible NixOS libraries. `nix-ld` provides an ELF loader, not every possible dependency: put libraries/source builds in the devShell or use a Nix-packaged program. Rootless Podman is optional and exposes a per-slot Docker-compatible socket. Enable `containers` only for trusted jobs, validate the exact `container:` and `services:` actions those projects use, and keep the hosted fallback available; Podman does not implement every Docker API behavior.

Only trusted private code may run here. Separate slot users and work directories prevent ordinary accidental mixing; they are not a hostile multi-tenant security boundary. All jobs share a kernel, Nix daemon and persistent caches. No fork PRs, public repo code, or unreviewed workflow changes. All fleet jobs must request `nixos` and `ci` so label-based draining prevents new assignments.

GitHub documentation: [registration scopes](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners), [runner-group private access](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access), [ephemeral runners and external logs](https://docs.github.com/en/actions/reference/runners/self-hosted-runners), and [job hooks](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts).
