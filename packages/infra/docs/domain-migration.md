# Squarespace → Cloudflare domains

For owner authentication on macOS, run `bun domains browser`. This opens the
Squarespace domains dashboard in regular Google Chrome with a dedicated persistent
profile under ignored `.domain-migration/owner-chrome` (owner-only directory).
Google OAuth excludes embedded user agents, so use this window for **Continue with
Google**, rather than the IDE browser. Re-running the command reuses the same
profile. The launcher does not enable remote debugging, export cookies, inherit
infrastructure credentials, or change domain settings. It prepares authenticated access for the OpenTofu owner transport. Protect this profile as
account access and exclude it from shared artifacts.

`bun domains browser-inspect --json` uses pinned Playwright and the same dedicated
profile. It blocks non-read HTTP methods, WebSockets, foreign navigation and
untrusted subresources, disables service workers that could evade request routing,
and performs no clicks or typing. Successful observations are saved to ignored
owner-only evidence files, not printed to the terminal. The native macOS keychain
remains enabled so the existing Chrome sign-in can be reused without exporting or
copying cookies. Playwright uses a debugging pipe, not a network debugging port.

If the profile is already open, inspection exits 2 without stopping it. After
explicit approval of a controlled restart, `--restart-browser` sends SIGTERM only
to the fingerprinted dedicated Chrome process, waits for graceful exit, and
launches the scripted inspection. It never uses SIGKILL or closes another profile.
The inspection closes only the browser process it launched; sign-in persists in
the private profile. Domain-setting writes run only through the `owner` OpenTofu root.

