/** Desired Zoomies application state. Infrastructure itself is declared in OpenTofu. */
export const ORIGIN = 'https://zoomies.chrisvouga.dev';

export type PoolSpec = {
  readonly name: string;
  readonly labels: readonly string[];
  readonly backend: 'docker' | 'podman' | 'process';
  readonly platform: { readonly os: string; readonly os_version: string };
  readonly min_runners: number;
  readonly max_runners: number;
  readonly idle_timeout: string;
  readonly ephemeral: boolean;
};

/**
 * Created only when absent. An existing pool is never modified, so capacity,
 * labels and sizes tuned later in the Zoomies UI survive every run.
 */
export const POOLS: readonly PoolSpec[] = [
  {
    name: 'zoomies-ubuntu-2404',
    labels: ['zoomies-ubuntu-2404'],
    backend: 'docker',
    platform: { os: 'ubuntu', os_version: '24.04' },
    min_runners: 0,
    max_runners: 4,
    idle_timeout: '5m',
    ephemeral: true,
  },
];

/** Where runners register. A personal account has no organization: name a repository. */
export const DEFAULT_TARGET = {
  target: 'crvouga/personal',
  target_type: 'repo',
} as const;
