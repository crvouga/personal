#!/usr/bin/env bun
console.error('Domain migration cancelled: registrations remain at Squarespace. No migration actions are permitted. See packages/infra/docs/domain-migration.md.');
process.exitCode = 2;
