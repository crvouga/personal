# The Cloudflare provider does not implement transfer initiation. This published
# REST provider keeps the documented registrar operation inside OpenTofu.
# All transfers are disabled by default; source-owner access is still required.
variable "domain_auth_codes" {
  type        = map(string)
  sensitive   = true
  default     = {}
  description = "Raw EPP codes supplied securely for initial transfer plans. Never commit or log them."
}

provider "restapi" {
  alias                 = "registrar"
  uri                   = "https://api.cloudflare.com/client/v4/accounts/${var.cloudflare_account_id}/registrar/registrations"
  bearer_token          = var.cloudflare_api_token
  create_returns_object = true
  debug                 = false
  timeout               = 60
  retries { max_retries = 0 }
}

resource "restapi_object" "domain_transfer" {
  provider  = restapi.registrar
  for_each  = { for domain, spec in local.config.domains : domain => spec if try(spec.transfer_enabled, false) }
  object_id = each.key
  path      = "/${each.key}/transfer-in"

  create_method = "POST"
  # Canonical registration reads work during transfer_pending and after active.
  # Never treat workflow completion as a reason to submit another transfer.
  read_method    = "GET"
  read_path      = "/${each.key}"
  update_method  = "GET"
  update_path    = "/${each.key}"
  update_data    = "{}"
  destroy_method = "GET"
  destroy_path   = "/${each.key}"
  destroy_data   = "{}"
  debug          = false

  data = jsonencode({
    auth_code    = base64encode(lookup(var.domain_auth_codes, each.key, ""))
    auto_renew   = true
    privacy_mode = "redaction"
  })
  ignore_all_server_changes = true
  lifecycle {
    prevent_destroy = true
    # EPP codes are one-use inputs, not ongoing desired registration settings.
    # Normal CI need not retain them after the accepted request is in state.
    ignore_changes = [data]
    postcondition {
      condition     = self.create_response == null || self.create_response == "" ? true : try(jsondecode(self.create_response).success == true && jsondecode(self.create_response).result.state != "failed", false)
      error_message = "Cloudflare did not accept the transfer workflow. Preserve state and inspect the read-only status; never blindly retry the billable request."
    }
  }
}
