# Squarespace → Cloudflare domains

Start from the repository root:

```bash
bun migrate-domains-to-cloudflare
```

This entry point resumes preparation for all 14 domains, uses existing Vault authentication to read the Cloudflare credential, discovers account zones, captures complete Cloudflare baselines, starts verified DNSSEC/delegation timers, probes public services, and writes a private report. It never prompts. Exit **2 means blocked**, not migrated. Exit **0 requires every domain to be verified with Cloudflare registration, delegation, DNSSEC and applicable service checks**. Reports and baselines live under ignored `.domain-migration/` with private permissions; reruns preserve originals.

**The requested unattended, zero-manual migration is currently blocked.** The pinned Cloudflare provider can update an existing registration but cannot initiate transfer-in. No configured published OpenTofu provider manages Squarespace domain unlocks, authorization codes, parent DS or nameservers. Those ownership operations also require account access and possibly reauthentication/email verification. The root instruction requires infrastructure changes exclusively through OpenTofu, so this command cannot use an alternate API writer or browser dashboard to bridge that gap. No registrar transfer is attempted, and no successful check stands in for missing ownership evidence. A compatible provider and authenticated owner access, or an explicit change to that repository constraint and a supported authenticated adapter, are needed for a fully unattended executor. Provider support alone does not remove registry locks or identity verification.

The commands below provide the supported automation and a precise operator recovery/runbook for the provider-owned steps. They do **not** represent completion of the zero-manual acceptance criterion. Under the owner's later instruction, unused domains have `dns_migration: retire-unused`: historical DNS and forwarding may be retired without a manual export. The two critical domains always use `preserve`.

## Scope and availability policy

Canonical configuration: [`locals.inventory.domains`](../tofu/modules/inventory/inventory.tf.json). Infrastructure remains in the existing `foundation` root. State addresses for the primary zone, existing records, redirects, tunnels and services are preserved. Merely adding a domain to inventory does not create its zone or transfer registration.

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

For the other 12 domains, the owner explicitly accepts interruption and unused DNS/redirects may retire. Existing Cloudflare records are still backed up and preserved when available. Other unused domains can start with the canonical empty target zone, so source DNS export is not a prerequisite. Their observation explicitly says old records were not enumerated/backed up. Existing HTTPS/source-server failures are advisory. Credential, DNSSEC, target DNS and registration failures still block progression. No general “ignore errors” flag exists. Do not downgrade the two critical domains; the OpenTofu inventory tests enforce that policy.

Domain registration, authoritative DNS, web hosting and email subscriptions are different services. Moving registration and DNS does not move website files or mailbox contents. Keep hosting used by either critical domain. No workflow cancels Squarespace, Google Workspace, other subscriptions or the owner's account.

## Access, tools and local evidence

- Install the repository-pinned Bun and **OpenTofu 1.13.0** with `mise install`. `dig` must support TCP DNS. Linux: `dnsutils`; macOS includes `dig`.
- The runner first accepts `TF_VAR_cloudflare_api_token`, `CF_API_TOKEN` or `CLOUDFLARE_API_TOKEN`, plus `TF_VAR_cloudflare_account_id` or `CLOUDFLARE_ACCOUNT_ID`. Otherwise it reads only the Cloudflare token/account fields from the existing Vault `secret/personal/dev` document using the current Vault login. It never writes or seeds secrets.
- Read scopes: account zone listing, zone/DNS read, DNSSEC/zone settings read; Registrar read for final registration checks; SSL certificate read if optional forwarding is retained. A 401/403/404 is missing evidence, never success. The new canonical Registrar API may require account availability/permissions that older tokens lack.
- Apply scopes and encrypted backend/provider inputs are described in [`tofu/README.md`](../tofu/README.md). Initialize `foundation` and `fleet` with their existing encrypted backends. Keep deployed image tags and other foundation inputs unchanged. Never initialize a replacement empty state or adopt an existing resource by creating a duplicate.
- Squarespace ownership requires the correct account, recovery mailbox, MFA and domain registrant contact. Cloudflare needs billing and valid registrant details. Neither an API token nor possession of a DNS record proves registrant authorization. Do not copy MFA seeds, session cookies, EPP codes or payment details into repository files, reports, shell arguments or logs.

