# ECMA parity work by feature family

## Batch 2: arrays and number conversion, 2026-11-23

The number checkpoint (contract 120) passes all 17 selected files, including
all nine original number-family Node-only gaps, with no lost pass in that
selection. Node core also passes. This is a focused checkpoint, not a new
whole-suite claim; full language/demo/GC/self-build gates follow the array
cutover. Receipts: ignored `artifacts/ecma-number-group2.log`,
`ecma-number-core2.log`, `ecma-number-build2.log`.

The fixes are shared algorithms, not expected-string substitutions:

- Decimal parseInt prefixes use correctly rounded guest FFI conversion after
  guest grammar recognition, instead of repeated multiply/add rounding.
- Radix 2/4/8/16/32 integer parsing shares the existing hex converter's
  significant/guard/sticky-bit algorithm. Other parseInt radices retain the
  ES5-permitted approximate wide accumulation; they are not claimed exact.
- String's unsigned-word fast path now excludes negative values.
- ADD concatenation uses the same shortest-decimal formatter as explicit
  number conversion, removing its separate hard-coded 15-digit printf path.
- Number.valueOf has a native primitive and a complete portable guest
  continuation. Number formatting checks branded receivers, ordered argument
  conversion, integer precision and non-finite/range precedence.
- toFixed, toPrecision and toExponential share guest exact decimal expansion
  and round once, choosing the larger decimal coefficient at ties. Base-2^16
  extraction and base-10^7 limbs keep intermediate arithmetic below 2^53.
  Exponential/precision presentation preserves significant zeros and ES5
  exponent thresholds. No host Number formatting implements standalone calls.

Array work separates logical uint32 length from initialized dense storage,
keeps high sparse indices in property descriptors, and truncates actual
entries in descending index order (including partial non-configurable failure).
Dense access remains fast. Prototype lookup must cover holes and inherited
virtual length; GC must only scan initialized physical cells. No larger heap,
corpus changes, new skips or demo edits are part of this approach.

The contract-121 focused checkpoint executes 84 files: **83 pass / one
pre-existing Node-failing extension case / two configured skips** (86 selected).
All **11 array and nine number targets pass**, with no lost pass in this
selection. The remaining failure is `ecma_3/Array/15.5.4.8-01.js`, which calls
the nonstandard static `String.split` API. No extension is added to satisfy it.
Receipts: ignored `artifacts/ecma-array-number-group.log`,
`ecma-array-core9.log`. Full acceptance is pending at this checkpoint.

Additional shared work required by the array cutover:

- Array headers have one initializer and named logical-length/padding accessors;
  vector length stays physical. Numeric keys outside signed dense offsets take
  the existing named-property path instead of exiting native execution.
- Descriptor definitions no longer allocate a dense gap. Truncation merges
  dense storage with sparse descriptor indices and preserves partial failure.
- Array holes and inherited virtual length participate in normal lookup.
- Read-only length assignment rejects even a SameValue write in strict code.
- Concat retains a dense native path and a guest sparse-data path. It only skips
  holes after proving that indexed getters/prototypes cannot make skipping
  observable. Dynamic arrays keep the ordinary index-by-index algorithm.
- Object.getPrototypeOf gains a native primitive and a guest validation
  continuation, allowing the sparse algorithm to audit prototypes without
  a host-language callback.
- Portable root discovery used to walk logical length and invoke [[Get]].
  That redundant walk is removed: authoritative record tracing owns all array
  vector/descriptor edges. A temporary diagnostic was stopped at about
  784 MiB RSS; after the fix the same portable sparse case finishes in under
  one second. Larger heaps and longer test limits were not used.

