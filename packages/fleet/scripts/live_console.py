#!/usr/bin/env python3
"""What the person in front of the live installer sees, and how they report it.

fleet-auto.sh calls `step`, `wait`, `stopped`, `stayed` and `done` as the
installation moves. Each draws a whole screen on the console: every step, the
current one, whether anything has been erased and what to do now. `status`,
`report`, `retry` and `return` are the commands the person types at a prompt
(fleet-status, fleet-report, fleet-retry, fleet-return).

Screens are written to the console device directly. systemd's journal+console
prefixes every line with the unit name and PID, which made text noisy and a QR
code unscannable. Nothing here reads a token, key or Wi-Fi password; everything
shown or put into an issue link passes through decide.redact.
"""
import json
import os
import re
import subprocess
import sys
import textwrap
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import decide  # noqa: E402

UNIT = "fleet-auto-install.service"
FLEET_NODES = "https://fleet.chrisvouga.dev/nodes"
WIDTH = 78
# A version 12 code at most: 35 rows under ~15 lines of text still fits a
# 1024x768 console (48 rows). The Linux console has no scrollback.
QR_URL_MAX = 360
# (id, title, what the person does). "{role}" is the role being installed.
STEPS = (
    ("network", "Connect to the network",
     "Nothing to do. Keep the network cable plugged in, or keep this computer near the Wi-Fi network it used before."),
    ("approval", "Read this node's approval",
     "Nothing to do. This uses the approval from the GitHub enrollment issue."),
    ("checks", "Check Fleet, the update cache and GitHub",
     "Nothing to do. This usually takes less than two minutes."),
    ("disk", "Find the internal disk",
     "Nothing to do."),
    ("erase", "Erase the internal disk",
     "Do not turn the computer off from now on. The original system is being removed."),
    ("install", "Install the {role} system",
     "Do not turn the computer off. This usually takes 5 to 20 minutes; this screen updates every 30 seconds."),
    ("restart", "Restart into the new {role} node",
     "Nothing to do. Remove any USB stick. The node appears in Fleet a few minutes after it starts."),
)
STEP_IDS = tuple(step[0] for step in STEPS)
LONG_STEPS = ("checks", "erase", "install")
# (pattern in the reason, summary, steps). The first match wins.
ADVICE = (
    (r"Waiting for Wi-Fi|network preflight|Wi-Fi setup failed|FLEET_NETWORK_UNAVAILABLE",
     "This computer is not online yet.",
     ["Plug in a network cable if you can; it is used automatically.",
      "On Wi-Fi, keep the computer near the network it used before the restart."]),
    (r"FLEET_CACHE_UNAVAILABLE",
     "The update cache cannot be reached, or does not have this installer's system yet.",
     ["A new release usually reaches the cache within a few minutes; waiting is often enough.",
      "If it keeps failing, report it: the release may be ahead of the cache."]),
    (r"FLEET_API_UNAVAILABLE",
     "Fleet (fleet.chrisvouga.dev) cannot be reached.",
     ["Wait; the installer tries again by itself.", "Check fleet.chrisvouga.dev on a phone. If it is down, report it."]),
    (r"FLEET_GITHUB_UNAVAILABLE",
     "GitHub cannot be reached or is limiting requests.",
     ["Wait; the installer tries again by itself."]),
    (r"FLEET_GITHUB_REGISTRATION|FLEET_GITHUB_KEY|FLEET_GITHUB_SCOPE",
     "GitHub refused to register this computer as a CI runner.",
     ["The repository owner checks the runner GitHub App installation and its repository access.",
      "Then open the Fleet installer in the original system again."]),
    (r"FLEET_APPROVAL_REQUIRED",
     "Fleet has not approved this computer.",
     [f"Open {FLEET_NODES}, approve this computer under Pending.", "Then open the Fleet installer in the original system again."]),
    (r"enrollment token|FLEET_ENROLLMENT|did not hold an age key",
     "The one-time approval was refused, expired or already used.",
     ["Open the Fleet installer in the original system again; it asks for a fresh approval on GitHub."]),
    (r"FLEET_NETWORK_WAIT_EXPIRED",
     "The installer could not reach everything it needs in time.",
     ["Check the network, then open the Fleet installer in the original system again.", "Report it if the network works."]),
    (r"FLEET_ROLE_SECRETS|FLEET_ROLE_KEY|FLEET_PLATFORM_NOT_READY|FLEET_METADATA|FLEET_BOOTSTRAP_INVALID|FLEET_CACHE_UNCONFIGURED|FLEET_API_UNCONFIGURED",
     "The published installer is not ready for this kind of node. A maintainer has to fix it.",
     ["Report it with the QR code. Nothing on this computer needs to change."]),
    (r"public key|devbox",
     "A devbox needs an SSH public key before anything is erased.",
     ["Use your .pub file in the Fleet installer, or put devbox.pub on a FLEET-KEY USB stick."]),
    (r"UEFI|x86-64",
     "This computer did not start in UEFI mode.",
     ["Turn on UEFI and turn off legacy/CSM boot in the firmware settings."]),
)
UNKNOWN = ("The installer stopped.", ["Report it with the QR code; the report says where it stopped."])


