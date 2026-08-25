(function (root) {
    function runKernelCompilerTest(Compiler, JSBackend, X86Backend, Heap) {
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
                if (jsResult.fn(null, left, right) !== expected) {
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
            function recordInitializer(base, address, type, size,
                                       word0, word1, word2, word3) {
                store32(base + address, type);
                store32(base + address + 4, size);
                store32(base + address + 16, word0);
                store32(base + address + 20, word1);
                store32(base + address + 24, word2);
                store32(base + address + 28, word3);
                return address;
            }
            var recordIR = compiler.compile(recordInitializer);
            var recordJS = new JSBackend().compile(recordIR);
            var recordX86 = new X86Backend().compile(recordIR);
            var heap = new Heap({heapBytes: 4096});
            try {
                recordJS.fn(heap.memory, 0, 64, 1, 32, 10, 20, 30, 40);
                if (heap.memory.readU32(64) !== 1 ||
                    heap.memory.readU32(88) !== 30) {
                    throw new Error("JavaScript record initializer mismatch");
                }
                if (recordX86.fn) {
                    recordX86.fn(heap.memory.nativeAddress(0), 128, 2, 32,
                                 11, 21, 31, 41);
                    if (heap.memory.readU32(128) !== 2 ||
                        heap.memory.readU32(156) !== 41) {
                        throw new Error("i386 record initializer mismatch");
                    }
                }
            } finally {
                heap.destroy();
                recordX86.destroy();
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