References: [Google OAuth browser policy](https://developers.google.com/identity/protocols/oauth2/policies#browsers),
[Squarespace domains dashboard](https://support.squarespace.com/hc/en-us/articles/24115750615309-Access-your-domains-dashboard).

Start from the repository root:

```bash
bun migrate-domains-to-cloudflare
```

This entry point prepares and advances all 14 domains without prompts. It discovers account zones, captures complete Cloudflare baselines or explicit unused-source retirement observations, starts verified DNSSEC/delegation timers, and probes services. When prerequisites are available, it generates and checks the canonical inventory change, reviews an encrypted saved OpenTofu plan against the domain scope policy, applies those exact bytes, checks both critical domains before and after every apply, submits eligible transfers once, and secures completed registrations. It polls verified cache waits and pending transfer workflows automatically; owner actions and unavailable access produce explicit blockers. Exit **2 means blocked**, not migrated. Exit **0 requires every domain to be verified with Cloudflare registration, delegation, DNSSEC and applicable service checks**. Reports and baselines live under ignored `.domain-migration/` with private permissions; reruns preserve originals.

The `owner` OpenTofu root supplies scoped Squarespace browser operations through the published pinned REST provider. Each operation receives its own encrypted local state and saved plan. The policy review verifies the exact domain, action, payload, methods and loopback transport identity; only application of those reviewed bytes grants the browser a temporary write lease. The native browser never receives infrastructure credentials. A durable native intent is recorded before a setting request, and persisted UI readback is required for acceptance. Uncertain writes are preserved and never blindly replayed. DNSSEC disable and nameserver changes are limited to canonical best-effort unused retirement; the four existing Cloudflare delegations are preserved. Unlock and code-request operations require the full DNS-live gate. Authentication challenges remain genuine blockers; scripts cannot manufacture a signed-in account or bypass MFA.

The Cloudflare transfer-in operation remains in `foundation/domain-transfers.tf`, using the same published REST provider. It is disabled until the complete transfer gate passes. Native owner acceptance, Cloudflare workflow acceptance and completed registrar ownership are separate facts; no accepted operation alone proves migration completion.

The default command executes supported available stages; the commands below also provide individual diagnostics and recovery for the provider-owned steps. They do **not** represent completion of the zero-manual acceptance criterion. Under the owner's later instruction, unused domains have `dns_migration: retire-unused`: historical DNS and forwarding may be retired without a manual export. The two critical domains always use `preserve`.

## Scope and availability policy

Canonical configuration: [`locals.inventory.domains`](../tofu/modules/inventory/inventory.tf.json). Cloudflare infrastructure remains in the existing `foundation` root; native Squarespace operations are declared in `owner`. State addresses for the primary zone, existing records, redirects, tunnels and services are preserved. Merely adding a domain to inventory does not create its zone or transfer registration.

| Domain                  | Policy       | Expiration reported by owner | Initial observation, 2026-10-14                     |
| ----------------------- | ------------ | ---------------------------- | --------------------------------------------------- |
| chrisvouga.dev          | **Critical** | 2034-12-23                   | Cloudflare DNS; apex → www; www returns 200         |
| gamezilla.app           | **Critical** | 2027-09-17                   | Cloudflare DNS; apex → www; www returns 200         |
| colddrive.app           | Best effort  | 2028-11-26                   | Legacy Google DNS                                   |
| datoms.app              | Best effort  | 2029-01-18                   | Legacy Google DNS; existing HTTPS failures          |
| emulates.dev            | Best effort  | 2027-10-06                   | Squarespace DNS                                     |
| imageresizerservice.com | Best effort  | 2026-12-04                   | Legacy Google DNS; unused forwarding may retire     |
| linkpage.app            | Best effort  | 2028-01-11                   | Legacy Google DNS; unused forwarding may retire     |
| moviefinder.app         | Best effort  | 2027-07-15                   | Cloudflare DNS; existing www 525                    |
| normalizer.app          | Best effort  | 2028-10-23                   | Cloudflare DNS                                      |
| patchdb.dev             | Best effort  | 2029-03-27                   | Existing SERVFAIL; parent points to unavailable DNS |
| tabular.chat            | Best effort  | 2028-10-30                   | Legacy Google DNS                                   |
| thehiccups.band         | Best effort  | 2029-03-27                   | Legacy Google DNS                                   |
| tripolar.band           | Best effort  | 2028-08-18                   | Legacy Google DNS; existing www 404                 |
| voteonit.app            | Best effort  | 2026-12-30                   | Squarespace/NS1 DNS; existing HTTPS failures        |

Expiration dates above are owner-supplied observations, not renewal instructions or a live guarantee. Eligibility probes reread RDAP and require at least 30 days of expiration runway. Check near-expiry domains early; allow for a transfer taking up to 15 days. Recent registration, transfer or registrant-contact changes can impose locks. A renewal shortly after expiration can have different registry renewal-credit consequences; review the actual registry terms before paying twice.

Only `gamezilla.app` and `chrisvouga.dev` have mandatory website continuity. Their **entire** DNS record sets, proxy flags, origins, www/apex redirects and HTTPS must remain healthy. They already use Cloudflare, so keep the same account, zone IDs and assigned nameservers. Transfer registration separately; do not recreate a zone or change hosting. A green local check cannot guarantee that every Internet client will avoid an interruption.

For the other 12 domains, the owner explicitly accepts interruption and unused DNS/redirects may retire. The supported Squarespace DNSSEC toggle may retire signing while the old DS expires for these explicitly unused domains. This exception never applies to preserved or critical domains, and the actual parent/resolver DS absence and cache wait must still pass before delegation changes. Existing Cloudflare records are still backed up and preserved when available. Other unused domains can start with the canonical empty target zone, so source DNS export is not a prerequisite. Their observation explicitly says old records were not enumerated/backed up. Existing HTTPS/source-server failures are advisory. Credential, DNSSEC, target DNS and registration failures still block progression. No general “ignore errors” flag exists. Do not downgrade the two critical domains; the OpenTofu inventory tests enforce that policy.

Domain registration, authoritative DNS, web hosting and email subscriptions are different services. Moving registration and DNS does not move website files or mailbox contents. Keep hosting used by either critical domain. No workflow cancels Squarespace, Google Workspace, other subscriptions or the owner's account.

## Access, tools and local evidence

- Install the repository-pinned Bun and **OpenTofu 1.13.0** with `mise install`. `dig` must support TCP DNS. Linux: `dnsutils`; macOS includes `dig`.
- The runner first accepts `TF_VAR_cloudflare_api_token`, `CF_API_TOKEN` or `CLOUDFLARE_API_TOKEN`, plus `TF_VAR_cloudflare_account_id` or `CLOUDFLARE_ACCOUNT_ID`. It also reuses an explicit allowlist of existing foundation provider/state inputs from environment aliases or the Vault `secret/personal/dev` document using the current Vault login: Cloudflare token/account/zone, Railway token, GitHub token, PlanetScale service token, state passphrase/access keys and complete `TOFU_VAULT_INPUTS`. Explicit `TF_VAR_*` inputs take precedence; unrelated application secrets are not copied. State access keys also supply the AWS backend environment. It never writes or seeds secrets.
- Read scopes: account zone listing, zone/DNS read, DNSSEC/zone settings read; Registrar read for final registration checks; SSL certificate read if optional forwarding is retained. A 401/403/404 is missing evidence, never success. The new canonical Registrar API may require account availability/permissions that older tokens lack.
- Apply scopes and encrypted backend/provider inputs are described in [`tofu/README.md`](../tofu/README.md). The runner reuses original `backend.backend.json` files automatically. In a Git worktree, it can recover them from the original checkout after checking the exact account endpoint, root-specific state key, allowed non-secret fields and backend locking. It never copies another checkout's provider cache, plaintext state or credentials. It then initializes `foundation` and `fleet` with those original configurations. It reads both states and refuses missing or empty platform state; it never invents a backend, passphrase or initial adoption. Keep deployed image tags and other foundation inputs unchanged. Never initialize a replacement empty state or adopt an existing resource by creating a duplicate.
- A recovered foundation input bundle can be supplied as owner-only `.domain-migration/tofu-inputs.json`, or through `DOMAIN_TOFU_INPUTS_FILE`. Use the original foundation variable names (`state_passphrase`, `state_access_key`, `state_secret_key`, `vault_inputs`, etc.), with a boolean `migration_ready` and string values for other supported inputs. The runner loads only its explicit foundation input allowlist. Explicit environment inputs and aliases take precedence; Vault and the current GitHub login are fallbacks after the recovered bundle, so alternate credentials do not silently rotate managed GitHub secrets. Symlinks, public permissions and malformed inputs are rejected without printing contents. Restore from the existing protected backup, never generate a replacement passphrase or copy a historical scratch database URL. When no explicit value is supplied, the deployed Vault image revision and migration-ready flag are preserved from live foundation state.
- Squarespace ownership requires the correct account, recovery mailbox, MFA and domain registrant contact. Cloudflare needs billing and valid registrant details. Neither an API token nor possession of a DNS record proves registrant authorization. Do not copy MFA seeds, session cookies, EPP codes or payment details into tracked repository files, reports, shell arguments or logs. EPP batch intake is limited to the private ignored input or a secure environment.

```bash
bun run domains --help
bun run domains inventory       # every Cloudflare zone versus the 14-domain inventory
bun run domains discover        # public observations, not a zone export or readiness gate
bun run health --only domains --verbose
```

`inventory` still needs comparison against every Squarespace account. Public DNS and RDAP cannot enumerate all domains someone owns. The supplied 14-domain account list is the starting inventory.

The one-command runner creates the following files automatically. Advanced commands can create them individually with `bun run domains init <domain>`:

| File                                         | Purpose                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `source-records.json`                        | Complete source observation for domains not already on Cloudflare                                                           |
| `baseline.json`                              | Immutable source records, nameservers, capture time and positive/negative/DS/delegation TTLs                                |
| `account-operator.json`                      | Shared recovery, billing and retirement findings entered once; initially empty                                              |
| `operator.json`                              | Findings that the currently available APIs cannot prove; initially empty                                                    |
| `freeze.json`                                | Immutable timestamp of the declared DNS change freeze                                                                       |
| `observations.json`                          | Automatically started/reset DS absence and delegation soak timers                                                           |
| `inventory-draft-*.json`                     | Reviewable candidate canonical inventory; no remote mutation                                                                |
| `report-*.json`, `campaign-*.json`           | Dated checks, configuration/evidence hashes and exact blockers                                                              |
| `*.tfplan`, `*.tfplan.json`, `*.review.json` | Encrypted saved plan, hash/scope metadata and automatic policy review receipt                                               |
| `transaction-*.json`                         | Original canonical inventory and candidate hash for recovery                                                                |
| `*-attempt.json`, `.applied`, `.succeeded`   | Durable intent before apply, successful OpenTofu exit, and passing post-checks; distinguish uncertain writes                |
| `source-adopted.json`                        | Successfully adopted source stage; reruns still check actual DNS                                                            |
| `next-actions.json`                          | Latest exact nameservers, optional owner findings not recorded, code-presence flags and required blockers; no secret values |

Keep this directory on durable storage outside Git and back it up securely before a cutover. The snapshots include public DNS values that can reveal internal naming. Never upload raw provider state, plan JSON, contacts or these private exports as public CI artifacts. The command holds a private campaign lock while it can edit the canonical inventory; another live process or another host cannot take it over. A verified dead local PID is recovered automatically. A process killed during the synchronous lock-acquisition guard can leave `execution.lock.guard`; verify no runner is acquiring the lock before removing that guard. OpenTofu retains its backend locks. Exclusive baseline writes protect originals and report filenames are unique. On a failed apply, preserve state and reports and inspect a new plan; do not blindly retry.

## Default unattended execution

```bash
bun migrate-domains-to-cloudflare          # execute supported stages and monitor verified waits
bun migrate-domains-to-cloudflare --once   # execute available stages once, then exit
bun migrate-domains-to-cloudflare --audit  # prepare/probe only; never apply
bun migrate-domains-to-cloudflare --json   # JSON progress lines, including exact remaining-action path
```

The default has no polling deadline. Use `--deadline-seconds` for a bounded foreground run and `--interval-seconds` (60–3600, default 60) to change polling. Keep the host awake and process running. SIGINT/SIGTERM stops between safe operations and retains receipts; a closed host does not run a background scheduler. A blocked owner step stops once no other domain has an automatic wait to monitor. Pending and in-progress transfers are monitored without another submission. Blocked, action-required, failed or unknown workflow states require resolution of the existing workflow and stop automatic submission.

Startup, each domain's checks, encrypted state reads, plan review, apply, final verification and polling waits print progress immediately. Long operations emit a heartbeat every 15 seconds with elapsed time and the last stage. A serial foundation plan can take several minutes and has a 10-minute timeout. Human-readable progress goes to stderr; final reports remain on stdout. With `--json`, stdout contains stage and heartbeat events tagged `type: "progress"` or `type: "heartbeat"`, followed by the existing report objects. Progress never streams raw provider output, command arguments or secret values.

Complete Cloudflare baselines and explicit unused-source retirement policy supply machine evidence without owner sign-off fields. Full record parity, actual zone identity, DNSSEC/delegation/cache waits, RDAP eligibility, authorized EPP inputs, extension support, transfer state and required service probes remain mandatory. A transfer request is authorized and billable; its actual API/payment/workflow outcome must succeed before registration can be reported complete. Unsupported APIs, unavailable credentials, locked domains and uncertain/existing workflows still block submission.

Owner recovery, non-DNS dependencies, independent fee/payment review, mail delivery exercises and subscription retirement are separate advisory findings. They stay **SKIP** when unverified, and the runner makes no claim to have tested them. They do not require clerical sign-off to advance a verified migration. Source review remains mandatory for a preserved external `operator-export` baseline, since a public DNS scan cannot establish completeness. The current 14 domains use complete Cloudflare baselines or owner-authorized unused retirement, so no source export sign-off is needed.

Optional account recovery, billing and retirement findings can be entered once in `.domain-migration/account-operator.json`; per-domain findings override these shared fields. Enter only actual dated findings. `next-actions.json` separates optional findings from required blockers and lists exact account-assigned nameservers and code presence without secret values. The owner declared the other twelve domains unused, so their dependency/mail continuity reviews follow that canonical policy without fabricated attestations.

Supply all available raw EPP codes in one owner-only JSON object keyed by domain: ignored `.domain-migration/auth-codes.json`, an external file selected with `DOMAIN_AUTH_CODES_FILE`, or secure `TF_VAR_domain_auth_codes`. The runner rejects public file permissions, symlinks and malformed files without echoing their contents. Set file permissions to `600`; do not pass codes as shell arguments or commit the file. A new process rereads the batch on resume. Codes are only used for eligible initial transfers and never included in progress reports.

For each domain, the executor preserves a candidate inventory and reviews that it changes only the allowed adoption fields or enables that domain's transfer/registration resource. It installs the reviewed candidate locally, runs the full foundation plan, rejects unrelated changes/imports, deletes/replacements, altered baseline records and unsafe transfer paths, records its policy review with the encrypted-file hash, reruns gates, and applies the saved plan. **Automatic review uses the same strict guard as the individual plan/apply commands; it is not a general approval of foundation drift.** No `-target` or unconditional approval is used. Stages run serially against the shared state. The command can modify the canonical inventory; inspect its resulting Git diff before committing it. If the original encryption input or backend credentials are unavailable, execution stops before any infrastructure apply. Restore them from the protected backup through the environment or private input bundle; never replace them with newly generated values.

A rejected plan restores only the runner's exact inventory bytes, preserving concurrent edits. An uncertain apply retains desired configuration, the saved plan and a durable intent; it stops further writes to the shared state. An uncertain transfer resumes with workflow reads and never repeats a POST. Successful OpenTofu exit is recorded separately from post-check success, so later runs can continue read-only verification rather than replay an already applied change. If an uncertain workflow exists outside OpenTofu state, adopt that actual resource through a reviewed OpenTofu import before further foundation applies. Never delete an intent or state entry merely to force another purchase.

Unrelated foundation changes block every domain's scoped plan. The runner reports `FOUNDATION_DRIFT_REQUIRED` and stops redundant domain plans rather than widening the migration scope. Reconcile those changes only through their own reviewed saved OpenTofu plan. Domain-specific prerequisite failures still allow independent domains to advance.

After a successful source apply, a newly created empty unused zone may briefly return `REFUSED` from its assigned Cloudflare nameservers. If its API status is pending and every other mandatory baseline check passes, the runner retries only read-only baseline verification, at most 12 checks with 5 seconds between them. It never replays the apply or treats a refused answer as success. Other failures, existing zones and critical domains do not use this retry. A later run can resume verification from the successful apply receipt.

## Complete source inventory and preparation

For the four domains already delegated to the same Cloudflare account, the runner enumerates **all pages of DNS records** through authenticated GETs. Before and after checks use full RRsets, including repeated MX/TXT values. TXT case, spaces and chunked content are significant. Proxy and flattening hide origins from public DNS, so origin comparison uses the API rather than comparing public edge IPs.

For the other ten, the current explicit unused-domain retirement policy records parent delegation and TTL observations and uses the canonical empty target inventory. It does not require manual source enumeration or pretend to back up those old records. If a domain is later changed to `dns_migration: preserve`, capture every source dashboard DNS row and managed preset into the private `source-records.json`. Squarespace has no configured domain-management provider here, and a DNS quick scan/`ANY` query cannot discover DKIM selectors, private names, wildcards or every verification record. An incomplete preserved-domain source reports `SOURCE_BASELINE_REQUIRED`. Critical zones require nonempty verified records and can never select retirement.

Example observation format (use actual records, never these example addresses):

```json
{
  "records": [
    {
      "name": "example.com",
      "type": "A",
      "content": "192.0.2.10",
      "ttl": 3600,
      "proxied": false
    },
    {
      "name": "example.com",
      "type": "MX",
      "content": "mail.example.net",
      "priority": 10,
      "ttl": 3600,
      "proxied": false
    },
    {
      "name": "example.com",
      "type": "TXT",
      "content": "v=spf1 -all",
      "ttl": 3600,
      "proxied": false
    },
    {
      "name": "example.com",
      "type": "CAA",
      "data": { "flags": 0, "tag": "issue", "value": "letsencrypt.org" },
      "ttl": 3600,
      "proxied": false
    },
    {
      "name": "_sip._tcp.example.com",
      "type": "SRV",
      "data": {
        "priority": 10,
        "weight": 5,
        "port": 5060,
        "target": "sip.example.net"
      },
      "ttl": 3600,
      "proxied": false
    }
  ]
}
```

Supported migrations: A, AAAA, CNAME, MX, TXT, child NS, PTR, CAA and SRV. Unsupported types/private routing stop capture until both provider mapping and probes are implemented. They are never silently discarded. Exclude source-generated apex NS/SOA/DNSSEC signatures; preserve delegated child NS, associated glue addresses and their DS records through a separately reviewed mapping when present. DS/HTTPS/SVCB/TLSA and other unsupported types deliberately block the default adapter.

The remaining evidence fields are dated findings, not yes/no checkboxes. `sourceReview` identifies the complete export, presets and hidden selectors. `dependenciesReview` covers mail/DKIM/SPF/DMARC, forwarding, delegated children/glue, hosting, CAA/ACME and other verification records. `accountRecoveryReview` covers registrant access, independent recovery email and MFA. `transferEligibilityReview` covers current supported TLD, registrant/contact locks and verification requirements. `billingReview` covers payment/renewal. `mailRoundTripReview` records real send/receive evidence or verified absence of mailbox use. `retirementReview` records subscription dependencies and a safe retirement decision; it does not require cancellation before verification. These owner reviews are advisory and remain SKIP when unrecorded; `sourceReview` alone is a mandatory gate for an external operator-export baseline. No code fills findings with fabricated claims. The automatic completion verdict covers actual registration, DNS, configured security and declared service probes; it does not certify account recovery, mail round trips, other subscriptions or account closure.

Freeze DNS writers and deployments that change records, then capture once. Critical-domain changes to existing A/AAAA/CNAME origins, proxy, TLS or redirects are out of scope. Keep both source and destination DNS answering during a nameserver move.

```bash
bun run domains freeze gamezilla.app   # campaign already does this once
bun run domains capture gamezilla.app # campaign captures automatically when source is Cloudflare
bun run domains check gamezilla.app --stage source
bun run domains draft gamezilla.app
```

`draft` reads current encrypted `foundation` and `fleet` state to avoid importing already-owned records twice. New zones are supported without a pre-existing target. It emits stable record keys and existing zone/record IDs for OpenTofu import. The default runner performs the restricted candidate/plan review and installation automatically; with the individual `draft` command, review the candidate diff before replacing the canonical inventory, and keep `manage_registration: false` until the transfer is independently complete. Never remove existing primary records or addresses to fit a draft.

## OpenTofu staging and guarded apply

Draft review changes only repository files; automatic execution then applies the scoped saved plan through OpenTofu. All remote creates/imports/settings go through the foundation root, never a custom API writer. `manage_zone` gates additional zones; `prevent_destroy` protects zones, migration records and adopted registrations. The existing primary zone stays at `cloudflare_zone.primary`.

```bash
bun run domains plan example.com --stage source --plan dns-stage.tfplan
# Review the saved plan securely, then use its actual encrypted-file SHA-256:
bun run domains apply example.com --plan dns-stage.tfplan --reviewed-sha256 <actual-64-character-digest>
```

Before planning and immediately before/after applying any domain, the runner checks full baseline DNS and HTTPS/TLS for **both critical domains**. A critical failure blocks progression even when the selected domain is unused. The plan guard permits only the chosen domain's zone, baseline-identical records and disabled target DNSSEC during staging. Unrelated resource updates/imports, unknown actions, deletes, replacements, unexpected record values or accidental proxy changes fail. The secure purpose permits only that domain's DNSSEC and registration settings. Plans expire after one hour; any inventory/baseline/evidence change requires a new plan. Apply verifies the exact encrypted bytes, reruns fresh gates, uses `-parallelism=1`, and always attempts post-checks, including after a partial failed apply. Provider plaintext output is withheld from reports because it may include secrets. Use the standard infrastructure commands in a trusted local terminal for detailed diagnostics.

Do not use `-target`, `-auto-approve`, state removal, provider patches or `prevent_destroy` removal to force this migration through a blocked gate. For an unrelated foundation drift, resolve it through its normal reviewed change, then make a fresh domain plan.

For the two critical domains, staging should yield no traffic-affecting changes. Their source and target are already the same account/zone. If it proposes a zone replacement, different nameservers, origin/proxy change or new CDN/TLS behavior, stop and resolve ownership first.

## DNSSEC, delegation and cache waits

1. Capture the old DS TTL and source configuration **before** removing any old DS. Keep the old signer serving while its DS can still be cached. DNSKEY is not DS; parent DS is a registrar/registry setting.
2. If a parent DS exists, remove it at the existing registrar using its supported owner flow. Do not disable the old signer before the parent DS has disappeared and old DS caches have expired. Squarespace does not allow DNSSEC changes during a pending transfer.
3. Keep target DNSSEC disabled in OpenTofu until registration finishes. For the primary zone, change both `cloudflare.dnssec_status` and the matching domain policy if a future reviewed change requires it.
4. `observe` and every non-source `check` automatically record the first verified absence at every parent authority and at 1.1.1.1/8.8.8.8. A contradictory/unverifiable observation resets the timer. Gates wait the greater of the observed old TTLs and 48 hours. The same rule covers positive, negative and delegation caches; a lower current TTL does not erase older cached data.
5. Run the cutover gate. Only then set the exact account-assigned nameservers from `bun run infra output -json domain_nameservers` at the existing registrar. Do not copy nameservers from another account or another domain. For the critical two, leave their existing assigned nameservers unchanged.
6. Keep old DNS and required hosting active. Do not start the registrar transfer while a nameserver move is still propagating.

```bash
bun run domains observe example.com
bun run domains check example.com --stage baseline
bun run domains watch example.com --stage cutover --deadline-seconds 259200
# Provider-owned nameserver operation, if needed, happens here.
bun run domains watch example.com --stage dns-live --deadline-seconds 259200
```

Watch runs at a bounded interval, requires three consecutive full required passes, and exits nonzero on deadline. It is a foreground process: keep the machine awake and the process running. Reruns retain valid timer evidence and rerun real probes; this is not a hosted scheduler or a promise to continue after the host closes.

The owner permits retirement of the unused Squarespace forwards, so no forwarding rules are enabled by default. Their old responses remain advisory observations. If forwarding is deliberately retained later, the optional adapter stages DNS-only first, waits for active Cloudflare edge certificates, then a separate `forwarding` plan changes only explicit forwarding hosts to proxied/automatic TTL and installs redirect rules. It preserves configured status, path/query behavior and checks exact Location headers afterwards. Never proxy a critical domain as a side effect of registrar migration.

## Registrar-owned steps and final verification

The Squarespace actions below remain an unsupported ownership boundary. After the necessary owner access, code inputs and mandatory API/DNS/service checks are available, the one-command runner performs the Cloudflare plan/apply, polling and security steps automatically. Its [transfer guide](https://support.squarespace.com/hc/en-us/articles/205812338-Transferring-a-domain-away-from-Squarespace) requires owner actions. Its documented [Reseller API](https://developers.squarespace.com/reseller/api-fundamentals) can manage reseller DNS/nameservers, but requires partner-issued OAuth credentials and access to resold domains; a normal personal account or Commerce token does not establish that access. No applicable owner credential/adapter is configured here. Verify these recovery steps against the current account UI and TLD policy:

1. In the Squarespace domains dashboard, select the exact domain. Verify contact-email access, lock eligibility and expiration. Avoid changing registrant contacts immediately before transfer; this can introduce another lock. Existing renewal service stays in place until acceptance is confirmed.
2. After `dns-live` passes, unlock the domain. Request its transfer authorization code and complete the password/MFA reauthentication. The code email can take up to 24 hours. Use the newest code if several were requested. Do not disable privacy unless the actual gaining-registrar flow specifically requires it.
3. Rerun `check --stage transfer`: RDAP must have no hold/redemption/delete/transfer-prohibited status, old parent DS must be absent, exact Cloudflare delegation must have soaked, full target records and required HTTPS must pass, and the extension API/authorized EPP input must be available. Separate owner fee/payment findings are advisory; the actual transfer workflow and active registration are required proof of success.
4. Review Cloudflare's actual fees, supported API extension schema, default payment method, approved default registrant address-book entry/terms and remaining registration term for the **existing active zone in the same account**. Transfer fees/extensions are TLD-specific; a domain registered many years ahead needs maximum-term handling verified. Do not assume another year is always purchasable. An extension unsupported by the API remains blocked rather than using an undocumented fallback.
5. Once the source owner code is securely available, the OpenTofu transfer operation below submits it. Supply accurate registrant information/default contact and complete any required approval/verification emails. Do not substitute `cloudflare_registrar_domain` Create: provider 5.26.0 updates existing-registration settings. The new REST resource makes the one-time transfer request, base64-encodes the raw EPP code as required by Cloudflare, enables renewal/privacy, and never retries its billable POST automatically.
6. Leave DNS, hosting and email in place while the transfer is pending. Squarespace's pending-transfer state can prevent editing DNS/nameservers/DNSSEC. Its Squarespace Domains LLC/II email may provide a five-day **rejection** window; do not mistake it for an approval link. Optional expedited approval described for Tucows is registrar-specific.
7. Monitor until RDAP identifies Cloudflare (IANA 1910), the canonical registration API returns this exact domain as active with creation/expiration dates, and all DNS/service gates pass. A successful HTTP page or unchanged nameservers does not prove registrar transfer completion.

```bash
# Enable only this domain's transfer_enabled after ownership prerequisites exist.
# Supply raw codes in TF_VAR_domain_auth_codes via a secure environment/input;
# never put values in shell arguments, Git, receipts or log files.
bun run domains plan example.com --stage transfer --plan transfer.tfplan
bun run domains apply example.com --plan transfer.tfplan --reviewed-sha256 <actual-digest>
bun run domains watch example.com --stage secure --deadline-seconds 1209600 --interval-seconds 1800
```

Transfer plans are scoped to a single create/adopt of `restapi_object.domain_transfer["example.com"]`. The adapter first checks extension API availability and refuses a second submission if a workflow already exists. The provider uses the canonical registration GET for refresh, which remains stable from `transfer_pending` through `active`; updates/destruction have GET-only methods as an additional safeguard, and `prevent_destroy` blocks removal. The one-use EPP input is ignored after acceptance, so later CI need not keep supplying the code. State/plans remain encrypted and provider debug is off. The code is base64-encoded for the API, not thereby encrypted: keep plaintext plan JSON and debug logs private. If a POST times out, reread workflow/registration state and recover the existing resource before any retry. An accepted 202/pending workflow is not completed ownership.

Once ownership is independently complete, set `manage_registration: true` in inventory. The optional `secure` plan adopts auto-renew, transfer lock and WHOIS privacy through the published provider. It never re-registers the domain. If DNSSEC is desired, set the domain's status active in the reviewed secure plan (and the existing primary policy for the primary zone). After applying, verify the exact parent DS equals Cloudflare's signer and both validating resolvers return authenticated DNS data. Some registrar/registry operations are asynchronous; preserve the successful apply and rerun read-only checks while waiting rather than replaying it.

```bash
bun run domains plan example.com --stage secure --plan secure.tfplan
bun run domains apply example.com --plan secure.tfplan --reviewed-sha256 <actual-digest>
bun run domains watch example.com --stage complete --deadline-seconds 259200
bun run health --only domains,dns,tls,services --strict --verbose
bun run health --drift --verbose
bun migrate-domains-to-cloudflare
```

Only after all 14 registrations/DNS checks and both critical sites pass should the account/subscription retirement review be acted on. Check for domains in other accounts, forwarding/renewal charges, refunds, mailbox billing, required receipts/tax records and any remaining website subscription. Do not cancel a registrar domain to “release” it. Keep Cloudflare renewal billing and independent recovery working, relock transferred domains, verify dates and save receipts. Account closure is a separate irreversible owner action; this tooling does not silently perform it.

## Health automation, failures and rollback

`bun run health` now includes a `domains` group, so the existing daily **Infra health** workflow monitors declared zones, exact parent/recursive delegation, DNSSEC, additional records, registration locks/renewals/privacy and critical HTTPS. Missing credentials/staging/transfer evidence reports SKIP. The manual **Domain health** workflow can run a strict completion check or a partial progress check. Local migration gates are stricter than a partial progress report: every required SKIP/WARN fails. The owner's explicit noncritical service-availability policy is advisory, as are separately labeled optional owner-review notes. A missing access credential, source completeness, DNS/TLS failure or registrar result is never reclassified as an owner-review note.

| Failure                             | Automatic behavior                         | Recovery boundary                                                                             |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Source missing/unsupported RR       | No source guess, no apply                  | Complete export/mapping and recheck                                                           |
| DNS record/TTL/proxy mismatch       | Gate fails with record identity            | Reconcile via reviewed OpenTofu diff; preserve sibling records                                |
| Old DS cached/published             | Cutover and signer-disable blocked         | Keep old signer up; remove parent DS through supported owner/provider flow; wait verified TTL |
| Parent/resolver NS disagree         | Soak timer reset; no transfer              | Keep both DNS providers serving; wait or correct exact nameservers                            |
| Critical HTTP/TLS/redirect failure  | Stop required gate                         | Restore the last reviewed application/DNS configuration; leave registrar transfer unstarted   |
| Noncritical existing web failure    | Advisory, visible in report                | Owner accepts interruption; target DNS/registration checks remain mandatory                   |
| Locked/rejected/expired EPP/payment | No blind retry or repeated purchase        | Resolve the actual owner/registrar condition, then reread status                              |
| Interrupted apply                   | Post-check attempted, command fails        | Preserve encrypted state; inspect actual resources and a fresh plan before resuming           |
| Access revoked/API unavailable      | Failure or explicit SKIP, never completion | Restore scoped access; rerun read-only checks                                                 |

Before registration transfer, a nameserver rollback can restore the recorded source nameservers **only while the old DNS service still exists and has a compatible DS/signing state**. Keep both providers serving throughout rollback propagation. Remove/expire an incompatible parent DS before changing signers; do not blindly switch nameservers underneath a published DS. Fix ordinary record errors through OpenTofu on the active zone whenever possible.

After Cloudflare Registrar accepts the transfer, do not plan on immediately returning registration/nameservers to Squarespace: transfer locks and Cloudflare Registrar's nameserver requirements apply. Repair records/hosting on Cloudflare. An already submitted registrar transfer may not be cancellable; check its actual state and registrar support instead of starting another transfer. Never destroy/recreate the active zone, bucket, database, tunnel or service as a rollback.

## Authoritative references

- [Cloudflare transfer prerequisites, DNS first, approval and limitations](https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/)
- [Cloudflare full DNS setup and limitations of quick scan](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Squarespace transfer, reauthentication, DNSSEC and pending-transfer restrictions](https://support.squarespace.com/hc/en-us/articles/205812338-Transferring-a-domain-away-from-Squarespace)
- [Cloudflare Registrar transfer-in API](https://developers.cloudflare.com/api/resources/registrar/subresources/transfer_in/methods/create/) — implemented by the guarded OpenTofu REST resource
- [Pinned published REST provider](https://github.com/Mastercard/terraform-provider-restapi/tree/v3.0.0)
- [Squarespace partner-issued reseller authentication](https://developers.squarespace.com/reseller/api-fundamentals)
- [Canonical current registration read endpoint](https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/get/)
- [Pinned provider registrar implementation](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/internal/services/registrar_domain/resource.go)
- [Pinned provider registrar settings schema](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/docs/resources/registrar_domain.md)
- [Pinned provider DNS record schema/import format](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/docs/resources/dns_record.md)
