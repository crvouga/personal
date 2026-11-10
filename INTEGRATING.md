# Integrating with shared infra — moved to the generated guides

Infrastructure docs for agents are split into two separate generated guides that
never share content:

- **Cloud app infrastructure** (Vault, PostgreSQL, R2 object store, Dockerized
  hosting on Railway, Google sign-in): [`llms-cloud.txt`](llms-cloud.txt),
  served at https://www.chrisvouga.dev/llms-cloud.txt
- **Local development infrastructure** (developer machines, toolchain, fleet,
  AI proxy, local Turborepo caching): [`llms-local.txt`](llms-local.txt),
  served at https://www.chrisvouga.dev/llms-local.txt

The index at https://www.chrisvouga.dev/llms-infra.txt routes to one of them.

This stub only exists so older links keep working. Point your project's
`AGENTS.md` / `CLAUDE.md` at the guide(s) above that it needs.
