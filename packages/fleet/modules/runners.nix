{ config, lib, pkgs, settings, registrationProvider ? null, drainProvider ? null, ... }: let
  # Every closure can start this many slots. Boot starts only the count
  # cattle.py writes to /run/fleet/slot-count for the live CPU and RAM.
  slots = settings.capacity.slotMax;
  ids = map (n: "slot-${toString n}") (lib.range 1 slots);
  runnerPackage = pkgs.writeShellScriptBin "Runner.Listener" ''
    set -euo pipefail
    real=${pkgs.github-runner}/bin/Runner.Listener
    if [ "''${1:-}" != configure ] || [ ! -s /run/fleet/runner-labels ]; then
      exec "$real" "$@"
    fi
    extra=""
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        "") continue ;;
        *,*) echo "runner label contains a comma" >&2; exit 1 ;;
      esac
      if [ -z "$extra" ]; then extra=$line; else extra="$extra,$line"; fi
    done < /run/fleet/runner-labels
    if [ -z "$extra" ]; then
      exec "$real" "$@"
    fi
    args=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --labels)
          shift
          args+=(--labels "$1,$extra")
          shift
          ;;
        --labels=*)
          args+=("--labels=''${1#--labels=},$extra")
          shift
          ;;
        *)
          args+=("$1")
          shift
          ;;
      esac
    done
    exec "$real" "''${args[@]}"
  '';
  scopeFor = n: if settings.github.scope == "organization" then settings.github.organization
    else builtins.elemAt settings.github.repositories (lib.mod (n - 1) (builtins.length settings.github.repositories));
  token = if registrationProvider != null then registrationProvider else pkgs.writeScript "fleet-token" ''#!${pkgs.python3.withPackages (p: [ p.pyjwt p.cryptography ])}/bin/python3
${builtins.readFile ../scripts/token.py}
'';
  control = if drainProvider != null then drainProvider else pkgs.writeScriptBin "runner-control" ''#!${pkgs.python3.withPackages (p: [ p.pyjwt p.cryptography ])}/bin/python3
${builtins.readFile ../scripts/token.py}
'';
  targets = if settings.github.scope == "organization" then [ settings.github.organization ] else settings.github.repositories;
  drain = pkgs.writeShellApplication {
    name = "fleet-drain";
    runtimeInputs = with pkgs; [ systemd coreutils util-linux control ];
    text = ''
      export FLEET_SCOPE=${lib.escapeShellArg settings.github.scope}
      export FLEET_TARGETS=${lib.escapeShellArg (lib.concatStringsSep " " targets)}
      export FLEET_APP_ID=${lib.escapeShellArg settings.github.appId}
      export FLEET_INSTALLATION_ID=${lib.escapeShellArg settings.github.installationId}
      export FLEET_UNITS=${lib.escapeShellArg (lib.concatStringsSep " " (map (id: "github-runner-${id}.service") ids))}
      ${builtins.readFile ../scripts/drain.sh}
    '';
  };
  resume = pkgs.writeShellApplication {
    name = "fleet-resume";
    runtimeInputs = with pkgs; [ systemd coreutils ];
    text = ''
      rm -f /run/fleet/draining
      rm -f /run/systemd/system/github-runner-*.service.d/drain.conf
      systemctl daemon-reload
      count=$(tr -d '[:space:]' < /run/fleet/slot-count)
      case "$count" in
        ""|*[!0-9]*) echo 'slot count is not a number' >&2; exit 1 ;;
      esac
      units=()
      n=1
      while [ "$n" -le "$count" ]; do
        units+=("github-runner-slot-$n.service")
        n=$((n + 1))
      done
      systemctl reset-failed "''${units[@]}"
      systemctl start "''${units[@]}"
    '';
  };
  hooks = event: pkgs.writeShellScript "fleet-job-${event}" (if event == "started" then ''
    exec 9>/run/fleet/gate
    ${pkgs.util-linux}/bin/flock 9
    # Admission barrier: a just-dispatched job fails before project code during drain.
    [ ! -e /run/fleet/draining ] || exit 75
    touch "$CI_BUSY_FILE"
  '' else ''
    rm -f "$CI_BUSY_FILE"
  '');
