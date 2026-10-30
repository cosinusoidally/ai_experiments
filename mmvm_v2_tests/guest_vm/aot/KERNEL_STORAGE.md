# Kernel local storage

The kernel compiler keeps JavaScript's logical local bindings distinct from
their native stack homes. `kernel_slots.js` attaches `localStorage` metadata
after graph inlining; it does not rewrite the IR's local indices, names or
register preferences. The JS backend continues to execute the original logical
locals. Native register selection also sees their original use counts.

This separation matters: an earlier experiment replaced logical locals with
merged storage indices. That changed register-selection weights, made existing
register choices worse and slowed self-hosted preparation substantially. It is
not the implementation retained here.

## Analysis

The shared control-flow builder exposes statements, branches, jumps, loops and
returns. For analysis, an opcode-dispatch node exposes its original conditional
body; specialization and actual dispatch emission remain backend decisions.

Each block records local reads before definition and local definitions. A
reverse fixed-point traversal solves live-in/live-out bit sets, including
backedges. A local's conservative interval spans its definitions, reads and
live block boundaries. Intervals may overlap more than necessary; they must
never omit a live edge. Nonoverlapping intervals may share a stack slot.

Inlined expression bodies have private return edges. Their reads and writes
are conservatively treated as simultaneous uses, rather than assuming a
definition executes on every path. This costs some reuse but avoids weakening
the existing inline-call semantics. IR sequences are traversed by numeric
index, not property enumeration. Ordinary IR records use named fields.

Locals with explicit register preferences retain dedicated stack homes. Other
intervals are ordered deterministically by first position and logical index,
then assigned available homes. This introduces no per-block register handoff,
runtime move, guest-specific specialization or heap-layout change.

## Native emission and inspection

`localStorage.names` retains logical source names; `slots` maps each logical
index to its physical home. `logicalCount`, `storageCount` and `passes` expose
the allocation result. `inspect_kernel_build.js --storage` prints counts.

The native backend's `localStorageIndex` and `localDisplacement` are the only
translation points. They cover loads, stores, direct arithmetic/comparisons,
the canonical EDX home and the hidden position-independent dispatch anchor.
ABI argument offsets are unchanged. This optimizes the native interpreter's
own stack, not the guest activation register banks or guest-heap objects.

The assembler's `emitEbpMemory` encodes one frame-relative instruction using
either a signed byte or full-width displacement. Named instruction macros
remain the public interface. Full-width fallback also avoids truncating large
argument/frame offsets. Source functions and their `toString` representations
are unchanged, and the logical-to-physical map remains available for debugging.

## Current checkpoint measurements

The interpreter has 639 logical locals and 173 native homes. Initial Node
project checks pass 12 programs / 270 assertions, and native GC stress passes
24 rounds / 47 collections. Node/js_min snapshots are byte-identical. Before
the compact-address encoder, Node and genuine self-hosted snapshots also match.

Home reuse alone takes 32.25 seconds for zlib quick correctness against a fresh
32.26-second control. The controlled self-hosted builds take 100.19 seconds
with the candidate interpreter versus 99.37 with the control interpreter,
both compiling identical current sources and producing identical output.
These are neutral results, not a substantial speedup.

Compact frame operands reduce native code from the original 407,634 bytes to
375,552 bytes. The first zlib observation is 31.33 seconds; js_min construction
takes 85.32 seconds. These do not establish the requested large gain. Full
Test262 passes all 3,292 authored variants with zero failures/timeouts/not-run,
in 498.23 seconds external elapsed (494.04 s CPU, peak RSS 575,828 KiB).
Broader live-demo validation of this checkpoint remains to be run.
All measurements are single-threaded, serial workload runs; no cache is used.

## Address selection follow-up

Native address selection now describes a base expression/register, optional
index and displacement. A single computed pointer is evaluated once into EAX
when it has no allocated register. Loads can then consume its displacement
directly, rather than emitting an add followed by a dereference. Existing
scaled-register addressing remains available for genuinely indexed accesses.
Trusted and raw integer loads retain their distinct shared IR operations;
native code can use the same machine addressing modes for both. The JS backend
keeps the original memory-adapter operations.

The assembler's general register/memory encoder also covers the mandatory EBP
displacement and ESP SIB cases. Named move/zero-extension/LEA macros expose
these encodings; no instruction byte sequences appear in backend code.
This follows the ordinary i386 instruction set and does not identify guest
functions, programs or benchmark names.

Initial project checks pass 12 programs / 270 assertions and the native
24-round / 47-collection workload. The execution-cursor candidate is still a
separate unaccepted change; a smaller instruction stream alone is not proof
that either change meets the performance target.
