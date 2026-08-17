# JavaScript-only Node HTTP compatibility plan

## Objective

Run the unchanged `node_hello.js` example with the minimal SpiderMonkey shell
using this invocation:

```sh
artifacts/js_min.exe node_runner.js node_hello.js
```

The compatibility layer must provide the small Node.js API surface used by the
example, use event-driven non-blocking network I/O, and be implemented entirely
in JavaScript through the FFI that already exists in the shell.

The implementation should use Linux interfaces available in the Linux 2.4
kernel series. This is a source and system-interface compatibility goal, not a
claim that the currently built executable and its modern shared libraries will
run on an actual Linux 2.4 installation.

## Implementation status

The initial hello-server target is implemented. The compatibility layer is
split across `node_runner.js` and `node_compat/{libc,events,process,net,http}.js`;
the small Buffer surface lives with the process globals rather than in a
separate file. The unchanged `node_hello.js` runs through `js_min.exe` with the
invocation above.

Local verification covers Node 24 comparison, GET, HEAD, fragmented request
headers, concurrent clients, wildcard and loopback binding, port 0, invalid
ports, and asynchronous listen errors. The client state machine retains
partial output and retries it after `POLLOUT`, although forced kernel-level
short-write testing remains a useful future stress test. Node 0.10 and Linux
2.4 runtime execution remain intentionally untested.

The compatibility surface has subsequently been extended with `fs.stat`,
`fs.readdir`, and `fs.readFile` plus their synchronous counterparts, binary
Buffer response bodies, and client address reporting. `node_web.js` uses the
callback-based forms and provides a portable static server with behavior
matching `net.js` across the locally tested routes. Compatibility callbacks are
queued asynchronously, while their underlying libc regular-file operations run
on the JavaScript event-loop thread; network descriptors remain non-blocking.

## Hard constraints

- Do not modify `js.c`, `js_min.c`, `js_min_linux.c`, `js_min_win32.c`, or any
  other C source.
- Do not add new native functions to `js.exe` or `js_min.exe`.
- Do not use npm packages or any other third-party JavaScript dependency.
- Do not fetch or download anything from the internet. If an external runtime,
  file, or test fixture becomes necessary, stop and ask the user to provide it.
- Keep `node_hello.js` valid for Node.js 0.10-era syntax and built-in APIs.
- Test locally with `~/src/nodejs/node-v24.14.1-linux-x64/bin/node` and with the
  interpreter produced by `./mk_min`.
- Do not claim that Node.js 0.10 or Linux 2.4 was tested unless the user later
  supplies an appropriate environment and explicitly requests that testing.
- Keep raw `ffi_call` use inside a centralized libc wrapper layer. Higher-level
  event-loop, socket, HTTP, and Node compatibility code must call named wrappers.

## Scope

The initial target is only the API surface required by `node_hello.js`:

```text
require("http")
http.createServer(callback)
server.on("error", callback)
server.listen(port, host, callback)
server.address()
response.writeHead(status, headers)
response.end(body)
Buffer.byteLength(string)
process.argv
process.exit(status)
console.log(...)
console.error(...)
```

The request callback must be dispatched from a readiness-based event loop. A
blocking `accept` loop inside `server.listen` does not satisfy this requirement.

## Non-goals

The first implementation will not attempt to provide general Node.js
compatibility. In particular, it will not initially implement:

- npm or `node_modules` resolution;
- CommonJS file modules beyond loading the target program;
- Node native addons;
- `fs`, `path`, `tls`, `dns`, `child_process`, or other built-in modules;
- a complete `Buffer` implementation;
- a complete streams implementation;
- HTTP client APIs;
- HTTP upgrades, WebSockets, trailers, compression, ranges, or chunked request
  bodies;
- full HTTP keep-alive support;
- threads, worker pools, or asynchronous hostname resolution;
- V8-specific behavior or full Node 0.10 behavioral compatibility.

## Proposed files