def env_path(name, default):
    return Path(os.environ.get(name) or default)


def state_dir():
    return env_path("FLEET_LIVE_STATE", "/run/fleet-live")


def install_log():
    return env_path("FLEET_INSTALL_LOG", "/run/fleet-install.log")


def erased():
    return Path(str(install_log()) + ".erasing").exists()


def read_text(path, limit=65536):
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - limit))
            return handle.read().decode("utf-8", "replace")
    except OSError:
        return ""


def load_state():
    try:
        data = json.loads((state_dir() / "state.json").read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(**changes):
    data = {**load_state(), **changes, "updated": int(time.time())}
    folder = state_dir()
    folder.mkdir(parents=True, exist_ok=True)
    temporary = folder / "state.json.new"
    temporary.write_text(json.dumps(data))
    temporary.chmod(0o644)  # no secrets: the person's own login reads it
    temporary.replace(folder / "state.json")
    return data


def cmdline():
    return read_text(os.environ.get("FLEET_CMDLINE") or "/proc/cmdline", 8192).split()


def cmdline_value(name):
    values = [word.split("=", 1)[1] for word in cmdline() if word.startswith(name + "=")]
    return values[-1] if values else ""


def role():
    value = cmdline_value("fleet.role")
    return value if value in decide.ROLES else "unknown"


def started_from():
    origin = cmdline_value("fleet.from")
    if origin in ("windows", "linux"):
        return origin
    if cmdline_value("fleet.enroll"):
        return "linux" if cmdline_value("findiso") else "windows"
    return "usb"


def original_system():
    return {"windows": "Windows", "linux": "the original Linux system"}.get(started_from(), "the original system")


def revision():
    manifest = env_path("FLEET_MANIFEST", "/iso/fleet-install-manifest")
    for line in read_text(manifest, 8192).splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] == role():
            text = read_text(Path(parts[1]) / "etc/fleet/revision", 128).strip()
            if re.fullmatch(r"[0-9a-f]{7,40}|unknown", text):
                return text
    return "unknown"


def reason():
    """The most specific explanation on record: the installer's own diagnostic,
    else the last line of this attempt that names a code or a next step."""
    diagnostic = read_text(str(install_log()) + ".diagnostic", 2048).strip()
    if diagnostic:
        return decide.redact(diagnostic.splitlines()[0])[:400]
    lines = read_text(state_dir() / "attempt.log", 16384).splitlines()
    for line in reversed(lines):
        if re.search(r"FLEET[_-][A-Z_]+|^Next:|Waiting for|refused|Refusing|failed", line):
            return decide.redact(line.strip())[:400]
    return ""


def advice(text):
    for pattern, summary, steps in ADVICE:
        if re.search(pattern, text or ""):
            return summary, steps
    return UNKNOWN


def code(text):
    found = re.search(r"FLEET[_-][A-Z_]+", text or "")
    return found.group(0) if found else ""


