/* Read-only bootstrap introspection for a genuine self-hosted build. Run from
 * mmvm_v2_tests on either native platform:
 *   guest.exe guest_vm/tools/trace_self_hosted_build.js artifacts/trace.snap
 * It traces nested source execution and key dependency bindings, not opcodes.
 * No source/cache shortcut or snapshot-copy fallback is installed. */
(function (global, args) {
    if (args.length !== 1) throw new Error("usage: trace_self_hosted_build.js OUTPUT.snap");
    var originalLoad = global.load;
    var installed = false;
    function binding(context, name) {
        try {
            var value = context.runtime.getGlobal(context, name);
            return value && value.guestType ? value.guestType : typeof value;
        } catch (error) { return "<lookup: " + (error && error.message || "exception") + ">"; }
    }
    function install() {
        if (installed) return;
        installed = true;
        var run = global.GuestVMJSContext.prototype.run;
        global.GuestVMJSContext.prototype.run = function (source, filename) {
            print("bootstrap source begin: " + filename + " (" + source.length + " chars)");
            try {
                var result = run.call(this, source, filename);
                print("bootstrap source end: " + filename +
                    "; NativeInterpreter=" + binding(this, "GuestVMNativeInterpreter") +
                    "; Execution=" + binding(this, "GuestVMExecution") +
                    "; VM=" + binding(this, "GuestVM"));
                return result;
            } catch (error) {
                print("bootstrap source failed: " + filename +
                    "; NativeInterpreter=" + binding(this, "GuestVMNativeInterpreter") +
                    "; " + (error && error.message || "exception"));
                throw error;
            }
        };
        function phase(prototype, name) {
            var original = prototype[name];
            prototype[name] = function () {
                print("bootstrap phase begin: " + name);
                var result = original.apply(this, arguments);
                print("bootstrap phase end: " + name);
                return result;
            };
        }
        phase(global.GuestVM.prototype, "start");
        phase(global.GuestVMKernelX86Backend.prototype, "writeStandaloneSnapshot");
        phase(global.GuestVMNativeInterpreter.prototype, "releaseAllocatorOwnership");
        phase(global.GuestVMRuntime.prototype, "standaloneNativeBindings");
        phase(global.GuestVMRuntime.prototype, "standaloneArgumentCells");
        phase(global.GuestVMRuntime.prototype, "shareSnapshotStringBackings");
    }
    global.load = function (filename) {
        var value = originalLoad(filename);
        if (filename === "guest_vm/node_environment.js") install();
        return value;
    };
    global.arguments = ["--vm-native", "--snapshot", args[0]];
    global.load("guest_runner.js");
}(this, typeof arguments !== "undefined" ? arguments : []));
