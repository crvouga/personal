/** Public provenance checks complement the Windows workflow's Authenticode check. */
import { asRecord, getJson, type HealthContext } from './context.js';
import { fail, pass, skip, type CheckResult } from './report.js';

export async function checkSignedInstaller(ctx: HealthContext, publisher: string): Promise<CheckResult> {
  const name = 'signed Windows installer';
  const repository = ctx.config.github?.infra_repo;
  const release = await getJson(ctx, `https://api.github.com/repos/${repository}/releases/tags/fleet-installer`);
  if (release.status !== 200) return fail(name, `Cannot inspect installer release (HTTP ${release.status})`);
  const assets = asRecord(release.body)['assets'];
  const entries = Array.isArray(assets) ? assets.map(asRecord) : [];
  const executable = entries.find((entry) => entry['name'] === 'fleet-installer-windows-x64.exe');
  const proofAsset = entries.find((entry) => entry['name'] === 'fleet-installer-windows-x64.signature.json');
  if (!executable || !proofAsset) return fail(name, 'A signed Windows installer and its verification proof have not both been published');
  const response = await getJson(ctx, `https://github.com/${repository}/releases/download/fleet-installer/fleet-installer-windows-x64.signature.json`);
  const proof = asRecord(response.body);
  const digest = executable['digest'];
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) return skip(name, 'GitHub release digest is unavailable; public download integrity was not verified');
  const revision = proof['revision'];
  const runId = proof['runId'];
  if (response.status !== 200 || proof['file'] !== executable['name'] || proof['sha256'] !== digest.slice(7) || proof['publisher'] !== publisher || typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision) || typeof runId !== 'number' || !Number.isSafeInteger(runId) || runId <= 0 || !/^[0-9a-f]{40}$/i.test(String(proof['certificateThumbprint'])) || !/^[0-9a-f]{40}$/i.test(String(proof['timestampCertificateThumbprint']))) {
    return fail(name, 'Published download, publisher or verification proof differs; complete the verified Windows signing workflow');
  }
  const source = await getJson(ctx, `https://api.github.com/repos/${repository}/actions/runs/${runId}`);
  const run = asRecord(source.body);
  const origin = asRecord(run['head_repository']);
  const valid = source.status === 200 && run['path'] === '.github/workflows/ci.yml' && run['conclusion'] === 'success' && run['head_branch'] === 'main' && run['head_sha'] === revision && origin['full_name'] === repository && ['push', 'workflow_dispatch'].includes(String(run['event']));
  return valid ? pass(name, 'Published file digest and publisher match the Windows verification proof from successful trusted main CI') : fail(name, 'Installer proof does not refer to successful trusted main CI');
}
