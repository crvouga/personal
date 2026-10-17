export function developmentMode(
  env: NodeJS.ProcessEnv
): 'local' | 'configured' {
  if (env['NODE_ENV'] === 'production')
    throw new Error('Use start, not dev, in production');
  const mode = env['AUTH_DEV_MODE'] ?? 'configured';
  if (mode !== 'local' && mode !== 'configured')
    throw new Error('AUTH_DEV_MODE must be local or configured');
  if (mode === 'local' && env['AUTH_ENVIRONMENT'] === 'production')
    throw new Error('Local fixtures cannot use the production environment');
  return mode;
}
