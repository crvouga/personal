#!/usr/bin/env python3
"""Opt-in launchers, preserving all existing native client configuration."""

import hashlib
import argparse, getpass, json, os, pathlib, shutil, sys, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--endpoint")
p.add_argument("--model")
p.add_argument("--claude-model")
p.add_argument("--uninstall", action="store_true")
p.add_argument("--validate", action="store_true")
a = p.parse_args()
home = pathlib.Path.home()
config = home / ".config/cliproxy-fleet"
bins = home / ".local/bin"
if a.uninstall:
    for name in ["codex-fleet", "claude-fleet", "opencode-fleet"]:
        f = bins / name
        if f.exists() and "cliproxy-fleet launcher" in f.read_text():
            f.unlink()
    # Keep the credential for deliberate reuse, not accidental credential loss.
    print(
        "Removed fleet launchers. Native settings unchanged. Remove ~/.config/cliproxy-fleet when no longer needed."
    )
    sys.exit()
os.umask(0o077)
config.mkdir(parents=True, exist_ok=True)
config.chmod(0o700)
bins.mkdir(parents=True, exist_ok=True)
if a.validate:
    settings = json.loads((config / "settings.json").read_text())
    key = (config / "client-key").read_text().strip()
    req = urllib.request.Request(
        settings["endpoint"].rstrip("/") + "/v1/models",
        headers={"Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    print("Authenticated model listing passed; model IDs:")
    print("\n".join(m["id"] for m in data.get("data", [])))
    sys.exit()
if not a.endpoint or not a.model:
    p.error("--endpoint and --model are required; choose actual available model IDs")
if not a.endpoint.startswith("https://"):
    p.error("Endpoint must use HTTPS")
previous = (
    json.loads((config / "settings.json").read_text())
    if (config / "settings.json").exists()
    else {}
)
generator_sha256 = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
settings = {
    "endpoint": a.endpoint.rstrip("/"),
    "generator_repository": "https://github.com/crvouga/personal",
    "generator_sha256": generator_sha256,
    "model": a.model,
    "claude_model": a.claude_model or previous.get("claude_model"),
}
keyfile = config / "client-key"
if not keyfile.exists():
    key = getpass.getpass(
        "Fleet client API key (hidden; NOT provider OAuth or management key): "
    )
    if len(key) < 32:
        sys.exit("Client key must contain at least 32 characters")
    keyfile.write_text(key + "\n")
    keyfile.chmod(0o600)
(config / "settings.json").write_text(json.dumps(settings, indent=2) + "\n")
# Use SDK-specific protocols; users select the launcher explicitly.
opencode = {
    "$schema": "https://opencode.ai/config.json",
    "provider": {
        "fleet-responses": {
            "npm": "@ai-sdk/openai",
            "name": "Fleet (Responses)",
            "options": {
                "baseURL": settings["endpoint"] + "/v1",
                "apiKey": "{env:CLIPROXY_API_KEY}",
            },
            "models": {a.model: {"name": a.model}},
        },
        "fleet-claude": {
            "npm": "@ai-sdk/anthropic",
            "name": "Fleet (Claude)",
            "options": {
                "baseURL": settings["endpoint"] + "/v1",
                "apiKey": "{env:CLIPROXY_API_KEY}",
            },
            "models": {a.claude_model: {"name": a.claude_model}},
        },
    },
    "model": "fleet-responses/" + a.model,
}
if not settings["claude_model"]:
    opencode["provider"].pop("fleet-claude")
else:
    opencode["provider"]["fleet-claude"]["models"] = {
        settings["claude_model"]: {"name": settings["claude_model"]}
    }
(config / "opencode.json").write_text(json.dumps(opencode, indent=2) + "\n")
launcher = """#!/usr/bin/env python3
# cliproxy-fleet launcher
# Generated from crvouga/personal packages/cliproxy-fleet/clients/bootstrap.py
# Source generator SHA256: __GENERATOR_SHA256__
import json,os,pathlib,sys
r=pathlib.Path.home()/'.config/cliproxy-fleet'
s=json.loads((r/'settings.json').read_text())
os.environ['CLIPROXY_API_KEY']=(r/'client-key').read_text().strip()
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
if name=='codex-fleet':
 args=['codex','-c','model_provider="fleet"','-c','model_providers.fleet.name="Fleet"','-c','model_providers.fleet.base_url='+json.dumps(s['endpoint']+'/v1'),'-c','model_providers.fleet.env_key="CLIPROXY_API_KEY"','-c','model_providers.fleet.wire_api="responses"','-c','model_providers.fleet.requires_openai_auth=false','-c','model_providers.fleet.supports_websockets=false','-m',s['model'],*args]
elif name=='claude-fleet':
 if not s.get('claude_model'):sys.exit('No Claude model configured. Add an authorized Claude account and rerun bootstrap with --claude-model MODEL_ID.')
 for k in ['ANTHROPIC_API_KEY','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY']:os.environ.pop(k,None)
 os.environ['ANTHROPIC_BASE_URL']=s['endpoint']
 os.environ['ANTHROPIC_AUTH_TOKEN']=os.environ['CLIPROXY_API_KEY']
 # Pin all default model families to the explicit approved model; no cost-changing fallback.
 for k in ['ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL']:os.environ[k]=s['claude_model']
 args=['claude','--model',s['claude_model'],*args]
else:
 os.environ['OPENCODE_CONFIG']=str(r/'opencode.json')
 args=['opencode',*args]
os.execvp(args[0],args)
"""
for name in ["codex-fleet", "claude-fleet", "opencode-fleet"]:
    f = bins / name
    if f.exists() and "cliproxy-fleet launcher" not in f.read_text():
        sys.exit("Refusing to overwrite unrelated launcher: " + str(f))
    f.write_text(launcher.replace("__GENERATOR_SHA256__", generator_sha256))
    f.chmod(0o700)
print(
    "Installed opt-in launchers in ~/.local/bin. Native client settings preserved. Run bootstrap.py --validate."
)
