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
kernel graph. The executable retains just `kernel32.dll` and `msvcrt.dll` as
static imports. On the first socket request the kernel loads `ws2_32.dll` using
LoadLibraryA/GetProcAddress, then initializes Winsock. All Winsock functions
receive generated cdecl-to-stdcall bridges, like other Windows API functions.
Non-network applications do not request Winsock initialization or loading.

The platform API declarations' fourth field marks deferred imports. The PE
builder emits initially zero target slots plus an inspectable table of
image-relative symbol-name and target-slot offsets (`socketImportLayout`).
Startup installs addresses of that table and the DLL name; `loadSocketLibrary`
fills the target slots at runtime. On missing exports it clears all slots and
releases the DLL before returning a normal error. Successful loading is pinned
for the process lifetime. No resolved addresses enter the file or snapshot.
Static import descriptors are grouped by DLL instead of assuming two groups.
The CLI only loads the Windows backend for --win32, so ELF packaging does not
load/compile these extra support modules.

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

## Validation: 2026-11-16

The native socket integration check passes under Wine and the Linux executable
(the extra Windows check verifies rejection of Unix sockets). It exercises
ephemeral binding, nonblocking accept/read/connect,
readiness timeout, SO_ERROR, binary payloads, EOF, duplicate/negative/closed poll
entries, refused connections and repeated create/close lifetimes. A bounded
backpressure phase fills an unread connection until would-block, closes the
writer, then verifies all queued bytes arrive before EOF. Assertion counts in
this phase vary with the platform's actual partial-write/read sizes.

The unchanged `node_web.js` passes HTTP acceptance under Wine
and Linux: binary/text GET, HEAD, redirects, index files, directory listings,
URL decoding, errors, traversal rejection, stdout logging, incomplete requests,
slow readers, and 80 simultaneous connections (above the common 64-entry C
fd_set default). Test fixtures/logs are temporary under artifacts.

These are Wine results, not a claim of tested native XP networking.

- Final lazy-loaded image: both explicit loopback and default all-interface
  Wine HTTP runs pass **106 checks** each, **2.21 s** each. The isolated Linux
  executable run passes the same 106 checks in **2.13 s**; the original Linux
  js_min/Node-compatibility runner passes in **4.37 s**. These are integration
  observations, not statistically controlled throughput benchmarks.
- Node and js_min core suites each pass **12 guest programs / 310 assertions**,
  plus their existing tokenizer/heap/compiler/embedding checks.
- Full Wine Test262 on the first networking checkpoint: **3292 passed /
  0 failed / 0 timed out / 0 not run**. Harness **346899.175 ms**, process
  **348.74 s**, peak RSS **518092 KiB**. The later changes defer Winsock loading
  and normalize negative poll timeouts; their networking paths are covered by
  the final focused checks. The language snapshot payload remains identical.
- Wine structural GC stress passes **27 audits / 113265 checked edges /
  221 property-index audits / 80 embedding collections**, 24 workload rounds.
  The tested inner heap is capped at 8 MiB, not the whole process. No corruption
  was reported. This ran before the deferred-DLL refinement; the final image
  also completes the genuine self-hosted construction/GC workload below.
- Final Wine genuine self-build: **81.76 s / 483324 KiB peak RSS**, exit 0,
  byte-identical snapshot. Prior fresh default Wine observation was **84.11 s /
  484268 KiB**; this pair shows no observed build regression, not an isolated
  optimization result.
- Standalone language and shell/ctypes integrations pass on the final image.
  A Node-compatible timer fires with an idle listening socket, then closes the
  server cleanly. The existing large binary file-I/O check also passes aligned
  and interior-span read/write/fread/fwrite cases on the final image.
  Richards and CodeLoad pass Octane quick correctness; this was not a complete
  Octane or ECMA rerun and does not establish new benchmark scores.
- PE packaging agrees byte-for-byte across Node, Linux js_min, Linux standalone
  guest and Windows standalone guest. ELF packaging remains byte-identical to
  the pre-networking image, including when generated under Wine. A Linux ELF
  written on Windows/Wine needs its Unix executable bit set before Linux use;
  Windows chmod is intentionally a no-op.

Final `artifacts/guest_vm-win32.exe` is **7,634,944 bytes**, SHA-256:

`ecd0b414703ada3cfcb764064110543949c9f7f6e8462ebbfbe40d69db481ed1`

The unchanged source/self-built snapshot is **7,595,640 bytes**, SHA-256:

`9c79d33d589a16b297b5b389ce9d1d3ee2dc67450589e2cc328cee7776fd2c42`

Raw build/test logs and generated files are ignored artifacts, not checked-in
sources. No C, demo, external corpus, shared interpreter or Node-compatibility
application/event-loop code was changed.

## Reproduction and XP hand-off

From `mmvm_v2_tests`, using new output names (packaging never overwrites):

```sh
node guest_runner.js --vm-native --snapshot artifacts/network.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/network.snap artifacts/guest_vm-win32.exe --win32
node guest_vm/tools/check_snapshot_pe.js artifacts/network.snap artifacts/guest_vm-win32.exe

# Activate the supplied 32-bit Wine prefix, then run checks serially.
. ../../wine/32.sh
WINEDEBUG=-all wine artifacts/guest_vm-win32.exe hello.js
WINEDEBUG=-all wine artifacts/guest_vm-win32.exe guest_vm/tools/check_native_network.js
WINEDEBUG=-all node guest_vm/tools/check_node_web.js --wine artifacts/guest_vm-win32.exe
WINEDEBUG=-all node guest_vm/tools/check_node_web.js --wine artifacts/guest_vm-win32.exe --all-interfaces
```

The HTTP supervisor is a developer tool using only Node built-ins; neither the
server nor the packaged runtime needs Node. For guest executables, that test
runs from a temporary directory containing only the application and fixtures,
not a source checkout. The `--js-min` supervisor option tests the original Linux
compatibility runner; `--native` tests the Linux standalone executable.

On XP, copy the generated executable, unchanged `node_web.js`, and a directory
of files to serve (for example `www`). No separate snapshot, development tools,
runtime source modules or npm packages are needed for the server. In cmd.exe:

```bat
guest_vm-win32.exe node_web.js --bind 127.0.0.1 --directory www 8000
```

Open `http://127.0.0.1:8000/` in a browser. Test an index.html directory, a
directory without an index (listing), a missing file and a binary download.
For access from another trusted machine, omit `--bind`; the existing default
is `0.0.0.0`, and Windows Firewall must permit the port. XP is not an appropriate
public Internet server target.

The native socket acceptance script can also be run on XP with the checkout
present (it loads `node_compat/libc.js`):

```bat
guest_vm-win32.exe guest_vm/tools/check_native_network.js
```

Keep this window's final passed/error output when reporting XP results. That
script uses loopback only and includes finite readiness waits. There is no DNS
or IPv6 requirement. The existing `--bind` implementation accepts numeric IPv4
addresses, not hostnames such as `localhost`.
