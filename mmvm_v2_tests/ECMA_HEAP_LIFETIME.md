# ECMA heap/lifetime investigation, 2026-11-02

This report distinguishes observed failures from independent root causes.
External corpus files are unchanged. Generated logs and images remain in
ignored `artifacts/` and are not checked in.

## Observed failures before stabilisation

- The fresh contract-94 control reproduces 906 passes / 423 failures,
  including 38 timeouts, with four existing skips and zero not run.
- One control failure explicitly reports an invalid heap reference:
  `ecma_5/Array/unshift-01.js`, reference 1 while treating an ordinary
  array-like receiver as indexed Array storage.
- The intermediate feature candidate reports 955 passes / 374 failures,
  including 20 timeouts. This is **not a stable checkpoint**: seven previously
  passing files fail, despite its higher total pass count.
- That candidate has **27 explicit heap/reference-error files**: 25 report
  already-freed execution frames, and two report a reclaimed object/string
  reference. Twenty are descriptor redefinition stress files; the others
  include ordinary bitwise/shift expressions and two descriptor files that
  previously passed. These are not evidence of 27 independent GC bugs.

## Shared binding-name lifetime defect

The portable reference backend reproduces the earliest error in the unchanged
`ecma/Expressions/11.10-2.js` test. The first failure occurs when
`Runtime.adoptEnvironment` reads a binding-name string that GC has reclaimed.
Later exception cleanup reports an already-freed frame, masking that original
diagnostic. This is why the first invalid access, not just the final error
line, matters.

Program registration allocates a value vector for binding names and fills its
cells, but did not publish its live length. Allocated capacity and live length
are different fields. The collector correctly traces only live cells; a
zero-length name vector therefore retains none of its strings. Native named
lookup also rejects a vector whose live length differs from the environment's
binding count, causing unnecessary semantic exits even before reclamation.

The fix publishes the completed vector length. A named layout verifier checks
the program's binding count against the live vector length and verifies every
name is a live String reference. The existing bounded structural GC stress
test applies that verifier to program records; no language micro-test or
external-corpus change is needed.

Separately, native-created closure parents were sometimes adopted with an
empty binding-name map. Adoption now reconstructs the parent's own layout
from its heap program rather than trusting the current caller's slots or an
empty supplied map. Ordinary data-only eval-variable environments can also
be read directly by the native name resolver. Accessors/exotic environments
continue to require their full semantic operation.

The fixed portable diagnostic completes the expression test with 3452794
instructions, matching the preceding passing control, instead of reporting
the reclaimed name and then the secondary freed-frame error.

## Other defects found during bring-up

- Array intrinsic fallbacks exposed a dispatch error: the numeric interval
  used to classify Math IDs also included `Array.push`. A declined push could
  enter the Math kernel with an incompatible calling convention and read a
  null value-cell pointer. Dispatch now explicitly identifies Math operations;
  the Math kernel also rejects unrecognised operations defensively.
- The pre-existing `unshift` reference error is addressed by the generic
  guest-bytecode algorithm for array-like receivers. With zero arguments it
  performs only the required length conversion/write, not billions of
  unnecessary element accesses for a large converted length.

## Diagnostics and validation

The existing native-exit tool now includes a bounded dump of lexical
environments, binding names, values and parent links. The new portable
diagnostic entry runs an unchanged corpus file through the existing guest
embedding, reporting the original implementation stack at the first failed
heap validation:

```sh
node guest_vm/tools/run_ecma_diagnostic.js ecma/Expressions/11.10-2.js 12000000
```

This is the Node-hosted **guest interpreter**, not execution of the test by
Node itself. Raw i386 FFI is disabled in that reference-backend diagnostic.
It does not replace the standalone suite runner or count as a suite score.

The js_min runner gate also caught a host call-object cleanup crash during
library installation. Callback creation is now centralised in the runtime's
guest-builtin installer rather than duplicated inside a nested context
installation function. The direct `guest_runner.js hello.js` check then
exposed a portable-compiler correctness issue: `typeof` on an unresolvable
identifier was emitted as a throwing global read. It now uses the existing
lexical `typeOfBinding` operation. The unchanged hello program prints only
`Hello, world!` and exits successfully on js_min after both fixes. No host
engine or C changes were made.

Final standalone pass sets, heap-error counts and regression-gate results
are recorded in [ECMA_TESTS_STATUS.md](ECMA_TESTS_STATUS.md) after validation.
A clean run means no explicit heap failures in that run, not proof that all
possible heap-corruption paths have been eliminated.
