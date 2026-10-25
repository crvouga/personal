"""Plan additional domains against pinned providers without live mutations."""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="workspace-tofu-aliases-") as directory:
    root = Path(directory)
    source = (ROOT / "fleet/aliases.tf").read_text()
    source = re.sub(r"(?ms)^import \{\n.*?^\}\n", "", source)
    (root / "aliases.tf").write_text(source)
    (root / "service").mkdir()
    (root / "service/main.tf").write_text('output "id" { value = "12345678-1234-4234-8234-123456789014" }\n')
    (root / "main.tf").write_text('''
terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "= 5.26.0" }
    railway = { source = "terraform-community-providers/railway", version = "= 0.6.2" }
  }
}
variable "proxy_alias" { default = false }
locals {
  config = {
    aliases = [{ hostname = "www.application.app", service = "app", zone = "application.app", proxied = var.proxy_alias }]
    domains = { "application.app" = { existing_zone_id = "83db052d18159889dd290724ac7d52d9" } }
  }
  services = { app = { port = 8080 } }
}
module "service" {
  for_each = local.services
  source = "./service"
}
data "terraform_remote_state" "foundation" {
  backend = "local"
  config = { path = "unused.tfstate" }
}
''')
    lock = (ROOT / "fleet/.terraform.lock.hcl").read_text()
    (root / ".terraform.lock.hcl").write_text("\n".join(re.search(
        r'provider "registry.opentofu.org/' + provider + r'" \{[^}]+\}', lock
    ).group() for provider in ["cloudflare/cloudflare", "terraform-community-providers/railway"]))
    shutil.copyfile(ROOT / "tests/aliases.tftest.hcl", root / "aliases.tftest.hcl")
    for args in [("init", "-backend=false", "-input=false", "-lockfile=readonly"), ("test", "-no-color")]:
        result = subprocess.run([shutil.which("tofu"), "-chdir=" + str(root), *args], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stdout[-6000:] + result.stderr[-6000:])
    print(result.stdout.strip())
