{
  description = "NixOS configurations for physical machines we run ourselves";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";
    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
  };
  outputs = { self, nixpkgs, disko, sops-nix }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    lib = nixpkgs.lib;
    clean = self.rev or null;
    dirty = self.dirtyRev or null;
    revision =
      if clean != null then clean
      else if dirty != null then dirty
      else "unknown";
    installerSettings = import ./settings/installer.nix;
    mkHost = settingsFile: hostModule: extraArgs: lib.nixosSystem {
      inherit system;
      specialArgs = { settings = import settingsFile; inherit revision; } // extraArgs;
      modules = [
        disko.nixosModules.disko
        sops-nix.nixosModules.sops
        hostModule
      ];
    };
    ci = mkHost ./fleet.nix ./hosts/ci.nix { };
    web = mkHost ./web.nix ./hosts/web.nix { };
    cache = mkHost ./cache.nix ./hosts/cache.nix { };
    installerIso = lib.nixosSystem {
      inherit system;
      specialArgs = { settings = installerSettings; };
      modules = [
        (nixpkgs + "/nixos/modules/installer/cd-dvd/installation-cd-minimal.nix")
        ./modules/installer.nix
        ./modules/installer-iso.nix
      ];
    };
    installerNetboot = lib.nixosSystem {
      inherit system;
      specialArgs = { settings = installerSettings; };
      modules = [
        (nixpkgs + "/nixos/modules/installer/netboot/netboot-minimal.nix")
        ./modules/installer.nix
      ];
    };
    netboot = mkHost ./netboot.nix ./hosts/netboot.nix { installer = installerNetboot; };
    guardedDisko = name: host: settings: pkgs.writeShellScript "disko-${name}" ''
      set -euo pipefail
      export PATH=${lib.makeBinPath [ pkgs.python3 pkgs.util-linux ]}:$PATH
      python3 ${./scripts/disk-guard.py} ${lib.escapeShellArg settings.disk}
      exec ${host.config.system.build.diskoScript}
    '';
    bootstrapFor = pkgs': pkgs'.writeShellScript "bootstrap" ''
      export PATH=${lib.makeBinPath [ pkgs'.nixos-anywhere pkgs'.openssh ]}:$PATH
      exec ${pkgs'.bash}/bin/bash ${./scripts/bootstrap.sh} "$@"
    '';
    testArgs = {
      inherit pkgs;
      inherit (nixpkgs) lib;
      sopsModule = sops-nix.nixosModules.sops;
      diskoModule = disko.nixosModules.disko;
    };
  in {
    nixosConfigurations = {
      ${(import ./fleet.nix).profile} = ci;
      ci = ci;
      web = web;
      cache = cache;
      netboot = netboot;
      installer = installerIso;
      "installer-${(import ./fleet.nix).profile}" = installerIso;
    };
    packages.${system} = {
      ci = ci.config.system.build.toplevel;
      node = self.packages.${system}.ci;
      web = web.config.system.build.toplevel;
      cache = cache.config.system.build.toplevel;
      netboot = netboot.config.system.build.toplevel;
      installer = installerIso.config.system.build.isoImage;
      default = self.packages.${system}.ci;
      disko-ci = guardedDisko "ci" ci (import ./fleet.nix);
      disko-web = guardedDisko "web" web (import ./web.nix);
      disko-cache = guardedDisko "cache" cache (import ./cache.nix);
      disko-netboot = guardedDisko "netboot" netboot (import ./netboot.nix);
      # Previous CI-only name. Bootstrap now uses disko-<role>.
      disko = self.packages.${system}.disko-ci;
      attic-client = pkgs.attic-client;
      nixos-anywhere = pkgs.nixos-anywhere;
      bootstrap = bootstrapFor pkgs;
    };
    checks.${system} = {
      node = self.packages.${system}.ci;
      web = self.packages.${system}.web;
      cache = self.packages.${system}.cache;
      netboot = self.packages.${system}.netboot;
      installer = self.packages.${system}.installer;
      vm = import ./tests/vm.nix (testArgs // { settings = import ./fleet.nix; });
      web-vm = import ./tests/web.nix testArgs;
      lifecycle = import ./tests/lifecycle.nix testArgs;
      netboot-vm = import ./tests/netboot.nix (testArgs // { inherit installerNetboot; });
    };
    apps.${system}.bootstrap = { type = "app"; program = "${bootstrapFor pkgs}"; };
    apps.aarch64-darwin.bootstrap = {
      type = "app";
      program = "${bootstrapFor nixpkgs.legacyPackages.aarch64-darwin}";
    };
    apps.x86_64-darwin.bootstrap = {
      type = "app";
      program = "${bootstrapFor nixpkgs.legacyPackages.x86_64-darwin}";
    };
    packages.aarch64-darwin.nixos-anywhere = nixpkgs.legacyPackages.aarch64-darwin.nixos-anywhere;
    packages.x86_64-darwin.nixos-anywhere = nixpkgs.legacyPackages.x86_64-darwin.nixos-anywhere;
    formatter.${system} = pkgs.nixfmt;
    devShells.${system}.default = pkgs.mkShell {
      packages = with pkgs; [ just sops age shellcheck actionlint python3 nixfmt ];
    };
  };
}
