// Private subprocess protocol: request and response travel only over captured
// pipes. No secret-bearing arguments, environment variables or native errors.
import { Entry } from '@napi-rs/keyring';
async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > 2 * 1024 * 1024)
      throw new Error('invalid-input');
  }
  const request = JSON.parse(input) as {
    service: string;
    name: string;
    operation: string;
    value?: string;
  };
  if (
    !/^[a-zA-Z0-9._/-]{1,200}$/.test(request.name) ||
    !/^workspace\.password-manager(?:\.restore\.[a-f0-9]{32})?$/.test(
      request.service
    )
  )
    throw new Error('invalid-input');
  if (request.operation === 'probe') {
    process.stdout.write(JSON.stringify('available'));
    return;
  }
  execute(request);
}
function execute(request: {
  service: string;
  name: string;
  operation: string;
  value?: string;
}): void {
  const entry = new Entry(request.service, request.name, {
    linux: { store: 'secret-service' },
  });
  if (request.operation === 'get')
    process.stdout.write(JSON.stringify(entry.getPassword()));
  else if (request.operation === 'set' && typeof request.value === 'string') {
    entry.setPassword(request.value);
    if (entry.getPassword() !== request.value) throw new Error('unavailable');
    process.stdout.write('null');
  } else if (request.operation === 'remove') {
    entry.deletePassword();
    process.stdout.write('null');
  } else throw new Error('invalid-input');
}

try {
  await main();
} catch {
  process.exitCode = 1;
}
