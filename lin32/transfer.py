#!/usr/bin/env python3
"""Create a partitioned FAT16 transfer disk using mkfs.vfat and original code."""
import sys
sys.dont_write_bytecode = True

from pathlib import Path
import struct
import subprocess

ROOT = Path.cwd()
BUILD = ROOT / "build"


def main():
    volume = BUILD / "transfer-volume.img"
    with volume.open("wb") as f:
        f.truncate(16 * 1024 * 1024)
    subprocess.run(["mkfs.vfat", "-F", "16", "-n", "LIN32TEST", str(volume)], check=True)
    data = bytearray(volume.read_bytes())
    sector = struct.unpack_from("<H", data, 11)[0]
    cluster_size = data[13] * sector
    reserved = struct.unpack_from("<H", data, 14)[0]
    copies = data[16]
    root_entries = struct.unpack_from("<H", data, 17)[0]
    fat_size = struct.unpack_from("<H", data, 22)[0] * sector
    fat_start = reserved * sector
    root_start = fat_start + copies * fat_size
    file_start = root_start + ((root_entries * 32 + sector - 1) // sector) * sector
    # Partition-relative hidden sector count.
    struct.pack_into("<I", data, 28, 2048)
    cluster = 2
    slot = 1  # formatter's volume label occupies slot zero
    for path in sorted((BUILD / "share").iterdir()):
        if not path.is_file():
            continue
        stem, ext = path.name.upper().rsplit(".", 1)
        if not (1 <= len(stem) <= 8 and 1 <= len(ext) <= 3):
            raise ValueError("transfer file must have an 8.3 name: " + path.name)
        content = path.read_bytes()
        count = (len(content) + cluster_size - 1) // cluster_size
        if file_start + (cluster - 2 + count) * cluster_size > len(data):
            raise ValueError("transfer volume is full")
        entry = root_start + slot * 32
        if slot >= root_entries:
            raise ValueError("transfer root directory is full")
        data[entry:entry+11] = (stem.ljust(8) + ext.ljust(3)).encode("ascii")
        data[entry+11] = 0x20
        # Valid FAT dates avoid XP's "The parameter is incorrect" in DIR.
        for offset in (16, 18, 24):
            struct.pack_into("<H", data, entry + offset, 0x21)  # 1980-01-01
        struct.pack_into("<H", data, entry + 26, cluster if count else 0)
        struct.pack_into("<I", data, entry + 28, len(content))
        pos = file_start + (cluster - 2) * cluster_size
        data[pos:pos+len(content)] = content
        for k in range(count):
            value = 0xffff if k == count - 1 else cluster + k + 1
            for c in range(copies):
                struct.pack_into("<H", data, fat_start + c * fat_size + 2 * (cluster+k), value)
        cluster += count
        slot += 1
    mbr = bytearray(512)
    # One FAT16 LBA partition. CHS values indicate LBA addressing.
    mbr[446:462] = struct.pack("<B3sB3sII", 0, b"\xfe\xff\xff", 0x0e,
                              b"\xfe\xff\xff", 2048, len(data) // 512)
    mbr[510:512] = b"\x55\xaa"
    image = BUILD / "transfer.img"
    with image.open("wb") as f:
        f.write(mbr)
        f.seek(2048 * 512)
        f.write(data)
    volume.unlink()
    print(image)


if __name__ == "__main__":
    main()
