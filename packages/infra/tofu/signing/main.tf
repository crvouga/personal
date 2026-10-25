module "inventory" { source = "../modules/inventory" }

locals {
  config     = module.inventory.config.fleet_windows_signing
  repository = module.inventory.config.github.infra_repo
  enabled    = local.config.enabled
  ready      = local.enabled && local.config.identity_validation_id != null
}

resource "azurerm_resource_provider_registration" "signing" {
  for_each = local.enabled ? toset(["Microsoft.CodeSigning", "Microsoft.ManagedIdentity"]) : toset([])
  name     = each.key
  lifecycle { prevent_destroy = true }
}

resource "azurerm_resource_group" "signing" {
  count    = local.enabled ? 1 : 0
  name     = local.config.resource_group
  location = local.config.location
  tags     = { managed_by = "opentofu", repository = local.repository }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition = alltrue([for id in [local.config.subscription_id, local.config.tenant_id, local.config.operator_object_id] :
        can(regex("^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$", id))
      ])
      error_message = "Signing requires the authenticated Azure subscription, tenant and operator object IDs in the canonical inventory. See packages/fleet/docs/windows-signing.md."
    }
  }
}

resource "azurerm_trusted_signing_account" "installer" {
  count               = local.enabled ? 1 : 0
  name                = local.config.account
  resource_group_name = azurerm_resource_group.signing[0].name
  location            = azurerm_resource_group.signing[0].location
  sku_name            = "Basic"
  tags                = azurerm_resource_group.signing[0].tags
  depends_on          = [azurerm_resource_provider_registration.signing]
  lifecycle { prevent_destroy = true }
}

# The operator can complete Microsoft's personal identity check. CI cannot.
resource "azurerm_role_assignment" "identity_verifier" {
  count                = local.enabled ? 1 : 0
  scope                = azurerm_trusted_signing_account.installer[0].id
  role_definition_name = "Artifact Signing Identity Verifier"
  principal_id         = local.config.operator_object_id
}

resource "azurerm_user_assigned_identity" "publisher" {
  count               = local.enabled ? 1 : 0
  name                = "fleet-installer-publisher"
  resource_group_name = azurerm_resource_group.signing[0].name
  location            = azurerm_resource_group.signing[0].location
  tags                = azurerm_resource_group.signing[0].tags
  depends_on          = [azurerm_resource_provider_registration.signing]
  lifecycle { prevent_destroy = true }
}

resource "azurerm_federated_identity_credential" "main" {
  count                     = local.enabled ? 1 : 0
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.publisher[0].id
  issuer                    = "https://token.actions.githubusercontent.com"
  audience                  = ["api://AzureADTokenExchange"]
  subject                   = "repo:${local.repository}:ref:refs/heads/main"
}

# Identity validation is deliberately absent here: Microsoft only supports the
# person's portal verification. Its approved ID enables this second stage.
resource "azapi_resource" "profile" {
  count     = local.ready ? 1 : 0
  type      = "Microsoft.CodeSigning/codeSigningAccounts/certificateProfiles@2024-02-05-preview"
  name      = local.config.profile
  parent_id = azurerm_trusted_signing_account.installer[0].id
  body = {
    properties = {
      identityValidationId = local.config.identity_validation_id
      profileType          = "PublicTrust"
      includeStreetAddress = false
      includePostalCode    = false
    }
  }
  response_export_values = ["properties.certificates"]
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = can(regex("^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$", local.config.identity_validation_id))
      error_message = "Activate only with Microsoft's completed identity-validation ID, never an empty or placeholder value."
    }
    postcondition {
      condition = try(length(distinct([
        for certificate in self.output.properties.certificates : certificate.subjectName
        if certificate.status == "Active" && trimspace(certificate.subjectName) != ""
      ])) == 1, false)
      error_message = "Azure must return active certificates with one unambiguous verified subject before release signing can be activated."
    }
  }
}

resource "azurerm_role_assignment" "signer" {
  count                            = local.ready ? 1 : 0
  scope                            = azapi_resource.profile[0].id
  role_definition_name             = "Artifact Signing Certificate Profile Signer"
  principal_id                     = azurerm_user_assigned_identity.publisher[0].principal_id
  skip_service_principal_aad_check = true
}

# This dedicated root owns only this derived Actions variable; foundation owns
# the other repository settings. No private credential or generated client ID
# needs to be copied into desired-state inventory or a GitHub secret.
resource "github_actions_variable" "signing" {
  count         = local.ready ? 1 : 0
  repository    = split("/", local.repository)[1]
  variable_name = "FLEET_WINDOWS_SIGNING"
  value         = jsonencode(local.release_config)
  depends_on    = [azurerm_role_assignment.signer, azurerm_federated_identity_credential.main]
}
