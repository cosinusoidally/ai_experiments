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

The remaining family cases include Unicode case mapping, legacy malformed
escapes/octal forms, performance timeouts and legacy `RegExp.$1` state. Do not
implement static capture globals or SpiderMonkey-specific behavior merely to
finish this bucket. Next standard-feature batches are call/eval environments
and array representation, with Number conversion/formatting kept coherent.

See [the implementation design](guest_vm/docs/regexp-and-string.md). Full
language/demo/GC/build gates and paired performance checks run once at the
combined checkpoint; focused family runs are used while fixing related causes.
