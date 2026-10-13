{ config, lib, pkgs, revision ? null, ... }: let
  # self.rev is null on a dirty tree. Callers pass dirtyRev or "unknown".
  rev = if revision == null then "unknown" else revision;
  server = pkgs.writeText "fleet-revision.py" ''
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    rev = open("/etc/self-hosting/revision", encoding="utf-8").read().strip()
    rev = rev.replace("\\", "\\\\").replace('"', '\\"')
    body = f'nixos_configuration_revision_info{{revision="{rev}"}} 1\n'.encode()


    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/metrics":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _fmt, *_args):
            return


    ThreadingHTTPServer(("127.0.0.1", 9101), Handler).serve_forever()
  '';
in {
  system.configurationRevision = lib.mkDefault rev;
  environment.etc."self-hosting/revision".text = config.system.configurationRevision + "\n";
  systemd.services.fleet-revision = {
    description = "Publish the running configuration revision on localhost";
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = "${pkgs.python3}/bin/python3 ${server}";
      DynamicUser = true;
      Restart = "on-failure";
    };
  };
}