```bash
bun run domains --help
bun run domains inventory       # every Cloudflare zone versus the 14-domain inventory
bun run domains discover        # public observations, not a zone export or readiness gate
bun run health --only domains --verbose
```

`inventory` still needs comparison against every Squarespace account. Public DNS and RDAP cannot enumerate all domains someone owns. The supplied 14-domain account list is the starting inventory.

The one-command runner creates the following files automatically. Advanced commands can create them individually with `bun run domains init <domain>`:

| File                               | Purpose                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `source-records.json`              | Complete source observation for domains not already on Cloudflare                            |
| `baseline.json`                    | Immutable source records, nameservers, capture time and positive/negative/DS/delegation TTLs |
| `operator.json`                    | Findings that the currently available APIs cannot prove; initially empty                     |
| `freeze.json`                      | Immutable timestamp of the declared DNS change freeze                                        |
| `observations.json`                | Automatically started/reset DS absence and delegation soak timers                            |
| `inventory-draft-*.json`           | Reviewable candidate canonical inventory; no remote mutation                                 |
| `report-*.json`, `campaign-*.json` | Dated checks, configuration/evidence hashes and exact blockers                               |
| `*.tfplan`, `*.tfplan.json`        | Encrypted OpenTofu saved plan plus hash/scope review metadata                                |

Keep this directory on durable storage outside Git and back it up securely before a cutover. The snapshots include public DNS values that can reveal internal naming. Never upload raw provider state, plan JSON, contacts or these private exports as public CI artifacts. The read-only campaign has no persistent lock to clean up after an interruption; exclusive baseline writes protect originals and report filenames are unique. Actual OpenTofu operations retain backend locking. On a failed apply, preserve state and reports and inspect a new plan; do not blindly retry.

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

The remaining evidence fields are dated findings, not yes/no checkboxes. `sourceReview` identifies the complete export, presets and hidden selectors. `dependenciesReview` covers mail/DKIM/SPF/DMARC, forwarding, delegated children/glue, hosting, CAA/ACME and other verification records. `accountRecoveryReview` covers registrant access, independent recovery email and MFA. `transferEligibilityReview` covers current supported TLD, registrant/contact locks and verification requirements. `billingReview` covers payment/renewal. `mailRoundTripReview` records real send/receive evidence or verified absence of mailbox use. `retirementReview` records subscription dependencies and a safe retirement decision; it does not require cancellation before verification. Missing findings remain blockers. No code fills them with fabricated claims.

Freeze DNS writers and deployments that change records, then capture once. Critical-domain changes to existing A/AAAA/CNAME origins, proxy, TLS or redirects are out of scope. Keep both source and destination DNS answering during a nameserver move.

```bash
bun run domains freeze gamezilla.app   # campaign already does this once
bun run domains capture gamezilla.app # campaign captures automatically when source is Cloudflare
bun run domains check gamezilla.app --stage source
bun run domains draft gamezilla.app
```

`draft` reads current encrypted `foundation` and `fleet` state to avoid importing already-owned records twice. New zones are supported without a pre-existing target. It emits stable record keys and existing zone/record IDs for OpenTofu import. Review the candidate diff before replacing the canonical inventory, and keep `manage_registration: false` until the transfer is independently complete. Never remove existing primary records or addresses to fit a draft.

## OpenTofu staging and guarded apply

Draft review changes only repository files. All remote creates/imports/settings go through the foundation root, never a custom API writer. `manage_zone` gates additional zones; `prevent_destroy` protects zones, migration records and adopted registrations. The existing primary zone stays at `cloudflare_zone.primary`.

```bash
bun run domains plan example.com --stage source --plan dns-stage.tfplan
# Review the saved plan securely, then use its actual encrypted-file SHA-256:
bun run domains apply example.com --plan dns-stage.tfplan --reviewed-sha256 <actual-64-character-digest>
```

