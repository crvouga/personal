locals {
  publisher = try(one(distinct([
    for certificate in azapi_resource.profile[0].output.properties.certificates : certificate.subjectName
    if certificate.status == "Active" && trimspace(certificate.subjectName) != ""
  ])), null)
  release_config = local.ready ? {
    tenant_id       = local.config.tenant_id
    subscription_id = local.config.subscription_id
    client_id       = azurerm_user_assigned_identity.publisher[0].client_id
    endpoint        = azurerm_trusted_signing_account.installer[0].account_uri
    account         = azurerm_trusted_signing_account.installer[0].name
    profile         = azapi_resource.profile[0].name
    publisher       = local.publisher
  } : null
}

output "release_config" {
  description = "Public configuration published automatically to the signing workflow after verified profile creation."
  value       = local.release_config
}

output "identity_validation_url" {
  description = "Open this account in Azure, then Objects > Identity validations > Individual > New identity > Public."
  value       = local.enabled ? "https://portal.azure.com/#resource${azurerm_trusted_signing_account.installer[0].id}/overview" : null
}
