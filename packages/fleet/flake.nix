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
    devboxSettings = import ./devbox.nix;
    ci = mkHost ciSettings ./hosts/ci.nix { };
    ciGpu = mkHost (ciSettings // { flakeAttr = "ci-gpu"; }) ./hosts/ci-gpu.nix { };
    web = mkHost webSettings ./hosts/web.nix { };
    cache = mkHost cacheSettings ./hosts/cache.nix { };
    devbox = mkHost devboxSettings ./hosts/devbox.nix { };
    installerIso = lib.nixosSystem {
      inherit system;
      specialArgs = { settings = installerSettings; };
      modules = [
        (nixpkgs + "/nixos/modules/installer/cd-dvd/installation-cd-minimal.nix")
        ./modules/installer.nix
        ./modules/installer-iso.nix
        # Role closures live on the ISO only. The netboot ramdisk must not
        # reference them; a multi-gigabyte initrd will not boot.
        {
          isoImage.storeContents = [
            ci.config.system.build.toplevel
            web.config.system.build.toplevel
            cache.config.system.build.toplevel
            netboot.config.system.build.toplevel
            devbox.config.system.build.toplevel
            installDisk
          ];
          isoImage.contents = [{
            source = pkgs.writeText "fleet-install-manifest" ''
              ci ${ci.config.system.build.toplevel}
              web ${web.config.system.build.toplevel}
              cache ${cache.config.system.build.toplevel}
              netboot ${netboot.config.system.build.toplevel}
              devbox ${devbox.config.system.build.toplevel}
              disko ${installDisk}
            '';
            target = "/fleet-install-manifest";
          }];
        }
      ];
    };
    installerNetboot = lib.nixosSystem {
      inherit system;
      specialArgs = { settings = installerSettings; };
      modules = [
        (nixpkgs + "/nixos/modules/installer/netboot/netboot-minimal.nix")
        ./modules/installer.nix
        { netboot.squashfsCompression = "zstd -Xcompression-level 3"; }
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
      export PATH=${lib.makeBinPath [ pkgs'.openssh ]}:$PATH
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
      devbox = devbox;
      installer = installerIso;
    };
    packages.${system} = {
      ci = ci.config.system.build.toplevel;
      node = self.packages.${system}.ci;
      web = web.config.system.build.toplevel;
      cache = cache.config.system.build.toplevel;
      netboot = netboot.config.system.build.toplevel;
      devbox = devbox.config.system.build.toplevel;
      installer = installerIso.config.system.build.isoImage;
      fleet-installer = import ./modules/installer-package.nix { inherit pkgs lib revision; };
      fleet-node = self.packages.${system}.fleet-installer;
      default = self.packages.${system}.ci;
      disko = installDisk;
      disko-ci = installDisk;
      disko-web = installDisk;
      disko-cache = installDisk;
      disko-netboot = installDisk;
      disko-devbox = installDisk;
      attic-client = pkgs.attic-client;
      nixos-anywhere = pkgs.nixos-anywhere;
      bootstrap = bootstrapFor pkgs;
    };
    checks.${system} = {
      node = self.packages.${system}.ci;
      web = self.packages.${system}.web;
      cache = self.packages.${system}.cache;
      netboot = self.packages.${system}.netboot;
      devbox = self.packages.${system}.devbox;
      devbox-vm = import ./tests/devbox.nix testArgs;
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
      wifi-vm = import ./tests/wifi.nix testArgs;
      # Every role reports to the fleet API. Pure evaluation: a role that loses
      # the unit, its boot target or its address fails here, not at a boot.
      agent-units = let
        roles = { inherit ci web cache netboot devbox; };
        url = (import ./settings/shared.nix).fleetApi.url;
        working = system: let unit = system.config.systemd.services.fleet-agent or null; in
          unit != null
          && builtins.elem "multi-user.target" unit.wantedBy
          && unit.environment.FLEET_API_URL == url
          && lib.hasInfix "fleet-agent run" unit.serviceConfig.ExecStart;
        broken = lib.attrNames (lib.filterAttrs (_: system: !(working system)) roles);
      in pkgs.runCommand "fleet-agent-units" { } (
        if broken == [ ] then "mkdir -p $out"
        else "echo 'roles without a working fleet-agent: ${lib.concatStringsSep ", " broken}' >&2; exit 1");
    };
    apps.${system} = {
      bootstrap = { type = "app"; program = "${bootstrapFor pkgs}"; };
      fleet-installer = {
        type = "app";
        program = "${self.packages.${system}.fleet-installer}/bin/fleet-installer";
      };
      fleet-node = {
        type = "app";
        program = "${self.packages.${system}.fleet-node}/bin/fleet-node";
      };
    };
    packages.aarch64-linux.fleet-installer = import ./modules/installer-package.nix {
      pkgs = nixpkgs.legacyPackages.aarch64-linux;
      inherit lib revision;
    };
    apps.aarch64-linux.fleet-installer = {
      type = "app";
      program = "${self.packages.aarch64-linux.fleet-installer}/bin/fleet-installer";
    };
    packages.aarch64-linux.fleet-node = self.packages.aarch64-linux.fleet-installer;
    apps.aarch64-linux.fleet-node = {
      type = "app";
      program = "${self.packages.aarch64-linux.fleet-node}/bin/fleet-node";
    };
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
