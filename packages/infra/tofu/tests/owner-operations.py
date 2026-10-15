"""Pinned owner REST provider on loopback only; no browser or registrar access."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

source = Path(__file__).resolve().parents[1] / "owner"
operation = {"action": "unlock", "domain": "example.dev", "nameservers": []}
identity = hashlib.sha256(json.dumps(operation, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
payload = dict(operation, id=identity)
calls = []
accepted = None
reject = False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())

    def do_GET(self):
        calls.append(("GET", self.path))
        assert self.path == "/operations/" + identity, self.path
        self.reply(200 if accepted else 404, accepted or {})

    def do_POST(self):
        global accepted
        calls.append(("POST", self.path))
        assert self.path == "/operations", self.path
        assert self.headers.get("Authorization") == "Bearer owner-fixture-token"
        assert json.loads(self.rfile.read(int(self.headers["Content-Length"]))) == payload
        accepted = dict(payload, status="accepted", recordedAt="2026-10-15T00:00:00Z")
        self.reply(409 if reject else 200, accepted)

    def do_DELETE(self):
        raise AssertionError("Owner operations may never send DELETE")


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    for rejected in [False, True]:
        reject = rejected
        accepted = None
        calls.clear()
        with tempfile.TemporaryDirectory(prefix="owner-provider-") as directory:
            root = Path(directory)
            for name in ["versions.tf", "main.tf", ".terraform.lock.hcl"]:
                text = (source / name).read_text().replace('source = "../modules/inventory"', 'source = "./inventory"')
                (root / name).write_text(text)
            (root / "inventory").mkdir()
            (root / "inventory/main.tf.json").write_text(json.dumps({"output": {"config": {"value": {"domains": {
                "example.dev": {"availability": "critical", "dns_migration": "preserve"}
            }}}}}))
            env = dict(os.environ, TF_VAR_state_passphrase="owner-provider-validation-only-passphrase-32-characters",
                       TF_VAR_owner_bridge_url=f"http://127.0.0.1:{server.server_port}",
                       TF_VAR_owner_bridge_token="owner-fixture-token", TF_VAR_owner_operation=json.dumps(operation),
                       API_DATA_IS_SENSITIVE="true")

            def run(*args, expected=0):
                result = subprocess.run([shutil.which("tofu"), "-chdir=" + str(root), *args], env=env,
                                        capture_output=True, text=True, timeout=120)
                if result.returncode != expected:
                    raise RuntimeError(result.stdout[-5000:] + result.stderr[-5000:])
                return result

            run("init", "-input=false", "-lockfile=readonly")
            run("plan", "-input=false", "-out=owner.tfplan")
            reviewed = json.loads(run("show", "-json", "owner.tfplan").stdout)
            changes = reviewed["resource_changes"]
            assert len(changes) == 1 and changes[0]["address"] == "restapi_object.squarespace_owner_operation[0]"
            assert json.loads(changes[0]["change"]["after"]["data"]) == payload
            assert not calls, "Plan must not POST an owner operation"
            assert not (root / "owner.tfplan").read_bytes().startswith(b"PK"), "Saved plan must be encrypted"
            run("apply", "-input=false", "owner.tfplan", expected=1 if reject else 0)
            assert sum(method == "POST" for method, _ in calls) == 1, calls
            if reject:
                continue
            state = (root / "terraform.tfstate").read_text()
            assert "owner-fixture-token" not in state and identity not in state, "State must be encrypted"
            run("plan", "-input=false", "-detailed-exitcode")
            assert sum(method == "POST" for method, _ in calls) == 1, calls
            env["TF_VAR_owner_operation"] = json.dumps(dict(operation, action="disable-dnssec"))
            refusal = run("plan", "-input=false", expected=1)
            assert "explicitly retired unused" in refusal.stdout + refusal.stderr
    print("PASS: owner plans read-only; exact payload; encrypted state/plans; accepted once; errors not retried; critical DNS rejected")
finally:
    server.shutdown()
