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
2. Test-level groups already observed: eval completion/lexing, constructor
   prototypes, Unicode line terminators, and identifier handling.
3. Full classification remains pending the first uninterrupted suite run.

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
