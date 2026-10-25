mock_provider "azurerm" {
  mock_resource "azurerm_resource_group" {
    defaults = { id = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/fleet-windows-signing" }
  }
  mock_resource "azurerm_trusted_signing_account" {
    defaults = {
      id          = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/fleet-windows-signing/providers/Microsoft.CodeSigning/codeSigningAccounts/fleetsigningtest"
      account_uri = "https://eus.codesigning.azure.net/"
    }
  }
  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/fleet-windows-signing/providers/Microsoft.ManagedIdentity/userAssignedIdentities/fleet-installer-publisher"
      client_id    = "22222222-2222-4222-8222-222222222222"
      principal_id = "33333333-3333-4333-8333-333333333333"
    }
  }
}
mock_provider "azapi" {
  mock_resource "azapi_resource" {
    defaults = {
      id = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/fleet-windows-signing/providers/Microsoft.CodeSigning/codeSigningAccounts/fleetsigningtest/certificateProfiles/fleet-installer"
      output = { properties = { certificates = [
        { status = "Active", subjectName = "CN=Fleet Test, O=Fleet Test, C=US" },
        { status = "Active", subjectName = "CN=Fleet Test, O=Fleet Test, C=US" },
        { status = "Revoked", subjectName = "CN=Old Publisher, C=US" }
      ] } }
    }
  }
}
mock_provider "github" {}

variables {
  state_passphrase = "test-only-state-passphrase-not-for-live-use"
}

override_module {
  target = module.inventory
  outputs = { config = {
    github = { infra_repo = "example/workspace" }
    fleet_windows_signing = {
      enabled                = true
      subscription_id        = "11111111-1111-4111-8111-111111111111"
      tenant_id              = "44444444-4444-4444-8444-444444444444"
      operator_object_id     = "55555555-5555-4555-8555-555555555555"
      resource_group         = "fleet-windows-signing"
      location               = "eastus"
      account                = "fleetsigningtest"
      profile                = "fleet-installer"
      identity_validation_id = "66666666-6666-4666-8666-666666666666"
    }
  } }
}

run "disabled_account_does_not_provision" {
  command = plan
  override_module {
    target = module.inventory
    outputs = { config = {
      github = { infra_repo = "example/workspace" }
      fleet_windows_signing = {
        enabled                = false
        subscription_id        = null
        tenant_id              = null
        operator_object_id     = null
        resource_group         = "fleet-windows-signing"
        location               = "eastus"
        account                = "fleetsigningtest"
        profile                = "fleet-installer"
        identity_validation_id = null
      }
    } }
  }
  assert {
    condition     = length(azurerm_resource_group.signing) == 0 && length(azurerm_resource_provider_registration.signing) == 0 && output.release_config == null
    error_message = "Unconfigured signing must not create Azure resources or activate publication."
  }
}

run "bootstrap_waits_for_personal_identity_validation" {
  command = plan
  override_module {
    target = module.inventory
    outputs = { config = {
      github = { infra_repo = "example/workspace" }
      fleet_windows_signing = {
        enabled                = true
        subscription_id        = "11111111-1111-4111-8111-111111111111"
        tenant_id              = "44444444-4444-4444-8444-444444444444"
        operator_object_id     = "55555555-5555-4555-8555-555555555555"
        resource_group         = "fleet-windows-signing"
        location               = "eastus"
        account                = "fleetsigningtest"
        profile                = "fleet-installer"
        identity_validation_id = null
      }
    } }
  }
  assert {
    condition     = azurerm_trusted_signing_account.installer[0].sku_name == "Basic" && length(azapi_resource.profile) == 0 && length(azurerm_role_assignment.signer) == 0 && length(github_actions_variable.signing) == 0
    error_message = "Bootstrap must use Basic billing and withhold signing permission and activation until identity validation is complete."
  }
  assert {
    condition     = azurerm_role_assignment.identity_verifier[0].principal_id == "55555555-5555-4555-8555-555555555555" && azurerm_role_assignment.identity_verifier[0].scope == azurerm_trusted_signing_account.installer[0].id
    error_message = "Only the pinned operator may verify identity, scoped to this signing account."
  }
  assert {
    condition     = azurerm_federated_identity_credential.main[0].subject == "repo:example/workspace:ref:refs/heads/main" && azurerm_federated_identity_credential.main[0].issuer == "https://token.actions.githubusercontent.com" && azurerm_federated_identity_credential.main[0].audience == tolist(["api://AzureADTokenExchange"])
    error_message = "Federation must permit this repository's main branch only, never PRs, environments or other repositories."
  }
}

run "validated_profile_activates_restricted_publisher" {
  command = plan
  assert {
    condition     = azapi_resource.profile[0].body.properties.profileType == "PublicTrust" && !azapi_resource.profile[0].body.properties.includeStreetAddress && !azapi_resource.profile[0].body.properties.includePostalCode
    error_message = "The profile must provide public trust without publishing the operator's street address or postal code."
  }
  assert {
    condition     = azurerm_role_assignment.signer[0].scope == azapi_resource.profile[0].id && azurerm_role_assignment.signer[0].principal_id == azurerm_user_assigned_identity.publisher[0].principal_id && azurerm_role_assignment.signer[0].role_definition_name == "Artifact Signing Certificate Profile Signer"
    error_message = "CI may sign with this one profile only; it must never receive account or subscription ownership."
  }
  assert {
    condition     = jsondecode(github_actions_variable.signing[0].value).publisher == "CN=Fleet Test, O=Fleet Test, C=US" && jsondecode(github_actions_variable.signing[0].value).client_id == "22222222-2222-4222-8222-222222222222"
    error_message = "Release configuration must use Azure's actual verified subject and generated identity, not hand-copied values."
  }
}

run "missing_active_subject_blocks_activation" {
  command = plan
  override_resource {
    target = azapi_resource.profile[0]
    values = { output = { properties = { certificates = [
      { status = "Revoked", subjectName = "CN=Fleet Test, C=US" }
    ] } } }
  }
  expect_failures = [azapi_resource.profile]
}

run "conflicting_active_subjects_block_activation" {
  command = plan
  override_resource {
    target = azapi_resource.profile[0]
    values = { output = { properties = { certificates = [
      { status = "Active", subjectName = "CN=Fleet Test, C=US" },
      { status = "Active", subjectName = "CN=Unexpected Publisher, C=US" }
    ] } } }
  }
  expect_failures = [azapi_resource.profile]
}
