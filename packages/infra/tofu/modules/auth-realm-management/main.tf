terraform {
  required_providers {
    http = { source = "hashicorp/http", version = "= 3.5.0" }
  }
}

variable "admin" {
  type = object({
    url                  = string
    username             = string
    password             = string
    access_client_id     = string
    access_client_secret = string
  })
  sensitive = true
}
variable "realm_id" { type = string }

# Keycloak 26.8 treats realm-management as an internal client whose secret cannot
# be read (403), and the provider's client data source always reads the secret.
# Look up only its identifier with the admin API, using a token fetched in the
# same read so it cannot expire between the two requests. Callers must declare
# depends_on for the realm so both reads happen at apply, after it exists.
data "http" "admin_token" {
  url    = "${var.admin.url}/realms/master/protocol/openid-connect/token"
  method = "POST"
  request_headers = {
    "Content-Type"            = "application/x-www-form-urlencoded"
    "CF-Access-Client-Id"     = var.admin.access_client_id
    "CF-Access-Client-Secret" = var.admin.access_client_secret
  }
  request_body = "grant_type=password&client_id=admin-cli&username=${urlencode(var.admin.username)}&password=${urlencode(var.admin.password)}"
  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "The Keycloak admin token request failed."
    }
  }
}
data "http" "realm_management" {
  url = "${var.admin.url}/admin/realms/${var.realm_id}/clients?clientId=realm-management"
  request_headers = {
    "Authorization"           = "Bearer ${jsondecode(data.http.admin_token.response_body).access_token}"
    "CF-Access-Client-Id"     = var.admin.access_client_id
    "CF-Access-Client-Secret" = var.admin.access_client_secret
  }
  lifecycle {
    postcondition {
      condition     = self.status_code == 200 && length(jsondecode(self.response_body)) == 1
      error_message = "The realm-management client was not found."
    }
  }
}

output "id" { value = jsondecode(data.http.realm_management.response_body)[0].id }
