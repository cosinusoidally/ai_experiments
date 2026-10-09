#!/usr/bin/env python3
"""Inspect the built PE using Python; no external assembler/linker/binutils."""
import sys
sys.dont_write_bytecode = True

import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent
ALLOWED = {
    "kernel32.dll": {"WriteFile", "ExitProcess", "VirtualAlloc", "CreateFileA",
                     "GetFileSize", "ReadFile", "CloseHandle", "VirtualProtect",
                     "GetCurrentProcess", "FlushInstructionCache", "GetStdHandle", "SetErrorMode", "GetLastError"},
    "msvcrt.dll": {"__set_app_type", "_controlfp", "__argc", "__argv", "_environ",
                   "__getmainargs", "exit", "_XcptFilter", "_exit", "_except_handler3"},
}


def audit(path):
    data = path.read_bytes()

    def unpack(fmt, offset):
        return struct.unpack_from(fmt, data, offset)

    assert data[:2] == b"MZ", "missing DOS signature"
    pe = unpack("<I", 0x3c)[0]
    assert data[pe:pe+4] == b"PE\0\0", "missing PE signature"
    machine, count = unpack("<HH", pe + 4)
    optional_size = unpack("<H", pe + 20)[0]
    optional = pe + 24
    assert machine == 0x14c and unpack("<H", optional)[0] == 0x10b, "expected i386 PE32"
    subsystem = unpack("<H", optional + 68)[0]
    os_version = unpack("<HH", optional + 40)
    subsystem_version = unpack("<HH", optional + 48)
    assert subsystem == 3 and os_version == (4, 0) and subsystem_version == (4, 0), \
        "unexpected Windows baseline headers"
    sections = []
    for i in range(count):
        offset = optional + optional_size + i * 40
        virtual_size, rva, raw_size, raw = unpack("<IIII", offset + 8)
        sections.append((rva, virtual_size, raw, raw_size))

    def file_offset(rva):
        for base, size, raw, raw_size in sections:
            if base <= rva < base + size and rva - base < raw_size:
                return raw + rva - base
        raise ValueError("unbacked RVA in PE audit")

    def string(rva):
        offset = file_offset(rva)
        return data[offset:data.index(b"\0", offset)].decode("ascii")

    import_rva = unpack("<I", optional + 104)[0]
    descriptor = file_offset(import_rva)
    imports = {}
    while any(unpack("<IIIII", descriptor)):
        lookup, _, _, name, first = unpack("<IIIII", descriptor)
        library = string(name).lower()
        imports[library] = []
        thunk = file_offset(lookup or first)
        while True:
            value = unpack("<I", thunk)[0]
            if not value:
                break
            assert not value & 0x80000000, "ordinal import requires a separate audit"
            imports[library].append(string(value + 2))
            thunk += 4
        descriptor += 20
    assert set(imports) == set(ALLOWED), "unexpected DLL dependency"
    for library, functions in imports.items():
        assert set(functions) == ALLOWED[library], "unexpected imported functions in " + library
    return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data),
            "machine": "i386", "format": "PE32", "subsystem": "console",
            "os_version": list(os_version), "subsystem_version": list(subsystem_version),
            "imports": imports}


def main():
    result = audit(ROOT / "build/share/lin32.exe")
    (ROOT / "build/pe-audit.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
