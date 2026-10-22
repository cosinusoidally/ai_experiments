/* Inspect a from-source kernel build on either bootstrap host. Redirect
 * stdout to an ignored artifact when comparing builds. This reports logical
 * function/local names, not just opaque differences in machine-code bytes.
 *
 * js_min.exe guest_vm/tools/inspect_kernel_build.js [function-name]
 * js_runner.exe artifacts/snap guest_vm/tools/inspect_kernel_build.js [function-name]
 * node guest_vm/tools/inspect_kernel_build.js [function-name]
 */
(function (shellArguments) {
    var nodeHost = typeof module !== "undefined" && module.exports;
    var VM, Intrinsics, args, report;
    if (nodeHost) {
        VM = require("../vm.js");
        Intrinsics = require("../native_intrinsics.js");
        args = process.argv.slice(2);
        report = function (line) { console.log(line); };
    } else {
        /* Inspect current source, not the implementation embedded in a seed. */
        GuestVM = undefined;
        load("guest_vm/guest_vm.js");
        VM = GuestVM;
        Intrinsics = GuestVMNativeIntrinsics;
        args = shellArguments;
        report = print;
    }
    if (args[0] === "--numbers") {
        var conversion = nodeHost ? require("../binary64.js") : GuestVMBinary64;
        var samples = [1.7976931348623157e308, 5e-324, 16777619,
                       -2128831035 * 16777619];
        var sampleIndex = 0;
        while (sampleIndex < samples.length) {
            var sample = samples[sampleIndex++];
            var bits = conversion.encode(sample);
            report(sample + " low=" + bits.low + " high=" + bits.high);
        }
        report("pow(2,1023)=" + Math.pow(2, 1023));
        var compilerClass = nodeHost ? require("../aot/kernel_compiler.js") :
            GuestVMKernelCompiler;
        report("fingerprint=" + new compilerClass().sourceFingerprint(
            "function sample(a) { return a + 1; }"));
        return;
    }
    var builtinsOnly = args[0] === "--builtins";
    var vm = new VM({nativeInterpreter: !builtinsOnly, retainNativeBuildIR: true});
    try {
        if (builtinsOnly) {
            var metadata = vm.runtime.functionMetadata;
            var key;
            for (key in metadata) {
                var callable = metadata[key];
                if (callable.nativeIntrinsic >= Intrinsics.UINT8_ARRAY_CONSTRUCTOR &&
                    callable.nativeIntrinsic <= Intrinsics.INT16_ARRAY_CONSTRUCTOR) {
                    var viewPrototype = vm.runtime.getProperty(callable, "prototype");
                    report(callable.name + " constructor=" + callable.heapAddress +
                        " prototype=" + viewPrototype.heapAddress +
                        " constructor owns element size=" + vm.runtime.hasOwnProperty(
                            callable, "BYTES_PER_ELEMENT") +
                        " prototype owns element size=" + vm.runtime.hasOwnProperty(
                            viewPrototype, "BYTES_PER_ELEMENT"));
                }
            }
            return;
        }
        var engine = vm.runtime.nativeInterpreter;
        if (args[0] === "--inlining") {
            var inlining = engine.ir.inlining;
            report("inlined call sites: " + inlining.callSites);
            var candidateIndex = 0;
            while (candidateIndex < inlining.eligibleFunctions.length) {
                var candidate = inlining.eligibleFunctions[candidateIndex++];
                report(candidate.name + ": " + candidate.nodes + " IR nodes");
            }
            return;
        }
        var functions = engine.ir.functions;
        var labels = engine.nativeResult.symbols;
        var index = 0;
        while (index < functions.length) {
            var fn = functions[index++];
            if (args[0] === "--fingerprints") {
                var fingerprintCompiler = nodeHost ?
                    require("../aot/kernel_compiler.js") : GuestVMKernelCompiler;
                report(fn.name + " " + new fingerprintCompiler().sourceFingerprint(fn.source));
                continue;
            }
            if (args.length && fn.name !== args[0]) continue;
            report(fn.name + " @" + labels["kernel_function_" + fn.name] +
                " args=" + fn.parameters.join(",") +
                " locals=" + fn.locals.join(","));
            if (args.length) report(fn.source);
        }
    } finally {
        vm.destroy();
    }
}(typeof arguments !== "undefined" ? arguments : []));
