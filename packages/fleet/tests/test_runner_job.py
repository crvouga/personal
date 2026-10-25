#!/usr/bin/env python3
"""Runner hook metadata never contains arbitrary environment or job output."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import runner_job


class RunnerJobTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "slot-1").mkdir()
        self.path = self.root / "slot-1/job.json"
        self.env = {"FLEET_RUN": str(self.root), "FLEET_SLOT": "slot-1", "GITHUB_REPOSITORY": "owner/repo",
                    "GITHUB_RUN_ID": "1234", "GITHUB_JOB": "build", "GITHUB_TOKEN": "do-not-send", "PASSWORD": "secret"}

    def test_start_completion_and_stop_capture_only_safe_identity(self):
        with mock.patch.object(runner_job, "timestamp", return_value="2026-10-25T01:00:00Z"):
            self.assertTrue(runner_job.record("started", self.env))
        started = json.loads(self.path.read_text())
        self.assertEqual(started, {"repository": "owner/repo", "runId": "1234", "jobName": "build",
            "startedAt": "2026-10-25T01:00:00Z", "finishedAt": None, "result": None})
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)
        with mock.patch.object(runner_job, "timestamp", return_value="2026-10-25T02:00:00Z"):
            self.assertTrue(runner_job.record("completed", dict(self.env, GITHUB_JOB="untrusted-replacement")))
        completed = json.loads(self.path.read_text())
        self.assertEqual(completed["jobName"], "build")
        self.assertEqual(completed["finishedAt"], "2026-10-25T02:00:00Z")
        self.assertEqual(completed["result"], "completed")
        self.assertTrue(runner_job.record("stopped", self.env))
        self.assertEqual(json.loads(self.path.read_text()), completed)
        self.assertNotIn("do-not-send", self.path.read_text())

    def test_listener_stop_records_interruption_without_claiming_job_success(self):
        runner_job.record("started", self.env)
        runner_job.record("stopped", self.env)
        value = json.loads(self.path.read_text())
        self.assertEqual(value["result"], "interrupted")
        self.assertIsNotNone(value["finishedAt"])

    def test_invalid_slot_repository_and_environment_are_rejected(self):
        self.assertFalse(runner_job.record("started", dict(self.env, FLEET_SLOT="../../outside")))
        runner_job.record("started", dict(self.env, GITHUB_REPOSITORY="../..", GITHUB_RUN_ID="1;rm", GITHUB_JOB="\x00x"))
        value = json.loads(self.path.read_text())
        self.assertIsNone(value["repository"])
        self.assertIsNone(value["runId"])
        self.assertIsNone(value["jobName"])

    def test_io_failure_is_best_effort_and_never_blocks_runner(self):
        with mock.patch.dict(os.environ, self.env, clear=True), mock.patch.object(runner_job, "record", return_value=False):
            self.assertEqual(runner_job.main(["started"]), 0)

    def test_deep_untrusted_json_and_unexpected_errors_never_fail_hook(self):
        self.path.write_text("[" * 1500 + "0" + "]" * 1500)
        self.assertTrue(runner_job.record("completed", self.env))
        self.assertEqual(json.loads(self.path.read_text())["result"], "completed")
        with mock.patch.dict(os.environ, self.env, clear=True), mock.patch.object(runner_job, "record", side_effect=RuntimeError("password=secret")):
            with mock.patch("sys.stderr") as stderr:
                self.assertEqual(runner_job.main(["completed"]), 0)
                self.assertNotIn("password", str(stderr.write.call_args_list))


if __name__ == "__main__":
    unittest.main()
