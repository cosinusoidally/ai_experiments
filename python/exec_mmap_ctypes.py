#!/usr/bin/env python

import ctypes
import os
import sys

def _is_windows():
    return os.name == "nt"


def _pointer_size_bits():
    return ctypes.sizeof(ctypes.c_void_p) * 8


def _code_size():
    return 6


def _allocate_executable_memory(size):
    if _is_windows():
        return _allocate_executable_memory_windows(size)
    return _allocate_executable_memory_posix(size)


def _allocate_executable_memory_posix(size):
    libc = ctypes.CDLL(None)
    libc.mmap.restype = ctypes.c_void_p
    libc.mmap.argtypes = [
        ctypes.c_void_p,
        ctypes.c_size_t,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_long,
    ]

    prot_read = 0x1
    prot_write = 0x2
    prot_exec = 0x4
    map_private = 0x02
    map_anon = 0x20

    address = libc.mmap(
        None,
        size,
        prot_read | prot_write | prot_exec,
        map_private | map_anon,
        -1,
        0,
    )
    failed = ctypes.c_void_p(-1).value
    if address == failed:
        raise OSError("mmap failed")
    return libc, address


def _allocate_executable_memory_windows(size):
    kernel32 = ctypes.windll.kernel32
    kernel32.VirtualAlloc.restype = ctypes.c_void_p
    kernel32.VirtualAlloc.argtypes = [
        ctypes.c_void_p,
        ctypes.c_size_t,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]

    mem_commit = 0x1000
    mem_reserve = 0x2000
    page_execute_readwrite = 0x40

    address = kernel32.VirtualAlloc(
        None,
        size,
        mem_commit | mem_reserve,
        page_execute_readwrite,
    )
    if not address:
        raise OSError("VirtualAlloc failed")
    return kernel32, address


def _write_machine_code(address):
    code = (ctypes.c_ubyte * _code_size()).from_address(address)

    # x86/x86_64 machine code:
    #   mov eax, 42
    #   ret
    #
    # Writing to EAX also sets RAX correctly on x86_64, so this sequence works
    # for both 32-bit and 64-bit CPython running on x86-family CPUs.
    code[0] = 0xB8
    code[1] = 0x2A
    code[2] = 0x00
    code[3] = 0x00
    code[4] = 0x00
    code[5] = 0xC3


def _free_memory(mapping, address):
    if _is_windows():
        mem_release = 0x8000
        mapping.VirtualFree.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_ulong]
        mapping.VirtualFree.restype = ctypes.c_int
        if not mapping.VirtualFree(ctypes.c_void_p(address), 0, mem_release):
            raise OSError("VirtualFree failed")
        return
    mapping.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
    mapping.munmap.restype = ctypes.c_int
    if mapping.munmap(ctypes.c_void_p(address), ctypes.c_size_t(_code_size())) != 0:
        raise OSError("munmap failed")


def main():
    if ctypes.sizeof(ctypes.c_void_p) not in (4, 8):
        raise RuntimeError("Unsupported pointer size: %d" % ctypes.sizeof(ctypes.c_void_p))

    size = _code_size()
    mapping, address = _allocate_executable_memory(size)

    try:
        _write_machine_code(address)

        function = ctypes.CFUNCTYPE(ctypes.c_uint32)(address)
        result = function()

        sys.stdout.write("python: %s\n" % sys.version.split()[0])
        sys.stdout.write("bits: %s\n" % _pointer_size_bits())
        sys.stdout.write("address: 0x%x\n" % address)
        sys.stdout.write("result: %s\n" % result)
    finally:
        try:
            del function
        except UnboundLocalError:
            pass
        _free_memory(mapping, address)


if __name__ == "__main__":
    main()
