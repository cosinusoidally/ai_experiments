/* Higher-level real-kernel acceptance, runnable by js_min or the standalone
 * executable. No child-process Node API, GDB, binutils or C helper. */
(function (args) {
    load("guest_vm/host_ffi.js"); load("guest_vm/aot/debug_binary.js");
    load("guest_vm/aot/kernel_dwarf.js"); load("guest_vm/debugger/format.js");
    load("guest_vm/aot/standalone_format.js");
    load("guest_vm/debugger/linux_i386.js");
    load("guest_vm/debugger/image.js"); load("guest_vm/debugger/dwarf.js");
    load("guest_vm/debugger/engine.js");
    load("guest_vm/debugger/x86.js");
    load("guest_vm/aot/x86_assembler.js"); load("guest_vm/aot/snapshot_frames.js");
    var io = new KernelDebuggerLinux(), image = null;
    function check(condition, description) {
        if (!condition) throw new Error("kernel debugger acceptance failed: " + description);
        io.output("PASS " + description + "\n");
    }
    try {
        if (args.length !== 1) throw new Error("usage: check_kernel_debugger.js artifacts/DEBUG_EXECUTABLE");
        image = new KernelDebuggerImage(io, String(args[0]));
        var debug = new KernelDebuggerDWARF(image);
        var e = new KernelDebuggerEngine(io, image, debug, {timeout: 30000, stepLimit: 100000});
        check(!io.pid, "symbol loading does not spawn an inferior");
        var A = KernelDebuggerDWARF.attributes, instructionCount = 0;
        for (var functionIndex = 0; functionIndex < debug.functions.length; functionIndex++) {
            var fn = debug.functions[functionIndex], pc = fn.attrs["$" + A.lowPC], end = pc + fn.attrs["$" + A.highPC];
            while (pc < end) {
                var instruction = KernelDebuggerX86.decode(function (address) { return image.codeByte(address); }, pc);
                pc += instruction.length; instructionCount++;
            }
            if (pc !== end) throw new Error("decoder crosses function boundary for " + debug.name(fn));
        }
        check(instructionCount > 0, "all " + debug.functions.length + " real kernel functions decode to exact boundaries");
        io.output("Decoded " + instructionCount + " real kernel instructions.\n");
        var sourceName = "guest_vm/aot/native_interpreter.js";
        var source = io.textFile(sourceName);
        var marker = "budget = budget - instructionsCompleted;";
        var position = source.indexOf(marker, source.indexOf("function nativeExecutionKernel("));
        check(position >= 0, "locate real kernel assignment for source stepping");
        var line = source.substring(0, position).split("\n").length;
        var assignment = e.addBreakpoint(sourceName + ":" + line, false);
        e.args = ["hello.js"]; var event = e.start();
        check(event.breakpoint === assignment.id, "source breakpoint stops before native assignment");
        var budgetBinding = e.variable("budget"), completedBinding = e.variable("instructionsCompleted");
        if (budgetBinding.home.unavailable || completedBinding.home.unavailable) {
            var header = image.section(".snapshot.header");
            check(header.at32(GuestVMStandaloneFormat.fields.optimizationMode) === 0,
                "only an optimized target permits the source probe local to be unavailable");
            var unavailable = budgetBinding.home.unavailable ? budgetBinding : completedBinding, refused = false;
            try { e.value(unavailable); } catch (error) { refused = error.message === unavailable.home.unavailable; }
            check(refused, "optimized variable availability is enforced rather than guessed");
            event = e.sourceStep(true);
            check(event.kind === "stopped", "source stepping works with optimized-out locals");
        } else {
            var budget = e.value(budgetBinding), completed = e.value(completedBinding);
            check(completed > 0, "initialized kernel local is readable");
            e.setVariable("instructionsCompleted", 0);
            check(e.value(e.variable("instructionsCompleted")) === 0, "write scalar local through its DWARF location");
            event = e.sourceStep(true);
            check(event.kind === "stopped" && e.value(e.variable("budget")) === budget,
                "source step observes the edited local's effect on computation");
        }
        e.removeBreakpoint(assignment.id); event = e.resume(false);
        check(event.kind === "exited" && event.code === 0, "debugged hello exits normally after source inspection");
        var bp = e.addBreakpoint("interpreterKernel", false);
        event = e.start(); check(event.breakpoint === bp.id, "function breakpoint stops a restarted inferior");
        var frames = e.frames(), names = [];
        for (var i = 0; i < frames.length; i++) {
            var frameSymbol = image.symbol(frames[i].pc);
            names.push(frames[i].fn ? debug.name(frames[i].fn) : frameSymbol ? frameSymbol.name : "external");
            check(!frames[i].unwindError, "frame " + i + " has no unwind error");
        }
        check(names.join(" ").indexOf("nativeExecutionKernel") >= 0, "CFI reaches the native execution caller");
        check(names.join(" ").indexOf("snapshot_bootstrap_entry main _main_abi_entry") >= 0,
            "CFI connects the interpreter through bootstrap, JS main and ABI bridge");
        for (i = 0; i < names.length; i++) if (names[i] === "main") {
            e.selectedFrame = i;
            check(e.value(e.variable("argc")) === 2 &&
                e.value(e.variable("snapshotEntry")) === image.byName.$snapshot_bootstrap_entry.start,
                "main parameters are recovered through the bootstrap frame");
        }
        e.selectedFrame = 0;
        check(e.value(e.variable("budget")) > 0, "stack parameter is recovered at function breakpoint");
        event = e.finish(); check(event.kind === "stopped", "finish reaches the native caller");
        io.terminate(); event = e.start();
        check(event.breakpoint === bp.id, "persistent breakpoint is reinstalled after live-child restart");
        e.removeBreakpoint(bp.id); event = e.resume(false);
        check(event.kind === "exited" && event.code === 0, "restart reuses hello arguments and completes");
        var symbol = image.byName.$interpreterKernel;
        check(!!symbol, "actual kernel symbol available for entry-boundary checks");
        var entry = e.addBreakpoint([symbol.start], false); event = e.start();
        check(event.breakpoint === entry.id, "raw address breakpoint stops exactly at entry");
        for (i = 0; i < 3; i++) {
            frames = e.frames();
            check(frames.length >= 3 && !frames[0].unwindError,
                "CFI unwinds at entry/frame-setup boundary " + i);
            event = e.resume(true);
        }
        e.removeBreakpoint(entry.id); event = e.resume(false, KernelDebuggerLinux.signals.interrupt);
        check(event.kind === "terminated" && event.signal === KernelDebuggerLinux.signals.interrupt,
            "explicit program signal is delivered, not mistaken for a debugger trap");
        function inspectABIFrame(symbolName, plan) {
            var symbol = image.byName["$" + symbolName], raw = [], k;
            check(!!symbol, "ABI frame symbol available: " + symbolName);
            for (k = 0; k < symbol.size; k++) raw.push(image.codeByte(symbol.start + k));
            var description = GuestVMSnapshotFrames.describe(raw, plan, GuestVMX86Assembler);
            var points = [0, description.pushedFrame, description.establishedFrame,
                description.bodyStart, description.epilogueStart, description.leftFrame];
            for (k = 0; k < description.cfi.length; k++) points.push(description.cfi[k].offset);
            points.sort(function (a, b) { return a - b; });
            var addresses = [];
            for (k = 0; k < points.length; k++) if (!k || points[k] !== points[k - 1]) addresses.push(symbol.start + points[k]);
            var boundary = e.addBreakpoint(addresses, false), baseline = null;
            e.args = ["hello.js"]; var stopped = e.start();
            var preserved = ["ebp", "ebx", "esi", "edi", "esp", "eip"];
            for (k = 0; k < addresses.length; k++) {
                check(stopped.kind === "stopped" && stopped.breakpoint === boundary.id && stopped.pc === addresses[k],
                    symbolName + " reaches ABI boundary " + k);
                var trace = e.frames();
                check(trace.length >= 2 && !trace[0].unwindError, symbolName + " unwinds at boundary " + k);
                var caller = trace[1].registers;
                if (!baseline) baseline = caller;
                for (var saved = 0; saved < preserved.length; saved++) {
                    if (typeof caller[preserved[saved]] !== "number" ||
                        caller[preserved[saved]] !== baseline[preserved[saved]]) throw new Error(symbolName +
                        " recovers the wrong caller " + preserved[saved] + " at boundary " + k);
                }
                if (k + 1 < addresses.length) stopped = e.resume(false);
            }
            e.removeBreakpoint(boundary.id); stopped = e.resume(false);
            check(stopped.kind === "exited" && stopped.code === 0, symbolName + " boundary workload exits normally");
        }
        inspectABIFrame("snapshot_bootstrap_entry", GuestVMSnapshotFrames.bootstrapPlan());
        inspectABIFrame("_main_abi_entry", GuestVMSnapshotFrames.bridgePlan());
        var requestedInterrupt = false;
        e.options.runningInput = function () {
            if (!requestedInterrupt) { requestedInterrupt = true; e.interrupt(); }
            else io.call("poll", [0, 0, 1]);
        };
        e.args = ["guest_vm/tests/gc_stress_workload.js"]; event = e.start();
        check(event.kind === "stopped" && event.interrupted && e.pendingSignal === 0,
            "debugger interrupt stops the real GC workload without pending signal delivery");
        e.options.runningInput = null; event = e.resume(false);
        check(event.kind === "exited" && event.code === 0,
            "continue resumes the interrupted bounded GC workload successfully");
        io.output("Kernel debugger real-kernel acceptance passed.\n");
    } finally { try { if (image) image.destroy(); } finally { io.destroy(); } }
}(arguments));
