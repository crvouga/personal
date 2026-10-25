mock_provider "railway" {
  mock_resource "railway_custom_domain" {
    defaults = {
      dns_record_value          = "service.up.railway.app"
      verification_host_label   = "_railway-verify.www.application.app"
      verification_record_value = "verification-value"
    }
  }
}
mock_provider "cloudflare" {}
override_data {
  target = data.terraform_remote_state.foundation
  values = { outputs = { environment_id = "12345678-1234-4234-8234-123456789013" } }
}

run "additional_domain" {
  command = plan
  assert {
    condition     = railway_custom_domain.alias["www.application.app"].service_id == module.service["app"].id && railway_custom_domain.alias["www.application.app"].target_port == 8080
    error_message = "An alias must attach to the existing service and port."
  }
  assert {
    condition     = cloudflare_dns_record.alias["www.application.app"].zone_id == "83db052d18159889dd290724ac7d52d9" && cloudflare_dns_record.alias["www.application.app"].type == "CNAME" && !cloudflare_dns_record.alias["www.application.app"].proxied
    error_message = "Additional domains must route directly to Railway in their own zone."
  }
}
