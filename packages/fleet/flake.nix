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
    # A dirty tree has no self.rev. Do not publish dirtyRev: it will never
    # match a system in the binary cache.
    revision = if (self.rev or null) != null then self.rev else "unknown";
    installerSettings = import ./settings/installer.nix;
    mkHost = settings: hostModule: extraArgs: lib.nixosSystem {
      inherit system;
      specialArgs = { inherit settings revision; } // extraArgs;
      modules = [
        disko.nixosModules.disko
        sops-nix.nixosModules.sops
        hostModule
      ];
    };
    ciSettings = import ./fleet.nix;
    webSettings = import ./web.nix;
    cacheSettings = import ./cache.nix;
    netbootSettings = import ./netboot.nix;
    ci = mkHost ciSettings ./hosts/ci.nix { };
    ciGpu = mkHost (ciSettings // { flakeAttr = "ci-gpu"; }) ./hosts/ci-gpu.nix { };
    web = mkHost webSettings ./hosts/web.nix { };
    cache = mkHost cacheSettings ./hosts/cache.nix { };
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
    netboot = mkHost netbootSettings ./hosts/netboot.nix { installer = installerNetboot; };
    # Every role shares this layout. The recorded path is checked again on the
    # target, then linked to the sentinel disko opens.
    installDisk = pkgs.writeShellScript "disko" ''
      set -euo pipefail
      export PATH=${lib.makeBinPath [ pkgs.python3 pkgs.util-linux pkgs.coreutils ]}:$PATH
      recorded=/run/fleet-install-disk
      [ -s "$recorded" ]
      device=$(tr -d '[:space:]' < "$recorded")
      [[ "$device" =~ ^/dev/[A-Za-z0-9._/:-]+$ ]]
      again=$(python3 ${./scripts/cattle.py} select-disk)
      [ "$again" = "$device" ]
      ln -sfn "$device" /dev/fleet-install-disk
      exec ${ci.config.system.build.diskoScript}
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
      ci = ci;
      ci-gpu = ciGpu;
      web = web;
      cache = cache;
      netboot = netboot;
      installer = installerIso;
    };
    packages.${system} = {
      ci = ci.config.system.build.toplevel;
      node = self.packages.${system}.ci;
      web = web.config.system.build.toplevel;
      cache = cache.config.system.build.toplevel;
      netboot = netboot.config.system.build.toplevel;
      installer = installerIso.config.system.build.isoImage;
      default = self.packages.${system}.ci;
      disko = installDisk;
      disko-ci = installDisk;
      disko-web = installDisk;
      disko-cache = installDisk;
      disko-netboot = installDisk;
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
      follow-up = import ./tests/follow-up.nix testArgs;
      netboot-vm = import ./tests/netboot.nix (testArgs // { inherit installerNetboot; });
      cattle = pkgs.runCommand "fleet-cattle" { } ''
        ${pkgs.python3}/bin/python3 ${./scripts/cattle.py} check ${./.}
        mkdir -p "$out"
      '';
      cattle-vm = import ./tests/cattle.nix testArgs;
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
