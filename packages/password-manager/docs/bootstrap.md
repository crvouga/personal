# Before Node and Bun

Start from the checkout root:

```sh
sh scripts/password-manager-setup.sh
```

An existing mise installation stays the toolchain owner. When mise is absent, use
this explicit bootstrap, then review/trust the root configuration. It needs no
Node, Bun, Python, Homebrew or npm. The release and checksums come from the
[official mise 2026.10.15 release](https://github.com/jdx/mise/releases/tag/v2026.10.15).
The package uses basic `mise install`/`exec`, without assuming newer bootstrap or
project-diagnostic features exist on an older installed manager.

1. On Debian/Ubuntu with no HTTPS downloader, obtain the declared OS prerequisites
   using the OS administrator account:

   ```sh
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl coreutils xz-utils unzip tar
   ```

   macOS supplies `/usr/bin/curl`, `/usr/bin/shasum` and the required POSIX tools.
   Linux supplies the POSIX/coreutils tools and `sha256sum`. These facilities are
   distribution/OS managed; this is not a bit-for-bit machine-image declaration.

2. Install the checksum-verified manager in your local executable directory:

   ```sh
   set -eu
   case "$(uname -s):$(uname -m)" in
     Darwin:arm64) pm_mise_asset=macos-arm64; pm_mise_sha=826c4833fa7437a63f6027b86bc10c8b61b1163dc793c03ecde92f68ad167890 ;;
     Darwin:x86_64) pm_mise_asset=macos-x64; pm_mise_sha=ea45cc6e787d412deb8e069eec57875c71863e33a36acf69dd59791c27c9c073 ;;
     Linux:aarch64) pm_mise_asset=linux-arm64; pm_mise_sha=3abbaac305a465ef038eb4ea07b961c037a8b639108005e43f8e2c00a8f67c11 ;;
     Linux:x86_64) pm_mise_asset=linux-x64; pm_mise_sha=e3b186d4c70627f27037be615becaf4acfb30e41fb6a1819486717dc94e4e2a9 ;;
     *) echo 'Unsupported platform/architecture'; exit 1 ;;
   esac
   pm_mise_download=$(mktemp)
   trap 'rm -f "$pm_mise_download"' EXIT
   curl --fail --location "https://github.com/jdx/mise/releases/download/v2026.10.15/mise-v2026.10.15-$pm_mise_asset" -o "$pm_mise_download"
   case "$pm_mise_asset" in
     macos-*) printf '%s  %s\n' "$pm_mise_sha" "$pm_mise_download" | /usr/bin/shasum -a 256 -c - ;;
     linux-*) printf '%s  %s\n' "$pm_mise_sha" "$pm_mise_download" | /usr/bin/sha256sum -c - ;;
   esac
   mkdir -p "$HOME/.local/bin"
   cp "$pm_mise_download" "$HOME/.local/bin/mise"
   chmod 755 "$HOME/.local/bin/mise"
   export PATH="$HOME/.local/bin:$PATH"
   ```

3. Review `mise.toml`, then authorize its tool definitions and continue:

   ```sh
   mise trust mise.toml
   sh scripts/password-manager-setup.sh
   ```

The continuation installs Node 22.22.3 and Bun 1.3.11 from the root toolchain,
performs frozen workspace installation, acquires Chromium/system dependencies and
initializes private onboarding. It never authenticates or modifies an online
account. Linux administration, a desktop credential-store unlock, provider consent
and native browser export remain explicit actions. Inspect `actions list` and
`doctor` to continue each one.

`tests/bootstrap/Dockerfile` exercises the Linux arm64 release/checksum and the
actual cold launcher in a clean supported image. Its second setup validates
idempotency. The other platform download checksums are verified release metadata;
no clean macOS/x64 installation is claimed from this Linux test.
