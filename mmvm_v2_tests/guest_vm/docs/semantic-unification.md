# Ordinary property semantics and root ownership

Follow-up to the storage/root cutover, starting from 77a2954.

## Boundaries and sequence

1. Share ordinary descriptor validation/attribute transitions. Runtime currently
   validates ToPropertyDescriptor in observable ES5 order and roots getter
   results. The native define-property path accepts callback-free descriptor
   fields and otherwise declines to the existing continuation. Both separately
   implement non-configurable/non-writable rules. Replace those duplicated
   rules with a pure kernel-dialect decision function; keep coercion, callbacks,
   SameValue computation, allocation and error construction with their callers.
2. Share ordinary assignment decisions and prototype resolution, preserving
   receiver identity, guarded owner/entry handles and explicit exotic handling.
3. Audit remaining root categories and temporary lifetimes. Share enumeration
   where ownership is shared, not permanent retention or moving collection.
4. Delete superseded implementations at each working cutover and retain named
   rejection reasons, rather than numeric diagnostics or silent new fallbacks.

Arrays/arguments/string/typed-view special cases remain explicit. No parser,
substring, source-sharing, C, demo or external corpus changes are in scope.
The pure decision layer must run as ordinary ES3-compatible JS and compile
through the existing shared kernel pipeline; no fake local constants or
descriptor allocations per ordinary assignment are acceptable.

## Validation

Use existing embedding/descriptor/context integration checks and bounded GC
audits at intermediate commits. Freeze the final source for one combined
corpus, benchmark, self-host/cross-host build and graphical/HTTP audit.
Compare exact ECMA pass sets. Preserve raw failures and timing/RSS observations
in ignored artifacts, run heavy work serially and commit working checkpoints.

## Descriptor decision checkpoint

property_semantics_kernel.js now owns ordinary descriptor rejection and flag
transitions. Runtime calls the ordinary JS function; the native graph compiles
that same function with explicit read-only field/attribute/rejection namespaces.
Normalized input consists only of presence bits, requested attribute bits and
SameValue mismatch bits. It retains no descriptor/heap references and allocates
nothing. Both old validation/flag-update blocks have been removed. Observable
getter order, callable validation, value rooting and exotic handling remain
with the adapters, before entry resolution and publication.

Node core passes (12 guest programs / 270 assertions plus internal checks),
and i386 focused embedding/context integration passes. The latter entry point
reuses the existing broad integration checks, not a new micro-feature suite.
Four selected existing Object.defineProperty tests pass under standalone
execution: define-over-method, function-length, miscellaneous, new-definition.
They take 26.047 runner seconds versus 28.356 on the unchanged old debug image
in an adjacent control. This is a focused observation, not full acceptance or
a claimed general speedup. Node builds the candidate in 9.57 seconds /
302840 KiB peak RSS. Broader build/corpus/performance gates remain pending.