The plan guard permits only the chosen domain's zone, baseline-identical records and disabled target DNSSEC during staging. Unrelated resource updates/imports, unknown actions, deletes, replacements, unexpected record values or accidental proxy changes fail. The secure purpose permits only that domain's DNSSEC and registration settings. Plans expire after one hour; any inventory/baseline/evidence change requires a new plan. Apply verifies the exact encrypted bytes, reruns fresh gates, uses `-parallelism=1`, and always attempts post-checks, including after a partial failed apply. Provider plaintext output is withheld from reports because it may include secrets. Use the standard infrastructure commands in a trusted local terminal for detailed diagnostics.

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

These are the unsupported automation boundary, not hidden work completed by the one-command runner. The current authoritative [Squarespace transfer guide](https://support.squarespace.com/hc/en-us/articles/205812338-Transferring-a-domain-away-from-Squarespace) requires owner actions. Verify these steps against current account UI and TLD policy when the provider gap is resolved:

1. In the Squarespace domains dashboard, select the exact domain. Verify contact-email access, lock eligibility and expiration. Avoid changing registrant contacts immediately before transfer; this can introduce another lock. Existing renewal service stays in place until acceptance is confirmed.
2. After `dns-live` passes, unlock the domain. Request its transfer authorization code and complete the password/MFA reauthentication. The code email can take up to 24 hours. Use the newest code if several were requested. Do not disable privacy unless the actual gaining-registrar flow specifically requires it.
3. Rerun `check --stage transfer`: RDAP must have no hold/redemption/delete/transfer-prohibited status, old parent DS must be absent, exact Cloudflare delegation must have soaked, full target records and required HTTPS must pass, and eligibility/billing evidence must exist.
4. Use Cloudflare's Transfer Domains flow for the **existing active zone in the same account**. Review actual fees and remaining registration term before committing. Transfer fees/extensions are TLD-specific; a domain already registered many years ahead needs maximum-term handling verified by Cloudflare. Do not assume the displayed expiration implies an additional year is always purchasable.
5. Supply the authorization code through the secure registrar flow, confirm accurate registrant information and terms, and complete required approval/verification emails. The configured provider cannot submit this operation. Do not substitute `cloudflare_registrar_domain` Create: provider 5.26.0 calls the existing-registration settings API, not transfer-in.
6. Leave DNS, hosting and email in place while the transfer is pending. Squarespace's pending-transfer state can prevent editing DNS/nameservers/DNSSEC. Its Squarespace Domains LLC/II email may provide a five-day **rejection** window; do not mistake it for an approval link. Optional expedited approval described for Tucows is registrar-specific.
7. Monitor until RDAP identifies Cloudflare (IANA 1910), the canonical registration API returns this exact domain as active with creation/expiration dates, and all DNS/service gates pass. A successful HTTP page or unchanged nameservers does not prove registrar transfer completion.

```bash
bun run domains check example.com --stage transfer
# Transfer via supported registrar owner/provider flow.
bun run domains watch example.com --stage secure --deadline-seconds 1209600 --interval-seconds 1800
```

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

`bun run health` now includes a `domains` group, so the existing daily **Infra health** workflow monitors declared zones, exact parent/recursive delegation, DNSSEC, additional records, registration locks/renewals/privacy and critical HTTPS. Missing credentials/staging/transfer evidence reports SKIP. The manual **Domain health** workflow can run a strict completion check or a partial progress check. Local migration gates are stricter than a partial progress report: every required SKIP/WARN fails. The only exception is the owner's explicit noncritical service-availability policy.

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
- [Cloudflare Registrar transfer-in API](https://developers.cloudflare.com/api/resources/registrar/subresources/transfer_in/methods/create/) — a documented endpoint does not make it a configured OpenTofu resource
- [Canonical current registration read endpoint](https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/get/)
- [Pinned provider registrar implementation](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/internal/services/registrar_domain/resource.go)
- [Pinned provider registrar settings schema](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/docs/resources/registrar_domain.md)
- [Pinned provider DNS record schema/import format](https://github.com/cloudflare/terraform-provider-cloudflare/blob/v5.26.0/docs/resources/dns_record.md)
