# Octane peak RSS: js_runner versus Node --jitless

## Later Typescript follow-up

Typescript now completes successfully on both engines. A fresh serial pair
at 11:23–11:25 UTC measures **437468 KiB (427.2 MiB)** for js_runner versus
**218124 KiB (213.0 MiB)** for Node --jitless: **2.01x guest / Node RSS**.
The guest scores 1003 versus Node's 10428. See
[the Typescript bring-up report](guest_vm/TYPESCRIPT_BRINGUP.md) for image
identity, timings and the earlier higher-memory successful observation.
The all-suite table below is retained as the original full-sweep checkpoint;
its Typescript failure row is historical, not the latest state.

## Measurement basis — 2026-10-31

This report extracts the peak resident-set measurements from the completed
[October 31 stock Octane comparison](OCTANE_COMPARISON_2026-10-31.md).
No benchmarks were rerun to produce this table. Each engine/suite ran in a
fresh process, serially, with the unchanged external benchmark and its stock
correctness checks. Node v24.14.1 ran with `--jitless`; the guest ran in the
i386 standalone `artifacts/js_runner.exe` using native contract 87.

The guest snapshot was 6538776 bytes, SHA-256
`8816444bc3c279687fd583efd372ef2d5dd92c7c88dd7d558816a5a39005cab8`.
The reference engine is x86-64, whereas js_runner is i386; these are the
actual configurations under comparison, not an architecture-controlled
experiment. See the linked report for commands and complete timings.

RSS is whole-process peak resident memory, not live JavaScript heap size,
reserved virtual address space or cumulative allocation volume. Exact values
are in KiB; MiB values divide by 1024 and round to one decimal place.
The ratio is guest RSS / Node RSS: below 1 means lower guest peak RSS.
All Node runs passed. Guest failures are explicitly marked and must not be
interpreted as memory measurements for successful completion.

## All fifteen benchmarks

| Benchmark | js_runner KiB | Node --jitless KiB | js_runner MiB | Node MiB | Guest / Node | Guest status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Richards | 20736 | 44012 | 20.3 | 43.0 | 0.47x | Pass |
| DeltaBlue | 56448 | 47088 | 55.1 | 46.0 | 1.20x | Pass |
| Crypto | 39424 | 45160 | 38.5 | 44.1 | 0.87x | Pass |
| RayTrace | 235776 | 47340 | 230.3 | 46.2 | 4.98x | Pass |
| EarleyBoyer | 403200 | 110256 | 393.8 | 107.7 | 3.66x | Pass |
| RegExp | 532224 | 55196 | 519.8 | 53.9 | 9.64x | Pass |
| Splay | 396672 | 279284 | 387.4 | 272.7 | 1.42x | Pass |
| NavierStokes | 24576 | 49304 | 24.0 | 48.1 | 0.50x | Pass |
| PdfJS | 254752 | 104748 | 248.8 | 102.3 | 2.43x | Pass |
| Mandreel | 532696 | 92596 | 520.2 | 90.4 | 5.75x | Allocation failure |
| Gameboy | 111480 | 78652 | 108.9 | 76.8 | 1.42x | Pass |
| CodeLoad | 395008 | 158392 | 385.8 | 154.7 | 2.49x | Pass |
| Box2D | 113792 | 65976 | 111.1 | 64.4 | 1.72x | Pass |
| zlib | 116480 | 48288 | 113.8 | 47.2 | 2.41x | Pass |
| Typescript | 134872 | 217556 | 131.7 | 212.5 | 0.62x | Missing `module` |

## Interpretation

- Among the thirteen suites that pass on both engines, the guest has lower
  peak RSS for Richards, Crypto and NavierStokes, and higher peak RSS for the
  other ten. These are single observations, not confidence intervals.
- RegExp has the largest passing-suite relative difference: 9.64x. RayTrace
  follows at 4.98x. This identifies memory-efficiency work, not its cause;
  peak RSS alone cannot distinguish fragmentation, retained data, transient
  allocation pressure and representation overhead.
- Mandreel reaches the guest's 512 MiB heap ceiling and fails allocation.
  Its reported last-collection live data is 106403568 bytes (101.5 MiB),
  so its 520.2 MiB process peak must not be described as 520.2 MiB of live
  benchmark data. Node completes at 90.4 MiB peak RSS. The guest's requested
  failing allocation size and largest free extent were not captured, so the
  exact allocator cause remains unconfirmed.
- Typescript exits because the guest platform module `module` is missing.
  Its lower RSS is not a memory-efficiency win: it does not complete the
  same workload as Node.
- There is no meaningful combined peak obtained by summing these rows:
  benchmarks execute in separate processes and their peaks are not concurrent.

