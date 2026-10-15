# Not a module. A function that returns the node scripts as ONE store path
# (agent.py, fleetconf.py and cattle.py import each other, so they must sit
# in the same directory) and the commands built on them. agent.nix, sync.nix,
# identity.nix, base.nix and ci-runner.nix call it, and nothing else.
{ lib, pkgs, apiUrl ? "" }: let
  python = "${pkgs.python3}/bin/python3";
  scripts = pkgs.runCommand "fleet-node-scripts" { } ''
    mkdir -p "$out"
    cp ${../scripts/cattle.py} "$out/cattle.py"
    cp ${../scripts/fleetconf.py} "$out/fleetconf.py"
    cp ${../scripts/agent.py} "$out/agent.py"
  '';
in {
  inherit scripts;
  # fleetconf get KEY DEFAULT: the setting this node last applied from the
  # fleet API, else DEFAULT. It never fails, so a unit can always call it.
  fleetconf = pkgs.writeShellScriptBin "fleetconf" ''
    exec ${python} ${scripts}/fleetconf.py "$@"
  '';
  # fleet-agent run|once|status|retire. A shell started by hand gets the same
  # API address as the unit.
  agent = pkgs.writeShellScriptBin "fleet-agent" ''
    export PATH=${lib.makeBinPath [ pkgs.iproute2 pkgs.systemd pkgs.coreutils ]}:$PATH
    export FLEET_API_URL="''${FLEET_API_URL-${apiUrl}}"
    exec ${python} ${scripts}/agent.py "$@"
  '';
}
