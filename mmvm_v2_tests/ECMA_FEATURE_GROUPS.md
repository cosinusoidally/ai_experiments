# ECMA parity work by feature family

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
