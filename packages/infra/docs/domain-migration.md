# Domains remain at Squarespace

The Cloudflare registrar/DNS consolidation was cancelled on 2026-10-14.
All 14 domains remain managed through Squarespace Domains. Registry RDAP identifies
`voteonit.app` as Tucows (IANA 69); that existing reseller arrangement is retained.
The other registrations remain with Squarespace registrar entities. Preserve the original nameservers;
Cloudflare DNS remains in use for `chrisvouga.dev`, `gamezilla.app`,
`moviefinder.app` and `normalizer.app`. Registrar ownership and DNS hosting are
separate services.

The ten empty pending Cloudflare zones created for the migration were removed
through a reviewed encrypted OpenTofu saved plan. Their DNSSEC resources were
also removed. Live parent delegation matched every original baseline before
cleanup. Critical website and DNS checks passed before and after the apply.
No transfer resource or transfer attempt receipt was found in the existing state
or local evidence. Existing Cloudflare zones, records, hosting, redirects and
subscriptions were retained.

The migration command now refuses execution. `bun domains inventory` and
`bun domains discover` are read-only. `bun health --only domains --verbose`
checks Squarespace registration/transfer locks, retained delegations, DNSSEC and
web endpoints. Missing Cloudflare credentials are reported as skipped API checks;
public registration and delegation checks still run. Desired policy remains in
`tofu/modules/inventory/inventory.tf.json`.

## Accepted unused-domain DNSSEC change

The migration disabled Squarespace DNSSEC for unused `emulates.dev` at
2026-10-15 02:46 UTC. The owner subsequently accepted leaving unused-domain
settings as they are, provided `chrisvouga.dev` and `gamezilla.app` are unaffected.
DNSSEC therefore remains disabled for `emulates.dev`; no owner login or further
rollback is required. No Squarespace nameserver change, domain unlock or EPP-code
request has a successful receipt.

All 14 domains remain transfer-locked, and live parent delegation still matches
the original baselines. A fresh scoped OpenTofu plan for the retained DNS zones,
records and DNSSEC resources reports no resource changes. Some unused websites
had pre-existing availability errors; these remain advisory. A cached DS for
`emulates.dev` can outlast the accepted DNSSEC disable; unused-domain DNSSEC
failures are advisory, while both critical domains retain mandatory checks.

The original encrypted owner-operation state, browser profile, baselines,
receipts, private source backup and cancellation plan/apply proof remain under
ignored `.domain-migration/`. Preserve these recovery records; do not commit or
publish them or replay old migration plans.