in {
  assertions = [
    { assertion = slots >= 1 && slots <= 64; message = "Fleet slots must be 1..64."; }
    { assertion = builtins.elem settings.github.scope [ "organization" "repository" ]; message = "Invalid GitHub scope."; }
    { assertion = settings.github.scope != "repository" || builtins.length settings.github.repositories > 0;
      message = "Repository registration needs at least one owner/repo."; }
  ];
  environment.systemPackages = [ drain resume ];
  environment.etc."fleet-slots".text = lib.concatStringsSep "\n" ids + "\n";
  users.groups = lib.genAttrs ids (_: {});
  users.users = lib.genAttrs ids (id: let index = lib.lists.findFirstIndex (x: x == id) 0 ids; in {
    isSystemUser = true; group = id; home = "/var/lib/github-runner/${id}";
    uid = 2000 + index;
    linger = settings.containers;
    subUidRanges = lib.optionals settings.containers [ { startUid = 100000 + 65536 * index; count = 65536; } ];
    subGidRanges = lib.optionals settings.containers [ { startGid = 100000 + 65536 * index; count = 65536; } ];
  });
  systemd.tmpfiles.rules = lib.concatMap (id: [
    "d /nix/ci-cache/${id} 0700 ${id} ${id} -"
    "d /run/fleet/${id} 0700 ${id} ${id} -"
  ]) ids ++ [ "d /run/fleet 0755 root root -" "f /run/fleet/gate 0666 root root -" ];
  services.github-runners = builtins.listToAttrs (lib.imap1 (n: id: lib.nameValuePair id {
    enable = true;
    url = "https://github.com/${scopeFor n}";
    name = null; # ACTIONS_RUNNER_INPUT_NAME below supplies hostname + slot
    ephemeral = true;
    replace = true;
    user = id; group = id;
    runnerGroup = if settings.github.scope == "organization" then settings.github.runnerGroup else null;
    tokenFile = "/run/fleet/tokens/${id}";
    package = lib.mkDefault runnerPackage;
    # nixos and ci stay in the store. x64, gpu, and high-mem are spliced
    # onto --labels at configure time from /run/fleet/runner-labels.
    extraLabels = [ "nixos" "ci" ];
    extraPackages = lib.optionals settings.containers [ pkgs.podman ];
    extraEnvironment = {
      ACTIONS_RUNNER_INPUT_NAME = "%H-${id}";
      CI_CACHE_DIR = "/nix/ci-cache/${id}";
      CI_BUSY_FILE = "/run/fleet/${id}/busy";
      ACTIONS_RUNNER_HOOK_JOB_STARTED = "${hooks "started"}";
      ACTIONS_RUNNER_HOOK_JOB_COMPLETED = "${hooks "completed"}";
    } // lib.optionalAttrs settings.containers {
      DOCKER_HOST = "unix:///run/user/${toString (2000 + lib.lists.findFirstIndex (x: x == id) 0 ids)}/podman/podman.sock";
    };
    serviceOverrides = {
      Restart = lib.mkForce "always";
      RestartSec = "15s";
      UMask = lib.mkForce "0077";
      ReadWritePaths = [ "/nix/ci-cache/${id}" "/run/fleet/${id}" ]
        ++ lib.optional settings.containers "/run/user/${toString (2000 + lib.lists.findFirstIndex (x: x == id) 0 ids)}";
      # Rootless Podman requires namespaces and mounts; enabled only explicitly.
    } // lib.optionalAttrs settings.containers {
      PrivateUsers = lib.mkForce false;
      RestrictNamespaces = lib.mkForce false;
      RestrictSUIDSGID = lib.mkForce false;
      SystemCallFilter = lib.mkForce [ ];
      NoNewPrivileges = lib.mkForce false;
    };
  }) ids);
  systemd.services = builtins.listToAttrs (lib.imap1 (n: id: lib.nameValuePair "github-runner-${id}" {
    wantedBy = lib.mkForce [ ];
    requires = [ "node-identity.service" ];
    after = [ "node-identity.service" ] ++ lib.optional (settings.secretsFile != null) "sops-install-secrets.service";
    unitConfig.ConditionPathExists = "!/run/fleet/draining";
    serviceConfig.ExecStartPre = lib.mkBefore [
      "+${token} register ${lib.escapeShellArgs [ settings.github.scope (scopeFor n) settings.github.appId settings.github.installationId "/run/secrets/github-app-key" "/run/fleet/tokens/${id}" ]}"
    ];
  }) ids);
}