See [current array storage](guest_vm/docs/data-structures.md#arrays-and-arguments).

The first broad application attempt caught a performance regression in demo5:
a 4096-slot hole-only preallocation cutoff made random raster-buffer writes
build linked sparse storage. That attempt was stopped after the watchdog;
no passing result is claimed for it. The policy now keeps ordinary work
buffers dense, bounded by 16 MiB of cells and one eighth of the runtime's
maximum heap. Both backends call the same policy. The adjusted application's
entire eleven-job matrix passes (`artifacts/ecma-arrays-dense-policy-apps.log`).
No demo-specific condition or demo edit was used. Final broad acceptance uses
the shared heap-budget policy, not the initial regression image.

Broad acceptance also exposed an existing Mandreel load failure at the default
512 MiB cap. A same-command control with the preceding `81d2238` executable
fails at the same `SET_PROPERTY` pc 275 in the compiler constant table; it is
not a newly passing benchmark lost by this batch. Control: **79.91 s /
538916 KiB**, 52 collections, 101396448 live bytes. Current: **139.81 s /
539108 KiB**, 162 collections, 106658976 live bytes. Both exhaust the arena
while loading, before a score. The additional time/collections are recorded,
not called performance parity. Receipts: `artifacts/ecma-array-mandreel-control.*`
and `artifacts/ecma-arrays-accept-octane-Mandreel.*`. The heap cap is unchanged.
The offline snapshot audit now supports `--program-pc PC OPCODE snapshot`
to locate candidate functions and operand words without expanding the heap.

The first whole-ECMA attempt also exposed **two new watchdog failures**:
`ecma_3/Statements/regress-74474-002.js` and `regress-74474-003.js`.
The run was stopped after finding them; it is not a completed acceptance run.
Density-only writes kept moderately gapped compiler work tables in sparse
descriptor storage. Contract 122 shares the constructor's bounded heap budget
with indexed writes, retaining geometric growth for established dense arrays.
An attempted extra in-capacity bypass did not preserve those results and was
not retained; the shared policy remains authoritative. An initial fixed-image
repeat passes both switch files in **2.33/2.30 s**, rather than timing out at
10 seconds; the pre-batch observations were **2.01/2.01 s**. Final acceptance
and build identity must use the corrected image, not contract 121.

### Completed whole-ECMA acceptance (`d5cac4c`, contract 122)

- **1041 pass / 288 fail / four existing skips / zero unrun**, 1333 selected
  and 1329 executed. Failures include the unchanged **39** watchdog timeouts.
- Compared with `81d2238`: **20 gained passes, zero lost passes**, no missing
  or extra filenames. All eleven Array and nine Number targets listed above
  are gains also passing Node. The per-file matrix appends the new column.
- Node overlap: **1010 common / 208 Node-only / 31 guest-only**; the
  outside-Date gap decreases **147 -> 127**, Date gap remains **81**.
- Process **607.13 s / 464160 KiB**, harness **605263.755 ms**, versus the
  preceding 619.50 s / 463748 KiB. These individual observations do not
  establish a controlled speedup.
- The two large switch files pass in the full run at **2.28/2.15 s**. This
  corrects the intermediate policy's lost passes under unchanged limits.
- Receipt: ignored `artifacts/ecma-arrays-budget-ecma.log` and `.time`.

### Cross-host build follow-up (contract 123)

The contract-122 Node and genuine self-build images matched, but js_min's
image differed in three stack-displacement bytes and its fingerprint. The
old shell's decompiler reused the new local name `prototype` for another
dispatcher temporary. Renaming it to `prototypeReference` restores identical
host-visible locals and code. No host-specific substitution, machine-code
patch or new compiler semantics is involved. Helper-extraction and declaration-
moving experiments were not retained.

`inspect_kernel_build.js --code-digests` now localizes these differences by
function, reusing the common exact byte-hash arithmetic. Complete Node/js_min
snapshots compare equal: SHA-256
`48f93cf36fa72e8ca1069bd4ed2986082d286e64d6dc7709cff3112b377ceb17`.
The final **702935-byte native kernel is byte-identical** to the contract-122
Node image used for the full ECMA, Test262 and fourteen Octane quick checks.
Those full results remain labeled `d5cac4c`, rather than being relabeled as
new runs. Final Node core also passes. Follow-up self-build, executable smoke
checks and paired scores are recorded below when complete.

### Profile-driven lookup follow-up (contract 124, acceptance in progress)

The first stock probes caught a serious regression that quick correctness
alone did not expose: PdfJS **830 -> 167** (control `81d2238`, new contract
123). Decimal formatting was an initial hypothesis, not the measured cause;
that formatter is unchanged by this follow-up. A bounded native CPU sample
finds **34.1% numeric name matching + 25.9% repeated integer digit counting**.
Correct hole/prototype lookup had introduced repeated linked-descriptor scans.

- Arrays now carry a monotonic named-index descriptor summary in their former
  padding word. Zero proves absence of named index descriptors; descriptor
  insertion/mapped arguments establish a positive, and cloning preserves it.
  Deletion may leave a conservative positive, never a false negative. Dense
  elements remain separate. There is no new allocation or GC edge.
- The portable classifier is shared with the runtime. Numeric-key hashing and
  exact comparison process digits once; lookup compares cached full hashes
  before characters, retaining exact comparison for collisions.
- Existing object integration now checks an earlier hole miss followed by
  numeric prototype definition, an own getter, deletion and prototype cleanup.
  Node core passes; focused selection remains **85 pass / one existing
  Node-failing extension / two existing skips**, including both large switches.
- Fresh stock observations: Box2D **412 -> 415**, CodeLoad **97.7 -> 95.4**,
  PdfJS **830 -> 808**. PdfJS process time recovers **38.69 -> 18.97 s**;
  control is 18.69 s. These are selected individual probes, not an all-Octane
  score or a controlled claim of universal performance parity.
- Profiling now supports a freestanding executable directly via
  `profile_native_vm.js --executable`; no `js_runner.exe` rebuild is needed.
- Receipts: ignored `artifacts/ecma-array-perf-pdfjs.log`,
  `ecma-arrays-final123-stock-*`, `ecma-arrays-indexed-*`. Full validation and
  cross-host/self-build identity remain pending for contract 124.

### Contract-124 build/application acceptance checkpoint

- Complete Node, js_min and genuine self-build images compare byte-for-byte:
  SHA-256 `fb8b5ee98587d939e77b44357ceac60f6df46b60f9e89d60fc551d96d338d91f`.
  Snapshot **7845568 bytes**, native kernel **707932 bytes**. The scored
  lookup probe and this acceptance image have identical native code.
- Build observations: Node **4.76 s / 275700 KiB**, js_min **92.48 s /
  374744 KiB**, self-build **83.05 s / 483848 KiB**. The pre-batch observations
  were js_min 93.28 s / 304752 KiB and self-build 82.27 s / 483508 KiB.
  Self-build time/RSS remain close; js_min bootstrap RSS is higher in these
  observations and must not be described as memory parity.
- All **seven standalone program gates and eleven demo/server gates pass**
  with the source snapshot moved aside. No demo or corpus source changes.
- Bounded GC: **30 audits / 141980 edges / 254 property-index audits /
  84 embedding collections / one runtime-bound function**, maximum bump
  **430056** under the **8 MiB** cap, no corruption. Workload/check 21.37 s.
- All **fourteen non-Mandreel Octane quick correctness checks pass**. These
  are not stock scores; the separate selected scored probes are listed above.
  Final-image Test262/ECMA and the final Mandreel attempt are still pending.
- Receipts: ignored `artifacts/ecma-arrays-accepted-*`.

Baseline: `a80c661`, paired with the 2026-11-22 direct Node UTC control in
[ECMA_TEST_RESULTS.tsv](ECMA_TEST_RESULTS.tsv). There are **248 Node-passing,
guest-failing files**: 81 in Date directories and 167 outside them. Counts
below partition that baseline by initial triage family, not by a claim that
each family has just one bug. No corpus changes, new skips or relaxed limits.

## Initial inventory

- **Date directories: 81.** Deferred as requested. Additional files outside
  these directories also depend on Date, so 167 is not a pure non-Date-feature
  count.
- **RegExp and String algorithms: 27.** RegExp/String directory gaps plus
  `ecma_3/extensions/regress-220367-002.js` and `regress-228087.js`. Directory
  names are not sufficient to identify extension requirements. This is the
  first implementation batch.
- **Call/eval environments, scope and strictness: 24.** ExecutionContexts,
  eval, strict, Function/FunExpr, Global and remaining Statement families,
  plus function-definition eval and the direct-eval `this` expression case.
  Separate binding/environment bugs from constructor and arguments behavior.
- **Descriptor-combination performance: 20.** The dictionary, middle and
  redefinition fractions under `ecma_5/Object/15.2.3.6-*`. All currently hit
  the unchanged worker watchdog. One fix to the execution/definition path
  could unlock the whole group; they are not 20 independent missing features.
- **Array length, sparsity and algorithms: 11.** Array-directory gaps. Large
  logical lengths currently cause dense backing allocation; sparse truncation
  and partial failure require one coherent representation/mutation cutover.
- **Number parsing, formatting and conversion: 9.** Number-directory gaps,
  parseInt precision, decimal literals and number-to-string conversions.
  Several need correct binary64 conversion/rounding, not special expected
  strings or additional heap space.
- **Legacy function arguments/caller introspection: 13.** FunctionObjects
  and related legacy property tests. Keep separate from core ES5 call/construct
  semantics; do not silently add proprietary behavior to improve totals.
- **Prototype/extension compatibility, scope review: 35.** Initial filename/
  failure-signature bucket including `__proto__`, legacy accessor APIs and
  proxies. These are not the present implementation target. Source review is
  necessary before classifying an entire file or supporting a facility.
- **Other conversions, built-ins and syntax: 28.** Includes eight Date-related
  files outside Date directories, Error/class metadata, JSON, argument coercion,
  parser/reserved-word cases and a prototype-write case. Six apparent coercion
  cases also depend on legacy prototype mutation in their source, so a
  coercion-looking failure is not proof that ToPrimitive is wrong.

The existing matrix contains every filename and both engine statuses. Preserve
the whole-suite denominator and exact old passes, rather than hiding deferred
families or compensating for a lost pass with an unrelated gain.

## Batch 1: shared RegExp/String implementation

Confirmed common causes and the initial targeted gains:

- RepeatMatcher did not clear captures belonging to a repeated atom: five
  files across `ecma_3/RegExp` and `ecma_5/RegExp`.
- Split attempted terminal empty matches and mishandled empty input: five
  files across the String directories.
- Replacement capture references with a leading zero were left literal:
  `ecma_3/String/15.5.4.11.js`.
- Failed brace-quantifier speculation left changed repeat bounds:
  `ecma_3/extensions/regress-228087.js` (ordinary matching semantics despite
  its directory name).
- String receiver/search/position conversion did not consistently enter
  traced guest conversion: two indexOf/lastIndexOf files.
- RegExp syntax was validated too late, and literals/constructors had no
  common validation entry: three malformed-pattern files.

Together these produce **17 new Node-parity passes in the targeted family**,
plus one guest-only gain, before broad final acceptance. This is not yet a
whole-suite pass-count claim. The family run selects 170 files, executes 168
and retains the two existing RegExp skips; it shows no lost passes at the
tested intermediate checkpoint. Final combined validation follows the
completed shared-parser and constructor-entry cutover.

The remaining family cases include Unicode case mapping, octal forms,
large-output performance timeouts and legacy `RegExp.$1` state. Do not
implement static capture globals or SpiderMonkey-specific behavior merely to
finish this bucket. Next standard-feature batches are call/eval environments
and array representation, with Number conversion/formatting kept coherent.

See [the implementation design](guest_vm/docs/regexp-and-string.md). Focused
family runs are used while fixing related causes; broad acceptance follows
the combined checkpoint. The first broad Test262 attempt found two legacy
escape regressions introduced by eager validation. The shared grammar was
corrected in `81d2238`; both exhaustive files and all 3292 tests then passed.

### Build and integration acceptance, 2026-11-23

- Node core suite passes; i386 js_min core passed the preceding combined
  checkpoint, before the identity/control-escape grammar correction.
- Node, js_min and genuine self-build snapshots are byte-identical:
  SHA-256 `c0c8cb14736b0200e93c00704f7e84ffb7559210b70e8adc0bc91c93b209aaa6`.
  Snapshot **7737136 bytes**, native code **687999 bytes**. No generated
  snapshot or executable is checked in.
- Self-build **82.27 s / 483508 KiB**, preceding checkpoint 80.75 s /
  483220 KiB. js_min build **93.28 s / 304752 KiB**, preceding 97.79 and
  101.22 s; these are individual observations, not controlled estimates.
- All seven standalone program gates and eleven graphical/server gates pass
  with the source snapshot moved aside. Demos are unchanged. This includes
  garage/autodrive input, HTTP listing/text/binary/HEAD checks and raw FFI.
- Bounded GC: 30 structural audits, 141980 edges, 254 property-index audits,
  84 embedding collections, one runtime-bound function, maximum bump 432824
  under the 8 MiB guest cap. No corruption was reported.
- Test262 **3292/3292**, **377.86 s / 512632 KiB**; prior 330.24 s /
  512456 KiB. The **14.4% timing regression** is recorded explicitly in
  [Test262 status](TEST262_STATUS.md). Literal validation currently builds
  trees that are discarded; reducing that cost must preserve one grammar.
- Paired stock observations, control `a80c661` then `81d2238`: Box2D
  **396 -> 366**, CodeLoad **89.7 -> 88.4**, PdfJS **748 -> 783**. These
  selected scores are mixed, not evidence of performance parity or a new
  whole-Octane sweep. RegExp quick correctness passes in **72.47 s /
  247808 KiB**; this mode produces no benchmark score.
  A separate reverse-order Box2D repeat gives new **372**, control **377**.
  The repeat narrows the difference, but does not establish no regression.
- Receipts remain in ignored `artifacts/ecma-groups-final-*` and
  `artifacts/ecma-groups-ecma-parity-final-*`.

### Completed whole-suite comparison, 2026-11-23

- **1021 passed / 308 failed / four existing skips / zero unrun**, 1333
  selected / 1329 executed; failures include the unchanged 39 timeouts.
- Against `a80c661`: **21 gained passes, zero lost passes**, with no missing
  or extra files. **20 gains are Node-parity gains**; the additional guest-only
  pass is `ecma/String/15.5.4.10-1.js`. This supersedes the initial focused
  17-parity-gain observation above.
- Exact Node overlap: **990 common passes / 228 Node-only passes / 31
  guest-only passes**. The Date-directory gap remains 81. The outside-Date
  gap decreases **167 -> 147**. The full filename matrix appends `81d2238`;
  no unrelated gain compensates for a lost pass.
- Process **619.50 s / 463748 KiB**, harness **619193.775 ms**, compared
  with preceding 608.84 s / 463944 KiB. No corpus, harness or policy changes.
- New Node-passing files, grouped by affected family:

  - String conversion: `ecma/String/15.5.4.6-1.js`, `15.5.4.7-1.js`.
  - Split/replacement: `ecma_2/String/split-001.js`, `split-003.js`;
    `ecma_3/String/15.5.4.11.js`, `15.5.4.14.js`;
    `ecma_5/String/split-01.js`, `split-xregexp.js`.
  - RegExp semantics/validation: `ecma_2/RegExp/unicode-001.js`;
    `ecma_3/RegExp/15.10.2-1.js`, `perlstress-001.js`, `regress-188206.js`,
    `regress-223273.js`, `regress-334158.js`, `regress-57631.js`;
    `ecma_3/extensions/regress-228087.js`;
    `ecma_5/RegExp/regress-429241.js`, `regress-613820-1.js`,
    `regress-613820-2.js`, `regress-613820-3.js`.

The grouping is by shared feature scope, not a claim that each listed file
exercises only one defect. Next priority candidates remain call/eval/scope,
descriptor-combination execution cost and sparse arrays, not proprietary APIs.

Seven of the initial 27 RegExp/String Node-only gaps remain:

- Unicode case conversion: `ecma/String/15.5.4.11-3.js`, `15.5.4.11-4.js`,
  `15.5.4.11-6.js` (native exits remain, not skipped).
- Octal escape matching: `ecma_3/RegExp/octal-001.js`.
- Legacy static capture state: `ecma_3/extensions/regress-220367-002.js`;
  not a target merely because Node supports it.
- Huge replacement output/timeouts: `ecma_5/RegExp/regress-617935.js` and
  `ecma_5/String/replace-math.js`. These request roughly 256 MiB and 64 GiB
  outputs respectively; bounded failure/size handling matters as much as
  matcher speed. Do not diagnose them by materializing gigabytes on this host.