```text
node_runner.js                 entry point and runtime lifecycle
node_compat/libc.js            symbol lookup and named libc wrappers
node_compat/events.js          minimal EventEmitter
node_compat/buffer.js          Buffer.byteLength and byte encoding helpers
node_compat/process.js         process and console globals
node_compat/net.js             non-blocking sockets and event-loop handles
node_compat/http.js            HTTP parser, response serializer, and API facade
node_hello.js                  unchanged application
```

If the old shell's path handling makes a directory layout unnecessarily
fragile, use equivalent flat names such as `node_compat_libc.js`. This is only a
packaging change; the layers should remain separate.

## Runner lifecycle

`node_runner.js` will use shell facilities that already exist, including the
global `arguments` array and `load` function.

Given:

```sh
artifacts/js_min.exe node_runner.js node_hello.js 8000 0.0.0.0
```

the shell exposes these runner arguments:

```text
arguments[0] = "node_hello.js"
arguments[1] = "8000"
arguments[2] = "0.0.0.0"
```

The runner will:

1. Validate that a target script was supplied.
2. Preserve the runner arguments before loading any compatibility files.
3. Load the libc, event, buffer, process, network, and HTTP layers.
4. Install `require`, `process`, `console`, and `Buffer` on the global object.
5. Synthesize Node-shaped arguments:

   ```text
   process.argv[0] = "artifacts/js_min.exe"
   process.argv[1] = "node_hello.js"
   process.argv[2] = "8000"
   process.argv[3] = "0.0.0.0"
   ```

6. Evaluate `node_hello.js` with `load`.
7. Drain callbacks that were queued during top-level evaluation.
8. Enter the event loop while referenced handles or queued callbacks remain.
9. Exit with the requested process status after the loop terminates.

`server.listen` must create and register a server handle, queue its completion
callback, and return. It must not take control of the event loop itself. This
allows all top-level statements following `server.listen` to execute before I/O
callbacks are dispatched, as they would under Node.

## Built-in module loading

The first `require` implementation will recognize built-in module names only:

```js
function require(name) {
    if (name === "http") {
        return nodeHttp;
    }
    throw new Error("unsupported built-in module: " + name);
}
```

It does not need filesystem module resolution for the hello-world target.
Keeping this boundary explicit prevents the project from accidentally growing
an incomplete npm implementation.

## Centralized libc wrapper layer

`node_compat/libc.js` will resolve native symbols once with `get_dlsym` and
`dlsym`, store their raw addresses privately, and expose named JavaScript
functions. Only this file may call `ffi_call` directly.

The initial wrappers are expected to include:

```text
socket
setsockopt
bind
listen
accept
fcntl
poll
read
write
send
close
calloc
free
getaddrinfo
freeaddrinfo
gai_strerror
getsockname
getnameinfo
signal
__errno_location
exit
```

All structures must be documented for the actual 32-bit Linux ABI used by
`js_min.exe`. Allocate native structures with `calloc`, initialize every field,
and release them deterministically. Do not retain a pointer to a temporary
SpiderMonkey string beyond the duration of its FFI call.

The wrapper layer will expose an `errno` accessor by calling
`__errno_location` and reading the returned integer pointer. Higher layers
should compare named constants such as `EINTR`, `EAGAIN`, and `EWOULDBLOCK`
rather than using unexplained numeric literals throughout the code.

## Conservative Linux 2.4 interface target

Use interfaces available in the Linux 2.4 kernel series:

- `socket`, `setsockopt`, `bind`, `listen`, and `accept`;
- `fcntl` with `F_GETFL`, `F_SETFL`, and `O_NONBLOCK`;
- `poll` with `POLLIN`, `POLLOUT`, `POLLERR`, and `POLLHUP`;
- `read`, `write` or `send`, and `close`;
- ordinary Unix signal handling for `SIGPIPE`;
- libc address conversion and resolution functions.

Do not use newer Linux facilities:

- `epoll`;
- `accept4`;
- `eventfd`;
- `timerfd`;
- `signalfd`;
- `inotify`;
- `io_uring`;
- `SOCK_NONBLOCK` or `SOCK_CLOEXEC` creation flags;
- assumptions about newer `sendfile` variants.

