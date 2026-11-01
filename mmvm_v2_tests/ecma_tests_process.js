/* Linux/i386 standalone test supervision. Exactly one child is active. Fork
 * shares the prepared runtime read-only until the worker changes it; its heap,
 * intrinsic mutations and any native failure cannot affect the parent.
 * This is test isolation, not parallel execution or a VM language facility. */
exports.create = function (backend, timeoutMs) {
    var FFI = require("./guest_vm/host_ffi.js"), ffi = new FFI();
    var WAIT_NO_HANG = 1, KILL_SIGNAL = 9, SIGNAL_MASK = 127, EXIT_SHIFT = 8;
    var SYSTEM_CALL_SIGNAL = 31, WORKER_FAILURE_EXIT = 125, POLL_MICROSECONDS = 10000;
    var SET_PARENT_DEATH_SIGNAL = 1, CORE_RESOURCE = 4;
    var WORD_BYTES = 4, PIPE_BYTES = WORD_BYTES * 2, RESULT_BYTES = 4096;
    function native(name) {
        var pointer = ffi.resolve(name);
        return function (args) { return ffi.call(pointer, args); };
    }
    var fork = native("fork"), pipe = native("pipe"), close = native("close");
    var read = native("read"), write = native("write"), waitpid = native("waitpid");
    var kill = native("kill"), usleep = native("usleep"), exit = native("_exit");
    var calloc = native("calloc"), free = native("free"), flush = native("fflush");
    var prctl = native("prctl"), getpid = native("getpid"), getppid = native("getppid");
    var setrlimit = native("setrlimit");
    var descriptors = calloc([1, PIPE_BYTES]), statusPointer = calloc([1, WORD_BYTES]);
    var buffer = calloc([1, RESULT_BYTES]), coreLimit = calloc([1, WORD_BYTES * 2]);
    if (!descriptors || !statusPointer || !buffer || !coreLimit) throw new Error("ECMA worker allocation failed");
    function failure(filename, status, name, message) {
        return {status: status, phase: "worker", name: name, message: message,
            filename: filename, line: 0, column: 0, instructions: 0};
    }
    function asciiJSON(result) {
        result.message = String(result.message || "").substring(0, 400);
        return JSON.stringify(result).replace(/[^\x20-\x7e]/g, function (character) {
            var hex = "0000" + character.charCodeAt(0).toString(16);
            return "\\u" + hex.substring(hex.length - 4);
        });
    }
    return {
        runTest: function (filename, source, harnessFiles, negative, limit) {
            if (pipe([descriptors]) !== 0) throw new Error("ECMA worker pipe failed");
            var input = ffi.peek32(descriptors), output = ffi.peek32(descriptors + WORD_BYTES);
            var parent = getpid([]);
            flush([0]);
            var child = fork([]);
            if (child < 0) { close([input]); close([output]); throw new Error("ECMA worker fork failed"); }
            if (child === 0) {
              try {
                close([input]);
                /* Bound crash artifacts and never orphan a worker if its
                 * supervisor is interrupted. prctl is available since Linux 2.2. */
                setrlimit([CORE_RESOURCE, coreLimit]);
                prctl([SET_PARENT_DEATH_SIGNAL, KILL_SIGNAL, 0, 0, 0]);
                if (getppid([]) !== parent) exit([WORKER_FAILURE_EXIT]);
                var result;
                try { result = backend.runTest(filename, source, harnessFiles, negative, limit); }
                catch (error) { result = failure(filename, "threw", "WorkerError", String(error && error.message || error)); }
                var payload = asciiJSON(result);
                if (payload.length > RESULT_BYTES || write([output, payload, payload.length]) !== payload.length) exit([WORKER_FAILURE_EXIT]);
                close([output]);
                exit([0]);
              } catch (transportError) {
                /* Never unwind into the supervisor's test loop in a child. */
                exit([WORKER_FAILURE_EXIT]);
              }
              exit([WORKER_FAILURE_EXIT]);
            }
            close([output]);
            var started = new Date().getTime(), expired = false;
            while (true) {
                var waited = waitpid([child, statusPointer, WAIT_NO_HANG]);
                if (waited === child) break;
                if (waited < 0) {
                    kill([child, KILL_SIGNAL]); waitpid([child, statusPointer, 0]);
                    close([input]); throw new Error("ECMA worker waitpid failed");
                }
                if (new Date().getTime() - started >= timeoutMs) {
                    expired = true;
                    kill([child, KILL_SIGNAL]); waitpid([child, statusPointer, 0]);
                    break;
                }
                usleep([POLL_MICROSECONDS]);
            }
            var status = ffi.peek32(statusPointer), text = "", received;
            while ((received = read([input, buffer, RESULT_BYTES])) > 0) {
                for (var index = 0; index < received; index++) text += String.fromCharCode(ffi.peek8(buffer + index));
            }
            close([input]);
            if (expired) return failure(filename, "timeout", "TimeoutError", "worker wall-clock limit exhausted");
            var signal = status & SIGNAL_MASK;
            if (signal === SYSTEM_CALL_SIGNAL) throw new Error("i386 worker received SIGSYS; stop and check execution environment");
            if (signal || (status >>> EXIT_SHIFT) !== 0 || !text) return failure(filename,
                "threw", "WorkerExit", signal ? "native signal " + signal : "native exit " + (status >>> EXIT_SHIFT));
            return JSON.parse(text);
        },
        destroy: function () {
            backend.destroy();
            free([descriptors]); free([statusPointer]); free([buffer]); free([coreLimit]);
        }
    };
};
