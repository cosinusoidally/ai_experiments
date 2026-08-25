/*
 * Cooperative three-JSContext demonstration.
 *
 * From mmvm_v2_tests, run either:
 *
 *   node guest_vm/demos/three_contexts.js
 *
 *   LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
 *     ../../mmvm_v2/artifacts/js_min.exe guest_vm/demos/three_contexts.js
 */
(function () {
    var isNode = typeof module !== "undefined" && module.exports;
    var VM;
    if (isNode) {
        VM = require("../guest_vm.js");
    } else {
        load("guest_vm/guest_vm.js");
        VM = GuestVM;
    }

    function hostPrint(message) {
        if (typeof print === "function") print(message);
        else console.log(message);
    }

    function requireStatus(result, wanted, description) {
        if (result.status !== wanted) {
            throw new Error(description + ": expected " + wanted +
                            ", got " + result.status);
        }
    }

    var runtime = new VM.JSRuntime();
    var cx_a = runtime.createContext();
    var cx_b = runtime.createContext();
    var cx_c = runtime.createContext();
    var shutdownRequested = false;

    try {
        cx_c.installGlobal("request_shutdown", cx_c.makeHostFunction(
            "request_shutdown", function () {
                shutdownRequested = true;
                return undefined;
            }));

        cx_c.run(
            "var c_call_count = 0;" +
            "function c_call(message) {" +
            "    c_call_count++;" +
            "    print('[cx_c] ' + message + ' | call ' +" +
            "          c_call_count + '/100');" +
            "    if (c_call_count === 100) {" +
            "        print('[cx_c] threshold reached; requesting cx_a and cx_b shutdown');" +
            "        request_shutdown();" +
            "        print('[cx_c] shutdown request accepted; c_call is exiting');" +
            "    }" +
            "    return c_call_count;" +
            "}",
            "cx_c.js");

        var cCallFunction = runtime.runtime.getGlobal(cx_c, "c_call");

        /* This is the external-call endpoint exported by cx_c. The scheduler
         * routes the yielded request into the real guest c_call above; its
         * callback is deliberately never invoked. */
        var cCallEndpoint = cx_c.makeHostFunction("c_call", function () {
            throw new Error("c_call endpoint must be routed through cx_c");
        });
        cx_a.installGlobal("c_call", cCallEndpoint);
        cx_b.installGlobal("c_call", cCallEndpoint);

        var executionA = cx_a.start(
            "while (true) { c_call('hi from cx_a'); }", "cx_a.js");
        var executionB = cx_b.start(
            "while (true) { c_call('hi from cx_b'); }", "cx_b.js");
        var producers = [executionA, executionB];

        function runCallInCxC(message) {
            var execution = cx_c.startFunction(
                cCallFunction, undefined, [message]);
            while (true) {
                var result = execution.resume(1000);
                if (result.status === "budget") {
                    continue;
                }
                if (result.status === "hostCall") {
                    execution.serviceHostCall();
                    continue;
                }
                if (result.status === "threw") throw result.exception;
                requireStatus(result, "completed", "cx_c c_call execution");
                return result.value;
            }
        }

        hostPrint("[embedder] starting round-robin execution of cx_a and cx_b");
        while (!shutdownRequested) {
            var producerIndex = 0;
            while (producerIndex < producers.length && !shutdownRequested) {
                var producer = producers[producerIndex];
                var producerResult = producer.resume(1000);
                if (producerResult.status === "hostCall") {
                    if (producerResult.call.name !== "c_call") {
                        throw new Error("unexpected producer host call: " +
                                        producerResult.call.name);
                    }
                    var count = runCallInCxC(
                        String(producerResult.call.arguments[0]));
                    producer.completeHostCall(count);
                } else if (producerResult.status === "threw") {
                    throw producerResult.exception;
                } else if (producerResult.status !== "budget") {
                    throw new Error("producer unexpectedly stopped: " +
                                    producerResult.status);
                }
                producerIndex++;
            }
        }

        /* cx_c's 100th c_call has returned before the producer continuations
         * are discarded. */
        executionA.abort();
        executionB.abort();
        hostPrint("[embedder] cx_a and cx_b shut down after 100 multiplexed calls");
        hostPrint("[embedder] cx_c completed; demo exiting");
    } finally {
        runtime.destroy();
    }
}());