`poll` is preferred over `select` because it is available in Linux 2.4 and does
not impose the same `FD_SETSIZE` limit. If ABI handling for `pollfd` proves
problematic, `select` is an acceptable, more conservative fallback for this
small server.

The compatibility layer should use numeric bind addresses for the initial
target. A synchronous libc hostname lookup can block and therefore should not
be presented as fully event-driven DNS. The example's default `0.0.0.0` does
not require DNS.

The source may use Linux 2.4-era APIs while the current binary still requires a
newer runtime environment because it was linked against modern glibc and other
shared libraries. Actual Linux 2.4 binary compatibility would require a
separately supplied compatible build environment and is outside this plan.

## Event loop

The event loop will be a JavaScript scheduler built around a blocking `poll`
call over non-blocking descriptors. Blocking inside `poll` while there is no
ready work is correct; individual network operations must not block.

Maintain:

- a FIFO queue of pending JavaScript callbacks;
- a map from file descriptor to handle state;
- a native `pollfd` array rebuilt or resized when registrations change;
- a count of referenced handles that keep the process alive;
- a process-exit flag and exit status.

Each iteration will:

1. Run callbacks already queued for dispatch.
2. Stop if `process.exit` was requested.
3. Exit normally if there are no referenced handles and no queued callbacks.
4. Build the `pollfd` array from current handle interests.
5. Call `poll`, retrying after `EINTR`.
6. Translate `revents` into queued accept, read, write, error, and close work.
7. Dispatch callbacks only from JavaScript, never as native C callbacks.

The hello-world target has no timers, so the initial implementation may use an
infinite poll timeout. A future timer queue can calculate a finite timeout
without adding `timerfd` or another newer kernel dependency.

## Non-blocking server sockets

When `server.listen` is called:

1. Parse and validate the port and bind address.
2. Resolve or construct a compatible socket address.
3. Create the socket with ordinary `socket(AF_INET, SOCK_STREAM, 0)`.
4. Apply `SO_REUSEADDR`.
5. Read the descriptor flags with `fcntl(F_GETFL)`.
6. add `O_NONBLOCK` with `fcntl(F_SETFL)`.
7. Bind and listen.
8. Query the effective address and port with `getsockname`, including port 0.
9. Register the listening descriptor for `POLLIN`.
10. Queue the `listen` callback.

When the listener is readable, call ordinary `accept` repeatedly until it
returns `EAGAIN` or `EWOULDBLOCK`. Retry after `EINTR`. Set `O_NONBLOCK` on every
accepted descriptor with `fcntl`; do not assume that Linux inherits the flag,
and do not use the newer `accept4` interface.

## Client state and non-blocking I/O

Each accepted client will have explicit state similar to:

```js
{
    fd: 7,
    inputPointer: 0,
    inputLength: 0,
    inputCapacity: 8192,
    outputChunks: [],
    outputChunk: 0,
    outputOffset: 0,
    requestDispatched: false,
    responseEnded: false,
    closeAfterWrite: true
}
```

Reads must:

- continue until `EAGAIN` or `EWOULDBLOCK`;
- retry after `EINTR`;
- handle EOF as a peer close;
- enforce a request-header size limit;
- preserve fragmented request data between readiness notifications;
- dispatch the request callback only after a complete header is available.

Writes must:

- occur only when output is queued and the descriptor is writable;
- handle short writes by retaining the unwritten suffix;
- stop and wait for another `POLLOUT` after `EAGAIN` or `EWOULDBLOCK`;
- retry after `EINTR`;
- handle disconnect errors without terminating the process;
- remove `POLLOUT` interest when the queue becomes empty;
- close only after the complete response has been flushed.

Ignore `SIGPIPE` once during initialization or use the Linux 2.4-compatible
`MSG_NOSIGNAL` send flag. A disconnected client must become an error event, not
terminate the interpreter.

## Minimal HTTP implementation

The parser needs enough HTTP/1.x behavior for ordinary GET and HEAD requests:

