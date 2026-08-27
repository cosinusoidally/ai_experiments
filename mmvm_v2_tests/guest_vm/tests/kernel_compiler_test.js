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
            function binary64Kernel(base, left, right, output) {
                storeF64(base + output,
                    divideF64(multiplyF64(
                        addF64(loadF64(base + left), loadF64(base + right)),
                        subtractF64(loadF64(base + left), loadF64(base + right))),
                        loadF64(base + right)));
                return output;
            }
            var f64IR = compiler.compile(binary64Kernel);
            var f64JS = new JSBackend().compile(f64IR);
            var f64X86 = new X86Backend().compile(f64IR);
            var f64Heap = new Heap({heapBytes: 4096});
            try {
                var f64Inputs = [[7.25, 2.5], [-11.75, 0.125],
                                 [1.0e100, -3.0e99]];
                var f64Index = 0;
                while (f64Index < f64Inputs.length) {
                    var f64Left = f64Inputs[f64Index][0];
                    var f64Right = f64Inputs[f64Index][1];
                    var f64Expected = ((f64Left + f64Right) *
                                      (f64Left - f64Right)) / f64Right;
                    f64Heap.memory.writeF64(64, f64Left);
                    f64Heap.memory.writeF64(72, f64Right);
                    f64JS.fn(f64Heap.memory, 0, 64, 72, 80);
                    assertF64(f64Heap.memory.readF64(80), f64Expected,
                              "JavaScript binary64 kernel");
                    if (f64X86.fn) {
                        f64X86.fn(f64Heap.memory.nativeAddress(0), 64, 72, 88);
                        assertF64(f64Heap.memory.readF64(88), f64Expected,
                                  "i386 binary64 kernel");
                    }
                    f64Index++;
                }
                if (f64X86.assembly.indexOf("fld_f64_ptr_eax()") < 0 ||
                    f64X86.assembly.indexOf("fstp_f64_ptr_ecx()") < 0) {
                    throw new Error("i386 binary64 backend did not use x87 macros");
                }
            } finally {
                f64Heap.destroy();
                f64X86.destroy();
            }
            function dispatchKernel(base, state, budget) {
                var pc = load32(base + state);
                var sum = 0;
                while (budget > 0) {
                    var value = load32(base + state + 4 + pc * 4);
                    if (value === 0) {
                        store32(base + state, pc);
                        return sum;
                    } else {
                        sum = sum + value;
                    }
                    pc = pc + 1;
                    budget = budget - 1;
                }
                store32(base + state, pc);
                return sum;
            }
            var dispatchIR = compiler.compile(dispatchKernel);
            var dispatchJS = new JSBackend().compile(dispatchIR);
            var dispatchX86 = new X86Backend().compile(dispatchIR);
            var dispatchHeap = new Heap({heapBytes: 4096});
            try {
                dispatchHeap.memory.writeU32(64, 0);
                dispatchHeap.memory.writeU32(68, 7);
                dispatchHeap.memory.writeU32(72, 11);
                dispatchHeap.memory.writeU32(76, 0);
                if (dispatchJS.fn(dispatchHeap.memory, 0, 64, 8) !== 18 ||
                    dispatchHeap.memory.readU32(64) !== 2) {
                    throw new Error("JavaScript control-flow kernel mismatch");
                }
                dispatchHeap.memory.writeU32(64, 0);
                if (dispatchX86.fn &&
                    (dispatchX86.fn(dispatchHeap.memory.nativeAddress(0), 64, 8) !== 18 ||
                     dispatchHeap.memory.readU32(64) !== 2)) {
                    throw new Error("i386 control-flow kernel mismatch");
                }
                if (dispatchX86.assembly.indexOf("kernel_loop_") < 0 ||
                    dispatchX86.assembly.indexOf("mov_eax_dword_ptr_eax()") < 0) {
                    throw new Error("control-flow backend bypassed macro assembly");
                }
            } finally {
                dispatchHeap.destroy();
                dispatchX86.destroy();
            }
            return "shared kernel IR passed on JS" +
                   (x86Result.fn ? " and native i386" :
                    "; i386 macro output validated");
        } finally {
            x86Result.destroy();
        }
    }

    function assertF64(actual, expected, label) {
        var scale = Math.abs(expected);
        var error = Math.abs(actual - expected);
        if (actual !== expected && error > (scale || 1) * 1e-12) {
            throw new Error(label + " mismatch: expected " + expected +
                            ", got " + actual);
        }
    }

    root.GuestVMRunKernelCompilerTest = runKernelCompilerTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runKernelCompilerTest;
    }
}(this));
