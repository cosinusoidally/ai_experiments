#!/usr/bin/env python3
"""Verify the real XP batch output captured through QEMU's serial port."""
import sys
sys.dont_write_bytecode = True

import re
from pathlib import Path

ROOT = Path.cwd()
EXPECTED = {
    "hello": (37, "Hello from native Linux i386 on Windows!", "int80 exception=0xc0000005"),
    "checks": (0, "ABI checks passed"),
    "stack": (0, "stack"),
    "heap": (0, "Heap growth checks passed"),
    "fileio": (0, "File I/O checks passed"),
    "badmem": (125, "guest fault exception=0xc0000005"),
    "illegal": (125, "guest fault exception=0xc000001d"),
    "readonly": (125, "guest fault exception=0xc0000005"),
    "short": (125, "truncated ELF header"),
    "headers": (125, "invalid ELF program header table"),
    "dynamic": (125, "expected little-endian static ELF32/i386 ET_EXEC"),
    "bounds": (125, "invalid ELF load segment bounds"),
    "entry": (125, "ELF entry is outside a readable executable segment"),
    "interp": (125, "dynamic ELF interpreter not supported yet"),
}


def main():
    log = (ROOT / "build/xp-serial.txt").read_text(encoding="ascii").replace("\r", "")
    assert "LIN32_TESTS_COMPLETE" in log, "XP test batch has not completed"
    assert "Version 5.1.2600" in log, "missing XP version evidence"
    matches = list(re.finditer(r"TEST (\w+) EXIT (-?\d+) EXPECT (\d+)[ \t]*\n", log))
    assert len(matches) == len(EXPECTED), "unexpected test count"
    seen = set()
    for i, match in enumerate(matches):
        name, result, declared = match.groups()
        assert name in EXPECTED and name not in seen, f"unexpected/duplicate test: {name}"
        seen.add(name)
        expected, *messages = EXPECTED[name]
        assert int(result) == int(declared) == expected, f"{name}: exit {result}, expected {expected}"
        end = matches[i+1].start() if i + 1 < len(matches) else log.index("LIN32_TESTS_COMPLETE")
        block = log[match.end():end]
        for message in messages:
            assert message in block, f"{name}: missing {message!r}"
        print(f"PASS {name}: exit {result}")
    print(f"All {len(matches)} Windows XP tests passed.")


if __name__ == "__main__":
    main()
