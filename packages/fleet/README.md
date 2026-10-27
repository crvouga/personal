# This platform’s Fleet configuration

Fleet is maintained at https://github.com/crvouga/fleet. This directory retains
the existing `packages/fleet` flake path for installed machines. It imports a
pinned upstream implementation and supplies this installation’s settings only.

Initialize application sources with `git submodule update --init --recursive`.
The matching source pin is in `source.json`. Keep it identical to `vendor/fleet`.
The API image builds from that submodule; platform OpenTofu continues owning the
existing infrastructure and schema resource addresses. No source migration step
applies a plan, deploys the API, installs an OS or rolls a node.

See `MIGRATION.md` for validation, rollout and rollback ownership.
