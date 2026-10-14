"""Exercise multi-zone/structured-record/redirect plans with the pinned real schema.

No provider network or resource mutation: all resource responses are mocked.
"""

import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

tofu_root = Path(__file__).resolve().parents[1]
policy = {
    "availability": "best-effort", "manage_zone": True, "records": {},
    "dnssec_status": "disabled", "manage_registration": True,
    "settle_seconds": 172800, "web_usage": "none", "https": [],
    "forwarding_enabled": True,
    "forwarding": [{"hostname": "unused.example", "target": "http://destination.example",
                    "status": 301, "preserve_path": True, "preserve_query": False}],
}
base = {"name": "unused.example", "ttl": 3600, "proxied": False}
policy["records"] = {
    "a": dict(base, type="A", content="192.0.2.1"),
    "mx1": dict(base, type="MX", content="mx1.example.net", priority=10),
    "mx2": dict(base, type="MX", content="mx2.example.net", priority=20),
    "caa": dict(base, type="CAA", data={"flags": 0, "tag": "issue", "value": "letsencrypt.org"}),
    "srv": dict(base, name="_sip._tcp.unused.example", type="SRV",
                data={"priority": 10, "weight": 5, "port": 5060, "target": "sip.example.net"}),
}
with tempfile.TemporaryDirectory(prefix="workspace-tofu-domains-") as directory:
    root = Path(directory)
    source = (tofu_root / "foundation/domains.tf").read_text()
    source = re.sub(r"(?ms)^import \{\n.*?^\}\n", "", source)
    (root / "domains.tf").write_text(source)
    (root / "fixture.json").write_text(json.dumps({"zone": "critical.example", "domains": {"unused.example": policy}}))
    (root / "main.tf").write_text('''
terraform {
  required_providers { cloudflare = { source = "cloudflare/cloudflare", version = "= 5.26.0" } }
}
variable "cloudflare_account_id" { default = "83db052d18159889dd290724ac7d52d9" }
locals { config = jsondecode(file("${path.module}/fixture.json")) }
resource "cloudflare_zone" "primary" {
  account = { id = var.cloudflare_account_id }
  name = local.config.zone
  type = "full"
}
''')
    lock = (tofu_root / "foundation/.terraform.lock.hcl").read_text()
    (root / ".terraform.lock.hcl").write_text(re.search(
        r'provider "registry.opentofu.org/cloudflare/cloudflare" \{[^}]+\}', lock
    ).group())
    shutil.copyfile(tofu_root / "tests/domains.tftest.hcl", root / "domains.tftest.hcl")
    for args in [("init", "-backend=false", "-input=false", "-lockfile=readonly"), ("test", "-no-color")]:
        result = subprocess.run([shutil.which("tofu"), "-chdir=" + str(root), *args],
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stdout[-6000:] + result.stderr[-6000:])
    print(result.stdout.strip())
