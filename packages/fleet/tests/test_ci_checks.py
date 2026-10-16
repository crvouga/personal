"""The parallel scheduler must retain all checks, including future additions."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("ci_checks", Path(__file__).parents[1] / "scripts/ci-checks.py")
ci_checks = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci_checks)


class CheckScheduling(unittest.TestCase):
    def test_every_check_runs_once_and_new_checks_are_not_lost(self):
        names = ["node", "web", "cache", "netboot", "devbox", "agent-units", "cattle", "future-check"]
        names += [name for group in ci_checks.SPECIAL.values() for name in group]
        groups = ci_checks.partition(names)
        self.assertCountEqual([name for group in groups.values() for name in group], names)
        self.assertIn("future-check", groups["roles"])
        self.assertEqual(groups["image"], ["installer"])

    @patch.object(subprocess, "check_output", return_value='["node", "installer", "vm"]')
    @patch.object(subprocess, "run")
    def test_image_has_one_build_and_preserves_git_revision(self, run, output):
        ci_checks.run("image")
        run.assert_called_once()
        command = run.call_args.args[0]
        self.assertEqual(command[-1], ".#checks.x86_64-linux.installer")
        self.assertEqual(command[command.index("-o") + 1], "result-iso")
        self.assertNotIn("path:.", " ".join(command))
        self.assertEqual(command[command.index("--max-jobs") + 1], "2")
        self.assertTrue(run.call_args.kwargs["check"])

    @patch.object(subprocess, "check_output", return_value='["node", "installer"]')
    @patch.object(subprocess, "run")
    def test_full_evaluation_runs_once_without_building_all_groups(self, run, output):
        ci_checks.run("roles")
        self.assertIn("--no-build", run.call_args_list[0].args[0])
        self.assertEqual(run.call_args_list[1].args[0][-1], ".#checks.x86_64-linux.node")

    @patch.object(subprocess, "check_output", return_value='["node"]')
    def test_missing_image_fails_instead_of_succeeding_empty(self, output):
        with self.assertRaises(ValueError):
            ci_checks.run("image")

    def test_unknown_group_fails(self):
        with self.assertRaises(ValueError):
            ci_checks.run("typo")
