# Test262 status

This is the chronological ledger for ECMAScript 5.1 Test262 work. The corpus
is read from `../../js_tests/tests/test262` and is never modified. Counts in
the full-suite table are recorded only after every selected variant reaches a
pass, failure, or timeout result; interrupted and focused runs appear in the
investigation log and are not used to claim progress.

## Full-suite history

| Date and time | Revision | Files | Variants | Passed | Failed | Timed out | Elapsed | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Pending | — | 3,292 | — | — | — | — | — | The first complete baseline is pending removal of root-harness blockers and adequate harness throughput. |

The failure count must decrease from one completed full run to the next.
A higher count blocks the corresponding change from being accepted, even if
individual new features pass. Existing VM tests, demos, and their established
performance are separate mandatory regression gates.

## Investigation log

### 2026-09-10 08:56 BST — initial complete-run attempt

- Revision: `8aaeea3`
- Command shape: `js_min.exe guest_runner.js --vm-native test262_runner.js --quiet`
- Outcome: interrupted after 66 reported variant failures because reparsing
  the root harness for every fresh context projected an impractically long
  run. This is not a full-suite count.
- Common failure: `ReferenceError: Function is not defined` at
  `shell.js:102:1` during harness evaluation.
- Action: retain fresh globals but cache and reuse the immutable compiled
  harness program within the one runtime.

### 2026-09-10 09:03 BST — Function constructor checkpoint

- Scope: both variants of `ch06/6.1.js` under Node-hosted and MMVM-native
  guest execution.
- Result before the change: 0 passed, 2 failed in the root harness because
  `Function` was absent.
- Result after the change: the `Function` failure is gone; both variants now
  reach `shell.js:430:5` and fail because
  `Date.prototype.getTimezoneOffset` is absent.
- Implementation: `Function` constructs source, runs it through the VM's own
  parser/compiler/verifier, and returns a guest-heap bytecode function. It
  does not call the host JavaScript `Function` constructor.
- Regression gates: Node and `js_min.exe` VM suites pass; the guest suite now
  contains 239 passing assertions. Networking, `node_web.js`, demo1, demo2,
  heap/GC/context tests, and the three-context demo remain passing.

### 2026-09-10 09:06 BST — host-call audit mode

- Added `guest_runner.js --vm-no-host-calls`.
- Any attempted embedder callback now becomes a source-located
  `HostCallError` before the callback executes, including in nested guest
  execution.
- A pure language test completes in this mode. `node_hello.js` currently
  identifies `require` as an existing bootstrap dependency.
- Test262 is not yet self-hosted: its bootstrap `Test262VM` service and
  filesystem operations still cross the embedding boundary. Conformance
  counts and self-hosting status remain separate until the suite completes
  with `--vm-no-host-calls`.

## Current failure groups

1. Runner bootstrap: isolated context execution and filesystem reads are
   still embedder services and must migrate behind guest/native runtime
   operations.
2. Stability: repeated fresh-context creation/teardown currently reaches a
   native-host crash after roughly 380 files. A short run over the same file
   boundary succeeds; accumulated runtime state is under investigation.
3. Test-level groups remaining from partial output include complete Unicode
   identifier classification, strict runtime semantics beyond parsing, and
   long-running Unicode lexical tests that exceed the diagnostic instruction
   allowance.
4. Full classification remains pending the first uninterrupted suite run.

### 2026-09-10 09:40 BST — runnable harness and chapter sample

- Root harness now completes under MMVM. `Function` and Date calendar
  construction are guest implementations; MMVM source-file decoding now
  converts UTF-8 to ES5.1 UTF-16 code units without host decoding.
- Added a reproducible manifest of all 3,292 applicable files and an initialized
  harness template. Each variant still receives a fresh global, cloned mutable
  harness state, and context-bound guest functions while sharing immutable
  bytecode.
