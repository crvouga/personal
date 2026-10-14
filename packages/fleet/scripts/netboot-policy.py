#!/usr/bin/env python3
"""Tell a netboot client to boot the local disk, or serve the installer.

Pixiecore calls /v1/boot/<mac>. The MAC is not the stable id, so the first
answer is an iPXE script that reads the SMBIOS UUID and the role file on the
ESP (volume label SHBOOT) and asks /fleet/choose. choose returns `exit 1`
unless this UUID's stable id or the installed role is flagged in
/etc/fleet/reinstall.json. An empty flag list boots the local disk.

Any non-200 answer would make Pixiecore ignore the client. That also boots
the next firmware entry, but it cannot see the UUID. The script is how a
flagged node is selected without a MAC list.
"""

import importlib.util
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

_cattle_spec = importlib.util.spec_from_file_location("cattle", Path(__file__).with_name("cattle.py"))
cattle = importlib.util.module_from_spec(_cattle_spec)
_cattle_spec.loader.exec_module(cattle)

ROLES = {"ci", "web", "cache", "netboot", "devbox"}


def port():
    return int(os.environ.get("FLEET_NETBOOT_PORT", "4012"))


def load_policy(path):
    """Broken or missing policy serves the local disk. It never defaults to the installer."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return [], []
    nodes = raw.get("nodes") if isinstance(raw, dict) else None
    roles = raw.get("roles") if isinstance(raw, dict) else None
    if not isinstance(nodes, list) or not isinstance(roles, list):
        return [], []
    return nodes, roles


def decide(uuid_text, mac, role, nodes, roles):
    """Return 'installer' or 'local'. Role ci-gpu is role ci."""
    wanted_nodes = set()
    for node in nodes:
        text = str(node).strip().lower()
        if len(text) == 4 and all(ch in "0123456789abcdef" for ch in text):
            wanted_nodes.add(text)
    wanted_roles = {str(item).strip() for item in roles if str(item).strip() in ROLES}
    role = str(role or "").strip()
    if role in wanted_roles:
        return "installer"
    try:
        ident = cattle.stable_id(uuid_text, mac or None)
    except ValueError:
        ident = None
    if ident and ident.lower() in wanted_nodes:
        return "installer"
    return "local"


def probe_script(mac):
    return "\n".join([
        "#!ipxe",
        "set fleet_uuid ${uuid}",
        "set fleet_mac ${net0/mac}",
        f"isset ${{fleet_mac}} || set fleet_mac {mac}",
        "set fleet_role ",
        "chain file://SHBOOT/fleet-role.ipxe ||",
        "chain http://${next-server}:"
        + str(port())
        + "/fleet/choose?uuid=${fleet_uuid}&mac=${fleet_mac}&role=${fleet_role} || exit 1",
        "",
    ])


def local_script():
    # exit 1 returns to firmware, which tries the next boot entry (the disk).
    # A board that powers off instead is a one-time BIOS qualification failure.
    return "\n".join([
        "#!ipxe",
        "iseq ${platform} efi && exit 1 || sanboot --no-describe --drive 0x80",
        "exit 1",
        "",
    ])


def installer_script(cmdline):
    text = " ".join(str(cmdline or "").split())
    return "\n".join([
        "#!ipxe",
        "kernel http://${next-server}:" + str(port()) + "/fleet/kernel initrd=fleet-initrd " + text,
        "initrd --name fleet-initrd http://${next-server}:" + str(port()) + "/fleet/initrd",
        "boot || exit 1",
        "",
    ])


def _read_path(pointer):
    try:
        target = Path(pointer).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    path = Path(target)
    if not path.is_file():
        return None
    return path


def _cmdline():
    pointer = os.environ.get("FLEET_CMDLINE_FILE", "/etc/fleet/netboot-cmdline")
    try:
        return Path(pointer).read_text(encoding="utf-8")
    except OSError:
        return ""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send(200, "text/plain", b"ok\n")
            return
        if parsed.path.startswith("/v1/boot/"):
            mac = unquote(parsed.path[len("/v1/boot/"):]).strip().lower()
            if cattle.MAC_RE.fullmatch(mac) is None:
                self.send_error(400)
                return
            body = json.dumps({"ipxe-script": probe_script(mac)}).encode()
            self._send(200, "application/json", body)
            return
        if parsed.path == "/fleet/choose":
            query = parse_qs(parsed.query)
            uuid_text = (query.get("uuid") or [""])[0]
            mac = (query.get("mac") or [""])[0]
            role = (query.get("role") or [""])[0]
            policy = os.environ.get("FLEET_POLICY", "/etc/fleet/reinstall.json")
            nodes, roles = load_policy(policy)
            choice = decide(uuid_text, mac, role, nodes, roles)
            if choice == "installer":
                script = installer_script(_cmdline())
            else:
                script = local_script()
            self._send(200, "text/plain", script.encode())
            return
        if parsed.path == "/fleet/kernel":
            self._send_file(os.environ.get("FLEET_KERNEL_FILE", "/etc/fleet/netboot-kernel"))
            return
        if parsed.path == "/fleet/initrd":
            self._send_file(os.environ.get("FLEET_INITRD_FILE", "/etc/fleet/netboot-initrd"))
            return
        self.send_error(404)

    def log_message(self, _fmt, *_args):
        return

    def _send(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, pointer):
        path = _read_path(pointer)
        if path is None:
            self.send_error(404)
            return
        length = path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)


def main():
    bind = os.environ.get("FLEET_NETBOOT_BIND", "0.0.0.0")
    ThreadingHTTPServer((bind, port()), Handler).serve_forever()


if __name__ == "__main__":
    main()
