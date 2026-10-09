#!/usr/bin/env python3
"""Small local QEMU monitor helper. Screenshots/input only; no guest agent."""
import argparse
from pathlib import Path
import socket
import time

ROOT = Path(__file__).resolve().parent


def command(s, text):
    s.sendall((text + "\n").encode("ascii"))
    result = b""
    while not result.endswith(b"(qemu) "):
        chunk = s.recv(65536)
        if not chunk:
            break
        result += chunk
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("screen", "key", "type", "command"))
    parser.add_argument("value", nargs="?", default="")
    args = parser.parse_args()
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(10)
        s.connect(str(ROOT / "build/monitor.sock"))
        greeting = b""
        while not greeting.endswith(b"(qemu) "):
            greeting += s.recv(65536)
        if args.action == "screen":
            target = ROOT / "build/screen.ppm"
            command(s, f"screendump {target}")
            from PIL import Image
            Image.open(target).save(target.with_suffix(".png"))
            print(target.with_suffix(".png"))
        elif args.action == "key":
            command(s, "sendkey " + args.value)
        elif args.action == "type":
            # Supplied XP image uses a UK keyboard layout.
            keys = {" ": "spc", ":": "shift-semicolon", "\\": "less",
                    "/": "slash", ".": "dot", "\n": "ret", "-": "minus",
                    '"': "shift-2", ">": "shift-dot", "_": "shift-minus",
                    "&": "shift-7", "*": "shift-8"}
            for char in args.value:
                key = keys.get(char, char.lower())
                if char.isupper():
                    key = "shift-" + key
                command(s, "sendkey " + key + " 30")
                time.sleep(.05)
        else:
            # Strip readline escape sequences only for readability of output.
            import re
            raw = command(s, args.value).decode("ascii", "replace")
            print(re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", raw).split("\r\n", 1)[-1])


if __name__ == "__main__":
    main()
