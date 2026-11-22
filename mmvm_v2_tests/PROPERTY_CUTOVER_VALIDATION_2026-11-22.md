# ES5.1 property-reference cutover: acceptance and performance

Implementation `d656ede`, contract 116; language-suite and strengthened GC
validation checkpoint `9a5349c`. Default optimized Linux executable, unchanged
512 MiB guest maximum. All heavy processes run serially. The executable's
source snapshot is moved aside throughout executable validation. No demos,
external tests, watchdogs or benchmark correctness checks are modified.

## Correctness and build gates

- Node and i386 js_min core suites: 15 guest programs / 321 assertion-intrinsic
  calls, plus the property integration fixture's own throwing checks. The
  integration fixture runs with standard-library support on portable, kernel
  and predecoded configurations.
- Standalone: seven program gates and eleven demo/server application gates
  pass, including garage/autodrive and binary HTTP responses.
- Strengthened bounded GC test: 24 rounds, 30 structural audits, 141980 checked
  edges, 254 property-index audits, 84 embedding collections, one expected
  runtime bound function, 8 MiB heap cap. Fresh converted keys and pending
  getter/setter operations survive collections. Process 38.86 s / 330912 KiB.
- Test262: 3292 executed / 3292 passed / zero failures, timeouts or unrun tests;
  365.42 s / 512452 KiB. Previous observation 357.06 s / 512396 KiB; 2.3% longer
  in this individual run, not a demonstrated timing improvement.
- ECMA: 1333 selected / 1329 executed / 997 passed / 332 failed (39 timeouts
  included) / four configured skips / zero unrun. 603.69 s / 463860 KiB.
  Exact comparison: 1332 statuses unchanged; the previously documented
  watchdog-boundary `ecma_5/Object/15.2.3.6-middle-redefinition-7-of-8.js`
  times out instead of its previous near-limit pass. No confirmed new
  semantic failures; do not describe this as an identical pass count.
- Node, js_min and genuine self-hosted snapshots have identical SHA-256
  `09a5ce1753a1832f70ccb044950065e704577dad3f627cffad2981764768fa8d`.
  js_min build 93.91 s / 315292 KiB; self-build 82.13 s / 481424 KiB.
  Prior observations: 102.04 s / 319156 KiB and 84.58 s / 479500 KiB.
- Native code 679397 bytes (13361 fewer); snapshot 7651280 bytes (21784 more).
  The extra guest operation support is included; source/debug capability is
  not removed. No fresh Windows or full debugger acceptance run is claimed.

## Fresh Octane scores

Fourteen stock suites complete with correctness checks and exit zero.
RegExp is a separate **quick correctness pass**, 75.40 s / 229888 KiB; no new
stock RegExp score is claimed. This is not a full fifteen-suite scored sweep.

| Suite | Stock aggregate score | Process seconds | Peak RSS KiB |
| --- | ---: | ---: | ---: |
| Richards | 87.4 | 3.35 | 22528 |
| DeltaBlue | 87.9 | 4.62 | 57984 |
| Crypto | 163 | 28.07 | 39808 |
| RayTrace | 245 | 11.12 | 154240 |
| EarleyBoyer | 432 | 28.12 | 467712 |
| Splay | 694 | 4.00 | 402304 |
| NavierStokes | 247 | 11.14 | 26368 |
| PdfJS | 802 | 19.22 | 263868 |
| Mandreel | 333 | 131.57 | 529584 |
| Gameboy | 829 | 16.91 | 99328 |
| CodeLoad | 93.4 | 30.39 | 298624 |
| Box2D | 371 | 15.95 | 98944 |
| zlib | 468 | 327.24 | 105600 |
| Typescript | 1147 | 125.64 | 467784 |

Scores are the stock `Score (version 9)` aggregate, including latency where
the suite defines it. Higher is better. The older November 15 sweep is not
the immediate pre-change baseline: it predates several cleanup commits.
The immediate pre-change control is the contract-115 `b6e872d` executable,
not the November 15 image. Serial fresh-process stock observations:

| Suite | Contract 115 control | Contract 116 | Difference |
| --- | ---: | ---: | ---: |
| Richards | 87.8 | 87.4 | -0.46% |
| DeltaBlue | 88.4 | 87.9 | -0.57% |
| RayTrace | 257 | 245 | -4.67% |
| PdfJS | 751 | 802 | +6.79% |
| CodeLoad | 87.7 | 93.4 | +6.50% |
| Box2D | 365 | 371 | +1.64% |

RayTrace's slowdown reproduced at 258 versus 245. Quick zlib also took
37.41 s versus control 35.88 s, both with correctness passing. These costs
were investigated rather than dismissed as noise. A bounded five-second
native CPU sample found string-key comparison at 14.7% of samples; the
comparison's simple rejection cases entered the large view/rope traversal
function. Removing a repeated own-property search alone did not recover
RayTrace (241), so that was not claimed as the performance fix.

### Contract 117 follow-up (`e4d5098`)

The shared string-key equality wrapper now rejects identical references and
unequal lengths before entering the separate content-traversal helper. The
normal bounded compiler inliner handles this wrapper for both backends; no
function-name specialization, benchmark branch or host implementation is
introduced. Get probes also carry their known own-entry miss into the common
operation, rather than searching the receiver again.

- Node and i386 js_min core: 15 programs / 321 intrinsic assertions, plus
  integration checks.
- RayTrace stock: **264**, versus repeated pre-change control **258** (+2.33%).
- Box2D stock: **392**, versus control **365** (+7.40%).
- Quick zlib: **35.28 s / 104576 KiB**, versus control **35.88 s / 104448 KiB**;
  both complete correctness checks. Quick timing is not a stock zlib score.
- Node, js_min and genuine self-hosted snapshots are bit identical:
  SHA-256 `08cf3518169eee1e41354546c255654b52ce98e55c35c2090a3b365af8b5b841`.
  js_min build **92.06 s / 315256 KiB**; self-build **82.97 s / 481636 KiB**.
  Snapshot **7658432 bytes**, native code **681492 bytes**. Compared with
  contract 115, native code is 11266 bytes smaller and snapshot data/code
  together are 28936 bytes larger; the snapshot remains below 8 MiB.
- All seven standalone program gates and all eleven demo/server application
  gates pass again with the source snapshot moved aside. GC retains the same
  30 audits / 141980 edges / 254 index audits / 84 embedding collections /
  one runtime bound function under its 8 MiB heap cap; workload/check time
  22058.185 ms, runtime construction 12618.548 ms.
- Final full Test262: **3292 executed / 3292 passed / zero failures, timeouts
  or unrun tests**. Harness 341178.131 ms, summed test time 325138.282 ms;
  process **341.87 s / 512372 KiB**. This observation is 6.4% shorter than
  contract 116 and 4.3% shorter than contract 115; not a controlled speedup
  estimate.
- Final full ECMA: **997 passed / 332 failed (39 timeouts included) / four
  skips / zero unrun**, 1333 selected / 1329 executed. Harness 609323.428 ms;
  process **609.64 s / 463792 KiB**. All 1333 filename statuses are identical
  to contract 116: no lost passes, gained passes, missing or extra files.
  The earlier contract-111 difference remains only the documented unstable
  watchdog-boundary case. Overall ECMA runtime is similar, not improved.
- The full scored Octane table above belongs to contract 116, not this later
  image. No fresh Windows or full debugger acceptance run is claimed.

## Reproduction and receipts

From `mmvm_v2_tests`, after building and packaging the snapshot normally:

```
artifacts/property-accepted.exe ecma_tests_runner.js
artifacts/property-accepted.exe test262_runner.js
artifacts/property-accepted.exe guest_vm/tests/gc_stress.js
artifacts/property-accepted.exe octane_runner.js Box2D
artifacts/property-accepted.exe octane_runner.js --quick RegExp
```

Run each command to completion before starting another heavy process.
Ignored receipts have prefixes `artifacts/property-accepted-`,
`artifacts/property-baseline-octane-` and `artifacts/property-zlib-quick-`.
The snapshot used to package the executable is held under a different name
while testing; the executable does not depend on it.
