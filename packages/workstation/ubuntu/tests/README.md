# Disposable Ubuntu reliability tests

Run from the repository root on Linux amd64 with Docker, KVM, the pinned Bun,
network access to the official release archives, and enough disk for a 12 GiB
sparse guest. This uses an isolated Ubuntu 26.04 VM; it never targets fleet hosts.
The test image is tooling, not a replacement OS image for development machines.

```sh
fleet_test_dir=$(mktemp -d)
mkdir -p "$fleet_test_dir/vm" "$fleet_test_dir/t3" "$fleet_test_dir/verification"
docker build -t personal-fleet-test-tools packages/workstation/ubuntu/tests
bun build packages/workstation/ubuntu/tests/runtime-check.ts --compile --outfile "$fleet_test_dir/verification/verify"
curl --fail --location --proto '=https' https://github.com/pingdotgg/t3code/releases/download/v0.1.7/t3-0.1.7-linux-x64.tar.gz --output "$fleet_test_dir/t3/t3.tar.gz"
docker run --rm --device /dev/kvm \
  -v "$PWD:/workspace:ro" \
  -v "$fleet_test_dir/vm:/artifacts" \
  -v "$fleet_test_dir/t3:/t3:ro" \
  -v "$fleet_test_dir/verification:/verification:ro" \
  personal-fleet-test-tools
```

The harness verifies the Ubuntu image and T3 checksums before use. It generates
fixture SSH identities, trusts only that explicit host key, and uses QEMU's
private forwarded SSH port. It does not mount host credentials, host networking,
the Docker socket, or production application data. All VM logs and fixture keys
remain under the private temporary directory; do not publish that directory.
Reuse the directory for an existing-machine rerun; use a new directory for a
fresh-machine test. VM termination is bounded even after a failed assertion.

The tracked test covers:

- Real Ansible baseline application, a second no-change application, validated
  sudoers, sleep masks, lingering, fresh SSH after reboot, and preserved work.
- Injected owned SSH/power drift repaired by the unchanged source baseline,
  followed by a no-change run. A capacity-policy fault refuses changes without
  filling the disk or killing user work.
- Pinned native T3 installation, unchanged service PID on repeated setup,
  injected service crash recovery, loaded administrator policy, and reboot.
- Pinned stock Beszel hub, missing native Docker/Compose installation, repeated
  no-op, and container restart after reboot.
- Native Beszel agent installation through the production private-variable-file
  adapter, repeated no-op with unchanged PID, bounded crash recovery, and reboot.
  Its fixture hub deliberately resolves to guest loopback with no HTTPS listener.
  This proves failure isolation and service lifecycle, **not** authenticated metrics.
- The production boot-policy observer compiled into a disposable test executable
  and run after the guest reboot. That executable is never a deployed service.

Separately, `python3 packages/workstation/monitoring/tests/upstream.py` runs real
pinned Beszel binaries with a disposable loopback hub. It checks supported account
and enrollment APIs, authenticated metrics, preserved registration/fingerprint,
and the supported backup/restore API. It uses no production accounts.

These tests do not prove multi-target controller bootstrap, intended-tailnet
connectivity, private TLS reachability, paired T3 execution, live provider accounts,
off-host disaster recovery, or every hardware/desktop configuration. Track those
separately in Fleet's acceptance issues. Never replace missing evidence with a
mocked pass, or run destructive fault injection against a live development box.
