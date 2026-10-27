# Retirement-only root. Do not apply without reviewing a saved destroy plan.

removed {
  from = azurerm_resource_provider_registration.signing
  lifecycle { destroy = false }
}

removed {
  from = azurerm_resource_group.signing
  lifecycle { destroy = true }
}

removed {
  from = azurerm_trusted_signing_account.installer
  lifecycle { destroy = true }
}

removed {
  from = azurerm_role_assignment.identity_verifier
  lifecycle { destroy = true }
}

removed {
  from = azurerm_user_assigned_identity.publisher
  lifecycle { destroy = true }
}

removed {
  from = azurerm_federated_identity_credential.main
  lifecycle { destroy = true }
}

removed {
  from = azapi_resource.profile
  lifecycle { destroy = true }
}

removed {
  from = azurerm_role_assignment.signer
  lifecycle { destroy = true }
}

removed {
  from = github_actions_variable.signing
  lifecycle { destroy = true }
}
