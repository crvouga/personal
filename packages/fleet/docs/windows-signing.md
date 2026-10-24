# Windows publisher signing

Issue [#130](https://github.com/crvouga/workspace/issues/130) is Edge's
“isn't commonly downloaded” SmartScreen warning. The currently published EXE is
unsigned. Changing its filename, wrapping it in a ZIP/MSI, removing Mark of the
Web, a self-signed certificate, or disabling SmartScreen is not a publisher-trust
fix. Unsigned releases start reputation from zero with every new file hash.

Microsoft's [SmartScreen developer guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
says even OV/EV and Artifact Signing certificates do not guarantee immediate
reputation. Store distribution has different trust behavior. No installer can
overrule an organization's application-control or download policy.

## Automated release path

`Fleet Windows signing` runs only after successful CI for trusted main pushes or
manual CI runs. It selects the Windows artifact from that exact run; it never
executes a pull-request artifact with signing permissions. Normal release
publication excludes EXEs, so it cannot overwrite a signed Windows download with
an unsigned build. PR artifacts remain available for packaging tests.

The workflow reads public configuration from the canonical OpenTofu inventory's
`fleet_windows_signing` entry, currently `null`:

- `tenant_id`, `subscription_id`, `client_id`: the dedicated publisher identity.
- `endpoint`, `account`, `profile`: Azure Artifact Signing public-trust profile.
- `publisher`: the exact verified certificate Subject expected by Windows.

GitHub OIDC logs in with short-lived credentials. The signing key remains with
Microsoft. Signing uses SHA-256 and an RFC 3161 timestamp. The final EXE must pass
Windows Authenticode verification, exact publisher matching, code-signing EKU,
SignTool verification of every signature and timestamp, and its packaged
self-test before upload. A public `.signature.json` records the signed download
hash, source CI run, revision, publisher and certificate identities. Older CI
runs cannot replace a newer signed build; retries of the same run are permitted.
Unrelated main commits do not strand an otherwise current tested installer. Failed operations can be
rerun against the same tested artifact without rebuilding or disabling checks.

## Current external blocker

No signing identity was found in repository secrets/variables or managed dev,
production and operator credential documents. No Azure connector or CLI account
is available in this workspace. The old unsigned release is retained; no claim
is made that it has been signed or that issue #130 is resolved live.

A verified public publisher identity must first exist. Microsoft performs the
identity check; an agent cannot fabricate it. Azure subscription, signing account,
public certificate profile, dedicated service principal, main-only GitHub OIDC
federation and profile-scoped **Artifact Signing Certificate Profile Signer**
assignment must be declared and adopted through `packages/infra/tofu` before
activation. Do not create them through a dashboard, CLI provisioner or this
workflow. Restrict federation to this repository's `refs/heads/main`; never grant
PR/queue identities or broad subscription ownership to the runtime signer.
Identity validation is the external provider's account verification, not a node
installation step.

Once those reviewed resources are available, fill the public inventory entry and
dispatch CI on current main to build and sign with that configuration. A retry
of an older run keeps its older configuration; do not use it for activation. Missing configuration fails
with `FLEET-SIGNING-NOT-CONFIGURED`; invalid signatures and wrong publishers fail
with their own copyable codes. The signing workflow is separate from platform
provisioning/deployment so missing publisher identity does not deadlock applying
its OpenTofu configuration. Track its result separately from the main CI gate.

Qualification still requires downloading the released file through real Edge on
clean Windows, checking the displayed publisher and testing permitted managed
policies. CI signature tests are not evidence of SmartScreen reputation.
