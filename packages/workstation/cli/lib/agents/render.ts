import { join, win32 } from 'node:path';
import type { PlatformName } from '../platform/types';
import { registry, type Selection } from './registry';

/** Dedicated outputs; native login/state directories are never copied. */
export function agentRoot(home: string, platform: PlatformName): string {
  return platform === 'windows'
    ? win32.join(home, 'AppData', 'Local', 'personal', 'agents')
    : join(home, '.config', 'personal', 'agents');
}

export function render(s: Selection): Record<string, string> {
  const model = JSON.stringify(s.model);
  if (s.tool === 'codex') {
    const provider =
      s.profile === 'proxy'
        ? '\nmodel_provider = "personal_proxy"\n[model_providers.personal_proxy]\nname = "Personal CLI Proxy"\nbase_url = ' +
          JSON.stringify(registry.proxy.endpoint + '/v1') +
          '\nenv_key = "CLIPROXY_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n'
        : '\n';
    return { 'config.toml': `model = ${model}${provider}` };
  }
  if (s.tool === 'claude')
    return {
      'settings.json': JSON.stringify({ model: s.model }, null, 2) + '\n',
    };
  if (s.tool === 'gemini')
    return {
      '.gemini/settings.json':
        JSON.stringify({ model: { name: s.model } }, null, 2) + '\n',
    };
  const config =
    s.profile === 'proxy'
      ? {
          $schema: 'https://opencode.ai/config.json',
          model: `personal_proxy/${s.model}`,
          provider: {
            personal_proxy: {
              npm: '@ai-sdk/openai',
              options: {
                baseURL: registry.proxy.endpoint + '/v1',
                apiKey: '{env:CLIPROXY_API_KEY}',
              },
              models: { [s.model]: { name: s.model } },
            },
          },
        }
      : { $schema: 'https://opencode.ai/config.json', model: s.model };
  return { 'opencode.json': JSON.stringify(config, null, 2) + '\n' };
}
