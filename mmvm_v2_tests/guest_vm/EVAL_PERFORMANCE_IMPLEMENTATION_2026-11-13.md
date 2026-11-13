# Eval/runtime construction performance — implementation log

Work follows the measured priorities in
[the phase report](EVAL_PHASE_MEASUREMENTS_2026-11-13.md).
External corpus, harness selection, instruction limits and demos are unchanged.
No source/program cache, threads, C changes or regex-specific shortcut is used.
Results below are single observations unless explicitly identified otherwise.

## Retained architecture

- One native-call binding factory replaces four argument-array wrappers.
  General `fn` adaptation remains; internal integer signatures use `callI32`.
  Executable ownership is checked, including retained entries after destruction.
  Memory-view bindings preserve allocation-relative return values and null.
- Record initializer/allocator entrypoints use the fixed integer boundary.
  Program metadata is normalized before reservation and imported through the
  existing checked dense-word ingress, rather than many field-write calls.
- Packed property helpers use the same shared IR on both storage backends,
  rather than interpreting their generated JS even when memory is native.
- Native own-property hints retain only a numeric insertion-order slot. They
  validate current bounds and key, then read the current descriptor. They do
  not retain weak pointers, assume immutable shapes or cache prototype misses.
- Native contract 105 adds allocator-owned initialization for ordinary typed
  portable constructors. Reservation, zeroing and header/four-word payload
  initialization are one non-collecting transaction using the existing allocator
  ownership and failure handoff. External buffer backings and observable word
  coercions retain the general path. Node uses the same kernel algorithms.
- `requireRecord` validates once before trusted header reads, rather than
  repeating linear-memory validation for every already bounded header word.

See the authoritative [compilation](docs/compilation.md),
[storage](docs/data-structures.md) and [allocation/GC](docs/execution-and-gc.md)
references for the contracts and lifetime rules.

## Completed measurements before allocator transaction

Unchanged native contract 103 image: `artifacts/full-jsmin.snap`, SHA-256
`d788779e0427855d5bd79938d172cc9a02b67308257c4b3ae0849d6dbd42138d`.

- Heavy `S7.8.5_A1.4_T2.js`: candidate 73.915 s, following unchanged control
  81.049 s. Other adjacent unchanged controls were 81.556 and 81.751 s.
- Slot-hint candidate, complete Test262: **3292 passed / 0 failed / 0 timed
  out / 0 skipped / 0 not run**, runner 396.926 s, process 397.62 s,
  512020 KiB peak RSS. The completed earlier unchanged audit was 433.644 s
  runner / 434.347 s process: approximately 8.5% less runner time.
- Its four heavy cases took 72.267, 72.679, 73.778 and 72.979 s.
- Standalone core suite passed: 12 guest programs / 270 assertions plus
  embedding, heap, compiler, native/predecoded interpreter checks.
- Bounded structural GC passed: 27 audits, 111996 checked edges, 221 property
  index audits, 74 embedding collections, maximum bump 3531768 bytes under
  the unchanged 8 MiB cap.
- Genuine source rebuild completed in 85.78 s. This alone is not an identity
  check: source edits occurred between constructing its bootstrap image and
  rebuilding. Final three-host identity validation is still required.

Logs: `artifacts/eval-slot-test262.log`, `artifacts/eval-boundary-core-guest.log`,
`artifacts/eval-slot-gc.log`, `artifacts/eval-boundary-self-build.log`.
Generated artifacts are ignored and are not part of the commit.

## Allocator transaction candidate — validation in progress

- Representative heavy case: **67.436 s** test time, 79.91 s process time,
  471328 KiB RSS. This is about 17% less test time than the adjacent unchanged
  81–82 s controls, not a claim about the entire suite yet.
- Node core suite: passed, 12 guest programs / 270 assertions plus internal
  checks. Native integration also passed directly under js_min.
- Standalone core: passed in 96.12 s, 470524 KiB peak RSS. Structural GC:
  passed in 30.90 s, 27 audits / 111996 edges / 221 property-index audits /
  74 embedding collections, maximum bump 3531768 bytes under the 8 MiB cap.
- Complete Test262, structural GC, other suite/application/benchmark and
  final deterministic rebuild checks remain to be recorded below.

## Experiments not retained

- A separate checked native reference-cell writer: 73.311 s for the heavy
  case, essentially unchanged versus the existing 73 s candidate. Removed.
- Broader kernel inlining with evaluated-once argument bindings: semantic
  checks passed on Node/js_min, but heavy test 75.323 s versus approximately
  73 s without it. Removed; the existing inlining policy is unchanged.

An additional development probe also exposed an existing *standalone control
runtime* limitation in object-valued Number/ToInt32 conversion. It is not a
new failure of the unchanged core/Test262 suites and is not fixed by this
performance work. The committed binding integration covers primitive inputs,
cross-backend memory offsets and executable lifetime; it must not be cited as
proof of complete standalone object-coercion support. Required inner-runtime
language behavior remains subject to the unchanged full conformance suite.
