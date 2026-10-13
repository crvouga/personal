# Live installer settings. The ISO and the PXE image share this file.
# Role age keys are not baked in. Bootstrap copies a role key over nixos-anywhere.
{
  sshKeys = (import ./shared.nix).sshKeys;
}
