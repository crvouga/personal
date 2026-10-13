{ ... }: {
  # CI nodes share this layout. Replace this import if a later CI profile needs
  # a different disk. Do not point it at the web, cache, or netboot layout file.
  imports = [ ./internal-nvme.nix ];
}
