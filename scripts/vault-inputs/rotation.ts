import { TOFU_VAULT_INPUTS_ADDRESS } from './model';

export const RAILWAY_TOKEN_ADDRESS =
  'github_actions_secret.bootstrap["RAILWAY_TOKEN"]';

/** Explicit Railway rotation updates both the Vault inputs and CI's copy. */
export function repairInputs(
  env: Record<string, string>,
  inputsJson: string,
  fromVault: string[],
  live: Record<string, string>
) {
  const planEnv: Record<string, string> = {
    ...env,
    TF_VAR_vault_inputs: inputsJson,
  };
  const addresses = [TOFU_VAULT_INPUTS_ADDRESS];
  if (fromVault.includes('RAILWAY_TOKEN')) {
    const token = live['RAILWAY_TOKEN'];
    if (!token?.trim())
      throw new Error('The live prd Vault has no value for RAILWAY_TOKEN');
    planEnv['TF_VAR_railway_token'] = token;
    addresses.push(RAILWAY_TOKEN_ADDRESS);
  }
  return { env: planEnv, addresses };
}
