"""Recover the absent domain with real providers and no reachable Railway API."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ACTION = ROOT.parents[2] / ".github/actions/tofu/action.yml"
DOMAIN_ID = "22efd584-cecb-4da6-a362-e7a8898edfb7"
step = ACTION.read_text().split("    - name: Recover absent retired domain state\n")[1]
script = step.split("      run: |\n", 1)[1].split("    - name: Plan\n", 1)[0]
script = "\n".join(line[8:] for line in script.splitlines())
lock = (ROOT / "services/.terraform.lock.hcl").read_text()
provider_lock = re.search(
    r'provider "registry.opentofu.org/terraform-community-providers/railway" \{[^}]+\}', lock
).group()


def run(args, cwd, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout[-6000:] + result.stderr[-6000:])
    return result.stdout


def resource(module, kind, name, attributes, provider):
    return {
        **({"module": module} if module else {}),
        "mode": "managed", "type": kind, "name": name, "provider": provider,
        "instances": [{"schema_version": 0, "attributes": attributes}],
    }


with tempfile.TemporaryDirectory(prefix="workspace-domain-recovery-") as directory:
    work = Path(directory)
    root = work / "packages/infra/tofu/services"
    root.mkdir(parents=True)
    shutil.copy(ROOT / "services/retired-application.tf", root / "retired.tf")
    (root / ".terraform.lock.hcl").write_text(provider_lock)
    (root / "main.tf").write_text('''
terraform {
  required_providers {
    railway = { source = "terraform-community-providers/railway", version = "= 0.6.2" }
  }
}
resource "terraform_data" "unrelated" {}
variable "image_tags" { type = map(string) }
module "service" {
  for_each = var.image_tags
  source = "./active-service"
  revision = each.value
}
output "image_tags" { value = var.image_tags }
''')
    active = root / "active-service"
    active.mkdir()
    (active / "main.tf").write_text('''
terraform {
  required_providers {
    railway = { source = "terraform-community-providers/railway", version = "= 0.6.2" }
  }
}
variable "revision" { type = string }
resource "railway_service" "this" {
  name = "active"
  project_id = "00000000-0000-4000-8000-000000000001"
  source_image = "ghcr.io/example/active:${var.revision}"
  regions = [{region = "us-east4", num_replicas = 1}]
}
''')
    run(["tofu", f"-chdir={root}", "init", "-backend=false", "-input=false", "-lockfile=readonly"], work)
    # Initialization can download providers. All recovery operations must work
    # without API access, including plan/apply; no mock provider masks reads.
    env = {**os.environ, "RAILWAY_TOKEN": "fixture-only", "HTTPS_PROXY": "http://127.0.0.1:1",
           "HTTP_PROXY": "http://127.0.0.1:1", "NO_PROXY": "", "no_proxy": "",
           "TF_VAR_image_tags": '{"active":"pending-release"}'}
    for module, include_remaining in [('module.service["fleet-api"]', False), ("module.retired_fleet_api", True)]:
        state = {
            "version": 4, "terraform_version": "1.13.0", "serial": 1,
            "lineage": "domain-recovery-fixture", "outputs": {
                # A partial failed apply can advance outputs before resources.
                "image_tags": {"value": {"active": "pending-release"}, "type": ["map", "string"]}
            }, "resources": [
                resource(module, "railway_custom_domain", "this", {
                    "id": DOMAIN_ID, "domain": "retired.example.com",
                    "service_id": "d9ecafa4-f1f6-4838-a5f3-bbc5125a8d7d",
                    "environment_id": "a431a93f-b1cd-4256-b377-fcac67b19631", "target_port": 8080,
                }, 'provider["registry.opentofu.org/terraform-community-providers/railway"]'),
                resource("", "terraform_data", "unrelated", {
                    "id": "keep-me", "input": None, "output": None, "triggers_replace": None,
                }, 'provider["terraform.io/builtin/terraform"]'),
                resource('module.service["active"]', "railway_service", "this", {
                    "id": "00000000-0000-4000-8000-000000000002", "name": "active",
                    "project_id": "00000000-0000-4000-8000-000000000001",
                    "source_image": "ghcr.io/example/active:deployed",
                    "regions": [{"region": "us-east4", "num_replicas": 1}],
                }, 'provider["registry.opentofu.org/terraform-community-providers/railway"]'),
                *([resource(module, "terraform_data", "remaining", {
                    "id": "still-retire", "input": None, "output": None, "triggers_replace": None,
                }, 'provider["terraform.io/builtin/terraform"]')] if include_remaining else []),
            ],
        }
        if include_remaining:
            wrong = json.loads(json.dumps(state))
            wrong["resources"][0]["instances"][0]["attributes"]["id"] = "unexpected-domain"
            serialized = json.dumps(wrong)
            (root / "terraform.tfstate").write_text(serialized)
            rejected = subprocess.run(["bash", "-c", script], cwd=work, env=env,
                                      capture_output=True, text=True)
            assert rejected.returncode != 0, "An unexpected domain ID must block recovery"
            assert (root / "terraform.tfstate").read_text() == serialized
        (root / "terraform.tfstate").write_text(json.dumps(state))
        run(["bash", "-c", script], work, env)
        remaining = json.loads((root / "terraform.tfstate").read_text())["resources"]
        assert not any(item["type"] == "railway_custom_domain" for item in remaining)
        assert len(remaining) == (3 if include_remaining else 2), "Recovery must preserve all other state entries"
        active_state = next(item for item in remaining if item.get("module") == 'module.service["active"]')
        assert active_state["instances"][0]["attributes"]["source_image"] == "ghcr.io/example/active:deployed"
        assert "already complete" in run(["bash", "-c", script], work, env)
        plan = root / "verify.tfplan"
        run(["tofu", f"-chdir={root}", "plan", "-refresh=false", "-input=false", f"-out={plan}"], work, env)
        changes = json.loads(run(["tofu", f"-chdir={root}", "show", "-json", str(plan)], work, env))["resource_changes"]
        actions = {item["address"]: item["change"]["actions"] for item in changes}
        expected = {"terraform_data.unrelated": ["no-op"], 'module.service["active"].railway_service.this': ["update"]}
        if include_remaining:
            expected["module.retired_fleet_api.terraform_data.remaining"] = ["delete"]
        assert actions == expected, actions
    print("PASS: both legacy addresses recover offline, repeat safely and preserve other retirement/state")
