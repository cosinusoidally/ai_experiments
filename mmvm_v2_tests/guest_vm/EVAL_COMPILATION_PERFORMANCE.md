# Small-program compilation performance investigation

## Checkpoint: paused, 2026-10-29

**No performance implementation from this investigation was retained.** All
experimental source changes were removed after full-workload measurements
failed to justify them. The retained VM implementation is unchanged from
`7752861`. This document records results and proposed next steps, not features
that currently exist in the code. Generated logs/images remain ignored.

The objective is to accelerate the four long Unicode/eval Test262 cases
through general VM improvements, without regressing other tests. No external
tests or demos were modified; no test-specific cache or budget exception was
introduced. Tests still execute under the standalone guest VM.

## Baseline

The user's completed `artifacts/log.txt` run provides a default-output baseline:

- 3,292 executed; **3,292 passed / 0 failed / 0 not run / 0 timed out**.
- Runner elapsed: **540.386 seconds**.
- Summed individual test-call time: **525.347 seconds**.
- Four long RegExp-literal Unicode cases: **399.732 seconds** combined.
- Other 3,288 tests: **125.615 seconds** combined.

The four cases are `S7.8.5_A1.1_T2.js`, `S7.8.5_A1.4_T2.js`,
`S7.8.5_A2.1_T2.js` and `S7.8.5_A2.4_T2.js`, all under `ch07/7.8/7.8.5/`.
They repeatedly compile different small eval sources; matching performance
alone does not explain their cost.

## Sampling

The existing read-only stack sampler was run against a bounded
2,000,000-instruction selection of `S7.8.5_A1.4_T2.js`. Runtime-construction
samples must be excluded: that phase also invokes a compiler but is not eval
execution. Among 83 sampled stacks containing `JSContext.compileEval`, 50
contained `Runtime.registerProgram`. These are overlapping inclusive stacks,
not independent percentages or proof of exclusive installation cost. The
sampler pauses the process briefly and perturbs timings; its elapsed time
must not be used as a throughput score.

Logs: `artifacts/eval-cost-baseline.jsonl`,
`artifacts/eval-cost-baseline.log`, `artifacts/eval-cost-profiler.log`.

## Rejected experiments

1. **Bulk program metadata initialization.** Two shared-kernel functions used
   named field setters to replace individual metadata writes, with the same
   JS/i386 backends and ordinary FFI argument limits. A bounded probe improved
   from **31.685 to 27.444 seconds** of test-call time. That early measurement
   was not enough to establish a full-test gain.

2. **Straight-line expression completion lowering.** Expression-only programs
   returned the final expression's result without an accumulator. Combined
   with the metadata experiment, the matched bounded probe took **29.681
   seconds**, worse than metadata initialization alone. An interrupted full
   run is not a conformance result. This compiler experiment was discarded
   before the completed grouped-storage run below.

3. **Opportunistic grouped program storage.** A single zeroed reservation held
   three ordinary records: the program descriptor, bytecode and constant
   vector. Existing layouts and independently collected lifetimes remained
   unchanged. An optional reservation fell back to separate allocations if
   contiguous storage could not fit. Allocation debt counted all three
   records; no collection occurred during partial construction. Together
   with bulk initialization, the bounded probe took **24.514 seconds**, about
   23% below the baseline probe. **The completed run did not retain that gain.**

All bounded probes deliberately exhaust the same 2,000,000-instruction cap;
their timeout is expected and is not a conformance pass. Their images were
built separately and tested serially, without concurrent heavy workloads.

## Completed experimental full run — rejected

The grouped-storage/bulk-initializer image, with the original completion
compiler, completed the unmodified suite:

- **3,292 passed / 0 failed / 0 not run / 0 timed out**.
- Runner elapsed: **554.764 seconds**; external elapsed: **555.41 seconds**.
- User CPU: **552.16 seconds**; peak RSS: **575,752 KiB**.
- Summed individual test-call time: **538.054 seconds**.
- Four long cases: **400.054 seconds** combined — essentially unchanged.
- Other 3,288 tests: **138.000 seconds** — about **9.9% slower** in this run.

Command: `./artifacts/js_runner.exe artifacts/eval-storage.snap
test262_runner.js`. Log: `artifacts/eval-storage-full.log`.

These are single-run comparisons, not statistical estimates. Nevertheless,
there is no demonstrated long-case benefit to justify keeping added complexity
and a possible regression elsewhere. All experimental implementation changes
were removed. Early low-budget improvements must not be reported as completed
test speedups.

Experimental versions also passed the Node project suite (12 guest programs /
270 assertions) and bounded structural GC audit (27 audits / 87,198 references /
76 embedding collections). Those checks establish useful correctness evidence,
not performance success. A new full Octane/demo/snapshot rebuild validation
was not completed for these rejected changes; no such claim is made.

## Proposed next step — not implemented

### Resumed diagnostic checkpoint on guestVM-cleanup

The original sampler's 12-frame limit can hide `compileEval` beneath a deep
parser chain. Filtering only stacks containing that ancestor biases the
selection toward shallower installation calls. The tool now accepts
`--stack-depth COUNT` (default 12, maximum 128) and reports truncation.
Stack-only reads use a bounded 1 MiB chunk cache, discarded on every resume;
the old single-window cache thrashed between slice descriptors and backing
strings and made deep-stack pauses excessive. The heap-walk profiler path
retains its existing window cache. No VM execution semantics change.

`tools/summarize_stacks.js` reports leaf/inclusive counts and the direct child
of a requested ancestor. It supports `--after-ms` to exclude startup, reports
incomplete stacks explicitly and warns about ancestor-selection bias. It is
an optional Node-based reader, like the existing process profiler, not a
dependency of the VM or Test262 execution.

The new 64-frame probe (`artifacts/eval-deep-cached.jsonl`) has 98 samples
after 20 seconds, none truncated. Of these, 54 contain `compileEval`: its
direct child is registration in 31, lowering in 11, parser construction in 5,
program parsing in 4 and verification in 3. This is a small perturbed sample,
not an exclusive full-test timing breakdown. Installation is still material,
but compilation does not account for the entire test duration.

```sh
node guest_vm/tools/profile_process_memory.js --stack-only --stack-depth 64 \
  artifacts/snap artifacts/eval-profile test262_runner.js \
  --instruction-limit 2000000 ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js
node guest_vm/tools/summarize_stacks.js artifacts/eval-profile.jsonl \
  --after-ms 20000 --ancestor 'function (source, filename, strict,'
```

The deliberately capped test times out, as expected; no conformance pass is
claimed. The uncached deep probe was terminated during startup and must not
be used as a VM speed measurement. i386 snapshot execution also passed the
existing hello program. The next runtime experiment is a general allocator
entry that combines reservation, zeroing and initial record words, replacing
the separate calls currently required per portable allocation. It must be
measured on completed workloads before being retained.

Add optional, low-overhead sampled phase timing for eval compilation: parsing,
scope setup/lowering, verification and program installation. Separate startup
from sustained execution and distinguish compilation from frame setup, GC and
the surrounding interpreted loop. Sample a fraction of compilations rather
than reading clocks or printing logs on every eval. Check profiling overhead
before trusting its breakdown.

Then target the measured largest sustained cost. No new profiling flag or
phase-timing implementation had been added when work was paused. Future
changes need completed long-case comparisons, full-suite correctness, separate
non-outlier timings and the existing workload/build regression gates before
being accepted. There are no active investigation processes at this checkpoint.
