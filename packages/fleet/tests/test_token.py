import importlib.util
import contextlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runner_control", Path(__file__).parents[1] / "scripts/runner_control.py")
token = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"jwt": types.SimpleNamespace(encode=lambda *a, **k: "signed-jwt")}):
    spec.loader.exec_module(token)


class TokenTests(unittest.TestCase):
    def test_transport_throttling_and_server_errors_are_temporary_but_auth_denial_is_not(self):
        for status in (403, 408, 429, 503):
            error = token.urllib.error.HTTPError('https://api.github.invalid', status, 'fixture', {}, None)
            expected = RuntimeError if status == 403 else token.GitHubUnavailable
            with self.subTest(status=status), patch.object(token.urllib.request, 'urlopen', side_effect=error):
                with self.assertRaises(expected):
                    token.request('GET', '/fixture', 'fixture-token')
        error = token.urllib.error.HTTPError('https://api.github.invalid', 403, 'fixture', {'X-RateLimit-Remaining': '0'}, None)
        with patch.object(token.urllib.request, 'urlopen', side_effect=error), self.assertRaises(token.GitHubUnavailable):
            token.request('GET', '/fixture', 'fixture-token')

    def test_status_is_read_only_and_counts_only_this_full_node_prefix(self):
        prefix = 'ci-aaaa-' + '1' * 32
        runners = [{'name': prefix + '-slot-1', 'status': 'online'},
                   {'name': prefix + '-slot-2', 'status': 'offline'},
                   {'name': prefix + '-slot-65', 'status': 'online'},
                   {'name': prefix + '-unrelated', 'status': 'online'},
                   {'name': 'ci-aaaa-' + '2' * 32 + '-slot-1', 'status': 'online'}]
        output = io.StringIO()
        with patch.object(token, 'app_token', return_value='fixture'), \
                patch.object(token, 'request', return_value={'runners': runners}) as request, \
                patch.object(sys, 'argv', ['runner-control', 'status', 'repository', 'example/private', '1', '2', 'key', prefix]), \
                contextlib.redirect_stdout(output):
            token.main()
        self.assertEqual(json.loads(output.getvalue()), {'registered': 4, 'online': 3,
                                                        'onlineNames': [prefix + '-slot-1']})
        self.assertTrue(all(call.args[0] == 'GET' for call in request.call_args_list))

    def test_registration_token_is_written_atomically_without_stdout(self):
        for scope, target, prefix in (("organization", "private-org", "/orgs/"), ("repository", "owner/private", "/repos/")):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as temp:
                key = Path(temp) / "private.pem"
                key.write_text("mock-key")
                output = Path(temp) / "tokens" / "slot-1"
                calls = []

                def api(method, path, auth, payload=None):
                    calls.append((method, path, auth, payload))
                    return {"token": "installation" if path.startswith("/app/") else "registration"}

                argv = ["token", "register", scope, target, "123", "456", str(key), str(output)]
                with patch.object(sys, "argv", argv), patch.object(token, "request", side_effect=api):
                    token.main()
                self.assertEqual(calls[0][1], "/app/installations/456/access_tokens")
                self.assertEqual(calls[1][1], prefix + target + "/actions/runners/registration-token")
                self.assertEqual(output.read_text(), "registration")
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                self.assertFalse(Path(str(output) + ".new").exists())

    def test_drain_removes_all_custom_labels_then_waits_for_idle(self):
        responses = iter([
            {"runners": [{"id": 12, "name": "ci-aabb-slot-1", "busy": True,
                          "labels": [{"name": "self-hosted"}, {"name": "Linux"}, {"name": "ci"}, {"name": "high-mem"}]}]},
            None, None,
            {"runners": [{"id": 12, "name": "ci-aabb-slot-1", "busy": True}]},
            {"runners": [{"id": 12, "name": "ci-aabb-slot-1", "busy": False}]},
        ])
        calls = []

        def api(method, path, auth, payload=None):
            calls.append((method, path, payload))
            return next(responses)

        with patch.object(token, "app_token", return_value="short-lived"), \
             patch.object(token, "request", side_effect=api), \
             patch.object(token.time, "sleep", return_value=None), \
             patch.object(sys, "argv", ["runner-control", "drain", "organization", "private-org", "1", "2", "key", "ci-aabb", "30"]):
            token.main()
        removed = [path for method, path, _ in calls if method == "DELETE"]
        self.assertIn("/orgs/private-org/actions/runners/12/labels/ci", removed)
        self.assertIn("/orgs/private-org/actions/runners/12/labels/high-mem", removed)
        self.assertEqual(calls[1][0], "DELETE")

    def test_pagination_does_not_miss_nodes_after_first_page(self):
        first = [{"id": i, "name": "other"} for i in range(100)]
        with patch.object(token, "request", side_effect=[{"runners": first}, {"runners": [{"id": 101, "name": "ci-target-slot-1"}]}]) as request:
            result = token.list_runners("organization", "org", "installation")
        self.assertEqual(len(result), 101)
        self.assertIn("page=2", request.call_args[0][1])

    def test_withdraw_deletes_an_idle_runner(self):
        calls = []

        def api(method, path, auth, payload=None):
            calls.append((method, path))
            if method == "GET":
                return {"runners": [{"id": 7, "name": "ci-test-slot-1", "busy": False, "labels": [{"name": "ci"}]}]}
            return None

        with patch.object(token, "app_token", return_value="installation"), \
             patch.object(token, "request", side_effect=api), \
             patch.object(sys, "argv", ["runner-control", "withdraw", "organization", "example-org", "1", "2", "key", "ci-test"]):
            token.main()
        self.assertIn(("DELETE", "/orgs/example-org/actions/runners/7"), calls)
        self.assertFalse(any(path.endswith("/7") is False and "/labels/" not in path and method == "DELETE" for method, path in calls))
        self.assertFalse(any("/labels/" in path for _method, path in calls))

    def test_withdraw_of_a_busy_runner_does_not_delete_it(self):
        calls = []

        def api(method, path, auth, payload=None):
            calls.append((method, path))
            if method == "GET":
                return {"runners": [{"id": 7, "name": "ci-test-slot-1", "busy": True, "labels": [{"name": "ci"}]}]}
            return None

        with patch.object(token, "app_token", return_value="installation"), \
             patch.object(token, "request", side_effect=api), \
             patch.object(sys, "argv", ["runner-control", "withdraw", "organization", "example-org", "1", "2", "key", "ci-test"]):
            with self.assertRaises(SystemExit) as caught:
                token.main()
        self.assertEqual(caught.exception.code, 4)
        self.assertIn(("DELETE", "/orgs/example-org/actions/runners/7/labels/ci"), calls)
        self.assertNotIn(("DELETE", "/orgs/example-org/actions/runners/7"), calls)

    def test_hold_removes_labels_and_leaves_the_runner(self):
        calls = []

        def api(method, path, auth, payload=None):
            calls.append((method, path))
            if method == "GET":
                return {"runners": [{"id": 7, "name": "ci-test-slot-1", "busy": True, "labels": [{"name": "ci"}]}]}
            return None

        with patch.object(token, "app_token", return_value="installation"), \
             patch.object(token, "request", side_effect=api), \
             patch.object(sys, "argv", ["runner-control", "hold", "organization", "example-org", "1", "2", "key", "ci-test"]):
            token.main()
        self.assertIn(("DELETE", "/orgs/example-org/actions/runners/7/labels/ci"), calls)
        self.assertNotIn(("DELETE", "/orgs/example-org/actions/runners/7"), calls)

    def test_withdraw_when_the_runner_is_already_gone(self):
        with patch.object(token, "app_token", return_value="installation"), \
             patch.object(token, "list_runners", return_value=[]), \
             patch.object(token, "request") as request, \
             patch.object(sys, "argv", ["runner-control", "withdraw", "organization", "example-org", "1", "2", "key", "ci-test"]):
            token.main()
        request.assert_not_called()

    def test_busy_timeout_never_stops_a_job(self):
        runner = {"id": 1, "name": "ci-node-slot-1", "busy": True, "labels": []}
        with patch.object(token, "app_token", return_value="installation"), \
             patch.object(token, "list_runners", return_value=[runner]), \
             patch.object(token, "request") as request, \
             patch.object(sys, "argv", ["runner-control", "drain", "organization", "org", "1", "2", "key", "ci-node", "0"]):
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                token.main()
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