- Complete `ch07/7.3` run under MMVM native: 59 files, 118 variants, 82 passed,
  36 failed, 0 timed out; 60.94 seconds. This is a subtree measurement, not a
  full-suite total.
- Observed groups in that subtree: eval completion/lexing, constructor
  prototype setup, Unicode line terminators, and identifier handling.
- A complete-run attempt reached the same test-level failures but was stopped
  after 67 files because pre-manifest discovery projected excessive startup
  time. It is not entered in the full-suite table.
- Regression gates: Node and `js_min.exe` suites pass with 249 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap/GC/context tests,
  and three-context scheduling remain passing.

### 2026-09-10 09:44 BST — unbounded-timeout run stopped

- Revision: `78fb446`.
- Selection: all 3,292 files; provisional 20,000,000-instruction limit.
- Outcome: deliberately terminated after 1,185.69 seconds. The run reported
  its 100-file checkpoint (160 passed, 40 failed) and then spent more than 15
  minutes in one small failing variant. This is not a completed-suite count.
- Peak RSS: 185,380 KiB.
- Action: use a bounded diagnostic allowance so a faulty infinite path cannot
  make the suite operationally unfinishable. A timeout remains a failure and
  therefore cannot inflate conformance.

### 2026-09-10 10:04 BST — lexical and Error-object checkpoint

- Revision: `e926acc`.
- Complete focused run: `ch07/7.3`, 59 files, 118 variants, 118 passed,
  0 failed, 0 timed out. The same selection previously had 36 failures.
- Fixed general guest behavior: U+2028/U+2029 token boundaries, guest-owned
  Error subtype prototypes, Error construction, inherited `instanceof`, and
  `Error.prototype.toString`.
- Regression gates: Node and `js_min.exe` suites pass with 252 guest
  assertions plus the existing networking, demo, heap, GC, and context checks.

### 2026-09-10 10:12 BST — eval completion checkpoint

- Revision: `e8907b6`.
- Complete focused run: `ch07/7.2`, 45 files, 90 variants, 90 passed,
  0 failed, 0 timed out.
- Eval now returns the value of a top-level expression completion rather than
  unconditionally returning `undefined`.
- Regression gates remain green on Node and `js_min.exe`.

### 2026-09-10 10:17 BST — bounded complete-run attempt exposed a crash

- Revision: `e926acc`; all 3,292 files; 20,000-instruction diagnostic limit.
- Outcome: the process received SIGSEGV after approximately 380 files, so no
  full-suite conformance count is claimed. Its last complete progress line was
  300 files / 600 variants: 532 passed and 68 failed. Later output reached
  `ch07/7.6/S7.6_A1.3_T3.js` before the crash.
- Elapsed at crash: 745.80 seconds. Peak RSS: 179,644 KiB.
- A five-file run spanning the apparent crash boundary subsequently completed
  all 10 variants, which points to accumulated runtime/context/GC state rather
  than one intrinsically crashing source file.

### 2026-09-10 17:10 BST — strict parsing and direct eval checkpoint

- Revision: `b7193b2`.
- Complete focused run: `ch07/7.6/7.6.1/7.6.1.2`, 62 files, 86 variants,
  86 passed, 0 failed, 0 timed out. Before direct strict eval, 18 strict
  variants in this selection failed.
- ES5.1 future-reserved words, strict directive prologues, function strictness,
  and reserved-word property names are handled by the guest tokenizer/parser.
- Syntactically direct eval no longer yields through an embedder host call. It
  inherits strict parsing and can address existing caller bindings through
  guest lexical-environment slots; indirect eval continues to use the global
  environment.
- Regression gates: Node and `js_min.exe` suites pass with 253 guest
  assertions plus networking, `node_web.js`, demo1, demo2, heap/GC/context,
  and three-context checks.

### 2026-09-10 18:01 BST — authoritative Unicode identifiers

