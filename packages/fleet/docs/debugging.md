# Debugging Fleet installer failures

Start with the diagnostic report from **Copy diagnostic report** or **Save
diagnostic report**. When a GitHub issue says log tails were shortened, its
missing logs are not evidence that the helper did nothing. The saved
`fleet-diagnostic.txt` contains the full report and can be attached to the issue.
Reports are redacted but can contain local paths and hardware details; review
them before sharing publicly. Never request an enrollment token, Wi-Fi password,
private key, `request.json` or a Windows staging journal as public evidence.

## Find the boundary that failed

1. Read **Version**, **Attempt**, **Mode**, **State** and **step**. Use that source
   revision when investigating an older downloaded executable; the rolling
   release and current `main` may have changed. **Verified image** identifies
   the downloaded ISO independently of the wizard build. An absent checksum
   means verification had not completed.
2. Read **Checks**. These are snapshots from the review, privileged preflight
   and any check after automatic preparation. Compare stages; a check that
   changes after elevation or preparation points to that boundary. Preserve
   every blocker, its measured detail and its fix. A missing stage means it
   was not recorded, not that its checks passed.
3. Read **Error type**, **Source**, **Context**, `errno` and `winerror`. Source
   locations exclude local variables. Use the matching source revision to
   inspect the invariant or failing operation. Expected refusals and unexpected
   exceptions both carry this evidence when caught by the wizard or helper.
4. Read **Timeline** to identify the last actual phase and elapsed time. Log
   messages do not replace the phase with `log`. The terminal duration freezes
   when the job finishes. Attempts get new IDs on retries.
5. Read **Job steps** and both **Log** sections. The helper's log may belong to
   another OS account; its last lines travel inside its result so the report
   can include them even if the window cannot open that file. If the helper
   dies before writing a result, that evidence may be unavailable. Search the
   logs for `attempt=<id>` to correlate them; an ID is not an authorization token.

An unelevated **System: Administrator: no** describes the browser server, not
the privileged helper. The helper's recorded privilege check describes its own
process. Unknown or unreadable progress means disk changes are possible. Wait
for a running helper to finish; never kill it or erase again just to get logs.

## Reproduce without touching hardware

From the repository root:

```sh
python3 -B packages/fleet/tests/test_wizard_evidence.py
python3 -B packages/fleet/tests/test_wizard_diagnostics.py
python3 -B packages/fleet/tests/test_wizard_automation.py
python3 -B packages/fleet/tests/test_wizard.py
```

Use the `WizardCase` fixture in `tests/test_wizard.py` for server/helper
regressions. It runs the real HTTP server, local image download and helper
against synthetic disk inventory and a regular file. Test failing checks,
unreadable logs, helper crashes and missing results at their boundaries. Keep
hardware probes mocked or use existing stand-ins. `FLEET_WRITE_TARGET` requires
`FLEET_DISKS_FILE`; neither is a way to point tests at a real disk. Windows raw
writes and firmware have their own regular-file stand-ins described in
[windows.md](windows.md).

CLI-only reports can use the read-only `fleet-node.sh doctor ROLE --json`
command from [agent-install.md](agent-install.md). Do not rerun an installation,
enroll again, change firmware, alter a boot entry or modify a staging journal
to collect evidence. A successful stand-in test proves the software boundary;
it does not prove a physical firmware handoff.

## Keep future failures diagnosable

Use `decide.invariant` with a concrete explanation, measured context and a safe
next step. Record additional preflight stages with `Progress.record_checks`;
only the check name, status, detail and fix enter reports. Do not pass whole
request, plan, environment or credential objects. Add user recovery rules to
`wizard/diagnostics.py` when the response is known. Test that essential evidence
survives the helper result, server cleanup and shortened GitHub issue, with
secrets redacted. Keep the full log for causes that do not fit in a URL.
