#!/usr/bin/env python3
"""Verify the actual XP self-hosting stages and binary comparisons."""
import sys
sys.dont_write_bytecode = True

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
EXPECTED = {
    "growth_compile": 0, "growth_run": 42, "growth_cross": 0,"win1": 0, "win2": 0, "win3": 0, "win12": 0, "win23": 0,
            "cross1": 0, "cross2": 0, "cross3": 0, "demo_compile": 0,
            "demo_run": 42, "demo_cross": 0}


def main():
    log = (ROOT / "build/xp-serial.txt").read_text(encoding="ascii").replace("\r", "")
    assert "WIN_SELFHOST_COMPLETE" in log, "self-hosting batch has not completed"
    assert "Version 5.1.2600" in log, "missing XP version evidence"
    matches = re.findall(r"STAGE (\w+) EXIT (-?\d+) EXPECT (\d+)[ \t]*\n", log)
    assert len(matches) == len(EXPECTED), "unexpected stage count"
    seen = set()
    for name, status, declared in matches:
        assert name in EXPECTED and name not in seen, "unexpected/duplicate stage"
        seen.add(name)
        assert int(status) == int(declared) == EXPECTED[name], f"{name}: unexpected status {status}"
        print(f"PASS {name}: exit {status}")
    assert log.count("FC: no differences encountered") == 7, "missing binary comparison evidence"
    assert "cc_min generated program OK" in log, "missing independent generated-program output"
    print("Windows stages are byte-identical to one another and to all three Linux stages.")


if __name__ == "__main__":
    main()
