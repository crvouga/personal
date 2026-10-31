/** Read-only diagnostics; accepts deployment IDs, never changes hosting. */
import { readDeploymentLogTail } from '../../packages/infra/lib/railway-logs';

const ids = (process.env.DEPLOYMENT_IDS ?? '')
  .split(',')
  .map((id) => id.trim());
if (
  !ids.length ||
  ids.length > 10 ||
  ids.some((id) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
)
  throw new Error('Supply 1–10 deployment UUIDs');
const token = process.env.RAILWAY_TOKEN;
if (!token) throw new Error('Missing RAILWAY_TOKEN');
for (const deploymentId of ids) {
  console.log(`Deployment ${deploymentId}`);
  const lines = await readDeploymentLogTail({ deploymentId, token });
  console.log(lines.length ? lines.join('\n') : 'No logs returned');
}
