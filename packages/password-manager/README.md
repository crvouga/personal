# Password manager

Private `@pkgs/password-manager` CLI for account discovery, conservative identity
reconciliation and selected Bitwarden imports/rotations. The
[execution and evidence ledger](docs/implementation.md) maps requirements to tests
and records the limits of local and live verification.
No personal account has been imported, changed, or live-verified during development.

Start from the repository root, including before Node/Bun are installed:

```sh
sh scripts/password-manager-setup.sh
```

The launcher uses the repository's existing mise installation to acquire Node
22.22.3 and Bun 1.4.4, installs the frozen workspace lock and initializes private
onboarding. If mise is missing it prints the exact platform installation/trust
path in [bootstrap.md](docs/bootstrap.md) and this same continuation command. No account mutation runs on install,
setup, build or ordinary tests. A terminal/browser consent or keychain unlock can
require your attention. Setup exits 2 while onboarding actions remain.

On an initialized checkout the equivalent root command is:

```sh
bun run password-manager setup
bun run password-manager actions list
bun run password-manager doctor
bun run password-manager run
```

All commands currently return JSON, including without `--json`. Output contains
allowlisted workflow metadata, never decrypted vault objects or subprocess error
messages. Exit codes: 0 completed/inspection, 1 failed, 2 requires user action,
3 partial/cancelled/unknown outcome. `--non-interactive` never prompts. Help:
`bun run password-manager --help` and `<command> --help`.

## Private state and credentials

macOS state: `~/Library/Application Support/password-manager/`.
Linux state: `~/.local/state/password-manager/`. Directories require owner-only
permissions (0700), metadata/config/database files require 0600. The SQLite
metadata is **not encrypted**. Do not synchronize these directories. Checkout,
known cloud-sync locations, unsafe permissions and final-component symlinks are
rejected. `--state-dir /private/local/path` selects another private local location.
Private state must stay outside Git, Turbo, build outputs and CI uploads.

Credentials, OAuth refresh tokens, old/replacement passwords, candidate imports,
issued recovery material and browser storage state use the existing `SecretStore`
port backed by macOS Keychain or a persistent Linux Secret Service. The adapter
requires Secret Service and never falls back to a volatile kernel keyring. This
avoids runtime writes to OpenTofu-owned Vault secrets. Browser verification starts
with no stored authentication state; browser screenshots/traces/HAR/video are off.

1. On macOS, unlock the login keychain in Keychain Access when prompted.
2. On Linux, run a user D-Bus session and unlock gnome-keyring/KWallet or another
   persistent Secret Service. A headless server without that facility is not a
   supported durable-secret environment.
3. Setup enumerates browser profile metadata and records native export actions;
   it never reads protected browser password/cookie databases. For missing Chromium run `bun run password-manager setup`. On supported Linux,
   `bun run password-manager setup --system-deps` installs Playwright's declared
   browser libraries through the OS package manager; administrator privileges can
   be required. Rerun `doctor` afterward.

No native compiler/Rust toolchain is required on supported prebuilt keyring
platforms. OS facilities are OS-version-managed, not a reproducible machine image.
Use `bun run password-manager dependencies` for owners, pinned npm versions,
resolved paths and platform requirements. No browser extension is required.

## Bitwarden connection

1. In your existing web vault open Settings > Security > Keys > API key. Authenticate
   and retrieve the personal `client_id` and `client_secret`.
2. Store them at masked prompts (never in command arguments or checked-in files):

   ```sh
   bun run password-manager secrets set bitwarden/client-id
   bun run password-manager secrets set bitwarden/client-secret
   bun run password-manager connect bitwarden --email you@example.com --server https://vault.bitwarden.com
   ```

3. For EU use `--server https://vault.bitwarden.eu`; for self-hosted use the exact
   HTTPS server. An existing configured binding cannot silently switch identity.
