# Automatic update recovery

Once a node is enrolled, routine system changes go through Git and CI. No SSH
command, reinstall or per-node approval is part of updating an existing node.
This applies after converting a Windows machine to its NixOS Fleet role too.

1. Merge the role configuration or code into `main`.
2. The independent Fleet cache workflow publishes the exact revision's signed
   closures. Nodes never compile an unpublished system locally.
3. Each online node polls after its previous attempt finishes: normally 300
   seconds plus up to 30 seconds of jitter and one second of timer accuracy.
   Boot schedules an attempt after 15 seconds plus that jitter.
4. An offline node keeps its existing generation. On reconnect or reboot, the
   same timer retries and selects current `main`, skipping missed intermediate
   commits. Delayed cache publication needs no additional commit or node action.
5. Activation must preserve an active update service and a timer enabled for
   subsequent boots. A failed health check restores the previous generation.

Kernel changes still use the configured reboot staggering and CI job drain.
That can delay a reboot by up to two hours before draining, and the drain itself
has a separate two-hour default bound. Other changes activate in place.

## Recovery boundaries

Only one updater can write the Git checkout or system profile at a time. Its
lock is inherited by child processes and released when those processes exit.
Once no writer exists, Git lock files left by interrupted updates are removed
from the private checkout automatically.

The previous generation stays GC-rooted while a candidate is unverified. If
power loss leaves the system profile on that candidate, the next attempt keeps
the saved rollback target instead of mistaking the candidate for a known-good
previous generation.

Fetch, substitution, profile selection, activation, rollback and runner recovery
are bounded. Commands that ignore termination are killed after a grace period.
Activation and rollback default to five minutes each, followed by a 30-second
kill grace. A stuck candidate cannot hold the timer indefinitely. Failed
attempts retain diagnostics and do not advance `last-success`.

The updater is not restarted midway through its own NixOS activation. The next
timer invocation uses the newly installed unit and script. The Fleet API can
be unavailable without blocking Git-based updates; an explicit `sync.paused`
setting still pauses updates until the operator clears it.

## Required evidence

- `tests/test_sync_recovery.py` runs the real pull script against a temporary Git
  repository and controlled dependency failures. It covers missed commits,
  delayed cache availability, inactive/disabled timers, stale Git locks and
  competing writers and interruption after profile selection, with
  previous-generation and success-marker assertions.
- `checks.update-units` verifies every deployable role and capability variant
  retains the boot timer, repeated scheduling and uninterrupted updater service.
- `checks.follow-up` runs a NixOS VM with a real systemd timer, Git checkout,
  system profile and command timeouts. It exercises slow updates, offline
  reboot, multiple missed releases, delayed cache publication, timer-breaking
  activation, hung activation, rollback, and two real NixOS generation switches
  that change the updater's own unit. Updates are driven by the timer throughout.
- The lifecycle and boot-health tests retain coverage for drain/resume,
  reboot failure, health rollback, generation retention and counted boot fallback.

The follow-up VM substitutes controlled fixture closures for external cache
downloads. Existing signature verification and exact-revision publication gates
remain mandatory; this test does not replace them. VM evidence also does not
prove a particular physical machine's firmware or recovery from hardware faults.
Qualify the first physical node by merging a harmless configuration change,
observing its reported revision advance, then repeating after an offline reboot
and confirming a real CI job succeeds.