def step_title(step_id):
    for number, (ident, title, _) in enumerate(STEPS, 1):
        if ident == step_id:
            return number, title.format(role=role())
    return 0, "Starting"


def step_label(data):
    number, title = step_title(data.get("step"))
    return f"step {number} of {len(STEPS)}, {title}" if number else "starting"


def minutes(seconds):
    seconds = max(0, int(seconds))
    return f"{seconds // 60} min {seconds % 60} s" if seconds >= 60 else f"{seconds} s"


def wrap(text, indent="  ", first=None):
    return textwrap.fill(text, WIDTH, initial_indent=first if first is not None else indent, subsequent_indent=indent)


# ---- screens --------------------------------------------------------------------

def checklist(data, mark="[>]"):
    current = data.get("step")
    index = STEP_IDS.index(current) if current in STEP_IDS else -1
    done_all = data.get("outcome") == "installed"
    rows = []
    for number, (ident, title, _) in enumerate(STEPS, 1):
        position = STEP_IDS.index(ident)
        box = "[x]" if position < index or done_all else mark if position == index else "[ ]"
        rows.append(f"  {box} {number}. {title.format(role=role())}")
    return rows


def header():
    title = f"FLEET INSTALLER: setting up this computer as a {role()} node"
    return ["=" * WIDTH, " " + title, "=" * WIDTH]


def erase_line():
    if erased():
        return f"The internal disk has been erased; {original_system()} is no longer on it."
    return f"Nothing has been erased. {original_system()[0].upper() + original_system()[1:]} is still on the disk."


def help_lines():
    return ["Need a command prompt? Press Alt+F2 (Alt+F1 comes back here).",
            "There, fleet-status explains this screen and fleet-report makes a GitHub",
            "issue link and QR code with everything a maintainer needs."]


def screen_step(data):
    number, title = step_title(data.get("step"))
    hint = STEPS[number - 1][2] if number else ""
    lines = [*header(), "", *checklist(data), "", f" Now: {title}", wrap(hint), "", wrap(erase_line(), "  ", " "), ""]
    return lines + [" " + line for line in help_lines()]


def screen_wait(data):
    why = data.get("reason") or "A check before erasing is not ready yet."
    summary, steps = advice(why)
    remaining = int(data.get("remaining") or 0)
    after = (f"returns to {original_system()} so nothing is left half done"
             if started_from() != "usb" else "stops here and shows what to do")
    lines = [*header(), "", *checklist(data, "[~]"), "",
             wrap(f"Waiting (attempt {data.get('attempt', 1)}): {summary}", "  ", " "),
             wrap("Why: " + why), ""]
    lines += [" What you can do:"] + [wrap(text, "     ", f"  {i}. ") for i, text in enumerate(steps, 1)]
    lines += ["", wrap(f"It tries again in {data.get('retry', 30)} seconds. If it is still not ready in "
                       f"{minutes(remaining)}, it {after}.", "  ", " "),
              wrap(erase_line(), "  ", " "), ""]
    return lines + [" " + line for line in help_lines()]


def screen_stopped(data, qr):
    """Short on purpose: the explanation and the QR code must fit one screen."""
    why = data.get("reason") or f"The installer exited with status {data.get('status', '?')}."
    why = re.sub(r"\s*\(?[Rr]etrying (automatically )?before disk changes\.?\)?|;? retrying before disk changes", "", why).strip()
    if erased():
        summary = "Installation failed after the internal disk was erased."
        steps = ["Report it now with the code below. Do not try to start the original system: it was erased.",
                 "Then make an install USB with the Fleet installer on another computer, start this computer "
                 f"from it and choose {role()}."]
    else:
        summary, steps = advice(why)
    number, title = step_title(data.get("step"))
    where = f"at step {number} of {len(STEPS)}: {title}" if number else "before its first step"
    lines = ["=" * WIDTH, wrap(f"FLEET INSTALLER STOPPED {where}", "  ", " "),
             "=" * WIDTH, wrap(erase_line(), "  ", " "), wrap("What happened: " + summary, "  ", " "),
             wrap("Why: " + why[:240], "  ", " "), " What to do:"]
    lines += [wrap(text, "     ", f"  {i}. ") for i, text in enumerate(steps, 1)]
    returning = int(data.get("returning") or 0)
    if returning and not erased():
        lines.append(wrap(f">>> Restarts into {original_system()} in {minutes(returning)}. Press Enter to stay here "
                          "instead." + (" Back in Windows, open the Fleet installer again: it cleans up and you can "
                                        "try again." if started_from() == "windows" else ""), "  ", " "))
    elif not erased():
        lines.append(wrap("fleet-retry tries again; fleet-return restarts into the original system "
                          "(remove any USB stick first).", "  ", " "))
    if qr:
        lines.append(wrap("Report it: scan this code with a phone camera to open a pre-filled GitHub issue, "
                          "or press Alt+F2 and type fleet-report.", "  ", " "))
    return lines + qr


