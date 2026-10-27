This package owns cloud resources through OpenTofu in `tofu/`, plus read-only inventory, build, health and documentation adapters. Do not add application schemas, physical-machine configurations, provisioning scripts or reconciliation controllers here.

See `tofu/README.md` for roots, encrypted state and migration rules. External application repositories own their code, schemas, migrations and publisher workflows. The `services` root hosts applications through generic inventory entries.
