import { updateInputs, stages } from './model';
import type { Inventory, Session, Ui } from './types';

/** Explicit UI demonstration: no state, Vault, provider or network access. */
export function demoSession(ui: Ui, inventory: Inventory): Session {
  const inputs = {
    secrets: {
      dev: {
        GOOGLE_OAUTH_CLIENT_ID: '123-demo.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-demo-old',
        PORTFOLIO_GITHUB_TOKEN: 'ghp_demo',
      },
      prd: {
        GOOGLE_OAUTH_CLIENT_ID: '123-demo.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-demo-old',
        PORTFOLIO_GITHUB_TOKEN: 'ghp_demo',
      },
    },
    admin_passwords: {},
  };
  return {
    async load() {
      ui.say('DEMO · Loaded synthetic data. No live connections.');
      return structuredClone(inputs);
    },
    async update(before, next, fills, preview) {
      updateInputs(before, fills, inventory.vault.kv_keys);
      for (const stage of stages(next, fills, inventory)) {
        ui.say(
          `\nDEMO · ${stage.label}\n${stage.addresses.map((address) => `  update ${address}`).join('\n')}`
        );
        if (
          !preview &&
          !(await ui.confirm(`DEMO · Apply simulated ${stage.state} plan?`))
        )
          throw new Error('Demo stopped. No live changes were made.');
      }
      ui.say('DEMO · Simulation complete. No live changes were made.');
    },
    close() {},
  };
}