- Revision: `1dd5005`.
- Complete focused native run: `ch07/7.6`, 271 files, 503 variants,
  503 passed, 0 failed, 0 timed out.
- Elapsed: 282.16 seconds. Peak RSS: 169,456 KiB.
- Replaced the permissive non-ASCII identifier fallback with a compact,
  host-independent BMP category lookup generated from the pinned Unicode
  3.0.0 `UnicodeData` source. The lookup covers ES5.1 identifier-start and
  identifier-part categories plus U+200C and U+200D without regular
  expressions, locale functions, host callbacks, or `Intl`.
- Byte-for-byte deterministic regeneration was verified with `js_min.exe`.
- Regression gates: Node and `js_min.exe` suites pass with 255 guest
  assertions. Existing networking, `node_web.js`, demo1, demo2, heap, GC,
  context, native-interpreter, and three-context checks remain green.

### 2026-09-10 18:25 BST — strict octal and native catch stability

- Pre-fix complete focused run at revision `8429e50`: `ch07/7.7`,
  `ch07/7.8`, and `ch07/7.9`, 326 files, 606 variants, 515 passed,
  91 failed, 0 timed out. Elapsed: 411.40 seconds. Peak RSS: 182,216 KiB.
  The failures cluster in strict octal string/numeric syntax, RegExp, and six
  automatic-semicolon-insertion cases.
- Intermediate numeric-literal run after strict lexical recognition:
  `ch07/7.8/7.8.3`, 80 files, 150 variants, 143 passed, 7 failed,
  0 timed out. Elapsed: 70.81 seconds. Peak RSS: 169,496 KiB. All seven
  remaining failures were dynamic strict-eval cases in the native engine.
- Post-fix complete native run: `ch07/7.8/7.8.3`, 80 files, 150 variants,
  150 passed, 0 failed, 0 timed out. Elapsed: 72.87 seconds. Peak RSS:
  169,484 KiB.
- Numeric tokens now distinguish and correctly evaluate the non-strict legacy
  octal extension, while the parser rejects it in strict programs, strict
  functions, direct eval, and numeric object-property names.
- Fixed a general native continuation bug: after a semantic exception entered
  a guest catch handler, the partially reloaded semantic register mirror was
  incorrectly spilled over authoritative native-heap registers. Catch
  continuations now retain heap authority, preventing stale constants and
  temporaries from corrupting subsequent operations.
- Regression gates: Node and `js_min.exe` suites pass with 258 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

### 2026-09-11 00:52 BST — strict string literal grammar

- Complete focused native run: `ch07/7.8/7.8.4`, 78 files, 120 variants,
  120 passed, 0 failed, 0 timed out. The earlier combined lexical run had
  35 failures in this selection.
- Elapsed: 55.97 seconds. Peak RSS: 166,032 KiB.
- String tokens now retain lexical metadata for escape sequences and decode
  the non-strict legacy octal extension correctly. Strict code rejects decimal
  and octal escape forms while retaining the permitted `\\0` form when it is
  not followed by a decimal digit.
- Directive-prologue handling now rejects an octal escape in an earlier
  directive when a later exact `use strict` directive makes the whole body
  strict. Escaped spellings such as `use\\x20strict` remain ordinary string
  directives and do not enable strict mode.
- Regression gates: Node and `js_min.exe` suites pass with 262 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

## Rules for subsequent entries

- Record local date/time, revision, exact selection, variant totals, failure
  count, timeout count, elapsed time, and peak RSS for every complete run.
- Keep raw logs as ignored temporary artifacts, not committed corpus output.
- Record focused and interrupted runs explicitly as such.
- Never convert an unsupported feature into an unexplained skip.
- Never implement an ES5.1 operation by forwarding it to SpiderMonkey or
  Node. Guest-visible semantics belong to the guest heap/runtime/interpreter.
- Do not make no-host-calls mode the default until existing platform services
  have migrated and the pre-existing regression suite passes in that mode.
