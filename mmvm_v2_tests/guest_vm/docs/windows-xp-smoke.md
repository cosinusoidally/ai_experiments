# Windows XP networking smoke test

2026-11-16: the unchanged `node_web.js` passes a bounded HTTP smoke test on the
provided Windows XP image under QEMU software emulation, not Wine.

## Results

- Windows XP Professional SP3, version 5.1, build
  `2600.xpsp.080413-2111` (confirmed through winver).
- QEMU 6.2, one vCPU, explicit single-threaded TCG, **256 MiB guest RAM** and
  a 32 MiB translation cache. No KVM, no build inside XP.
- The already-built executable and application were transferred on a read-only
  test CD, then copied to `C:\GVM_SMOKE` in the disposable disk overlay. No
  runtime source modules, Node installation or separate snapshot were needed.
- The server listens on all IPv4 interfaces at port 8000. Host requests go
  through `127.0.0.1:18080` forwarding; guest external networking is restricted.
- XP's firewall displayed its ordinary application alert. Unblocking this test
  executable allowed the forwarded requests; that rule exists only in the
  overlay. The firewall was not globally disabled.
- **10 checks passed:** index-page GET with exact bytes, 4,096-byte binary GET
  containing all byte values, HEAD with the correct length and empty body,
  and a missing-file 404. Request logs appeared on the XP console.
- Observed QEMU high-water RSS: **341552 KiB (333.55 MiB)**. Host MemAvailable
  stayed around **1 GiB or more** in the running samples. No memory issue was
  encountered; no concurrent heavy tests were run.
- The final VM was shut down with its ACPI power button through QMP.

This is a basic XP SP3 smoke test, not an XP full-suite, throughput or long-run
stability result. The broader Wine acceptance is recorded in
[Windows networking](windows-networking.md).

The executable tested has SHA-256:

`ecd0b414703ada3cfcb764064110543949c9f7f6e8462ebbfbe40d69db481ed1`

The supplied base image was opened **read-only** by QEMU, with the qcow2 overlay
as its only writable hard disk. Its full before/after SHA-256 is:

`ceb0f4f85a63679ecd6943091e40db0331886c663ce29e8dfb43e21ec3c778bb`

No files in the supplied `xp` directory were changed. Screenshots, ISO, logs,
PID file and overlay are temporary artifacts and are not checked in.

## Reproduction

All commands below start in `mmvm_v2_tests`. QEMU, genisoimage, Node and
ImageMagick were already available locally; nothing was downloaded. No root
filesystem mounting, guest agent, Python or development tools inside XP are
required.

Build the executable on the Linux host as described in the networking guide,
then use a **new** working directory:

```sh
mkdir -p artifacts/xp-smoke
sha256sum ../../xp/winxp.img > artifacts/xp-smoke/base-before.sha256
node guest_vm/tools/xp_smoke/prepare.js artifacts/xp-smoke/cd
node guest_vm/tools/xp_smoke/launch.js artifacts/xp-smoke
```

The launcher creates a qcow2 overlay referencing the raw base image, verifies
the backing chain before reuse and refuses to start if another recorded QEMU
PID still exists or host MemAvailable is below 768 MiB. It reserves no more
than the specified 256 MiB guest RAM. QEMU's additional process/code-cache
overhead means its RSS can exceed that guest RAM size.

The launcher is detached from the terminal's execution timeout. During initial
bring-up, a terminal-owned QEMU was sent SIGTERM by the Codex supervisor; the
detached launch avoided that. This was not an out-of-memory kill.

Inspect boot progress without a graphical QEMU window:

```sh
node guest_vm/tools/qmp_control.js artifacts/xp-smoke/qmp.sock screen artifacts/xp-smoke/screen.ppm
convert artifacts/xp-smoke/screen.ppm artifacts/xp-smoke/screen.png
```

Wait until the desktop and Run dialog are actually ready before typing; QMP
key injection is not a synchronous acknowledgement from Windows applications.
Open Run with `key meta_l-r`, type `cmd`, and press Return. At the ready command
prompt type `d:/start.bat` and press Return. The CD is drive D in this setup.
Forward slashes avoid the supplied image's UK/US backslash-key difference:

```sh
node guest_vm/tools/qmp_control.js artifacts/xp-smoke/qmp.sock key meta_l-r
# Wait for Run to appear.
node guest_vm/tools/qmp_control.js artifacts/xp-smoke/qmp.sock type cmd
node guest_vm/tools/qmp_control.js artifacts/xp-smoke/qmp.sock key ret
# Wait for the command prompt.
node guest_vm/tools/qmp_control.js artifacts/xp-smoke/qmp.sock type d:/start.bat
node guest_vm/tools/qmp_control.js artifacts/xp-smoke/qmp.sock key ret
```

The batch file copies the existing binaries/fixtures into the overlay and runs
the server, not a guest-VM build. If XP prompts, choose Unblock for GUEST (Alt+U
when that alert has focus). Then run the host-side check:

```sh
node guest_vm/tools/xp_smoke/verify.js artifacts/xp-smoke/cd
```

Stop the VM and verify base integrity afterwards:

```sh
node guest_vm/tools/qmp_control.js artifacts/xp-smoke/qmp.sock powerdown
# Wait for QEMU to exit before inspecting/reusing the overlay.
sha256sum -c artifacts/xp-smoke/base-before.sha256
```

`qmp_control.js ... quit` is an emergency emulator stop, not a guest clean
shutdown; use powerdown first. Nothing here modifies the backing image or
requires allocating a second full raw-disk copy.
