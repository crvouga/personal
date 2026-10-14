"""Real pinned REST provider against a local registrar double; never a live transfer."""

import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

tofu_root = Path(__file__).resolve().parents[1]
requests = []
registration_status = "transfer_pending"
fail_post = False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, code, result, success=True):
        payload = json.dumps({"success": success, "errors": [], "messages": [], "result": result}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        requests.append(("POST", self.path))
        assert self.path == "/example.dev/transfer-in", self.path
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert base64.b64decode(body["auth_code"]).decode() == "test-owner-code"
        assert body["auto_renew"] and body["privacy_mode"] == "redaction"
        self.respond(500 if fail_post else 202,
                     {"state": "pending", "completed": False, "context": {"domain_name": "example.dev"}},
                     success=not fail_post)

    def do_GET(self):
        requests.append(("GET", self.path))
        assert self.path == "/example.dev", self.path
        self.respond(200, {"domain_name": "example.dev", "status": registration_status})

    def do_DELETE(self):
        raise AssertionError("No DELETE may reach the registrar")

    def do_PUT(self):
        raise AssertionError("Updates must never resubmit a transfer")


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    for error_case in [False, True]:
        fail_post = error_case
        requests.clear()
        with tempfile.TemporaryDirectory(prefix="workspace-tofu-domain-transfer-") as directory:
            root = Path(directory)
            source = (tofu_root / "foundation/domain-transfers.tf").read_text()
            source = re.sub(r'uri\s*= "[^"\n]+"', f'uri = "http://127.0.0.1:{server.server_port}"', source)
            source = source.replace("bearer_token          = var.cloudflare_api_token", 'bearer_token = "test-token"')
            (root / "transfers.tf").write_text(source)
            (root / "main.tf").write_text('''
terraform {
  required_providers { restapi = { source = "Mastercard/restapi", version = "= 3.0.0" } }
}
locals { config = jsondecode(file("${path.module}/fixture.json")) }
''')
            fixture = {"domains": {"example.dev": {"transfer_enabled": True}}}
            (root / "fixture.json").write_text(json.dumps(fixture))
            lock = (tofu_root / "foundation/.terraform.lock.hcl").read_text()
            (root / ".terraform.lock.hcl").write_text(re.search(
                r'provider "registry.opentofu.org/mastercard/restapi" \{[^}]+\}', lock
            ).group())
            env = dict(os.environ, TF_VAR_domain_auth_codes=json.dumps({"example.dev": "test-owner-code"}))

            def run(*args, expected=0):
                result = subprocess.run([shutil.which("tofu"), "-chdir=" + str(root), *args],
                                        env=env, capture_output=True, text=True)
                if result.returncode != expected:
                    raise RuntimeError(result.stdout[-5000:] + result.stderr[-5000:])
                return result

            run("init", "-backend=false", "-input=false", "-lockfile=readonly")
            run("plan", "-input=false", "-out=reviewed.tfplan")
            # The saved fixture plan is constrained to the local API double.
            reviewed = json.loads(run("show", "-json", "reviewed.tfplan").stdout)
            assert [r["address"] for r in reviewed["resource_changes"]] == ['restapi_object.domain_transfer["example.dev"]']
            run("apply", "-input=false", "reviewed.tfplan", expected=1 if error_case else 0)
            assert len([r for r in requests if r[0] == "POST"]) == 1, requests
            if error_case:
                continue
            run("plan", "-input=false", "-detailed-exitcode")  # Pending is stable.
            registration_status = "active"
            run("plan", "-input=false", "-detailed-exitcode")  # Completion does not replay.
            env["TF_VAR_domain_auth_codes"] = "{}"
            run("plan", "-input=false", "-detailed-exitcode")  # CI can discard the one-use input.
            assert len([r for r in requests if r[0] == "POST"]) == 1, requests
            fixture["domains"]["example.dev"]["transfer_enabled"] = False
            (root / "fixture.json").write_text(json.dumps(fixture))
            rejected = run("plan", "-input=false", expected=1)
            assert "prevent_destroy" in rejected.stderr + rejected.stdout
    print("PASS: registrar 202 accepted once; pending/complete/no-code plans stable; deletes blocked; failed POST never retried")
finally:
    server.shutdown()
