#!/usr/bin/env python3
"""Build the single PE32 runtime and original Linux fixtures without downloads."""
import sys
sys.dont_write_bytecode = True

import hashlib
import argparse
import os
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
SHARE = BUILD / "share"
TCC = Path(os.environ.get("LIN32_TCC_ROOT", "/tmp/tcc-cross"))
TCC_BIN = TCC / "bin"
TCC_LIB = TCC / "lib/tcc"
TCC_WIN = TCC_LIB / "win32"


def run(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=ROOT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clean", action="store_true",
                        help="remove all generated build artifacts and local Python caches")
    args = parser.parse_args()
    if args.clean:
        if (BUILD / "monitor.sock").exists():
            raise SystemExit("Stop the XP test VM before cleaning its disks and logs.")
        if BUILD.exists():
            shutil.rmtree(BUILD)
        for cache in ROOT.rglob("__pycache__"):
            if cache.is_symlink():
                cache.unlink()
            else:
                shutil.rmtree(cache)
        print("Cleaned build artifacts and Python caches.")
        return
    SHARE.mkdir(parents=True, exist_ok=True)
    run(TCC_BIN / "i386-win32-tcc", f"-B{TCC_LIB}",
        f"-I{TCC_WIN / 'include'}", f"-I{TCC_WIN / 'include/winapi'}",
        f"-L{TCC_WIN / 'lib'}", "-nostdlib", "-Wall", "lin32.c", "entry.S",
        "-lkernel32", "-o", SHARE / "lin32.exe")
    for case, name in enumerate(("hello", "checks", "badmem", "illegal", "readonly", "stack"), 1):
        run(TCC_BIN / "i386-tcc", f"-B{TCC_LIB}", "-nostdlib", "-static", f"-DCASE={case}",
            "-Wl,-Ttext=0x08048000", "fixtures.S", "-o", SHARE / f"{name}.elf")
    hello = (SHARE / "hello.elf").read_bytes()
    (SHARE / "short.elf").write_bytes(hello[:20])
    damaged = bytearray(hello)
    struct.pack_into("<I", damaged, 28, 0xfffffff0)  # e_phoff outside file
    (SHARE / "headers.elf").write_bytes(damaged)
    damaged = bytearray(hello)
    struct.pack_into("<H", damaged, 16, 3)  # ET_DYN
    (SHARE / "dynamic.elf").write_bytes(damaged)
    damaged = bytearray(hello)
    phoff = struct.unpack_from("<I", damaged, 28)[0]
    struct.pack_into("<I", damaged, phoff + 16, 0xffffffff)  # oversized p_filesz
    (SHARE / "bounds.elf").write_bytes(damaged)
    damaged = bytearray(hello)
    struct.pack_into("<I", damaged, 24, 0x12345678)  # unmapped entry
    (SHARE / "entry.elf").write_bytes(damaged)
    damaged = bytearray(hello)
    struct.pack_into("<I", damaged, phoff, 3)  # PT_INTERP
    (SHARE / "interp.elf").write_bytes(damaged)
    tests = [("hello", "--trace hello.elf", 37),
             ("checks", 'checks.elf alpha "two words"', 0),
             ("stack", "stack.elf", 0),
             ("badmem", "badmem.elf", 125),
             ("illegal", "illegal.elf", 125),
             ("readonly", "readonly.elf", 125)]
    tests += [(name, name + ".elf", 125) for name in
              ("short", "headers", "dynamic", "bounds", "entry", "interp")]
    lines = ["@echo off", "cd /d %~dp0", "ver > result.txt"]
    for name, args, expected in tests:
        lines += [f"lin32.exe {args} > {name}.out 2> {name}.err",
                  f"echo TEST {name} EXIT %errorlevel% EXPECT {expected} >> result.txt",
                  f"type {name}.out >> result.txt", f"type {name}.err >> result.txt",
                  "echo. >> result.txt"]
    lines += ["echo LIN32_TESTS_COMPLETE >> result.txt",
              "mode com1: baud=115200 parity=n data=8 stop=1 > nul",
              "type result.txt > com1", "type result.txt"]
    (SHARE / "run.cmd").write_bytes(("\r\n".join(lines) + "\r\n").encode("ascii"))
    digest = hashlib.sha256((SHARE / "lin32.exe").read_bytes()).hexdigest()
    (BUILD / "lin32.sha256").write_text(digest + "  lin32.exe\n")
    print("Built", SHARE / "lin32.exe", "SHA256", digest)


if __name__ == "__main__":
    main()
