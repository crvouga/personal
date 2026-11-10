#!/usr/bin/env bash
# Workflow step shell: behaves like `bash -eo pipefail {0}` and also appends the
# step's script and output to one log that failure-summary.mjs reads.
set -o pipefail
log="${RUNNER_TEMP:-/tmp}/ci-steps.log"
{ printf '\n::ci-step::\n'; cat "$1"; printf '\n::ci-output::\n'; } >> "$log"
bash --noprofile --norc -eo pipefail "$1" 2>&1 | tee -a "$log"
