{ config, settings, ... }: let
  cache = settings.binaryCache;
  providesCache = (settings.bootstrap or { }).providesCache or false;
  apiUrl = (settings.fleetApi or { }).url or "";
  present = value: value != null && value != "" && !(builtins.match ".*TODO.*" value != null);
  metadata = {
    version = 1;
    role = settings.role;
    inherit apiUrl providesCache;
    cacheUrl = cache.url;
    cachePublicKey = cache.publicKey;
    secretsFile = if settings.secretsFile == null then null else toString settings.secretsFile;
    requiredSecrets = builtins.attrNames config.sops.secrets;
    github = settings.github or null;
    installBlocked = metadata.blocked;
    blocked = (if present cache.url && present cache.publicKey then [ ] else [
      "FLEET_CACHE_UNCONFIGURED: automatic updates require the fleet binary-cache URL and signing public key. Configure the platform before installing nodes."
    ]) ++ (if present apiUrl then [ ] else [
      "FLEET_API_UNCONFIGURED: this image cannot register or report to Fleet."
    ]) ++ (if providesCache && settings.secretsFile == null then [
      "FLEET_CACHE_SECRET_MISSING: the cache server's encrypted signing/authentication secret must be configured before bootstrap."
    ] else [
    ]) ++ (if present settings.repo.url then [ ] else [
      "FLEET_REPOSITORY_UNCONFIGURED: the Git source for automatic updates is not configured."
    ]);
  };
in {
  # Public configuration only. Credentials remain in the wrapped document and
  # role-encrypted secrets; both are checked privately before disk erasure.
  environment.etc."fleet/bootstrap.json".text = builtins.toJSON metadata;
}
