# Fleet deployment configuration

Fleet implementation, installer, API, schema, tests and workflows are owned by
https://github.com/crvouga/fleet. `vendor/fleet` pins the source used for API
builds and schema validation; `source.json` pins the identical Nix input.
Update both together after upstream CI passes.

This directory contains only this platform's machine configuration and encrypted
SOPS inputs. Preserve existing repository paths so installed nodes keep following
this compatibility flake. Never place reusable Fleet implementation here.

Cloud infrastructure and secrets remain exclusively OpenTofu-owned. Do not apply
infrastructure or change machines as part of a source dependency update. Disk
installation requires explicit approval naming the disk. Never commit plaintext
secrets or private age keys. Review upstream changes before advancing the pin.
