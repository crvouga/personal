{ config, lib, pkgs, revision ? null, ... }: let
  # self.rev is null on a dirty tree. Callers pass dirtyRev or "unknown".
  rev = if revision == null then "unknown" else revision;
  server = pkgs.writeText "fleet-revision.py" ''
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    def esc(value):
        return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "")

    def node():
        data = {"hostname": "unknown", "role": "unknown", "capabilities": ""}
        try:
            handle = open("/run/fleet/node", encoding="utf-8")
        except OSError:
            return data
        with handle:
            for line in handle:
                if "=" not in line:
                    continue
                key, value = line.strip().split("=", 1)
                if key in data:
                    data[key] = value
        return data

    def body():
        try:
            rev = open("/etc/fleet/revision", encoding="utf-8").read().strip()
        except OSError:
            rev = "unknown"
        info = node()
        rev_e = esc(rev)
        lines = [
            'nixos_configuration_revision_info{revision="%s"} 1' % rev_e,
            'nixos_node_info{hostname="%s",role="%s",capabilities="%s",revision="%s"} 1' % (
                esc(info["hostname"]), esc(info["role"]), esc(info["capabilities"]), rev_e,
            ),
        ]
        return ("\n".join(lines) + "\n").encode()


    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/metrics":
                self.send_error(404)
                return
            payload = body()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, _fmt, *_args):
            return


    ThreadingHTTPServer(("127.0.0.1", 9101), Handler).serve_forever()
  '';
in {
  system.configurationRevision = lib.mkDefault rev;
  environment.etc."fleet/revision".text = config.system.configurationRevision + "\n";
  systemd.services.fleet-revision = {
    description = "Publish the running configuration revision on localhost";
    wantedBy = [ "multi-user.target" ];
    after = [ "node-identity.service" ];
    wants = [ "node-identity.service" ];
    serviceConfig = {
      ExecStart = "${pkgs.python3}/bin/python3 ${server}";
      DynamicUser = true;
      Restart = "on-failure";
    };
  };
}
