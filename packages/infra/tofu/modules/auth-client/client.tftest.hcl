mock_provider "keycloak" {}
variables {
  realm_id      = "projects-dev"
  client_id     = "project-a-local"
  enabled       = true
  redirect_uris = ["http://localhost:3000/callback", "http://127.0.0.1:5173/callback"]
}
run "exact_web_clients" {
  command = plan
  assert {
    condition     = keycloak_openid_client.this.pkce_code_challenge_method == "S256" && keycloak_openid_client.this.standard_flow_enabled && !keycloak_openid_client.this.implicit_flow_enabled && !keycloak_openid_client.this.direct_access_grants_enabled
    error_message = "All web clients must use code and S256 PKCE."
  }
  assert {
    condition     = toset(keycloak_openid_client.this.web_origins) == toset(["http://localhost:3000", "http://127.0.0.1:5173"])
    error_message = "CORS must include only exact registered origins."
  }
}
run "unrelated_domains" {
  command = plan
  variables { redirect_uris = ["https://project-a.com/callback", "https://project-b.io/callback"] }
}
run "wildcard_rejected" {
  command = plan
  variables { redirect_uris = ["http://localhost:3000/*"] }
  expect_failures = [var.redirect_uris]
}
run "loopback_port_required" {
  command = plan
  variables { redirect_uris = ["http://localhost/callback"] }
  expect_failures = [var.redirect_uris]
}
run "lookalike_loopback_rejected" {
  command = plan
  variables { redirect_uris = ["http://127x0x0x1:3000/callback"] }
  expect_failures = [var.redirect_uris]
}
run "fragment_rejected" {
  command = plan
  variables { redirect_uris = ["https://project-a.com/callback#fragment"] }
  expect_failures = [var.redirect_uris]
}
