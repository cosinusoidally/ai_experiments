/* End-to-end snapshot/backing ownership check, not a language micro-test.
 * From mmvm_v2_tests:
 *   js_min.exe guest_vm/tools/check_buffer_snapshot.js --vm-native --snapshot artifacts/buffers.snap
 *   js_runner.exe artifacts/buffers.snap guest_vm/tools/check_buffer_snapshot.js --verify
 * Build arguments are the ordinary guest_runner arguments. Node also works as
 * a build host (inline emulated storage); js_min tests native external storage.
 * No application sources or external fixtures are modified. */
(function (root, shellArguments) {
    var node = typeof module !== "undefined" && module.exports;
    var args = node ? process.argv.slice(2) : shellArguments;
    var length = 2 * 1024 * 1024 + 3, middle = 1024 * 1024 + 1;
    if (args[0] === "--verify") {
        function verify() {
            var bytes = root.__bufferSnapshotFixture;
            if (!bytes || bytes.length !== length || bytes[0] !== 19 ||
                    bytes[middle] !== 128 || bytes[length - 1] !== 37 ||
                    bytes[1] !== 0 || bytes[middle - 1] !== 0) {
                throw new Error("snapshot lost large backing bytes or view lifetime");
            }
        }
        verify();
        /* Existing bounded workload forces collections while the loaded
         * backing remains reachable. It also replaces and releases backings. */
        load("guest_vm/tests/gc_stress_workload.js");
        verify();
        var alias = root.__bufferSnapshotFixture.slice(middle, middle + 2);
        alias[1] = 93;
        if (root.__bufferSnapshotFixture[middle + 1] !== 93) {
            throw new Error("snapshot backing alias was copied instead of shared");
        }
        print("large buffer snapshot reload/GC/aliasing passed");
        return;
    }
    var snapshotRequested = false;
    for (var option = 0; option < args.length; option++) {
        if (args[option] === "--snapshot") snapshotRequested = true;
    }
    if (!snapshotRequested) throw new Error("expected ordinary --vm-native --snapshot OUTPUT arguments");
    var Backend;
    if (node) Backend = require("../aot/backend_x86.js");
    else { load("guest_vm/guest_vm.js"); Backend = root.GuestVMKernelX86Backend; }
    var write = Backend.prototype.writeStandaloneSnapshot;
    Backend.prototype.writeStandaloneSnapshot = function (
            path, result, runtime, execution, programPath, metadata, options) {
        var bytes = runtime.bufferSupport.allocate(length);
        var token = runtime.retain(bytes);
        try {
            runtime.bufferSupport.write(bytes, 0, 19);
            runtime.bufferSupport.write(bytes, middle, 128);
            runtime.bufferSupport.write(bytes, length - 1, 37);
            runtime.setGlobal(execution.frames[0].context, "__bufferSnapshotFixture", bytes);
        } finally { runtime.release(token); }
        return write.call(this, path, result, runtime, execution, programPath, metadata, options);
    };
    try {
        if (node) require("../../guest_runner.js");
        else load("guest_runner.js");
    } finally { Backend.prototype.writeStandaloneSnapshot = write; }
}(this, typeof arguments === "undefined" ? [] : arguments));
