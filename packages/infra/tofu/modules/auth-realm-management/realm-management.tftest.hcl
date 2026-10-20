mock_provider "http" {}

variables {
  realm_id = "projects"
  admin = {
    url                  = "https://auth-admin.example.dev"
    username             = "placeholder-user"
    password             = "placeholder value &=+"
    access_client_id     = "access-id"
    access_client_secret = "access-secret"
  }
}

override_data {
  target = data.http.admin_token
  values = {
    status_code   = 200
    response_body = "{\"access_token\":\"token\"}"
  }
}
override_data {
  target = data.http.realm_management
  values = {
    status_code   = 200
    response_body = "[{\"id\":\"0f0f0f0f-0000-4000-8000-000000000001\",\"clientId\":\"realm-management\"}]"
  }
}

run "returns_the_realm_management_client_id" {
  command = apply
  assert {
    condition     = output.id == "0f0f0f0f-0000-4000-8000-000000000001"
    error_message = "The module must return the realm-management client's internal id."
  }
}

run "form_encodes_the_admin_password" {
  command = apply
  assert {
    condition     = strcontains(data.http.admin_token.request_body, "password=placeholder+value+%26%3D%2B") && strcontains(data.http.admin_token.request_body, "client_id=admin-cli")
    error_message = "The admin password must be form encoded in the token request."
  }
}
