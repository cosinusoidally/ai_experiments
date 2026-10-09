#!/usr/bin/env python3
"""Start isolated XP testing; use vm.py command quit to stop this VM."""
import sys
sys.dont_write_bytecode = True

import argparse
from pathlib import Path
import subprocess

ROOT = Path.cwd()
BUILD = ROOT / "build"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, default=Path("../../xp/winxp.img"))
    args = parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    overlay = BUILD / "xp-overlay.qcow2"
    if not overlay.exists():
        subprocess.run(["qemu-img", "create", "-f", "qcow2", "-F", "raw", "-b",
                        str(args.base.resolve()), str(overlay)], check=True)
    if (BUILD / "monitor.sock").exists():
        raise SystemExit("monitor.sock exists: stop the existing VM before starting another")
    with (BUILD / "qemu.log").open("ab") as log:
        process = subprocess.Popen([
            "qemu-system-i386", "-m", "256",
            # Explicit block graph: only the overlay is writable.
            "-blockdev", f"driver=file,node-name=xp-base-file,filename={args.base.resolve()},read-only=on",
            "-blockdev", "driver=raw,node-name=xp-base,file=xp-base-file,read-only=on",
            "-blockdev", f"driver=file,node-name=xp-overlay-file,filename={overlay}",
            "-blockdev", "driver=qcow2,node-name=xp-overlay,file=xp-overlay-file,backing=xp-base",
            "-device", "ide-hd,drive=xp-overlay,bus=ide.0,unit=0",
            "-drive", f"file={BUILD / 'transfer.img'},format=raw,if=ide,index=1,snapshot=on",
            "-display", "none", "-monitor", f"unix:{BUILD / 'monitor.sock'},server=on,wait=off",
            "-serial", f"file:{BUILD / 'xp-serial.txt'}", "-nic", "none",
            "-rtc", "base=localtime", "-no-reboot"],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    (BUILD / "qemu.pid").write_text(str(process.pid) + "\n")
    print("Started XP test VM, PID", process.pid)


if __name__ == "__main__":
    main()
