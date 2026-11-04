#!/usr/bin/env python3
import json, os, pathlib, subprocess, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class Clients(unittest.TestCase):
    def test_preserves_native_settings_and_routes_protocols(self):
        with tempfile.TemporaryDirectory() as d:
            h = pathlib.Path(d)
            c = h / ".config/cliproxy-fleet"
            c.mkdir(parents=True)
            (c / "client-key").write_text("test-only-" + "x" * 48)
            native = h / ".codex/config.toml"
            native.parent.mkdir()
            native.write_text('model = "native-model"\n')
            env = os.environ.copy()
            env["HOME"] = d
            command = [
                "python3",
                str(ROOT / "clients/bootstrap.py"),
                "--endpoint",
                "https://ai-proxy.example.ts.net",
                "--model",
                "explicit-codex",
                "--claude-model",
                "explicit-claude",
            ]
            subprocess.run(command, env=env, check=True, capture_output=True)
            subprocess.run(command, env=env, check=True, capture_output=True)
            self.assertEqual(native.read_text(), 'model = "native-model"\n')
            fake = h / "fake"
            fake.mkdir()
            for name in ["codex", "claude", "opencode"]:
                f = fake / name
                f.write_text(
                    '#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({"args":sys.argv[1:],"base":os.getenv("ANTHROPIC_BASE_URL"),"has_key":bool(os.getenv("CLIPROXY_API_KEY")),"config":os.getenv("OPENCODE_CONFIG")}))\n'
                )
                f.chmod(0o700)
            env["PATH"] = str(fake) + ":" + env["PATH"]
            for name in ["codex", "claude", "opencode"]:
                out = json.loads(
                    subprocess.check_output(
                        [str(h / ".local/bin" / f"{name}-fleet"), "--help"],
                        env=env,
                        text=True,
                    )
                )
                self.assertTrue((h / ".local/bin" / f"{name}-fleet").is_symlink())
                self.assertTrue(out["has_key"])
                self.assertNotIn("test-only-", json.dumps(out))
                if name == "codex":
                    self.assertIn(
                        'model_providers.fleet.wire_api="responses"', out["args"]
                    )
                if name == "claude":
                    self.assertEqual(out["base"], "https://ai-proxy.example.ts.net")
                if name == "opencode":
                    self.assertEqual(out["config"], str(c / "opencode.json"))
            subprocess.run(
                ["python3", str(ROOT / "clients/bootstrap.py"), "--uninstall"],
                env=env,
                check=True,
                capture_output=True,
            )
            self.assertFalse((h / ".local/bin/codex-fleet").exists())
            self.assertTrue(native.exists())


if __name__ == "__main__":
    unittest.main()
