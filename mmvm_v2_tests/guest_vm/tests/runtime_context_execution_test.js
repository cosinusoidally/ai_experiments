(function (root) {
    function assert(condition, message) {
        if (!condition) throw new Error(message);
    }

    function runRuntimeContextExecutionTest(VM) {
        var JSRuntime = VM.JSRuntime;
        var firstRuntime = new JSRuntime();
        var firstContext = firstRuntime.createContext();
        var secondContext = firstRuntime.createContext();
        var otherRuntime = new JSRuntime();
        var otherContext = otherRuntime.createContext();

        firstContext.installGlobal("contextMarker", 11);
        secondContext.installGlobal("contextMarker", 22);
        firstContext.run("var contextValue = contextMarker + 1;", "first_context.js");
        secondContext.run("var contextValue = contextMarker + 2;", "second_context.js");
        assert(firstRuntime.runtime.getGlobal(firstContext, "contextValue") === 12,
               "first context global environment was not isolated");
        assert(firstRuntime.runtime.getGlobal(secondContext, "contextValue") === 24,
               "second context global environment was not isolated");

        var firstObject = firstRuntime.runtime.makeObject();
        firstContext.installGlobal("owned", firstObject);
        secondContext.installGlobal("sharedOwned", firstObject);
        firstRuntime.runtime.setProperty(firstObject, "value", 37);
        secondContext.run("var sharedObjectValue = sharedOwned.value;",
                          "shared_runtime_object.js");
        assert(firstRuntime.runtime.getGlobal(secondContext,
                                              "sharedObjectValue") === 37,
               "contexts in one runtime did not share a runtime-owned object");
        firstContext.run(
            "var homeValue = 40;" +
            "function exportedAdd(amount) { homeValue += amount; return homeValue; }",
            "cross_context_function_owner.js");
        var exportedAdd = firstRuntime.runtime.getGlobal(firstContext, "exportedAdd");
        secondContext.installGlobal("exportedAdd", exportedAdd);
        secondContext.run("var exportedResult = exportedAdd(2);",
                          "cross_context_function_caller.js");
        assert(firstRuntime.runtime.getGlobal(firstContext, "homeValue") === 42 &&
               firstRuntime.runtime.getGlobal(secondContext,
                                              "exportedResult") === 42,
               "cross-context function did not use its home context globals");
        var rejectedForeignObject = false;
        try {
            otherContext.installGlobal("foreign", firstObject);
        } catch (error) {
            rejectedForeignObject = true;
        }
        assert(rejectedForeignObject, "context accepted an object from another runtime");
        assert(firstRuntime.internString("shared-name") ===
               firstRuntime.internString("shared-name"),
               "runtime did not intern repeated strings");
        var atomAddress = firstRuntime.runtime.internStringAddress("shared-name");
        assert(firstRuntime.runtime.linearHeap.recordType(atomAddress) ===
               firstRuntime.runtime.linearHeap.constructor.Types.STRING,
               "runtime atom is not an authoritative heap string");
        assert(firstRuntime.runtime.internedStrings !==
               otherRuntime.runtime.internedStrings,
               "independent runtimes shared an intern table");

        var budgetExecution = firstContext.start(
            "var total = 0;" +
            "function add(value) { return value + 1; }" +
            "for (var i = 0; i < 20; i++) total = add(total);",
            "budget_resume.js");
        var budgetResult = budgetExecution.resume(0);
        assert(budgetResult.status === "budget" && budgetResult.instructions === 0,
               "zero budget did not yield without executing");
        var budgetYields = 0;
        do {
            budgetResult = budgetExecution.resume(3);
            if (budgetResult.status === "budget") budgetYields++;
        } while (budgetResult.status === "budget");
        assert(budgetResult.status === "completed", "budgeted execution did not complete");
        assert(budgetYields > 5, "execution did not repeatedly preserve its continuation");
        assert(firstRuntime.runtime.getGlobal(firstContext, "total") === 20,
               "resumed guest frames produced the wrong result");

        var hostCalls = 0;
        firstContext.installGlobal("hostAdd", firstContext.makeHostFunction(
            "hostAdd", function (receiver, args) {
                hostCalls++;
                return Number(args[0]) + Number(args[1]);
            }));
        var hostExecution = firstContext.start(
            "var hostAnswer = hostAdd(20, 22); hostAnswer = hostAnswer + 1;",
            "host_yield.js");
        var hostResult = hostExecution.resume(Infinity);
        assert(hostResult.status === "hostCall", "external host function did not yield");
        assert(hostCalls === 0, "host callback ran before the embedder serviced it");
        assert(hostResult.call.name === "hostAdd" &&
               hostResult.call.arguments[0] === 20 &&
               hostResult.call.arguments[1] === 22,
               "host-call request did not preserve its arguments");
        hostExecution.completeHostCall(42);
        hostResult = hostExecution.resume(Infinity);
        assert(hostResult.status === "completed", "host-call execution did not resume");
        assert(firstRuntime.runtime.getGlobal(firstContext, "hostAnswer") === 43,
               "host-call result was not installed in the caller register");
        assert(hostCalls === 0, "manual host completion unexpectedly invoked callback");

        var servicedExecution = firstContext.start(
            "var servicedAnswer = hostAdd(3, 4);", "serviced_host.js");
        var servicedResult = servicedExecution.resume(Infinity);
        assert(servicedResult.status === "hostCall", "second host call did not yield");
        servicedExecution.serviceHostCall();
        servicedResult = servicedExecution.resume(Infinity);
        assert(servicedResult.status === "completed" && hostCalls === 1,
               "embedder host-call service path failed");
        assert(firstRuntime.runtime.getGlobal(firstContext, "servicedAnswer") === 7,
               "serviced host return value was incorrect");

        firstContext.installGlobal("inlineAdd", firstRuntime.runtime.makeNativeFunction(
            "inlineAdd", function (receiver, args) { return args[0] + args[1]; }));
        var inlineExecution = firstContext.start(
            "var inlineAnswer = inlineAdd(8, 9);", "inline_intrinsic.js");
        var inlineResult = inlineExecution.resume(Infinity);
        assert(inlineResult.status === "completed" &&
               firstRuntime.runtime.getGlobal(firstContext, "inlineAnswer") === 17,
               "explicit inline intrinsic unexpectedly yielded");

        firstContext.installGlobal("hostFailure", firstContext.makeHostFunction(
            "hostFailure", function () { throw new Error("host failed"); }));
        var failedExecution = firstContext.start(
            "hostFailure();", "failed_host.js");
        var failedResult = failedExecution.resume(Infinity);
        assert(failedResult.status === "hostCall", "failing host call did not yield first");
        failedExecution.serviceHostCall();
        failedResult = failedExecution.resume(Infinity);
        assert(failedResult.status === "threw" &&
               String(failedResult.exception).indexOf("host failed") >= 0,
               "host failure was not injected when execution resumed");

        var gcExecution = firstContext.start(
            "var suspendedBytes = Buffer.alloc(4);" +
            "suspendedBytes[0] = 63;" +
            "for (var k = 0; k < 8; k++) suspendedBytes[1] = k;",
            "suspended_gc.js");
        var gcResult = gcExecution.resume(12);
        assert(gcResult.status === "budget", "GC continuation test did not suspend");
        firstRuntime.collect();
        do {
            gcResult = gcExecution.resume(12);
        } while (gcResult.status === "budget");
        assert(gcResult.status === "completed" &&
               firstRuntime.runtime.bufferSupport.viewBacking(
                   firstRuntime.runtime.getGlobal(firstContext,
                                                  "suspendedBytes")).freed === false,
               "collection did not retain a suspended execution value");

        firstRuntime.destroy();
        otherRuntime.destroy();
        return "runtime/context isolation and resumable execution passed";
    }

    root.GuestVMRunRuntimeContextExecutionTest = runRuntimeContextExecutionTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runRuntimeContextExecutionTest;
    }
}(this));
