{ config, lib, pkgs, settings, ... }: let
  normalize = app: {
    name = app.name;
    domain = app.domain;
    port = app.port;
    containerPort = app.containerPort or app.port;
    image = app.image or null;
    envSecret = app.envSecret or null;
  };
  apps = map normalize settings.apps;
  imageApps = lib.filter (app: app.image != null) apps;
  localApps = lib.filter (app: app.image == null) apps;
  names = map (app: app.name) apps;
  # Reserved names never get a public certificate, so the placeholder works offline.
  # Real domains omit `tls` and Caddy obtains a certificate automatically.
  internalDomain = domain:
    domain == "localhost"
    || lib.hasSuffix ".localhost" domain
    || lib.hasSuffix ".local" domain
    || lib.hasSuffix ".internal" domain
    || lib.hasSuffix ".example" domain
    || lib.hasSuffix ".invalid" domain
    || lib.hasSuffix ".test" domain
    || builtins.match ".*\\..*" domain == null;
  label = name: builtins.match "[a-z][a-z0-9-]{0,62}" name != null;
  domainOk = domain: builtins.match "[A-Za-z0-9][A-Za-z0-9.-]*" domain != null;
  placeholder = port: pkgs.writeScript "web-placeholder-${toString port}" ''
    #!${pkgs.python3}/bin/python3
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"placeholder-ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, fmt, *args):
            return
    ThreadingHTTPServer(("127.0.0.1", ${toString port}), Handler).serve_forever()
  '';
  secretNames = lib.unique (lib.filter (name: name != null) (map (app: app.envSecret) imageApps));
in {
  assertions = [
    { assertion = lib.all (app: label app.name) apps; message = "Web app names must be lowercase DNS labels."; }
    { assertion = names == lib.unique names; message = "Web app names must be unique."; }
    { assertion = map (app: app.domain) apps == lib.unique (map (app: app.domain) apps); message = "Web app domains must be unique."; }
    { assertion = map (app: app.port) apps == lib.unique (map (app: app.port) apps); message = "Web app localhost ports must be unique."; }
    { assertion = lib.all (app: domainOk app.domain) apps; message = "Web app domains must be hostnames."; }
    { assertion = lib.all (app: app.port >= 1 && app.port <= 65535 && app.containerPort >= 1 && app.containerPort <= 65535) apps;
      message = "Web app ports must be 1..65535."; }
    { assertion = lib.all (app: app.envSecret == null || label app.envSecret) apps; message = "Web envSecret names must be lowercase DNS labels."; }
    { assertion = lib.all (app: app.envSecret == null || settings.secretsFile != null) apps;
      message = "Set secretsFile to this role's encrypted web.yaml before using envSecret. Never use the CI fleet file."; }
    { assertion = config.services.github-runners == { }; message = "Web hosts must not run GitHub Actions runners."; }
    { assertion = !config.programs.nix-ld.enable; message = "nix-ld stays on CI runner hosts."; }
    { assertion = !(config.users.users ? "slot-1"); message = "Web hosts must not create CI runner users."; }
  ];
  networking.firewall.allowedTCPPorts = [ 80 443 ];
  # Hostname comes from modules/identity.nix. This role must not write runner files.
  systemd.services = lib.mkMerge ([
    {
      caddy = {
        after = map (app: "web-app-${app.name}.service") localApps
          ++ map (app: "podman-${app.name}.service") imageApps;
        wants = map (app: "web-app-${app.name}.service") localApps
          ++ map (app: "podman-${app.name}.service") imageApps;
      };
    }
    (lib.listToAttrs (map (app: lib.nameValuePair "web-app-${app.name}" {
      description = "Local placeholder for ${app.name} until its image is set";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "simple";
        DynamicUser = true;
        ExecStart = placeholder app.port;
        Restart = "on-failure";
      };
    }) localApps))
  ] ++ map (app: lib.mkIf (app.envSecret != null && settings.secretsFile != null) {
    "podman-${app.name}" = {
      after = [ "sops-install-secrets.service" ];
      requires = [ "sops-install-secrets.service" ];
    };
  }) imageApps);
  # environment and environmentFiles would copy values into the Nix store.
  # --env-file points at the sops runtime path and stays a plain string.
  virtualisation.oci-containers.backend = "podman";
  virtualisation.oci-containers.containers = lib.listToAttrs (map (app: lib.nameValuePair app.name {
    image = app.image;
    ports = [ "127.0.0.1:${toString app.port}:${toString app.containerPort}" ];
    extraOptions = lib.optionals (app.envSecret != null) [
      "--env-file" "/run/secrets/${app.envSecret}"
    ];
  }) imageApps);
  services.caddy = {
    enable = true;
    virtualHosts = lib.listToAttrs (map (app: lib.nameValuePair app.domain {
      extraConfig = ''
        reverse_proxy 127.0.0.1:${toString app.port}
        ${lib.optionalString (internalDomain app.domain) "tls internal"}
      '';
    }) apps);
  };
  sops.secrets = lib.mkIf (settings.secretsFile != null && secretNames != [ ]) (
    lib.listToAttrs (map (name: lib.nameValuePair name { mode = "0400"; }) secretNames)
  );
}
