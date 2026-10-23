"""Prove the publisher handoff forgets the file and preserves the live ruleset."""

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
inventory = json.loads((tofu_root / "modules/inventory/inventory.tf.json").read_text())["locals"]["inventory"]
settings = inventory["github"]["repositories"]["mockingbird"]
writes = []
commit = {"sha": "b" * 40, "commit": {"message": "original publisher", "committer": {"name": "GitHub", "email": "noreply@github.com"}},
          "files": [{"filename": ".github/workflows/publish.yml", "status": "added"}]}
ruleset = {
    "id": 23647164, "name": "Protect main", "target": "branch", "enforcement": "active",
    "bypass_actors": [], "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
    "rules": [
        {"type": "deletion"}, {"type": "non_fast_forward"},
        {"type": "pull_request", "parameters": {
            "allowed_merge_methods": ["merge"], "dismiss_stale_reviews_on_push": False,
            "require_code_owner_review": False, "require_last_push_approval": False,
            "required_approving_review_count": 0, "required_review_thread_resolution": False}},
        {"type": "required_status_checks", "parameters": {
            "strict_required_status_checks_policy": True,
            "required_status_checks": [{"context": name, "integration_id": integration} for name, integration in
                                       [("Commitlint", 15368), ("Check", 15368), ("GitGuardian Security Checks", 46505)]]}},
    ],
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split("?", 1)[0].removeprefix("/api/v3")
        if path == "/orgs/crvouga":
            body, status = {"message": "Not Found"}, 404
        elif path == "/users/crvouga":
            body, status = {"login": "crvouga", "id": 1, "type": "User"}, 200
        elif path == "/repos/crvouga/mockingbird":
            body, status = {"id": 123, "name": "mockingbird", "default_branch": "main"}, 200
        elif path == "/repos/crvouga/mockingbird/rulesets/23647164":
            body, status = ruleset, 200
        elif path == "/repos/crvouga/mockingbird/contents/.github/workflows/publish.yml":
            body, status = {"type": "file", "name": "publish.yml", "path": ".github/workflows/publish.yml",
                            "sha": "a" * 40, "encoding": "base64",
                            "url": f"http://127.0.0.1:{self.server.server_port}{path}?ref=main",
                            "content": base64.b64encode(b"original publisher\n").decode()}, 200
        elif path == "/repos/crvouga/mockingbird/commits":
            body, status = [commit], 200
        elif path == "/repos/crvouga/mockingbird/commits/" + commit["sha"]:
            body, status = commit, 200
        else:
            raise AssertionError("Unexpected read: " + path)
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def reject(self):
        writes.append((self.command, self.path))
        self.send_error(403, "Protected repository writes forbidden")

    do_POST = do_PUT = do_PATCH = do_DELETE = reject


def run(root, *args):
    result = subprocess.run([shutil.which("tofu"), "-chdir=" + str(root), *args],
                            env=os.environ, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout[-6000:] + result.stderr[-6000:])
    return result.stdout


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix="publisher-handoff-") as directory:
        root = Path(directory)
        source = (tofu_root / "foundation/repository.tf").read_text()
        resource = re.search(r'(?ms)^resource "github_repository_ruleset" "application_default_branch" \{.*?^\}', source).group()
        resource = resource.replace("github_repository.application[each.key].name", "each.key")
        config = f'''terraform {{
  required_providers {{ github = {{ source = "integrations/github", version = "= 6.13.0" }} }}
}}
provider "github" {{
  owner = "crvouga"
  token = "test-token"
  base_url = "http://127.0.0.1:{server.server_port}/"
}}
locals {{ application_repositories = jsondecode({json.dumps(json.dumps({"mockingbird": settings}))}) }}
'''
        publisher = '''resource "github_repository_file" "publish" {
  for_each = { mockingbird = true }
  repository = each.key
  branch = "main"
  file = ".github/workflows/publish.yml"
  content = "original publisher\\n"
}
'''
        singleton = resource.replace('"application_default_branch"', '"mockingbird_main"')
        singleton = re.sub(r'(?m)^  for_each.*$', '', singleton)
        singleton = singleton.replace('each.key', '"mockingbird"').replace('each.value', 'local.application_repositories.mockingbird')
        (root / "main.tf").write_text(config + singleton + "\n" + publisher)
        lock = (tofu_root / "foundation/.terraform.lock.hcl").read_text()
        (root / ".terraform.lock.hcl").write_text(re.search(r'provider "registry.opentofu.org/integrations/github" \{[^}]+\}', lock).group())
        run(root, "init", "-input=false", "-lockfile=readonly")
        run(root, "import", "-input=false", 'github_repository_file.publish["mockingbird"]', "mockingbird:.github/workflows/publish.yml:main")
        run(root, "import", "-input=false", "github_repository_ruleset.mockingbird_main", "mockingbird:23647164")
        move = re.search(r'(?ms)^moved \{\n  from = github_repository_ruleset.mockingbird_main.*?^\}', source).group()
        retired = (tofu_root / "foundation/retired.tf").read_text()
        handoff = retired[retired.index('moved {\n  from = github_repository_file.publish["mockingbird"]'):]
        (root / "main.tf").write_text(config + resource + "\n" + publisher.replace('{ mockingbird = true }', '{}') + move + "\n" + handoff)
        # Include the production import configuration: a stale import can point
        # at the publisher being handed off even when moved/removed are correct.
        imports = json.loads((tofu_root / "foundation/imports.tf.json").read_text())["import"]
        (root / "imports.tf.json").write_text(json.dumps({"import": [
            entry for entry in imports if entry["to"] == 'github_repository_file.publish["mockingbird"]'
        ]}))
        run(root, "plan", "-input=false", "-out=handoff.tfplan")
        plan = json.loads(run(root, "show", "-json", "handoff.tfplan"))
        changes = {row["address"]: row for row in plan["resource_changes"]}
        rule = changes['github_repository_ruleset.application_default_branch["mockingbird"]']
        assert rule["previous_address"] == "github_repository_ruleset.mockingbird_main"
        assert rule["change"]["actions"] == ["no-op"], rule
        file = changes['github_repository_file.application_owned_publishers["mockingbird"]']
        assert file["change"]["actions"] == ["forget"], file
        run(root, "apply", "-input=false", "handoff.tfplan")
        run(root, "plan", "-input=false", "-detailed-exitcode")
        assert writes == [], writes
        print("PASS: publisher handoff forgets the live file, moves the ruleset unchanged, and issues zero API writes")
finally:
    server.shutdown()