- recognize `CRLF CRLF` across fragmented reads;
- parse the method, request target, and HTTP version;
- reject malformed request lines and oversized headers;
- parse header names case-insensitively;
- expose `request.method`, `request.url`, `request.httpVersion`, and
  `request.headers`;
- reject unsupported request bodies for the initial implementation or consume
  a declared `Content-Length` before reusing a connection.

The first implementation should send `Connection: close` and close after one
response. Disabling keep-alive avoids pipelining and body-framing complexity
while retaining valid event-driven HTTP behavior.

`response.writeHead(status, headers)` will store the status and headers.
`response.end(body)` will:

1. encode the body as UTF-8 bytes;
2. add `Content-Length` if the application did not supply it;
3. add `Connection: close` for the initial implementation;
4. serialize the status line and headers;
5. queue headers and body on the client;
6. enable `POLLOUT` interest;
7. return without waiting for bytes to be written.

For a HEAD request, calculate the same headers but suppress body bytes.

## Node object behavior

### EventEmitter

Implement at least:

```text
on(name, callback)
emit(name, ...arguments)
```

An emitted `error` without a listener should terminate with a diagnostic. The
hello server installs an error listener, so bind and listen failures must be
delivered there rather than silently thrown from a later poll iteration.

### Server

Implement:

```text
on
listen
address
close (useful for tests even though the example does not call it)
```

`address()` should return an object containing at least `address`, `family`, and
`port` after the socket has bound.

### Request

Initially expose:

```text
method
url
httpVersion
headers
socket
```

### Response

Initially expose:

```text
writeHead
end
statusCode
headersSent
```

Guard against calling `writeHead` or `end` after the response has ended.

### Buffer

Implement `Buffer.byteLength(value, encoding)` with correct UTF-8 byte counts,
not merely JavaScript string length. The hello body is ASCII, but a correct
small UTF-8 implementation prevents immediately observable incompatibilities.
The HTTP layer may use its own native byte-buffer abstraction internally; it
does not initially need to expose the full Node `Buffer` class.

### Process exit

`process.exit(status)` should stop scheduling new work and terminate with the
requested status. A libc `exit` wrapper is available if immediate termination
is needed without changing C code. Normal event-loop exhaustion should return
status zero through the runner.

## Error handling and cleanup

- Route asynchronous socket errors to the server or connection error path.
- Include the failed operation and errno in diagnostics.
- Close every descriptor exactly once.
- Free request, response, address, poll, and client buffers deterministically.
- Remove a descriptor from the poll registry before freeing its handle state.
- Treat peer resets as connection-local failures.
- Retry interruptible operations after `EINTR`.
- Never busy-loop on `EAGAIN`.
- Put practical limits on header bytes, header count, and queued response bytes.

## Implementation stages

### Stage 1: runner and non-network globals

- Add `node_runner.js`.
- Construct `process.argv` from runner arguments.
- Implement `process.exit`, `console.log`, and `console.error`.
- Implement `Buffer.byteLength` for UTF-8.
- Add built-in-only `require` routing.
- Load `node_hello.js` unchanged and verify that the failure moves from missing
  globals to the intentionally incomplete `http` implementation.

### Stage 2: libc wrappers and ABI checks

- Add the private symbol table and named libc wrapper object.
- Add native allocation helpers with deterministic cleanup.
- Add named constants and documented 32-bit structure layouts.
- Add errno access.
- Add small local tests for structure reads/writes and wrapper return values.
- Confirm that raw `ffi_call` occurs only in the wrapper file.

### Stage 3: event loop and raw TCP server

- Implement callback and active-handle queues.
- Implement the `pollfd` registry.
- Implement non-blocking listener creation.
- Implement accept, client read, queued write, and close state machines.
- Test many simultaneous localhost clients and deliberately fragmented input.
- Test responses large enough to require multiple writes.

### Stage 4: Node event and HTTP facade

- Implement the minimal EventEmitter.
- Implement `http.createServer` and Server methods.
- Implement request parsing and request objects.
- Implement response header serialization and `response.end`.
- Run `node_hello.js` unchanged through `node_runner.js`.

