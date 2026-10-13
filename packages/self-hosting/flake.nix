{
  description = "Disposable, trusted-code-only GitHub Actions runner fleet";
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
    settings = import ./fleet.nix;
    modules = [ disko.nixosModules.disko sops-nix.nixosModules.sops
      ./modules/node.nix ./modules/runners.nix ./modules/cache.nix
      ./modules/update.nix ./modules/disk.nix (./profiles + "/${settings.profile}.nix") ];
    node = nixpkgs.lib.nixosSystem {
      inherit system modules;
      specialArgs = { inherit settings; };
    };
    installer = nixpkgs.lib.nixosSystem {
      inherit system;
      specialArgs = { inherit settings node; };
      modules = [ (nixpkgs + "/nixos/modules/installer/cd-dvd/installation-cd-minimal.nix")
        ./modules/installer.nix ];
    };
  in {
    nixosConfigurations = { ${settings.profile} = node; "installer-${settings.profile}" = installer; };
    packages.${system} = {
      node = node.config.system.build.toplevel;
      installer = installer.config.system.build.isoImage;
      default = self.packages.${system}.node;
      disko = pkgs.writeShellScript "fleet-disko" ''
        set -euo pipefail
        export PATH=${nixpkgs.lib.makeBinPath [ pkgs.python3 pkgs.util-linux ]}:$PATH
        python3 ${./scripts/disk-guard.py} ${nixpkgs.lib.escapeShellArg settings.disk}
        exec ${node.config.system.build.diskoScript}
      '';
      nixos-anywhere = pkgs.nixos-anywhere;
    };
    checks.${system} = {
      node = self.packages.${system}.node;
      installer = self.packages.${system}.installer;
      vm = import ./tests/vm.nix { inherit pkgs settings; inherit (nixpkgs) lib; sopsModule = sops-nix.nixosModules.sops; };
    };
    packages.aarch64-darwin.nixos-anywhere = nixpkgs.legacyPackages.aarch64-darwin.nixos-anywhere;
    packages.x86_64-darwin.nixos-anywhere = nixpkgs.legacyPackages.x86_64-darwin.nixos-anywhere;
    formatter.${system} = pkgs.nixfmt;
    devShells.${system}.default = pkgs.mkShell {
      packages = with pkgs; [ just sops age shellcheck actionlint python3 nixfmt ];
    };
  };
}
