#!/usr/bin/env python3
"""Split the offline ISO into release assets below GitHub's 2 GiB limit."""
import hashlib
import json
import sys
from pathlib import Path

PART_SIZE = 1024 ** 3


def package_image(source, directory, part_size=PART_SIZE):
    if not 0 < part_size < 2 * 1024 ** 3:
        raise ValueError("release parts must be smaller than 2 GiB")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    parts = []
    with open(source, "rb") as image:
        while True:
            block = image.read(min(part_size, 4 * 1024 ** 2))
            if not block:
                break
            name = f"fleet-installer.iso.part-{len(parts):03d}"
            size = 0
            part_digest = hashlib.sha256()
            with open(directory / name, "wb") as part:
                while block:
                    part.write(block)
                    digest.update(block)
                    part_digest.update(block)
                    size += len(block)
                    if size == part_size:
                        break
                    block = image.read(min(part_size - size, 4 * 1024 ** 2))
            parts.append({"name": name, "size": size, "sha256": part_digest.hexdigest()})
    if not parts:
        raise ValueError("refusing to publish an empty installer")
    manifest = {"version": 1, "size": sum(part["size"] for part in parts),
                "sha256": digest.hexdigest(), "parts": parts}
    (directory / "fleet-installer.iso.parts.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (directory / "fleet-installer.iso.sha256").write_text(digest.hexdigest() + "  fleet-installer.iso\n")
    return manifest


if __name__ == "__main__":
    package_image(sys.argv[1], sys.argv[2])
