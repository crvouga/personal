"""A small but real ISO9660 image builder with Rock Ridge names, enough for the
installer's own reader (decide._iso_index) to walk. Used by the tests that need
an image with a boot menu, a kernel, an initrd and a GRUB program inside."""

SECTOR = 2048


def _dirent(ident, extent, size, is_dir, rr_name=None):
    if ident == ".":
        raw = b"\x00"
    elif ident == "..":
        raw = b"\x01"
    else:
        raw = ident.encode("ascii")
    system_use = b""
    if rr_name is not None:
        encoded = rr_name.encode("ascii")
        system_use = b"NM" + bytes([5 + len(encoded), 1, 0]) + encoded
    offset = 33 + len(raw) + (1 if len(raw) % 2 == 0 else 0)
    record = bytearray(offset + len(system_use))
    record[0] = len(record)
    record[2:6] = extent.to_bytes(4, "little")
    record[6:10] = extent.to_bytes(4, "big")
    record[10:14] = size.to_bytes(4, "little")
    record[14:18] = size.to_bytes(4, "big")
    record[25] = 2 if is_dir else 0
    record[32] = len(raw)
    record[33:33 + len(raw)] = raw
    record[offset:] = system_use
    return bytes(record)


def build(tree):
    """tree: {name: bytes | {name: ...}}. Returns the image bytes."""
    directories = []  # (path, children dict, parent index)

    def collect(children, parent):
        index = len(directories)
        directories.append({"children": children, "parent": parent})
        for name in sorted(children):
            if isinstance(children[name], dict):
                children[name] = (children[name], collect(children[name], index))
        return index

    # Directories first (one sector each), then file data.
    collect(tree, 0)
    first_free = 18 + len(directories)
    extents, files = {}, []
    for number, directory in enumerate(directories):
        extents[number] = 18 + number
    cursor = first_free
    for number, directory in enumerate(directories):
        for name, value in sorted(directory["children"].items()):
            if isinstance(value, bytes):
                files.append((number, name, value, cursor))
                cursor += max(1, -(-len(value) // SECTOR))
    image = bytearray(cursor * SECTOR)
    placed = {(number, name): (extent, len(value)) for number, name, value, extent in files}
    for number, name, value, extent in files:
        image[extent * SECTOR:extent * SECTOR + len(value)] = value
    for number, directory in enumerate(directories):
        records = [_dirent(".", extents[number], SECTOR, True), _dirent("..", extents[directory["parent"]], SECTOR, True)]
        for position, (name, value) in enumerate(sorted(directory["children"].items())):
            ident = f"{'D' if isinstance(value, tuple) else 'F'}{number:02d}{position:03d}"
            if isinstance(value, tuple):
                records.append(_dirent(ident, extents[value[1]], SECTOR, True, name))
            else:
                extent, size = placed[(number, name)]
                records.append(_dirent(ident, extent, size, False, name))
        body = b"".join(records)
        assert len(body) <= SECTOR, "fixture directory too large"
        image[extents[number] * SECTOR:extents[number] * SECTOR + len(body)] = body
    pvd = bytearray(SECTOR)
    pvd[0], pvd[1:6], pvd[6] = 1, b"CD001", 1
    pvd[128:130] = SECTOR.to_bytes(2, "little")
    pvd[130:132] = SECTOR.to_bytes(2, "big")
    root = _dirent(".", extents[0], SECTOR, True)
    pvd[156:156 + len(root)] = root
    image[16 * SECTOR:17 * SECTOR] = pvd
    end = bytearray(SECTOR)
    end[0], end[1:6], end[6] = 255, b"CD001", 1
    image[17 * SECTOR:18 * SECTOR] = end
    return bytes(image)


def installer_tree(kernel=b"kernel-bytes\n", initrd=b"initrd-bytes\n", grub=b"grub-efi-program\n"):
    entries = [("boot", "ci", "")] + [(f"boot-{role}", role, "") for role in ("web", "cache", "netboot", "devbox")]
    entries.append(("boot-copytoram", "ci", " copytoram"))
    config = ["DEFAULT boot"]
    for label, role, extra in entries:
        config += [f"LABEL {label}", "LINUX /boot/bzImage",
                   f"APPEND init=/nix/store/fleet/init root=LABEL=FLEET_ISO fleet.role={role}{extra}", "INITRD /boot/initrd"]
    return {
        "isolinux": {"isolinux.cfg": ("\n".join(config) + "\n").encode()},
        "boot": {"bzImage": kernel, "initrd": initrd},
        "EFI": {"nixos-installer-image": b"x", "BOOT": {"BOOTX64.EFI": grub}},
    }
