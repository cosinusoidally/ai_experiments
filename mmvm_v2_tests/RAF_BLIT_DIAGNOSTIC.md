# Animation-frame and full-frame blit diagnostic

This note records the 640x480 `demo3.js` investigation and the subsequent
scheduler fix so the framebuffer pipeline can be revisited later.

## Reproduction

Run the full-frame blit benchmark at a requested 60 FPS:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo3.js \
  --size 640x480 --fps 60 \
  --fps-counter --debug-events
```

Before the scheduler fix, the measured run produced:

```text
first sample:   30.7 complete blits/s
steady sample:  36.7 complete blits/s
client CPU:     41 percent
user CPU:       5.91 seconds over 15 seconds
system CPU:     0.33 seconds over 15 seconds
```

The observed CPU percentage is consistent with separate interactive runs which
showed approximately 45 percent CPU use.

At 640x480, each packed framebuffer contains:

```text
640 * 480 * 4 = 1,228,800 bytes
```

At 36.7 blits/s, the complete X11 path handles approximately 45.1 MB/s of
framebuffer payload.

## Original primary cause

The animation-frame wait was serialized after rendering and upload:

```text
animation-frame callback
        -> draw dirty regions
        -> upload the full framebuffer
        -> queue CopyArea
        -> wait for socket write completion
        -> start a new 16 ms animation-frame timer
        -> next frame
```

The next animation-frame timer did not mature while the previous frame was
being drawn or uploaded. The upload completion callback switches client
buffers and only then calls `queueAnimationFrame()`.

The MMVM compatibility implementation of `requestAnimationFrame` was a fresh
16 ms timer for every call. A measured 36.7 FPS corresponded to a 27.2 ms frame
period. Approximately 11 ms is client CPU work and approximately 16 ms is the
mandatory post-completion animation-frame sleep:

```text
1000 / (11 ms + 16 ms) ~= 37 FPS
11 / 27 ~= 41 percent client CPU
```

The low client CPU use is therefore expected. The process spends much of each
frame asleep in the timer or in `poll`, rather than exhausting the CPU.

## Original 60 FPS quantization

The configured frame interval was rounded:

```text
round(1000 / 60) = 17 ms
```

The animation-frame timer waits 16 ms. If rendering and upload complete very
quickly, the first callback can arrive before the 17 ms limit and be rejected.
A second complete 16 ms timer is then needed:

```text
16 ms + 16 ms ~= 32 ms
1000 / 32 ~= 31.25 FPS
```

This can make a faster workload approach 30 FPS. A workload which takes enough
time before starting the next 16 ms timer can instead reach approximately
35-40 FPS, explaining the observed variation.

## Double-buffering limitation

The two client framebuffer allocations currently provide safe ownership but
not a pipelined producer/consumer design:

```text
draw A -> upload A -> wait -> draw B -> upload B -> wait
```

The implementation does not yet render B while A is in flight. There is also
only one server-side back pixmap. Redraw requests are deliberately collapsed
to prevent stale frame queues and to avoid reintroducing the native-buffer
lifetime corruption fixed by double buffering.

The server-side pixmap plus final `CopyArea` provides coherent presentation,
but it does not overlap drawing, socket transmission, and display work.

## CPU accounting

The reported percentage belongs only to `js_min.exe`. It excludes processing
performed by the X server, Xwayland, a compositor, and the kernel. The X server
may consume additional CPU while receiving `PutImage` bands and processing the
final `CopyArea`.

## Implemented scheduler correction

The scheduler now uses an absolute, persistent animation cadence rather than
starting a new cooldown after upload completion:

1. Frame intervals retain the floating-point value `1000 / fps`; 60 FPS is no
   longer rounded up to 17 ms.
2. MMVM and the direct-Node fallback schedule animation callbacks against
   persistent absolute 60 Hz deadlines.
3. The next animation-frame wait can remain pending while rendering or upload
   is in progress.
4. If that callback matures while an upload is busy, the scheduler remembers
   it and begins the requested frame as soon as the upload completes.
5. Missed application deadlines are collapsed instead of replayed, and the
   demos continue to derive motion from wall-clock time.
6. Buffer ownership remains conservative: two client buffers, one upload in
   flight, one server pixmap, and no queue of stale completed frames.

The intended frame period should approach:

```text
max(configured frame interval, rendering time, upload time)
```

rather than the original serialized form:

```text
rendering time + upload time + a new animation-frame interval
```

No XShm extension or platform-specific native add-on is used. The transport
remains ordinary nonblocking X11 core-protocol traffic over the Unix-domain
socket, which keeps the same JavaScript source runnable by stock Node.js.

## Result after correction

The same MMVM command at 640x480 and a requested 60 FPS produced:

```text
first sample:   50.8 complete blits/s
steady sample:  60.0 complete blits/s
client CPU:     54 percent
user CPU:       8.10 seconds over 16 seconds
system CPU:     0.54 seconds over 16 seconds
```

At a requested 20 FPS, the first startup-inclusive sample was 17.2 FPS and the
steady sample was exactly 20.0 FPS. Direct Node.js 24 at 640x480 and 60 FPS
measured 59.6 FPS followed by 60.0 FPS. These are interactive single-run
measurements rather than a statistically controlled benchmark, but they show
that the serialized extra timer wait and 60 FPS rounding limit are gone.

The 60 FPS MMVM result moves approximately 73.7 MB/s of framebuffer payload
before X11 request headers and the final `CopyArea`, compared with 45.1 MB/s in
the original 36.7 FPS steady sample.

## Remaining optimization boundary

The current design deliberately does not render into one buffer while another
buffer is uploading. That deeper producer/consumer pipeline would require
more buffer-state and frame-dropping machinery, and it is unnecessary for the
blit benchmark now that it reaches its requested steady-state rate. The next
meaningful bottleneck for `demo2.js` is its per-pixel JavaScript rasterizer,
not this scheduler or the full-frame upload path.

## Interpretation for demo2

`demo3.js` proves that the double-buffered X11 path can present a 1,228,800-byte
640x480 framebuffer tens of times per second when JavaScript modifies only
small dirty regions. `demo2.js` reaches approximately 0.7-1.0 FPS at the same
resolution because its software rasterizer clears, depth-tests, interpolates,
textures, lights, and writes hundreds of thousands of pixels per frame.

Improving this scheduler can substantially improve the blit-only benchmark,
but it will not by itself materially improve `demo2.js` at 640x480. The 3D
rasterizer must be optimized separately.
