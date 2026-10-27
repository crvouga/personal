{
  description = "NixOS configurations for physical machines we run ourselves";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";
    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
    # Use OMP's maintained Nix build and its own pinned toolchain inputs.
    oh-my-pi.url = "github:can1357/oh-my-pi/v18.13.1";
  };
  outputs = inputs: let
    source = builtins.fromJSON (builtins.readFile ./source.json);
    fleet = builtins.fetchGit { inherit (source) url rev; };
  in import (fleet + "/packages/fleet/outputs.nix") (inputs // {
    deployment = {
      shared = import ./settings/shared.nix;
      roles.ci = import ./fleet.nix;
      roles.devbox = import ./devbox.nix;
    };
  });
}