4. Run `bun run password-manager run`. The separate masked master-password prompt
   unlocks the vault for that process; the session is cleared on exit. API login
   does not unlock encrypted data. FIDO2/Duo users can use this documented API-key
   route without disabling MFA. [Bitwarden CLI](https://bitwarden.com/help/cli/)
5. For an explicitly configured unattended unlock, store the unlock value in the
   OS credential store and set `bitwarden.masterPasswordRef` in the private config.
   Keep an independently usable recovery path; storing the only recovery key
   inside the vault that it unlocks is not a recovery strategy.

The locked local `@bitwarden/cli` is resolved explicitly, with package-owned
`BITWARDENCLI_APPDATA_DIR`. Global `bw`/`bws`, unrelated sessions and global config
are not selected by the adapter. Shared/organization discovery is off by default.

## Sources and coverage

```sh
bun run password-manager sources add chrome csv --file /private/export.csv
bun run password-manager sources add archive mbox --file /private/archive.mbox
bun run password-manager sources add message eml --file /private/message.eml
bun run password-manager sources list
bun run password-manager discover --source archive
bun run password-manager accounts reconcile
```

Exports are credential-bearing files: use a private local folder and leave the
original store intact until migration readback is verified. Mail archives need no
vault unlock. Mail vendor domains, forwarded messages, receipts and sign-in alerts
remain **unverified clues**. They do not become password destinations. Explicitly
confirm a mapping after reviewing the evidence and official service identity:

```sh
bun run password-manager accounts confirm EVIDENCE_ID --origin https://service.example --username ExactUsername
```

Origins and usernames remain distinct; public suffix matching only suggests
relationships. A stored vault item does not establish that its password works.
SSO, social sign-in and passkey-only records do not get automatic passwords.

Review commands support reversible decisions and exact, user-verified aliases:

```sh
bun run password-manager evidence list --source SOURCE_ID --category registration
bun run password-manager accounts decisions
bun run password-manager accounts undo DECISION_ID
bun run password-manager accounts alias ACCOUNT_ID EVIDENCE_ID
bun run password-manager accounts confirm-batch /private/reviewed-mappings.json
```

Batch input is an array of `{evidenceId, origin, username, auth?, identityProvider?}`.
It records your verification of these mappings; it never infers equivalence from an
email vendor or shared suffix. In-flight accounts cannot be remapped.

| Source                     | Implemented discovery                                                | Transfer limits                                                                           |
| -------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Personal Bitwarden         | Login items + references; shared opt-in                              | Does not test existing passwords                                                          |
| Chrome/Chromium CSV        | name/url/username/password/note                                      | Password export only                                                                      |
| Firefox CSV                | url/username/password plus native metadata                           | Native authentication/export remains OS/browser controlled                                |
| Apple Passwords/Safari CSV | Title/URL/Username/Password/Notes/OTPAuth                            | Passkeys require native exchange/enrollment                                               |
| Bitwarden JSON             | Bounded unencrypted login export in memory, candidates in OS secrets | Non-login records, folders, passkeys and attachments surface as unsupported transfer work |
| MBOX/EML                   | Streaming MIME header evidence; bounded headers/lines                | No attachment/body analysis, remote images or reset-link execution                        |
| Gmail                      | Read-only API search, metadata pagination/history                    | Requires configured desktop OAuth application and consent                                 |
| Microsoft                  | Delegated read-only basic metadata, complete nextLink paging         | Date-window polling; no folder-delta claim                                                |
| IMAP                       | TLS INBOX headers, UID/UIDVALIDITY                                   | Provider-supported OAuth/app-password; no password-login downgrade                        |
| Infrastructure inventory   | Existing OpenTofu JSON URL/domain clues                              | Hosting presence is not account confirmation                                              |

Browser export paths (the browser/OS must authenticate you):

1. Chrome: Settings > Autofill and passwords > Google Password Manager > Settings
   > Export passwords. Choose a private local CSV destination, then add it as `csv`.
2. Firefox: open `about:logins` > menu > Export Logins, authenticate to the OS and
   export CSV, then add it as `csv`.
3. macOS Passwords: Passwords app > File > Export All Passwords (older Safari:
   Settings > Passwords > menu > Export All Passwords), authenticate and export CSV.
   Passkeys/security keys are not transported in a password CSV.
4. Other managers: select a documented supported CSV or Bitwarden JSON format.
   Unknown nonempty fields are rejected rather than silently dropped.
5. CSV/JSON/MBOX/EML scans resume bounded work against a file snapshot. A changed
   snapshot restarts discovery; conflicting encrypted candidates require a distinct
   source ID or explicit review. Header/record limits reject malformed input.
6. After `discover`, inspect source coverage; a failed/incomplete scan is never
   equivalent to a successful empty mailbox. Resume with the same command.

## Gmail and Microsoft OAuth

1. Add a source with a selected identity and existing installed-app client ID:

   ```sh
   bun run password-manager sources add mail gmail --identity you@example.com --client-id YOUR_DESKTOP_CLIENT_ID
   bun run password-manager connect gmail --source mail
   ```

2. If a registration is needed, `actions show ACTION_ID` provides the provider-specific
   console fields and consent steps. Google: enable Gmail API; configure Branding,
   Audience/test users and Data Access with `gmail.readonly`; create a **Desktop app**
   client. Store any client secret via `secrets set`, then set `clientSecretRef` in
   the private config. `gmail.metadata` cannot use the required search `q` parameter.
   [Google scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
   [message search](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).
3. For Microsoft use kind `microsoft`, configure an Entra mobile/desktop public
   client with loopback redirect and delegated `Mail.ReadBasic` + `User.Read` (mailbox identity verification) + `offline_access`.
   Set `tenant` to the intended account audience/tenant, then run
   `bun run password-manager connect microsoft --source SOURCE_ID`.
4. The interactive command opens the system browser, validates loopback-only
   callback/state and S256 PKCE, and stores refresh credentials in the OS store.
   Headless execution records a durable action and exits without waiting.
5. Revoked/expired consent requires running the same `connect` command again.
   Google External apps in Testing can have seven-day refresh-token lifetimes for
   these scopes. Identity password changes can revoke Gmail-authorized credentials.
   [Google token lifecycle](https://developers.google.com/identity/protocols/oauth2).

Private configuration is schema-versioned (`config.json` in the state directory).
See [config.example.json](config.example.json). It contains references and safe
example identifiers, never tokens. Configure date scope, Spam/Trash inclusion,
message bounds and aliases per source. IMAP reads only INBOX over TLS; configure
`host`, `identity` and `credentialRef` to an encrypted JSON value containing the
provider-supported `accessToken` or app-specific `pass`.

## Planning, import, rotation and recovery

```sh
bun run password-manager audit
bun run password-manager plan --kind import
bun run password-manager apply PLAN_ID
bun run password-manager plan --kind rotate --account ACCOUNT_ID
bun run password-manager apply PLAN_ID
bun run password-manager status
bun run password-manager actions show ACTION_ID
bun run password-manager resume RUN_ID
bun run password-manager recover OPERATION_ID
```

Inspection does not mutate live accounts. Applying a concrete plan authorizes its
listed operations once. Imports reconcile against the current vault with stable
operation markers and readback. A lost create acknowledgement triggers vault
reconciliation before retry. Existing passwords are not replaced by stale exports.
Conflicts and unsupported/nonportable fields require explicit resolution:

```sh
bun run password-manager imports list
bun run password-manager imports choose EVIDENCE_ID
bun run password-manager imports resolve EVIDENCE_ID --vault-item VAULT_ID --mode merge-metadata
bun run password-manager imports configure EVIDENCE_ID --folder-id EXISTING_FOLDER_ID --personal
bun run password-manager plan show PLAN_ID
bun run password-manager plan revise PLAN_ID
bun run password-manager plan discard PLAN_ID
```

`choose` selects one create candidate. `merge-metadata` keeps the current password
and merges supported source fields. `replace-password` explicitly selects the source
password; `preserve` deliberately keeps the current destination. Conflicting TOTP or
custom-field values remain blocked. Folder `none` removes a source folder reference;
`--personal` explicitly removes source organization ownership. Passkeys, attachment
bytes and non-login native transfers stay visible as separate actions. A complete
scan never resolves unfinished migration actions.

Plans freeze account identity, exact origin, operation kind, destination item,
source candidate reference, factor selection and expected vault account/server.
Unsubmitted expired plans need `plan revise`, inspection and `apply` of the new ID.
Discarding an unsent plan does not delete its encrypted staged material. Once a
change was submitted, use recovery to reconcile that outcome; do not discard it.
Cancellation exits 3. `cancel RUN_ID` records cancellation, and `resume RUN_ID`
clears it explicitly and continues the same staged operation where authorized.

The initial production browser target is GitHub username/password accounts.
The deterministic adapter fills the password change form at Password and
authentication, confirms the response, updates the freshest Bitwarden object and
verifies with a fresh password sign-in. [GitHub password workflow](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/updating-your-github-access-credentials).
This adapter is fixture-tested, **not live-verified**. MFA, device verification,
CAPTCHA, passkey/SSO-only accounts and changed provider forms pause the affected
operation. There is no MFA bypass. Independent operations continue.

One replacement is stored in the OS secret store **before** submission. Old and
staged values remain recoverable through unknown outcomes. After timeout/crash,
recovery tests the staged value before considering the old value; it never blindly
resubmits an ambiguous change. It does not promise rollback. After a website change
and vault failure, finish the new state using `recover`. Vault preflight/readback
preserve unrelated fields; external edits can still race because bw has no atomic
compare-and-swap API. Completion requires current vault storage and fresh password
authentication; an authenticated cookie does not establish password validity.
Reads sync the package-owned vault cache before inspection. A later vault revision
invalidates the previous verification status conservatively, including metadata-only
edits. The report preserves when verification occurred; it does not claim perpetual
credential validity. Account activity remains unknown until you review it; duplicate
items and possible unused accounts are review candidates, never automatic deletion.

## Factors and emergency preparation

These are separate selected actions, with user-attested outcomes clearly separated
from independently verified password logins:

```sh
bun run password-manager auth plan mfa-enroll --account ACCOUNT_ID
bun run password-manager apply PLAN_ID
bun run password-manager actions show ACTION_ID
bun run password-manager auth attest OPERATION_ID --tested
```

Kinds include `factor-replace`, `factor-remove`, `passkey-enroll`,
`recovery-regenerate`, `recovery-check`, `delete-account` and `review-linked`.
Provider/hardware interaction remains guided. Code capture, checkpointing and
attestation are implemented; unattended factor enrollment is not claimed.
Regeneration requires encrypted capture of issued material before attestation:
`bun run password-manager auth capture OPERATION_ID --stdin` from protected input.
Do not regenerate a second time after a lost response. Use your existing
Authenticator/security-key strategy and test the replacement before removing an
old factor. Factor removal requires both the completed, tested replacement operation
and the exact old factor label:

```sh
bun run password-manager auth plan factor-remove --account ACCOUNT_ID --replacement TESTED_OPERATION_ID --target-factor 'Old security key'
```

A replacement can be named using `--target-factor` when creating its enrollment
plan. Removal of that same label is refused. Guided tests are user attestations;
the tool does not claim independent biometric/hardware verification. Recovery-code
issuance intent is durable before the handoff, captured codes are read back from
the encrypted store, and recovery material is retained beyond rotation cleanup.

`auth plan recovery-check --account ACCOUNT_ID` supplies emergency preparation:
check the recovery email/phone dependency, a second trusted device, authenticator
backup, exact vault region/account and an offline independent backup password.
Do not put the only recovery code in the system it recovers. Google account
changes mark matching mail connectors for reauthorization without erasing evidence,
cursors or downstream plans. Resume with `connect gmail --source SOURCE_ID` and
then `discover --source SOURCE_ID`.

Google linked apps can be reviewed at `https://myaccount.google.com/connections`;
Apple at `https://account.apple.com` > Sign-In and Security > Sign in with Apple.
Use supported native credential exchange for nonportable passkeys; do not scrape
protected browser databases or assume every key is exportable.

## Backups, schedules, retention and upgrades

```sh
bun run password-manager secrets set backup/independent-password
bun run password-manager backup create
bun run password-manager backup verify BACKUP_ID
bun run password-manager schedule install
bun run password-manager schedule status
bun run password-manager schedule remove
bun run password-manager cleanup
bun run password-manager cleanup --apply
```

Use a unique backup password of at least 20 characters and retain it through an
independent offline route. Backups use a versioned AES-256-GCM/scrypt container,
with vault items, workflow metadata and encrypted staging; no unprotected browser
sessions or mail archives. This is not a Bitwarden account-restricted encrypted
export. Bitwarden's own account-restricted exports cannot recover into another
account or after the relevant key changes; password-protected exports have
different portability. [Bitwarden export properties](https://bitwarden.com/help/encrypted-export/).
Verification authenticates decryption, validates source config and all metadata,
restores SQLite in isolation, and hydrates/readbacks every referenced staged secret.
Personal folder metadata is encrypted alongside vault items. Organization collection
definitions need a separately selected native organization export.
It does not mutate the active vault or prove live Bitwarden account recovery,
attachment recovery, or hardware-key portability. Copy encrypted backup files to
your separately selected backup destination; do not upload plaintext exports.

Recover without the original machine/vault using the independently retained password:

```sh
bun run password-manager backup restore /private/backup.pwm --destination /private/isolated-restore
bun run password-manager --state-dir /private/isolated-restore status
```

The destination must be empty, private, outside the active state and outside the
archive path. Restore creates a separate OS secret namespace, disables auto-apply,
restores source config and staging, and rewrites action commands to the isolated
state. Repeated completed restore is a no-op. Before reconnecting, store the
personal API credentials in the new namespace (use configured reference names if
you customized these):

```sh
bun run password-manager --state-dir /private/isolated-restore secrets set bitwarden/client-id
bun run password-manager --state-dir /private/isolated-restore secrets set bitwarden/client-secret
bun run password-manager --state-dir /private/isolated-restore connect bitwarden
```

Reconnect the exact original vault identity and mail sources before recovering
selected incomplete operations. Browser
sessions and OAuth tokens are deliberately excluded and require fresh authorization.

For a deliberately chosen native transfer into a separate test/recovery vault:

```sh
bun run password-manager backup extract /private/backup.pwm --destination /private/transfer.json
```

This explicit command writes **sensitive plaintext** Bitwarden JSON with owner-only
permissions and refuses to overwrite a file. Import it only in the selected isolated
destination, inspect its contents in the native application, then delete the transfer
file. `verify` and `restore` never perform this extraction or live-vault import.

Schedules use launchd (macOS) or a systemd user timer (Linux). They use the exact
Node/CLI path and private state directory, never Turbo, and never embed credentials.
A locked OS store yields actions. Default policy performs discovery/health/planning;
mutations require explicit `execution.autoApply`, `allowedKinds`, `allowedOrigins`
and `allowedAccounts`. Strong unique passwords do not get arbitrary scheduled
rotation. Stop overlap using durable locks. Inspect `status`/`actions list` after
scheduled work. Summaries are retained in private SQLite with backup freshness,
stale submitted operations, capability changes and notification identity; unchanged
pending-action sets do not produce a new notification identity. Local JSON is the
notification baseline. A required browser/MFA handoff stays pending during unattended
runs instead of generating duplicate plans or repeated authentication attempts.

Cleanup previews by default and purges expired staged secrets only for completed
password rotations with `--apply`. It also removes verified backups older than
`retentionDays`, retaining the two newest verified archives and all unverified ones. Incomplete-operation secrets are retained. Original
exports, vault items and browser records are not deleted incidentally. Deleting
source files is separately selected after complete scan and verified import:

```sh
bun run password-manager cleanup export SOURCE_ID
bun run password-manager cleanup export SOURCE_ID --apply
```

The exact private CSV/JSON snapshot must still match; all source items need verified
import/update mappings. Applying disables the source and deletes that export file
only. Original browser/vault stores, incomplete-operation credentials and encrypted
candidates remain intact. A `preserve` decision alone does not authorize export
cleanup. Deletion is not a promise of secure erasure from SSDs/backups.

Upgrades are deliberate repository maintenance: update exact package versions with
`bun add --cwd packages/password-manager PACKAGE@VERSION`, review `bun.lock`, update
matching dependency/version checks, install the new Playwright browser with setup,
and rerun all package checks and browser fixtures. Node/Bun updates go through root
`mise.toml`. No operational command implicitly updates tools.

## Development and verification

```sh
bun run --cwd packages/password-manager tc
bun run --cwd packages/password-manager lint
bun run --cwd packages/password-manager test
bun run --cwd packages/password-manager test:browser
```

Bun runs pure domain/connector fixtures; managed Node runs SQLite integration and
real process-kill/recovery tests. Browser fixtures use the production adapter
against a controlled loopback site with synthetic credentials. Default tests
require no personal secrets. Keep any dedicated live test separate and explicitly
selected. [Maintainer guide](docs/maintaining.md) describes adapter contracts and
[implementation ledger](docs/implementation.md) maps all 16 acceptance scenarios
to concrete evidence and clearly separates fixture and live validation.

## IMAP and confirmed inventories

1. Add an `imap` source with your exact `identity` in private `config.json`; set the
   provider's official TLS host, `port` (default 993) and `credentialRef`.
2. Store that reference through `secrets set REFERENCE` at a masked prompt, using
   JSON `{"pass":"provider-issued app password"}` or `{"accessToken":"provider-supported OAuth access token"}`.
   Follow the provider's native app-password/consent requirements with MFA intact;
   this package does not exchange Gmail API scopes for IMAP access.
3. Run `discover --source SOURCE_ID`. The client uses TLS and read-only INBOX
   selection, bounded headers and UID/UIDVALIDITY continuation. A UIDVALIDITY change
   causes rescan. Expired IMAP OAuth credentials require refreshing that explicit
   protected reference; there is no silent ordinary-password fallback.
4. To record accounts independently of mail, register kind `confirmed` with a
   private JSON array of `{origin, username, auth, identityProvider?}`. These are
   user-confirmed identities, not independently verified credentials.

## Troubleshooting

- `missing` / `wrong-version`: run the cold launcher or frozen reinstall, then
  `setup`; inspect `dependencies` for the declared owner and resolved local path.
- `locked`: unlock the desktop persistent credential store or run the selected
  vault operation in a terminal for its separate masked unlock prompt.
- `expired-connection` / `insufficient-scope`: reconnect the indicated mailbox with
  the original installed-app registration and requested read-only scopes.
- `incomplete` / `stale-cursor`: rerun discovery for that source. Expired pagination
  checkpoints reset to a full scoped scan; evidence already collected remains.
- `busy`: the package will not steal a lock from a live owner. Wait for that
  operation to finish; a terminated local owner's lock is recovered on the next
  attempt. Foreign-host/reused live-PID locks require deliberate local inspection.
- `outcome_unknown` / `reconciliation_required`: retain old and staged secrets and
  run the exact stored `recover` command. A second replacement is not generated.
- Unsupported site: the initial automated target is GitHub. Other origins receive
  an explicit native-workflow action; account closure, factor removal and vault
  deletion are never incidental migration behavior.
