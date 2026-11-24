# Linux ECMA and Octane audit — 2026-11-15

## Scope and provenance

Fresh default optimized standalone executable built from `ae0e709`; VM source
checkpoint `5163ff6`. No VM, harness or external corpus changes during this
audit. Node v24.14.1 is the build host, not the benchmark execution engine.
The executable runs the native i386 guest interpreter on Linux
`6.8.0-149-generic`. Its original input snapshot is moved aside before tests.

- Snapshot: 7,534,408 bytes; SHA-256
  `30b44eac1e4ea85fd59be8305ecd32825fd6f929ce6224cef2756f85957c556c`.
- Executable SHA-256:
  `8423ff1ffe303280190d2988bfee404618c16b349a406d63269dcca31d6f11cc`.
- Raw per-test/per-benchmark logs and GNU time receipts:
  ignored `artifacts/linux-suites-2026-11-15/`.
- ECMA runs first with the existing 10-second per-file watchdog, no total
  instruction cap, and the four explicitly configured historical skips.
- All fifteen stock Octane suites follow, one fresh process per suite, with
  stock correctness checks and `--diagnostics`, not `--quick`. Each suite has
  an outer 1800-second watchdog. No multithreading or overlapping heavy tests.

These are serial measurements, not a controlled attribution experiment.
Historical score comparisons use the latest full executable sweep in
[the November 14 performance audit](PERFORMANCE_AUDIT_2026-11-14.md), not
the more recent three-suite smoke runs.

## ECMA results

- **1333 selected / 1329 executed / 997 passed / 332 failed**, including
  **39 timeouts / 4 configured skips / 0 not run**. Timeouts are included in
  failures. Process exit 1 reflects the existing failing tests.
- Harness elapsed **606.922158 s**; process **608.69 s** (566.45 user,
  32.86 system); peak RSS **463788 KiB**.
- Per-directory pass/fail: ecma **473/147**, ecma_2 **149/23**, ecma_3
  **177/48**, ecma_5 **198/114**. Timeouts respectively **11/0/1/27**;
  all four configured skips are in ecma_3.
- Exact comparison of all 1333 filenames against the previous tracked
  `fa4b98f` results: **996 old passes preserved / 1 gained / 0 lost /
  0 missing statuses**. Only `ecma_5/Number/tonumber-string-hex.js` changes,
  FAIL to PASS. This verifies the shared hexadecimal StringNumericLiteral
  conversion introduced during Windows bring-up; no VM fix was made in
  this measurement turn.
- The previous full run was 996 passed / 333 failed (39 timeouts), four skips,
  zero not run; process **609.22 s**, peak RSS **463836 KiB**. Current time is
  **0.09% shorter**, effectively unchanged in these individual observations.
- [ECMA_TEST_RESULTS.tsv](ECMA_TEST_RESULTS.tsv) retains both historical
  columns and adds the current full per-file result column.

## Stock Octane results

**14/15 suites pass. Mandreel regressed:** it exits 70 during source loading
with an allocation failure before producing a score. All suites were attempted
to completion/controlled failure; no outer watchdog expired. The other fourteen
processes exit zero and emit stock aggregate scores with correctness checks.

