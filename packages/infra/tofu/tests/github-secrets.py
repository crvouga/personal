"""Verify opaque secret adoption against the pinned GitHub provider, without writes."""

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
repositories = json.loads((tofu_root / "modules/inventory/inventory.tf.json").read_text())["locals"]["inventory"]["github"]["repositories"]
declared_secrets = {(repo, name) for repo, settings in repositories.items()
                    for name in settings.get("actions_secrets", [])}
secret_names = {name for _, name in declared_secrets}
missing = set()
mutations = []
timestamp = "2026-10-01T00:00:00Z"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        parts = self.path.split("?", 1)[0].strip("/").split("/")
        if "repos" in parts:
            parts = parts[parts.index("repos"):]
        elif "orgs" in parts:
            parts = parts[parts.index("orgs"):]
        elif "users" in parts:
            parts = parts[parts.index("users"):]
        status = 200
        if parts[0] == "orgs":
            status, body = 404, {"message": "Not Found"}
        elif parts[0] == "users":
            body = {"login": "crvouga", "id": 1, "type": "User"}
        elif len(parts) == 3 and parts[0] == "repos":
            name = parts[2]
            body = {"id": 123, "name": name, "full_name": "crvouga/" + name,
                    "owner": {"login": "crvouga", "id": 1}}
        elif len(parts) == 5 and parts[3:] == ["actions", "secrets"]:
            names = secret_names - {name for repo, name in missing if repo == parts[2]}
            body = {"total_count": len(names), "secrets": [
                {"name": name, "created_at": timestamp, "updated_at": timestamp}
                for name in sorted(names)]}
        elif len(parts) == 6 and parts[3:5] == ["actions", "secrets"]:
            name = parts[5]
            if (parts[2], name) in missing:
                status, body = 404, {"message": "Not Found"}
            else:
                body = {"name": name, "created_at": timestamp, "updated_at": timestamp}
        else:
            raise AssertionError("Unexpected GitHub read: " + self.path)
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def reject_mutation(self):
        mutations.append((self.command, self.path))
        self.send_error(403, "Secret writes are forbidden in this test")

    do_POST = do_PUT = do_PATCH = do_DELETE = reject_mutation


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix="workspace-tofu-github-secrets-") as directory:
        root = Path(directory)
        source = (tofu_root / "foundation/repository.tf").read_text()
        initial_locals = source[:source.index('data "github_actions_secrets"')]
        block_patterns = [
            r'(?ms)^data "github_actions_secrets" "repository" \{.*?^\}',
            r'(?ms)^locals \{\n  existing_repository_secrets.*?^\}',
            r'(?ms)^resource "github_actions_secret" "repository" \{.*?^\}',
            r'(?ms)^import \{\n  for_each = local.existing_repository_secrets.*?^\}',
            r'(?ms)^output "unavailable_repository_secrets" \{.*?^\}',
        ]
        blocks = "\n".join(re.search(pattern, source).group() for pattern in block_patterns)
        config = f'''
terraform {{
  required_providers {{ github = {{ source = "integrations/github", version = "= 6.13.0" }} }}
}}
provider "github" {{
  owner = "crvouga"
  token = "test-github-token"
  base_url = "http://127.0.0.1:{server.server_port}/"
}}
module "inventory" {{ source = {json.dumps(str(tofu_root / "modules/inventory"))} }}
locals {{ config = module.inventory.config }}
'''
        (root / "main.tf").write_text(config + initial_locals + blocks)
        lock = (tofu_root / "foundation/.terraform.lock.hcl").read_text()
        (root / ".terraform.lock.hcl").write_text(re.search(
            r'provider "registry.opentofu.org/integrations/github" \{[^}]+\}', lock
        ).group())

        def run(*args, expected=0):
            result = subprocess.run(
                [shutil.which("tofu"), "-chdir=" + str(root), *args],
                env=os.environ, capture_output=True, text=True,
            )
            if result.returncode != expected:
                raise RuntimeError(result.stdout[-4000:] + result.stderr[-4000:])
            assert not mutations, mutations
            return result.stdout

        def plan():
            run("plan", "-input=false", "-parallelism=1", "-out=adopt.tfplan")
            data = json.loads(run("show", "-json", "adopt.tfplan"))
            assert len(data.get("resource_changes", [])) == len(declared_secrets - missing)
            assert all(change["change"]["actions"] == ["no-op"]
                       for change in data.get("resource_changes", [])), data

        run("init", "-input=false", "-lockfile=readonly")
        plan()
        run("apply", "-input=false", "-parallelism=1", "adopt.tfplan")
        run("plan", "-input=false", "-detailed-exitcode")
        timestamp = "2026-10-05T00:00:00Z"
        run("plan", "-input=false", "-detailed-exitcode")
        missing.add(("mockingbird", "PADDLE_API_KEY"))
        plan()
        run("apply", "-input=false", "-parallelism=1", "adopt.tfplan")
        run("plan", "-input=false", "-detailed-exitcode")
        print("PASS: adopt GitHub-only secrets, preserve rotations, skip missing secret, stable plans; zero API mutations")
finally:
    server.shutdown()