def screen_done(data):
    lines = [*header(), "", *checklist(data), "",
             f" Installed. Restarting into the new {role()} node now.",
             wrap("Nothing else to do. Remove any USB stick. If the computer starts this installer again, "
                  "remove the stick and restart."),
             wrap(f"The node appears in Fleet at {FLEET_NODES} a few minutes after it starts.")]
    return lines


def screen_stayed():
    return ["", " Staying in the installer. A command prompt opens next.",
            "   fleet-status  explains what happened",
            "   fleet-report  GitHub issue link and QR code",
            "   fleet-retry   tries the installation again (only before anything is erased)",
            "   fleet-return  restarts into the original system (only before anything is erased)"]


def qr_lines(url):
    tool = os.environ.get("FLEET_QRENCODE") or "qrencode"
    try:
        done = subprocess.run([tool, "-t", "ANSIUTF8", "-m", "2", "-l", "L", "-o", "-", url],
                              capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return done.stdout.splitlines() if done.returncode == 0 else []


def draw(lines, clear=True):
    """Write to the console device; the journal gets a plain copy without the QR code."""
    text = "\n".join(lines) + "\n"
    target = os.environ.get("FLEET_CONSOLE") or "/dev/console"
    try:
        with open(target, "a", encoding="utf-8", errors="replace") as console:
            console.write(("\033[H\033[2J" if clear and target.startswith("/dev/") else "") + text)
    except OSError:
        sys.stderr.write(text)
    plain = [line for line in lines if "\033[" not in line]
    print("\n".join(plain), flush=True)


# ---- reports ----------------------------------------------------------------------

def outcome_text(data):
    outcome = data.get("outcome")
    status = data.get("status")
    if outcome == "waiting":
        return f"waiting before erasing (attempt {data.get('attempt', 1)})"
    if outcome in ("stopped", "stayed"):
        return f"stopped {'after' if erased() else 'before'} erasing (exit {status})"
    if outcome == "installed":
        return "installed; restarting"
    return "running" if data else "not started"


def facts(full):
    data = load_state()
    started = data.get("started")
    why = reason() or data.get("reason") or "none recorded"
    if not full:
        # Every character costs QR rows; the long form is fleet-report --full.
        # The title already carries the code.
        return [f"{role()} {revision()[:8]} from {started_from()}: {outcome_text(data)}",
                re.sub(r"^FLEET[_-][A-Z_]+:\s*", "", why)]
    out = [
        "Source: live installer screen (packages/fleet/scripts/fleet-auto.sh, fleet-install.sh)",
        f"Started from: {started_from()}",
        f"Role: {role()}",
        f"Revision: {revision()}",
        f"Step: {step_label(data)}",
        f"Outcome: {outcome_text(data)}",
        f"Erased: {'yes' if erased() else 'no'}",
        f"Reason: {why}",
    ]
    if started:
        out.append(f"Elapsed: {minutes(time.time() - started)}")
    dmi = Path(os.environ.get("FLEET_SYS") or "/sys") / "class/dmi/id"
    machine = " ".join(read_text(dmi / name, 128).strip() for name in ("sys_vendor", "product_name")).strip()
    memory = re.search(r"MemTotal:\s+(\d+)", read_text("/proc/meminfo", 4096))
    links = []
    for interface in sorted(Path("/sys/class/net").glob("*")) if Path("/sys/class/net").is_dir() else []:
        if interface.name != "lo":
            links.append(f"{interface.name}={read_text(interface / 'operstate', 32).strip() or '?'}")
    wifi = Path("/run/fleet-wifi/wifi.json").exists() or Path("/nix/fleet-state/network").exists()
    out += [
        f"Machine: {machine or 'unknown'}",
        f"Memory: {int(memory.group(1)) // 1024} MiB" if memory else "Memory: unknown",
        f"Kernel: {os.uname().release}",
        f"Network links: {' '.join(links) or 'none'}; carried Wi-Fi profile: {'yes' if wifi else 'no'}",
        "", "## Install log (last 40 lines)",
        *[decide.redact(line) for line in read_text(install_log()).splitlines()[-40:]],
        "", "## Last attempt output (last 30 lines)",
        *[decide.redact(line) for line in read_text(state_dir() / "attempt.log").splitlines()[-30:]],
    ]
    return out


def issue(full):
    data = load_state()
    why = reason() or data.get("reason") or ""
    title = "Fleet installer screen: " + (code(why) or advice(why)[0].rstrip("."))
    step = f"Installer screen: {step_label(data) if full else step_label(data).split(',')[0]}"
    text = "\n".join(facts(full))
    if full:
        return decide.issue_form_url_within(title, step, text)
    return decide.issue_form_url_within(title, step, text, QR_URL_MAX, "(more: fleet-report --full)")


# ---- commands ---------------------------------------------------------------------

def unit_active():
    tool = os.environ.get("FLEET_SYSTEMCTL") or "systemctl"
    try:
        return subprocess.run([tool, "is-active", "--quiet", UNIT], timeout=10, check=False).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def as_root(command):
    return command if os.geteuid() == 0 else ["sudo", "-n", *command]


def cmd_step(args):
    if not args or args[0] not in STEP_IDS:
        print("usage: fleet-live step " + "|".join(STEP_IDS), file=sys.stderr)
        return 2
    now = int(time.time())
    data = load_state()
    data = save_state(step=args[0], stepStarted=now, started=data.get("started") or now, outcome=None, reason="")
    draw(screen_step(data))
    return 0


def cmd_wait(args):
    values = dict(zip(args[::2], args[1::2]))
    data = save_state(outcome="waiting", reason=reason(), attempt=int(values.get("--attempt", 1)),
                      remaining=int(values.get("--remaining", 0)), retry=int(values.get("--retry", 30)))
    draw(screen_wait(data))
    return 0


def cmd_stopped(args):
    values = dict(zip(args[::2], args[1::2]))
    data = save_state(outcome="stopped", reason=reason(), status=int(values.get("--status", 1)),
                      returning=int(values.get("--returning", 0)))
    draw(screen_stopped(data, qr_lines(issue(False))))
    return 0


def cmd_stayed(_):
    save_state(outcome="stayed", returning=0)
    draw(screen_stayed(), clear=False)
    return 0


def cmd_done(_):
    data = save_state(step="restart", outcome="installed", stepStarted=int(time.time()))
    draw(screen_done(data))
    return 0


def cmd_tick(_):
    data = load_state()
    if data.get("outcome") or data.get("step") not in LONG_STEPS:
        return 0
    latest = ""
    for line in reversed(read_text(install_log(), 8192).splitlines()):
        latest = re.sub(r"^\S+Z\s+", "", decide.redact(line)).strip()
        if latest:
            break
    latest = re.sub(r"/nix/store/[a-z0-9]{32}-", "", latest)
    elapsed = minutes(time.time() - (data.get("stepStarted") or time.time()))
    # Redraw rather than append: the console has no scrollback, and twenty
    # minutes of appended lines would push the steps off the screen.
    draw(screen_step(data) + ["", wrap(f"Still working: {elapsed} on this step." + (f" Latest: {latest[:60]}" if latest else ""), "  ", " ")])
    return 0


def cmd_status(args):
    data = load_state()
    if not data:
        lines = ["No Fleet installation has started on this boot. Nothing was changed."]
        if not env_path("FLEET_MANIFEST", "/iso/fleet-install-manifest").exists():
            lines.append("This image carries no installer (for example the netboot ramdisk).")
    elif data.get("outcome") == "waiting":
        lines = screen_wait(data)
    elif data.get("outcome") in ("stopped", "stayed"):
        lines = screen_stopped({**data, "returning": 0}, []) + ["", " Details:", *["   " + line for line in facts(True)[1:9]]]
    elif data.get("outcome") == "installed":
        lines = screen_done(data)
    else:
        lines = screen_step(data)
    if unit_active():
        lines += ["", " The installer is still running. Its screens appear on the visible console."]
    lines += ["", " Commands:",
              "   fleet-status   show this again",
              "   fleet-report   GitHub issue link and QR code for a problem (--full for a longer link)",
              "   fleet-retry    try the installation again (only before anything is erased)",
              "   fleet-return   restart into the original system (only before anything is erased)",
              f"   journalctl -u {UNIT}   everything the installer printed"]
    print("\n".join(lines))
    return 0


def cmd_report(args):
    full = "--full" in args
    url = issue(full)
    print("Fleet installer problem report")
    print("Open this link (or scan the code) to create a pre-filled GitHub issue. Review it before submitting.")
    print()
    if not full:
        print("\n".join(qr_lines(url)))
    print(url)
    print()
    print("\n".join(facts(full)))
    return 0


def cmd_retry(_):
    if erased():
        print("Next: the disk was already erased, so the installer does not repeat on its own. Report it "
              "(fleet-report), then start this computer from a Fleet install USB.", file=sys.stderr)
        return 2
    if unit_active() and load_state().get("outcome") not in ("stopped", "stayed"):
        print("The installer is already running. Its screens appear on the visible console.")
        return 0
    started = os.environ.get("FLEET_AUTO_STATE") or "/run/fleet-auto-started"
    tool = os.environ.get("FLEET_SYSTEMCTL") or "systemctl"
    subprocess.run(as_root(["rm", "-f", started]), check=False)
    save_state(outcome=None, reason="", step="network")
    done = subprocess.run(as_root([tool, "restart", "--no-block", UNIT]), check=False)
    if done.returncode != 0:
        print("Next: the installer could not be started again. Report it with fleet-report.", file=sys.stderr)
        return 1
    print("Trying again. The installer screens appear on the visible console.")
    return 0


def cmd_return(_):
    if erased():
        print("Next: the original system was already erased, so there is nothing to return to. Report it "
              "(fleet-report), then start this computer from a Fleet install USB.", file=sys.stderr)
        return 2
    if unit_active() and load_state().get("outcome") not in ("stopped", "stayed"):
        print("Next: the installer is still running. Wait until it stops or finishes.", file=sys.stderr)
        return 2
    print(f"Restarting into {original_system()}. If this installer starts again, remove the USB stick.")
    tool = os.environ.get("FLEET_SYSTEMCTL") or "systemctl"
    return subprocess.run(as_root([tool, "reboot"]), check=False).returncode


COMMANDS = {"step": cmd_step, "wait": cmd_wait, "stopped": cmd_stopped, "stayed": cmd_stayed, "done": cmd_done,
            "tick": cmd_tick, "status": cmd_status, "report": cmd_report, "retry": cmd_retry, "return": cmd_return}


def main(argv):
    if not argv or argv[0] not in COMMANDS:
        print("usage: fleet-live " + "|".join(COMMANDS), file=sys.stderr)
        return 2
    try:
        return COMMANDS[argv[0]](argv[1:])
    except Exception as exc:  # the screen must never be what stops an installation
        print(f"fleet-live {argv[0]}: {type(exc).__name__}: {decide.redact(exc)}", file=sys.stderr)
        return 0 if argv[0] in ("step", "wait", "stopped", "stayed", "done", "tick") else 70


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