| Suite | Nov 14 score | Current score | Change | Process seconds | Peak RSS KiB | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Richards | 92.6 | 93 | +0.43% | 3.36 | 22272 | PASS |
| DeltaBlue | 95.4 | 95.7 | +0.31% | 4.48 | 60160 | PASS |
| Crypto | 177 | 179 | +1.13% | 25.72 | 40704 | PASS |
| RayTrace | 269 | 285 | +5.95% | 10.39 | 210688 | PASS |
| EarleyBoyer | 468 | 482 | +2.99% | 25.12 | 467840 | PASS |
| RegExp | 2.88 | 2.88 | 0.00% | 571.44 | 467968 | PASS |
| Splay | 682 | 675 | -1.03% | 4.11 | 406400 | PASS |
| NavierStokes | 256 | 249 | -2.73% | 11.01 | 26368 | PASS |
| PdfJS | 756 | 711 | -5.95% | 20.48 | 310640 | PASS |
| Mandreel | 336 | — | — | 66.91 | 489452 | FAIL: allocation |
| Gameboy | 770 | 831 | +7.92% | 16.94 | 109056 | PASS |
| CodeLoad | 90.9 | 98.9 | +8.80% | 29.37 | 268928 | PASS |
| Box2D | 419 | 455 | +8.59% | 13.27 | 108416 | PASS |
| zlib | 531 | 556 | +4.71% | 275.33 | 104320 | PASS |
| Typescript | 1274 | 1329 | +4.32% | 107.26 | 467832 | PASS |

Scores are the stock final `Score (version 9)` values, not an individual
throughput subscore when a suite also measures latency. Higher is better.

- Among the **14 passing suites only**, the geometric mean score ratio is
  **+2.44%** versus November 14, and **-5.38%** versus the older November 13
  executable scores. This is not a valid all-15 improvement claim: omitting
  the newly failed suite would conceal a correctness regression.
- PdfJS is **5.95% lower**, NavierStokes **2.73% lower**, Splay **1.03% lower**
  in these observations. Other scores are unchanged or higher. These are
  historical, unpaired comparisons; no causal attribution is established.
- Total process time across all fifteen attempts: **1185.19 s**. The previous
  all-passing run took 1266.80 s, but current Mandreel stops early; the lower
  total cannot be interpreted as an overall speedup.
- ECMA plus all Octane attempts: **1793.88 s**, approximately **29m 54s**,
  excluding image generation and measurement/reporting overhead.

## Mandreel regression and next investigation

The default 512 MiB image reports:

```text
guest VM unsupported opcode 6 at bytecode pc 61 (detail 0, allocation 1;
GC 21, live 136868112, tail 503758840, limit 536870912, maximum 536870912)
```

Opcode 6 is SET_PROPERTY. **This does not mean SET_PROPERTY is missing**:
the allocation-failed flag is set while the guest front end is loading
`mandreel.js`, through `octane_runner.js:107`. No benchmark score is produced.
The reported live bytes are well below the maximum; the diagnostic alone
does not distinguish a large contiguous-span failure, fragmentation or an
allocator bookkeeping problem. It does not report the requested span size.

The recent unified environment changed ordinary `load` to capture statement
locations unconditionally; the former default image did not. That is a
concrete front-end allocation-policy change to investigate, **not a proven
root cause**. Next steps are to reproduce loading, inspect the failed request
and free-span distribution, and compare location-metadata construction with
the previous policy. Preserve actionable diagnostics and the existing heap
cap rather than declaring success by silently increasing the limit or
skipping Mandreel. No VM changes or limit adjustments were made in this audit.

The full-run failure, including its diagnostic, is retained here because raw
artifacts may be cleared. This regression was not covered by the preceding
three-suite smoke checks.

## Follow-up: Mandreel location-storage fix

The A/B override in the existing `trace_octane_load.js` tool confirms that
disabling source-location capture lets the same executable/512 MiB cap load
Mandreel and pass setup (81.34 seconds overall). This diagnostic override is
not the production fix and is not used for scores.

The compiler wrote source locations into a sparse-looking JS array indexed
by bytecode-word position. The guest array implementation reserves contiguous
tagged-vector capacity for those indices. Optimizer rewriting also wrote
undefined entries into location arrays even when no location existed. Both
are inappropriate compiler-storage choices for large generated functions.

