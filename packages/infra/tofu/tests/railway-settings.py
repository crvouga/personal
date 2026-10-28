"""Exercise GraphQL provider reads and drift repair without a Railway account."""

import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

tofu_root = Path(__file__).resolve().parents[1]
service_id = "00000000-0000-4000-8000-000000000001"
environment_id = "00000000-0000-4000-8000-000000000002"
state = {"serviceId": service_id, "environmentId": environment_id}
writes = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        variables = request["variables"]
        assert variables["serviceId"] == service_id
        assert variables["environmentId"] == environment_id
        if "mutation Settings" in request["query"]:
            assert isinstance(variables["sleepApplication"], bool)
            state.update(variables)
            writes.append(dict(variables))
            result = {"serviceInstanceUpdate": True}
        else:
            result = {"serviceInstance": dict(state)}
        body = json.dumps({"data": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix="workspace-tofu-settings-") as directory:
        root = Path(directory)
        source = (tofu_root / "modules/railway-service/main.tf").read_text()
        start = source.index("locals {")
        end = source.index('resource "railway_variable_collection"')
        settings = source[start:end].replace("railway_service.this.id", "var.service_id")
        (root / "main.tf").write_text(settings + """
terraform {
  required_providers {
    graphql = { source = "sullivtr/graphql", version = "= 2.6.2" }
  }
}
variable "service_id" { type = string }
variable "environment_id" { type = string }
variable "service" { type = any }
provider "graphql" { url = "http://127.0.0.1:PORT/graphql" }
""".replace("PORT", str(server.server_port)))
        lock = (tofu_root / "services/.terraform.lock.hcl").read_text()
        (root / ".terraform.lock.hcl").write_text(re.search(
            r'provider "registry.opentofu.org/sullivtr/graphql" \{[^}]+\}', lock
        ).group())
        (root / "inputs.auto.tfvars.json").write_text(json.dumps({
            "service_id": service_id,
            "environment_id": environment_id,
            "service": {"railway": {
                "health_path": "/health", "sleep": False, "start_command": "bun start",
                "draining_seconds": 60, "health_timeout_seconds": 180
            }},
        }))

        def run(*args, expected=0):
            result = subprocess.run(
                [shutil.which("tofu"), "-chdir=" + str(root), *args],
                env=os.environ, capture_output=True, text=True,
            )
            if result.returncode != expected:
                raise RuntimeError(result.stdout[-4000:] + result.stderr[-4000:])

        run("init", "-input=false", "-lockfile=readonly")
        run("apply", "-auto-approve", "-input=false")
        assert len(writes) == 1
        run("plan", "-detailed-exitcode", "-input=false")
        state.update({"healthcheckPath": "/wrong", "sleepApplication": True,
                      "startCommand": "wrong command", "drainingSeconds": 0, "healthcheckTimeout": 1})
        run("plan", "-detailed-exitcode", "-input=false", expected=2)
        run("apply", "-auto-approve", "-input=false")
        assert state["healthcheckPath"] == "/health"
        assert state["sleepApplication"] is False
        assert state["startCommand"] == "bun start"
        assert state["drainingSeconds"] == 60
        assert state["healthcheckTimeout"] == 180
        assert len(writes) == 2
        run("plan", "-detailed-exitcode", "-input=false")
        inputs = json.loads((root / "inputs.auto.tfvars.json").read_text())
        inputs["service"]["railway"].pop("start_command")
        inputs["service"]["railway"].pop("draining_seconds")
        inputs["service"]["railway"].pop("health_timeout_seconds")
        (root / "inputs.auto.tfvars.json").write_text(json.dumps(inputs))
        run("apply", "-auto-approve", "-input=false")
        assert state["startCommand"] is None
        assert state["drainingSeconds"] is None
        assert state["healthcheckTimeout"] is None
        run("plan", "-detailed-exitcode", "-input=false")
        print("PASS: Railway settings apply, stable plan, detect drift, repair, clear command, stable plan")
finally:
    server.shutdown()