### Stage 5: behavioral comparison and hardening

- Run the example locally under Node 24 on one port.
- Run it through `js_min.exe` on another port.
- Compare status, headers with nondeterministic fields excluded, body, HEAD
  behavior, bind errors, port 0, and concurrent requests.
- Exercise disconnects, malformed requests, partial reads, partial writes, and
  repeated start/stop cycles.
- Audit the libc symbol list against the Linux 2.4 constraint.
- Verify that no C source changed.

## Local-only test strategy

Build the interpreter with:

```sh
LD_LIBRARY_PATH=../firefox-1.0.8/lib ./mk_min
```

Run the native Node reference with the already-installed local binary:

```sh
~/src/nodejs/node-v24.14.1-linux-x64/bin/node \
  node_hello.js 18090 127.0.0.1
```

Run the compatibility implementation with:

```sh
LD_LIBRARY_PATH=../firefox-1.0.8/lib \
  artifacts/js_min.exe node_runner.js node_hello.js 18091 127.0.0.1
```

All requests must target localhost. Use only tools and fixtures already present
on the machine. Do not download an old Node binary, old kernel image, test
suite, package, or documentation.

Node 0.10 compatibility will initially be checked by source review: retain
`var`, function callbacks, CommonJS `require`, and built-in APIs known to the
example. Linux 2.4 compatibility will initially be checked by an explicit
native-symbol audit and by rejecting newer APIs in code review. Neither claim
should be described as runtime-tested.

## Acceptance criteria

The first implementation is complete when all of the following are true:

- `node_hello.js` remains unchanged and runs under the local Node 24 binary.
- The same file runs through:

  ```sh
  artifacts/js_min.exe node_runner.js node_hello.js
  ```

- No C or header file changes are present.
- No npm or third-party dependency is present.
- No external download was made.
- The server defaults to port 8000 and bind address `0.0.0.0` as specified by
  the example.
- Network descriptors are placed in non-blocking mode.
- The event loop is readiness-driven with `poll` or the documented `select`
  fallback.
- `server.listen` returns before callbacks are dispatched.
- Multiple clients can be active without a blocking per-client loop.
- Fragmented requests and partial writes complete correctly.
- GET returns status 200 and exactly `Hello, world!\n`.
- HEAD returns matching headers without response-body bytes.
- Access through the local Node 24 runtime and the compatibility runner has the
  same application-visible body and content length.
- The raw FFI boundary is centralized in the libc wrapper layer.
- An API audit finds no post-Linux-2.4 kernel dependency.
- The limitations concerning actual Node 0.10 and Linux 2.4 runtime testing are
  stated accurately.

## Risks and mitigations

### Old SpiderMonkey behavior

The shell uses a much older SpiderMonkey than Node's V8. Keep compatibility
code in conservative ES3-era syntax: `var`, ordinary functions, simple object
literals, and arrays. Avoid accessors, modern property APIs, typed arrays,
promises, and other modern language features.

### FFI type limitations

The FFI treats native values primarily as 32-bit integers and pointers. Keep
the initial target on the existing 32-bit ABI, avoid APIs requiring 64-bit
return values, and document every native structure offset. Do not generalize
the implementation to 64-bit without adding a separate ABI description and
tests.

### HTTP parser complexity

Keep the initial protocol surface intentionally small, enforce limits, close
after each response, and reject unsupported framing rather than guessing. The
goal is to run the example safely, not reproduce all of Node's HTTP parser.

### Apparent rather than actual non-blocking behavior

Tests must include concurrent clients, fragmented reads, and queued multi-write
responses. A server that only works because small localhost reads and writes
complete immediately does not meet the acceptance criteria.

### Kernel versus userspace compatibility

Keep the kernel-facing API list conservative, but do not imply that modern
glibc, the dynamic loader, or `libmozjs.so` will execute on a Linux 2.4 system.
That separate binary-portability problem requires a user-supplied compatible
environment and explicit authorization to test.
