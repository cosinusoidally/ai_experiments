(function (root) {
    function runKernelCompilerTest(Compiler, JSBackend, X86Backend) {
        function arithmeticKernel(left, right) {
            return (((left + right) * 3) ^ (left - right)) | 0;
        }
        var compiler = new Compiler();
        var ir = compiler.compile(arithmeticKernel);
        var jsResult = new JSBackend().compile(ir);
        var x86Result = new X86Backend().compile(ir);
        try {
            var inputs = [[0, 0], [1, 2], [-7, 11], [12345, -9876],
                          [2147483647, 17]];
            var index = 0;
            while (index < inputs.length) {
                var left = inputs[index][0];
                var right = inputs[index][1];
                var expected = arithmeticKernel(left, right);
                if (jsResult.fn(left, right) !== expected) {
                    throw new Error("JavaScript kernel backend mismatch");
                }
                if (x86Result.fn && x86Result.fn(left, right) !== expected) {
                    throw new Error("i386 kernel backend mismatch");
                }
                index++;
            }
            if (x86Result.assembly.indexOf("mov_eax_arg(0)") < 0 ||
                x86Result.assembly.indexOf("imul_eax_ecx()") < 0 ||
                x86Result.assembly.indexOf("ret()") < 0) {
                throw new Error("i386 backend did not use macro assembly");
            }
            return "shared kernel IR passed on JS" +
                   (x86Result.fn ? " and native i386" :
                    "; i386 macro output validated");
        } finally {
            x86Result.destroy();
        }
    }

    root.GuestVMRunKernelCompilerTest = runKernelCompilerTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runKernelCompilerTest;
    }
}(this));
