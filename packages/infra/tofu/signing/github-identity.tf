# GitHub's default subject can include immutable owner/repository IDs. Read its
# actual prefix rather than reconstructing the older name-only format.
data "github_rest_api" "oidc" {
  count    = local.enabled ? 1 : 0
  endpoint = "repos/${local.repository}/actions/oidc/customization/sub"
  lifecycle {
    postcondition {
      condition = try(
        self.code == 200 && jsondecode(self.body).use_default &&
        replace(jsondecode(self.body).sub_claim_prefix, "/@[0-9]+/", "") == "repo:${local.repository}",
        false
      )
      error_message = "Signing requires GitHub's default OIDC subject prefix for this exact repository; custom, missing or mismatched subjects cannot activate trust."
    }
  }
}

locals {
  github_subject_prefix = local.enabled ? try(jsondecode(data.github_rest_api.oidc[0].body).sub_claim_prefix, "") : ""
}