Compiler-owned location storage is now an ordered, paged boundary map.
Repeated instructions from a statement share one boundary; optimizer rewriting
walks a monotonic cursor and relocates boundaries without huge sparse vectors.
All lookup/diagnostic consumers use the shared location API. Public compiler
descriptors keep their default sparse-array format; compact storage is selected
explicitly or by the existing paged self-hosted compilation mode. Adoption
still emits the existing traced PC/line/column records; no snapshot/native ABI
change or removal of debug information. See [implementation contracts](guest_vm/docs/compilation.md#compiler-source-location-storage).

Node core passes (12 programs / 310 guest assertions plus internal checks).
The existing error-location test now exercises both location representations
and retains its filename/line/column expectations. The final functional
candidate passes **full stock Mandreel**, capture enabled, unchanged heap cap:
**aggregate score 346**, **129.83 s**, **526712 KiB peak RSS**, exit zero.
Its throughput/latency subscores are 145/827, not the aggregate score. The
previous successful November 14 aggregate was 336 in 127.62 seconds; these
single observations do not establish a speedup. RSS is higher than the old
500712-KiB observation because location information remains enabled; no small
memory-footprint claim is made.

### Post-fix validation (`6b89c2a`)

- Both Node/js_min core suites pass: 12 guest programs / 310 assertions,
  internal compiler checks and the existing command-line/context checks.
- Full Linux Test262: **3292 passed / 0 failed / 0 timed out / 0 not run**.
  Harness **414010.437 ms**, summed test time **381092.047 ms**; process
  **414.79 s**, peak RSS **512332 KiB**. This is slower than the pre-fix
  366.85-second observation; no full-suite performance-neutrality claim.
- A subsequent matched chapter-09 comparison passes **128/128 on both**:
  control/fixed process **17.66/17.05 s**, summed test time
  **2977.177/2839.121 ms**. The smaller comparison is faster but does not
  establish the cause of the slower full-suite observation.
- Native language integration and Linux/Windows-Wine shell/ctypes integration
  pass. GC integrity: **27 audits / 113184 edges / 221 property indexes /
  74 embedding collections**, max bump **3532584 bytes** under an 8 MiB cap.
- All eight bounded Linux demos and three HTTP servers pass with the actual
  original source snapshot absent. No demo/corpus changes or relaxed limits.
- A combined Richards/PdfJS/CodeLoad/Typescript correctness run passes too.
  Its scores are not compared with per-process baselines: it loads several
  large suites into one heap before timing. Separate paired runs follow.

Matched fresh-process observations, pre-fix executable then fixed executable,
same unmodified benchmark and options:

| Suite | Control score | Fixed score | Change | Control/fixed process s | Control/fixed RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richards | 85.3 | 84.7 | -0.70% | 3.45 / 3.33 | 22400 / 22016 |
| PdfJS | 678 | 727 | +7.23% | 21.83 / 20.83 | 310496 / 240524 |
| CodeLoad | 89.8 | 91.6 | +2.00% | 31.57 / 31.01 | 230272 / 296320 |

Memory results are mixed; CodeLoad RSS increases in this pair, so this is not
an across-the-board memory reduction claim. Single pairs are not statistical
attribution. The native interpreter code section remains **696243 bytes and
byte-identical** to the pre-fix image; the change is compiler metadata storage,
not a benchmark-specific interpreter or machine-code optimization.

Current image **7,544,872 bytes**, SHA-256
`f756a9f225bdcafa78b0f7a27f584e7f792daa8710717b71b39044f7cae44858`.
Node, genuine Linux self-hosting and js_min produce identical bytes. Self-build
**80.06 s / 480176 KiB**, versus the preceding 82.64-second observation;
js_min build **101.76 s / 333396 KiB**, versus 101.94 seconds. Snapshot size
increases by 10464 bytes for the shared metadata implementation.

Raw follow-up receipts: ignored `artifacts/mandreel-fix/`. The corrected image
is `artifacts/mandreel-fix/current.exe`. The full failed-sweep table above
remains the exact audit record, not silently overwritten by focused retests.
The full ECMA and all-fifteen Octane sweeps were not repeated after this fix;
the ECMA 997/332 record above is the preceding full run.
