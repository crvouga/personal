"""Verify foundation controls converge with the real pinned providers and local APIs."""

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
inventory = json.loads((tofu_root / "modules/inventory/inventory.tf.json").read_text())["locals"]["inventory"]
repository = inventory["github"]["infra_repo"]
repository_name = repository.split("/")[1]
project_id = "00000000-0000-4000-8000-000000000001"
environment_id = "00000000-0000-4000-8000-000000000002"
clearance = {"enabled": True}
railway_writes = []
github_writes = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, body, status=200):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if "/orgs/" in path:
            return self.reply({"message": "Not Found"}, 404)
        if "/users/" in path:
            return self.reply({"login": "crvouga", "id": 1, "type": "User"})
        if path.endswith("/vulnerability-alerts"):
            self.send_response(204)
            self.end_headers()
            return
        if path.endswith("/repos/" + repository):
            settings = inventory["github"]["pr_ready"]["repo_settings"]
            return self.reply({**settings, "id": 123, "name": repository_name, "full_name": repository,
                               "owner": {"login": "crvouga", "id": 1, "type": "User"},
                               "private": False, "permissions": {"admin": True}, "has_pages": False,
                               "squash_merge_commit_message": "COMMIT_MESSAGES",
                               "squash_merge_commit_title": "COMMIT_OR_PR_TITLE"})
        raise AssertionError("Unexpected GitHub read: " + path)

    def do_POST(self):
        if self.path != "/graphql":
            return self.reject_github_write()
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        query, variables = request["query"], request["variables"]
        assert variables["environmentId"] == environment_id
        if query.strip().startswith("mutation"):
            assert variables["projectId"] == project_id
            assert "enabled: false" in query
            railway_writes.append(variables)
            clearance["enabled"] = False
            return self.reply({"data": {"environmentClearanceDefaultUpdate": True}})
        environment = {"id": environment_id, "clearanceDefault": clearance["enabled"]}
        # The old query omitted this value, causing the provider to erase the
        # projectId mutation input on every refresh and propose another update.
        if "projectId" in query:
            environment["projectId"] = project_id
        return self.reply({"data": {"environment": environment}})

    def reject_github_write(self):
        github_writes.append((self.command, self.path))
        self.send_error(403, "GitHub writes forbidden in this convergence test")

    def do_PATCH(self):
        assert self.path.endswith("/repos/" + repository)
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        security = payload.get("security_and_analysis")
        if security:
            assert "secret_scanning_non_provider_patterns" not in security
            assert security["secret_scanning"]["status"] == "enabled"
            assert security["secret_scanning_push_protection"]["status"] == "enabled"
        github_writes.append(payload)
        self.do_GET()

    do_PUT = do_DELETE = reject_github_write


def run(root, *args, expected=0):
    result = subprocess.run([shutil.which("tofu"), "-chdir=" + str(root), *args],
                            env=os.environ, capture_output=True, text=True)
    if result.returncode != expected:
        raise RuntimeError(result.stdout[-5000:] + result.stderr[-5000:])
    return result.stdout


def provider_lock(root, provider):
    lock = (tofu_root / "foundation/.terraform.lock.hcl").read_text()
    (root / ".terraform.lock.hcl").write_text(re.search(
        r'provider "registry.opentofu.org/' + provider + r'" \{[^}]+\}', lock).group())


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix="foundation-controls-") as directory:
        railway_root = Path(directory) / "railway"
        railway_root.mkdir()
        source = (tofu_root / "foundation/railway-settings.tf").read_text()
        locals_block = re.search(r'(?ms)^locals \{\n  railway_clearance_mutation.*?^\}', source).group()
        resource = re.search(r'(?ms)^resource "graphql_mutation" "railway_environment_clearance" \{.*?^\}', source).group()
        resource = resource.replace("railway_project.workspace.default_environment.id", "var.environment_id")
        resource = resource.replace("railway_project.workspace.id", "var.project_id")
        config = f'''
terraform {{
  required_providers {{ graphql = {{ source = "sullivtr/graphql", version = "= 2.6.2" }} }}
}}
provider "graphql" {{ url = "http://127.0.0.1:{server.server_port}/graphql" }}
variable "project_id" {{ default = "{project_id}" }}
variable "environment_id" {{ default = "{environment_id}" }}
''' + locals_block + "\n"
        legacy_resource = resource.replace("        projectId\n", "")
        (railway_root / "main.tf").write_text(config + legacy_resource)
        provider_lock(railway_root, "sullivtr/graphql")
        run(railway_root, "init", "-input=false", "-lockfile=readonly")
        run(railway_root, "plan", "-input=false", "-out=reviewed.tfplan")
        run(railway_root, "apply", "-input=false", "reviewed.tfplan")
        assert clearance["enabled"] is False
        run(railway_root, "plan", "-input=false", "-detailed-exitcode", expected=2)
        (railway_root / "main.tf").write_text(config + resource)
        run(railway_root, "plan", "-input=false", "-out=correction.tfplan")
        run(railway_root, "apply", "-input=false", "correction.tfplan")
        for _ in range(2):
            run(railway_root, "plan", "-input=false", "-detailed-exitcode")
        assert len(railway_writes) == 2, railway_writes
        print("PASS: repair existing clearance project-ID drift; stable repeated refreshes after correction")

        github_root = Path(directory) / "github"
        github_root.mkdir()
        source = (tofu_root / "foundation/repository.tf").read_text()
        resource = re.search(r'(?ms)^resource "github_repository" "workspace" \{.*?^\}', source).group()
        (github_root / "main.tf").write_text(f'''
terraform {{
  required_providers {{ github = {{ source = "integrations/github", version = "= 6.13.0" }} }}
}}
provider "github" {{
  owner = "crvouga"
  token = "test-github-token"
  base_url = "http://127.0.0.1:{server.server_port}/"
}}
module "inventory" {{ source = {json.dumps(str(tofu_root / "modules/inventory"))} }}
locals {{
  config = module.inventory.config
  merge_gate = local.config.github.pr_ready
}}
import {{
  to = github_repository.workspace
  id = "{repository_name}"
}}
''' + resource)
        provider_lock(github_root, "integrations/github")
        run(github_root, "init", "-input=false", "-lockfile=readonly")
        run(github_root, "plan", "-input=false", "-out=reviewed.tfplan")
        plan = json.loads(run(github_root, "show", "-json", "reviewed.tfplan"))
        for row in plan["resource_changes"]:
            assert row["change"]["actions"] in [["no-op"], ["update"]]
            changed = {key for key, value in row["change"]["after"].items()
                       if row["change"]["before"].get(key) != value}
            # The legacy provider fills this local default on the first import.
            assert changed <= {"ignore_vulnerability_alerts_during_read"}, changed
        run(github_root, "apply", "-input=false", "reviewed.tfplan")
        initial_writes = len(github_writes)
        for _ in range(2):
            run(github_root, "plan", "-input=false", "-detailed-exitcode")
        assert len(github_writes) == initial_writes
        print("PASS: foundation GitHub security settings converge without unsupported-field drift; no recurring API mutations")
finally:
    server.shutdown()
