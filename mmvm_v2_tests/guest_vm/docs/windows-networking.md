# Windows networking

## Bring-up plan

Provide the existing Node compatibility layer's POSIX-shaped socket boundary
using XP-era Winsock 2 APIs. Keep `node_web.js`, HTTP handling and the shared
event loop unchanged. Do not add host-language networking, C code, threads,
callbacks, WSAPoll or post-XP imports.

1. Add kernel-dialect socket ownership, error translation, nonblocking I/O and
   a select-backed poll adapter to the PE platform implementation.
2. Use generated cdecl-to-stdcall bridges for Winsock imports. Keep Linux
   packaging and the snapshot payload independent of these Windows additions.
3. Test hello, socket readiness/error/lifetime behaviour and the unchanged
   node_web server under Wine, including directory listings and binary files.
4. Check Linux networking and build identity/regressions; document exact
   commands and limitations for a real Windows XP acceptance run.

Native socket handles must never be passed to CRT file I/O. A private descriptor
registry distinguishes sockets from CRT descriptors and releases entries on
close. Linux constants at the compatibility boundary are translated explicitly;
raw Windows errors must not leak into code expecting Linux errno values.

This work does not promise Linux ABI emulation for `net.js`, Unix-domain sockets,
DNS/IPv6 support beyond the existing Node-compatible surface, or full Node.js
compatibility. Unsupported requests should fail normally rather than terminate
the process. Existing Windows XP runtime support is the baseline to preserve.

## Implementation

`tools/windows_network.js` adds functions/constants to the Windows platform
kernel graph. The PE builder imports `ws2_32.dll` alongside `kernel32.dll` and
`msvcrt.dll`; Winsock initialization is lazy. All Winsock imports receive the
same generated cdecl-to-stdcall bridges as other Windows API functions.
DLL import descriptors are now grouped by DLL rather than assuming two groups.

Private socket descriptors start at `0x40000000`. Each live descriptor has a
small native registry entry with its SOCKET handle and nonblocking flags. Close
unlinks/frees the entry. File descriptors continue to use the CRT; read/write
and close route sockets to recv/send/closesocket. No registry entries or native
handles are captured in the snapshot. The OS releases Winsock process state at
exit; there is no per-socket WSAStartup/WSACleanup cycle.

The supported boundary translates AF_INET/SOCK_STREAM, SOL_SOCKET's
SO_REUSEADDR/SO_ERROR, fcntl F_GETFL/F_SETFL with O_NONBLOCK, and the ordinary
connection/readiness errors consumed by the shared layer. Other options fail
with ENOPROTOOPT; unsupported families fail with EAFNOSUPPORT. IPv4 text parsing
accepts four decimal octets. Existing numeric-bind-only Node server policy is
unchanged; this does not introduce DNS, IPv6 or Node TCP client APIs that the
compatibility layer did not already expose.

Polling builds counted Winsock fd_sets in per-call native scratch storage,
with space for every input entry rather than a fixed C FD_SETSIZE structure.
Duplicate entries share set membership but count separately in poll's result;
negative descriptors are ignored and unknown descriptors report POLLNVAL.
Failed asynchronous connects expose requested writability so the existing
SO_ERROR path reports a translated connection failure. EOF is readable and is
resolved by recv returning zero. The poll allocation is bounded to 65,536 input
entries; this is a resource limit, not a claim of that many supported clients.

Pointers borrowed for kernel I/O pass through existing range-commit support,
so uncommitted guest pages are made accessible before Winsock reads/writes
them. The shared HTTP, filesystem and event-loop implementation is unchanged.

## Initial acceptance

The native socket integration check passes under Wine (4,279 checks) and the
Linux executable (4,278; the extra Windows check verifies rejection of Unix
sockets). It exercises ephemeral binding, nonblocking accept/read/connect,
readiness timeout, SO_ERROR, binary payloads, EOF, duplicate/negative/closed poll
entries, refused connections and repeated create/close lifetimes.

The unchanged `node_web.js` passes the same 104-check HTTP acceptance under Wine
and Linux: binary/text GET, HEAD, redirects, index files, directory listings,
URL decoding, errors, traversal rejection, stdout logging, incomplete requests,
slow readers, and 80 simultaneous connections (above the common 64-entry C
fd_set default). Test fixtures/logs are temporary under artifacts.

These are Wine results, not a claim of tested native XP networking.
