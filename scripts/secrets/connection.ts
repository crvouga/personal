import { collectEnvironment } from '../vault-inputs/environment';
import { readLiveVault } from '../vault-inputs/live';
import type { Ui } from './types';

export async function connect(ui: Ui): Promise<Record<string, string>> {
  const live = await ui.task('Authenticate through your Vault CLI login', () =>
    readLiveVault()
  );
  if (!live)
    throw new Error(
      'Vault authentication is unavailable. Run vault login, then retry.'
    );
  return ui.task('Load managed operator credentials', () =>
    collectEnvironment({}, live)
  );
}
