import { parseOptions } from './cli-options';
import { dispatch, print } from './cli-commands';
import { FleetUsageError } from './errors';

let parsed = false;
try {
  const options = parseOptions(process.argv.slice(2));
  parsed = true;
  process.exitCode = await dispatch(options);
} catch (error) {
  const usage = error instanceof FleetUsageError || !parsed;
  print({
    version: 1,
    ok: false,
    code: usage ? 'invalid_usage' : 'operation_failed',
    error:
      error instanceof FleetUsageError
        ? error.message
        : 'Fleet command failed. Run fleet help and inspect the operation locally. Raw errors are withheld to protect credentials.',
  });
  process.exitCode = usage ? 2 : 1;
}
