"""Download the installer image and write it to a USB disk.

Pure Python on purpose: Windows has no dd, and the wizard must not depend on
curl, bash, or anything else being installed. Every step states what it
expects with `invariant`, so a corrupt download, a short write, or a bad
read-back stops the program with the values needed to diagnose it.
"""
import hashlib
import os
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import bootstrap  # noqa: F401
import decide

CHUNK = 4 * 1024 * 1024
SECTOR = 4096  # a multiple of both 512 and 4096 byte sectors
SHA_RE = re.compile(r"^[0-9a-fA-F]{64}$")
TIMEOUT = 30


class Cancelled(Exception):
    """The person pressed cancel. Nothing is left half written that the next run cannot redo."""


def _noop(*_args):
    return None


def open_url(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    return urllib.request.urlopen(request, timeout=TIMEOUT)


def parse_checksum(text):
    words = text.split()
    decide.invariant(bool(words) and SHA_RE.match(words[0]) is not None, "the checksum file is not a sha256", "The release is broken. Re-run the Fleet workflow so it publishes fleet-installer.iso.sha256.", got=text[:80])
    return words[0].lower()


def fetch_checksum(url):
    try:
        with open_url(url) as reply:
            return parse_checksum(reply.read(4096).decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError) as exc:
        raise RuntimeError(f"could not download the checksum from {url}: {exc}") from exc


def probe(url):
    """Return (error or None, total size or None) without downloading the image."""
    try:
        with open_url(url, {"Range": "bytes=0-0"}) as reply:
            reply.read(1)
            total = None
            span = reply.headers.get("Content-Range", "")
            match = re.search(r"/(\d+)$", span)
            if match:
                total = int(match.group(1))
            elif reply.headers.get("Content-Length") and getattr(reply, "status", None) in (None, 200):
                total = int(reply.headers["Content-Length"])
            return None, total
    except urllib.error.HTTPError as exc:
        return f"HTTP {exc.code} {exc.reason}", None
    except (urllib.error.URLError, OSError) as exc:
        return str(getattr(exc, "reason", exc)), None


def sha256_of(path, progress=_noop, cancel=None):
    digest = hashlib.sha256()
    size = os.path.getsize(path)
    done = 0
    with open(path, "rb") as handle:
        while True:
            block = handle.read(CHUNK)
            if not block:
                break
            if cancel and cancel():
                raise Cancelled()
            digest.update(block)
            done += len(block)
            progress(done, size)
    return digest.hexdigest()


def download(url, dest, expected_sha256, progress=_noop, cancel=None):
    """Fetch url to dest. dest only ever holds a complete, verified image."""
    expected = expected_sha256.lower()
    decide.invariant(SHA_RE.match(expected) is not None, "download was given a malformed sha256", sha=expected_sha256)
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and sha256_of(dest) == expected:
        progress(dest.stat().st_size, dest.stat().st_size)
        return dest
    # Multiple wizard windows must never share a partial download.
    fd, name = tempfile.mkstemp(prefix=dest.name + ".", suffix=".partial", dir=dest.parent)
    os.close(fd)
    staged = Path(name)
    digest = hashlib.sha256()
    written = 0
    try:
        with open_url(url) as reply, open(staged, "wb") as out:
            total = int(reply.headers.get("Content-Length") or 0)
            while True:
                block = reply.read(CHUNK)
                if not block:
                    break
                if cancel and cancel():
                    raise Cancelled()
                out.write(block)
                digest.update(block)
                written += len(block)
                progress(written, total)
            out.flush()
            os.fsync(out.fileno())
    except (urllib.error.URLError, OSError) as exc:
        staged.unlink(missing_ok=True)
        raise RuntimeError(f"the download from {url} failed after {written} bytes: {exc}") from exc
    except Cancelled:
        staged.unlink(missing_ok=True)
        raise
    try:
        decide.invariant(digest.hexdigest() == expected, "the downloaded installer does not match its checksum",
                         "Run the wizard again. If it repeats, the release asset and its .sha256 disagree: re-run the Fleet workflow.",
                         want=expected, got=digest.hexdigest(), bytes=written)
        with open(staged, "rb") as check:
            head = check.read(decide.ISO_MAGIC_OFFSET + 5)
        decide.invariant(decide.looks_like_iso(head), "the downloaded file matches its checksum but is not an ISO9660 image",
                         "The release asset is wrong. Re-run the Fleet workflow so it publishes a real fleet-installer.iso.", bytes=written)
    except decide.Invariant:
        staged.unlink(missing_ok=True)
        raise
    os.replace(staged, dest)
    decide.invariant(dest.stat().st_size == written, "the installer on disk is the wrong size", file=str(dest), want=written)
    return dest


def padded(size):
    return (size + SECTOR - 1) // SECTOR * SECTOR


def check_capacity(size, capacity):
    decide.invariant(size > 0, "refusing to write an empty image", size=size)
    decide.invariant(capacity >= padded(size), "the USB disk is smaller than the installer",
                     "Use a USB disk of at least the size shown in the wizard.", capacity=capacity, image=size, required=padded(size))


def write_image(iso, target, capacity, expected_sha256, progress=_noop, cancel=None):
    """Write iso to target (a raw disk, or any file in tests), sync it, then
    read it back and prove the bytes are the ones that were verified."""
    iso = Path(iso)
    size = iso.stat().st_size
    check_capacity(size, capacity)
    decide.invariant(SHA_RE.match(expected_sha256) is not None, "write_image was given a malformed sha256", sha=expected_sha256)
    flags = os.O_RDWR | getattr(os, "O_BINARY", 0)
    fd = os.open(target, flags)
    written = 0
    try:
        with open(iso, "rb") as source:
            while written < size:
                if cancel and cancel():
                    raise Cancelled()
                block = source.read(CHUNK)
                decide.invariant(block != b"", "the image ended early while writing", wrote=written, want=size)
                if len(block) % SECTOR:
                    block = block + b"\0" * (padded(len(block)) - len(block))
                count = os.write(fd, block)
                decide.invariant(count == len(block), "the disk accepted a short write", wrote=count, asked=len(block), at=written)
                written += min(len(block), size - written)
                progress(written, size)
        os.fsync(fd)
        digest = hashlib.sha256()
        os.lseek(fd, 0, os.SEEK_SET)
        remaining = size
        while remaining:
            if cancel and cancel():
                raise Cancelled()
            want = min(CHUNK, padded(remaining))
            block = os.read(fd, want)
            decide.invariant(len(block) > 0, "the disk returned nothing while reading back", missing=remaining)
            take = min(len(block), remaining)
            digest.update(block[:take])
            remaining -= take
            progress(size - remaining, size)
    finally:
        os.close(fd)
    decide.invariant(digest.hexdigest() == expected_sha256.lower(), "the USB disk does not hold the installer after writing",
                     "The USB disk or its port is faulty. Try another USB disk or port.", want=expected_sha256, got=digest.hexdigest())
    return size


def cache_dir(os_name=None):
    os_name = os_name or decide.current_os()
    override = os.environ.get("FLEET_CACHE")
    if override:
        return Path(override)
    if os_name == "Windows":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "fleet-installer"
    if os_name == "Darwin":
        return Path.home() / "Library" / "Caches" / "fleet-installer"
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "fleet-installer"


def scratch_dir(prefix):
    path = Path(tempfile.mkdtemp(prefix=prefix))
    os.chmod(path, 0o700)
    return path
