# OpenBao service

This package contains the OpenBao runtime image, health proxy and private auth/read implementation behind `personal infra-vault`. Every infrastructure resource is owned by [OpenTofu](../infra/tofu/README.md): Railway hosting and DNS, PlanetScale Postgres storage and schema, initialization/unseal, KV mounts, policies, auth backends, users, tokens and secret data.

```bash
bun run infra plan
bun run infra:bootstrap plan
bun run infra:vault plan
```

Import the existing initialization output before applying the bootstrap root. Its encrypted state owns the original root token and unseal shares; never initialize a replacement seal or commit these credentials. CI applies the bootstrap root after deployment. The root token is consumed by the vault configuration root through encrypted remote state.

The runtime expects `DB_CONNECTION_URI` and `BAO_API_ADDR` from OpenTofu-managed Railway variables. The Atlas schema resource owns `secret_store`; there is no standalone migration/provisioning script or Makefile.

Install the single CLI with `bun run personal:install`; the old `scripts/install-cli.sh` forwards to it. `vault login`, `personal infra-vault setup --project personal --config dev`, and `personal infra-vault run -- <command>` remain available for authentication and secret reads. Secret updates must go through the OpenTofu vault root. The CLI does not provision infrastructure.
