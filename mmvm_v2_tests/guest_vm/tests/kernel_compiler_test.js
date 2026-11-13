(function (root) {
    function runKernelCompilerTest(Compiler, JSBackend, X86Backend, Heap) {
        function arithmeticKernel(left, right) {
            return (((left + right) * 3) ^ (left - right)) | 0;
        }
        var compiler = new Compiler();
        /* Compare normal JavaScript with both backends, rather than asserting
         * a particular private IR shape for the loop implementation. */
        var ChecksumLayout = {COLUMNS: 3, FINAL_ROWS: 2};
        function loopChecksum(rows) {
            var CHECKSUM = 0;
            for (var row = 0; row < rows; row++) {
                for (var column = ChecksumLayout.COLUMNS; column > 0; --column) {
                    CHECKSUM = CHECKSUM + row * column;
                }
            }
            for (; row < rows + ChecksumLayout["FINAL_ROWS"]; row = row + 1);
            for (;;) {
                if (row >= rows + ChecksumLayout.FINAL_ROWS) return CHECKSUM + row;
                row++;
            }
        }
        var loopIR = compiler.compile(loopChecksum,
            {constantNamespaces: {ChecksumLayout: ChecksumLayout}});
        var loopJS = new JSBackend().compile(loopIR);
        var loopX86 = new X86Backend().compile(loopIR);
        var nativeStorageBackend = new X86Backend({captureBytes: false});
        var nativeStorageLoop = nativeStorageBackend.compile(loopIR);
        try {
            if (nativeStorageLoop.length !== loopX86.length ||
                    nativeStorageLoop.assembly !== loopX86.assembly ||
                    nativeStorageBackend.temporaryAssemblers.length !== 0) {
                throw new Error("assembler storage changed code layout or leaked storage");
            }
            if (nativeStorageLoop.pointer) {
                var byteIndex = 0;
                while (byteIndex < loopX86.length) {
                    if ((peek8(nativeStorageLoop.pointer + byteIndex) & 255) !==
                            loopX86.bytes[byteIndex++]) {
                        throw new Error("native assembler storage changed instruction bytes");
                    }
                }
            }
            var loopInputs = [-3, 0, 1, 8, 100];
            for (var loopIndex = 0; loopIndex < loopInputs.length; loopIndex++) {
                var rows = loopInputs[loopIndex];
                var expectedLoop = loopChecksum(rows);
                if (loopJS.fn(null, rows) !== expectedLoop ||
                    (loopX86.fn && loopX86.fn(rows) !== expectedLoop) ||
                    (nativeStorageLoop.fn && nativeStorageLoop.fn(rows) !== expectedLoop)) {
                    throw new Error("kernel for-loop checksum differs from JS");
                }
            }
        } finally {
            loopX86.destroy();
            nativeStorageLoop.destroy();
        }
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
                if (x86Result.callI32 && x86Result.callI32(left, right) !== expected) {
                    throw new Error("fixed-signature kernel binding differs from generic binding");
                }
                index++;
            }
            if (x86Result.fn) {
                if (x86Result.fn.apply(null, [false, true, null, undefined,
                        -1, 1.5, Infinity, NaN, 9]) !== arithmeticKernel(0, 1)) {
                    throw new Error("generic kernel binding changed primitive argument conversion");
                }
            }
            if (x86Result.assembly.indexOf("mov_eax_arg(0)") < 0 ||
                x86Result.assembly.indexOf("imul_eax_ecx()") < 0 ||
                x86Result.assembly.indexOf("ret()") < 0) {
                throw new Error("i386 backend did not use macro assembly");
            }
            function nativeCallKernel(pointer) {
                return callNativeI32(pointer);
            }
            var nativeCallIR = compiler.compile(nativeCallKernel);
            var nativeCallJS = new JSBackend().compile(nativeCallIR);
            var nativeCallBackend = new X86Backend();
            var nativeCallX86 = nativeCallBackend.compile(nativeCallIR);
            var nativeCallHeap = new Heap({heapBytes: 4096});
            try {
                nativeCallHeap.memory.setNativeCaller(function (pointer, args) {
                    if (pointer !== 1234 || args.length !== 0) {
                        throw new Error("JavaScript native-call ABI mismatch");
                    }
                    return 4321;
                });
                if (nativeCallJS.fn(nativeCallHeap.memory, 1234) !== 4321) {
                    throw new Error("JavaScript native-call result mismatch");
                }
                if (nativeCallX86.fn) {
                    var getpid = nativeCallBackend.ffi.resolve("getpid");
                    if (nativeCallX86.fn(getpid) <= 0) {
                        throw new Error("i386 native-call result mismatch");
                    }
                }
                if (nativeCallX86.assembly.indexOf(
                        "call_dword_ptr_esp(0)") < 0) {
                    throw new Error("native call bypassed macro assembly");
                }
            } finally {
                nativeCallHeap.destroy();
                nativeCallX86.destroy();
            }
            function nativeF64CallKernel(pointer, input, output) {
                storeF64(output, callNativeF64(pointer, input));
                return output;
            }
            var nativeF64IR = compiler.compile(nativeF64CallKernel);
            var nativeF64JS = new JSBackend().compile(nativeF64IR);
            var nativeF64Backend = new X86Backend();
            var nativeF64X86 = nativeF64Backend.compile(nativeF64IR);
            var nativeF64Heap = new Heap({heapBytes: 4096});
            try {
                nativeF64Heap.memory.setNativeF64Caller(
                    function (pointer, args) {
                        if (pointer !== 5678 || args.length !== 1 ||
                            args[0] !== 64) {
                            throw new Error("JavaScript binary64 native-call ABI mismatch");
                        }
                        return 12.5;
                    });
                nativeF64JS.fn(nativeF64Heap.memory, 5678, 64, 80);
                assertF64(nativeF64Heap.memory.readF64(80), 12.5,
                          "JavaScript binary64 native-call result");
                if (nativeF64X86.fn) {
                    var numberText = "-1234.5e-2";
                    var textIndex = 0;
                    while (textIndex < numberText.length) {
                        nativeF64Heap.memory.writeU8(
                            64 + textIndex, numberText.charCodeAt(textIndex));
                        textIndex++;
                    }
                    nativeF64Heap.memory.writeU8(64 + textIndex, 0);
                    var atof = nativeF64Backend.ffi.resolve("atof");
                    nativeF64X86.fn(atof,
                        nativeF64Heap.memory.nativeAddress(64),
                        nativeF64Heap.memory.nativeAddress(80));
                    assertF64(nativeF64Heap.memory.readF64(80), -12.345,
                              "i386 binary64 native-call result");
                }
                if (nativeF64X86.assembly.indexOf(
                        "call_dword_ptr_esp(4)") < 0) {
                    throw new Error("binary64 native call bypassed macro assembly");
                }
            } finally {
                nativeF64Heap.destroy();
                nativeF64X86.destroy();
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
            /* The same memory view must expose allocation-relative addresses
             * on both backends, including a nonzero view base. */
            function memoryAddressKernel(base, offset) { return base + offset; }
            var addressIR = compiler.compile(memoryAddressKernel);
            var addressJS = new JSBackend().compile(addressIR);
            var addressX86 = new X86Backend().compile(addressIR);
            var addressHeap = new Heap({heapBytes: 4096});
            try {
                if (addressJS.fn(addressHeap.memory, 64, 16) !== 80 ||
                        (addressX86.fn &&
                         (addressX86.callMemoryOffset(addressHeap.memory, 64, 16) !== 80 ||
                          addressX86.callMemoryI32(addressHeap.memory, 64, 16) !==
                              ((addressHeap.memory.nativeAddress(64) + 16) | 0)))) {
                    throw new Error("kernel memory result address contract differs across backends");
                }
            } finally { addressX86.destroy(); addressHeap.destroy(); }
            function rawMemoryKernel(byteAddress, wordAddress, byteValue,
                                     wordValue) {
                var result = 0;
                storeRaw8(byteAddress, byteValue);
                storeRaw32(wordAddress, wordValue);
                result = (loadRaw8(byteAddress) ^ loadRaw32(wordAddress)) | 0;
                return result;
            }
            var rawMemoryIR = compiler.compile(rawMemoryKernel);
            var rawMemoryJS = new JSBackend().compile(rawMemoryIR);
            var rawMemoryX86 = new X86Backend().compile(rawMemoryIR);
            var rawMemoryHeap = new Heap({heapBytes: 4096});
            try {
                var rawByteValue = 0xa5;
                var rawWordValue = 0x76543210;
                var rawExpected = (rawByteValue ^ rawWordValue) | 0;
                if (rawMemoryJS.fn(rawMemoryHeap.memory, 64, 68,
                                   rawByteValue, rawWordValue) !== rawExpected) {
                    throw new Error("JavaScript raw-memory kernel mismatch");
                }
                if (rawMemoryHeap.memory.readU8(64) !== rawByteValue ||
                    rawMemoryHeap.memory.readU32(68) !== rawWordValue) {
                    throw new Error("JavaScript raw-memory writes mismatch");
                }
                if (rawMemoryX86.fn &&
                    rawMemoryX86.fn(rawMemoryHeap.memory.nativeAddress(96),
                                    rawMemoryHeap.memory.nativeAddress(100),
                                    rawByteValue, rawWordValue) !== rawExpected) {
                    throw new Error("i386 raw-memory kernel mismatch");
                }
                if (rawMemoryX86.assembly.indexOf("mov_byte_ptr_ecx_al()") < 0 ||
                    rawMemoryX86.assembly.indexOf("mov_dword_ptr_ecx_eax()") < 0) {
                    throw new Error("i386 raw memory bypassed macro assembly");
                }
            } finally {
                rawMemoryHeap.destroy();
                rawMemoryX86.destroy();
            }
            /* Exercise float32 storage through the shared pipeline, including
             * IEEE ties-to-even, subnormals, signed zero and overflow. */
            function binary32Kernel(base, input, output) {
                storeRawF32(base + output, loadF64(base + input));
                storeF64(base + output + 8, loadRawF32(base + output));
                return output;
            }
            var f32IR = compiler.compile(binary32Kernel);
            var f32JS = new JSBackend().compile(f32IR);
            var f32X86 = new X86Backend().compile(f32IR);
            var f32Heap = new Heap({heapBytes: 4096});
            try {
                var f32Inputs = [[0, 0], [-0, 0x80000000], [1, 0x3f800000],
                    [1 + Math.pow(2, -24), 0x3f800000],
                    [1 + 3 * Math.pow(2, -24), 0x3f800002],
                    [Math.pow(2, -150), 0], [3 * Math.pow(2, -150), 2],
                    [Math.pow(2, 128), 0x7f800000],
                    [Number.MAX_VALUE, 0x7f800000], [-Number.MAX_VALUE, 0xff800000]];
                for (var f32Index = 0; f32Index < f32Inputs.length; f32Index++) {
                    f32Heap.memory.writeF64(64, f32Inputs[f32Index][0]);
                    var f32Expected = f32Inputs[f32Index][1] | 0;
                    f32JS.fn(f32Heap.memory, 0, 64, 80);
                    if ((f32Heap.memory.readU32(80) | 0) !== f32Expected) {
                        throw new Error("JS float32 roundtrip bits mismatch");
                    }
                    var f32Decoded = f32Heap.memory.readF64(88);
                    if (f32X86.fn) {
                        f32X86.fn(f32Heap.memory.nativeAddress(0), 64, 80);
                        if ((f32Heap.memory.readU32(80) | 0) !== f32Expected ||
                                f32Heap.memory.readF64(88) !== f32Decoded ||
                                (f32Decoded === 0 && 1 / f32Heap.memory.readF64(88) !== 1 / f32Decoded)) {
                            throw new Error("i386 float32 roundtrip differs from JS");
                        }
                    }
                }
            } finally {
                f32Heap.destroy();
                f32X86.destroy();
            }
            function binary64Kernel(base, left, right, output) {
                storeF64(base + output,
                    divideF64(multiplyF64(
                        addF64(loadF64(base + left), loadF64(base + right)),
                        subtractF64(loadF64(base + left), loadF64(base + right))),
                        loadF64(base + right)));
                return output;
            }
            /* Catalogs contain only declared intrinsics, not inherited object
             * methods. Check both front ends reject an unsupported name before
             * returning malformed IR; no backend/code-shape assertion needed. */
            function inheritedFloatOperation(base) {
                storeF64(base, toString(loadF64(base), loadF64(base)));
                return 0;
            }
            var floatFrontends = [null, {constantBindings: {}}];
            for (var frontendIndex = 0; frontendIndex < floatFrontends.length;
                    frontendIndex++) {
                var rejectedInheritedFloat = false;
                try {
                    compiler.compile(inheritedFloatOperation,
                        floatFrontends[frontendIndex]);
                } catch (intrinsicError) {
                    rejectedInheritedFloat = intrinsicError instanceof SyntaxError;
                }
                if (!rejectedInheritedFloat) {
                    throw new Error("inherited method accepted as a float intrinsic");
                }
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
                function toInt32Kernel(base, address) {
                    var coerced = toInt32F64(loadF64(base + address));
                    return coerced;
                }
                var toInt32IR = compiler.compile(toInt32Kernel);
                var toInt32JS = new JSBackend().compile(toInt32IR);
                var toInt32X86 = new X86Backend().compile(toInt32IR);
                try {
                    var coercionInputs = [12.9, -12.9, 4294967297,
                                          -4294967297, NaN, Infinity];
                    var coercionIndex = 0;
                    while (coercionIndex < coercionInputs.length) {
                        var coercionValue = coercionInputs[coercionIndex++];
                        var coercionExpected = coercionValue | 0;
                        f64Heap.memory.writeF64(96, coercionValue);
                        if (toInt32JS.fn(f64Heap.memory, 0, 96) !==
                            coercionExpected) {
                            throw new Error("JavaScript ToInt32 kernel mismatch");
                        }
                        if (toInt32X86.fn &&
                            toInt32X86.fn(f64Heap.memory.nativeAddress(0), 96) !==
                            coercionExpected) {
                            throw new Error("i386 ToInt32 kernel mismatch for " +
                                            coercionValue);
                        }
                    }
                    if (toInt32X86.assembly.indexOf("fnstcw_stack(0)") < 0 ||
                        toInt32X86.assembly.indexOf("fistp_i64_stack(4)") < 0) {
                        throw new Error("i386 ToInt32 bypassed macro assembly");
                    }
                } finally {
                    toInt32X86.destroy();
                }
                function toNativeI32Kernel(base, address) {
                    return toNativeI32F64(loadF64(base + address));
                }
                var toNativeI32IR = compiler.compile(toNativeI32Kernel);
                var toNativeI32JS = new JSBackend().compile(toNativeI32IR);
                var toNativeI32X86 = new X86Backend().compile(toNativeI32IR);
                try {
                    /* This is the signed i386 conversion used by js_min's
                     * raw-memory boundary, not ECMAScript ToInt32. */
                    var nativeCoercionInputs = [1.9, -1.9, 2147483647,
                        2147483648, 3666283700, -2147483649, NaN, Infinity];
                    var nativeCoercionExpected = [1, -1, 2147483647,
                        -2147483648, -2147483648, -2147483648,
                        -2147483648, -2147483648];
                    var nativeCoercionIndex = 0;
                    while (nativeCoercionIndex < nativeCoercionInputs.length) {
                        f64Heap.memory.writeF64(
                            96, nativeCoercionInputs[nativeCoercionIndex]);
                        if (toNativeI32JS.fn(f64Heap.memory, 0, 96) !==
                            nativeCoercionExpected[nativeCoercionIndex]) {
                            throw new Error("JavaScript native-I32 conversion mismatch");
                        }
                        if (toNativeI32X86.fn &&
                            toNativeI32X86.fn(
                                f64Heap.memory.nativeAddress(0), 96) !==
                            nativeCoercionExpected[nativeCoercionIndex]) {
                            throw new Error("i386 native-I32 conversion mismatch");
                        }
                        nativeCoercionIndex++;
                    }
                    if (toNativeI32X86.assembly.indexOf(
                            "fistp_i32_stack(4)") < 0) {
                        throw new Error("i386 native-I32 conversion bypassed macro assembly");
                    }
                } finally {
                    toNativeI32X86.destroy();
                }
            } finally {
                f64Heap.destroy();
                f64X86.destroy();
            }
            function namedConstantKernel(value) {
                var WORD_BYTES = 4;
                var PREVIOUS_WORD = -1;
                WORD_BYTES = WORD_BYTES + 1;
                return value * WORD_BYTES + PREVIOUS_WORD;
            }
            var namedConstantIR = compiler.compile(namedConstantKernel,
                {constantBindings: {WORD_BYTES: 99, PREVIOUS_WORD: 99}});
            var namedConstantJS = new JSBackend().compile(namedConstantIR);
            var namedConstantX86 = new X86Backend().compile(namedConstantIR);
            try {
                /* Observable mutation/shadowing matters, not whether a
                 * later data-flow pass can eliminate these local slots. */
                if (namedConstantJS.fn(null, 3) !== 14 ||
                    (namedConstantX86.fn && namedConstantX86.fn(3) !== 14)) {
                    throw new Error("uppercase locals did not mutate/shadow external bindings");
                }
                var rejectedConstantAssignment = false;
                try {
                    compiler.compile(function () {
                        IMMUTABLE_WORDS = 8;
                        return IMMUTABLE_WORDS;
                    }, {constantBindings: {IMMUTABLE_WORDS: 4}});
                } catch (constantError) {
                    rejectedConstantAssignment =
                        String(constantError).indexOf(
                            "kernel constant cannot be assigned") >= 0;
                }
                if (!rejectedConstantAssignment) {
                    throw new Error("kernel compiler allowed constant assignment");
                }
            } finally {
                namedConstantX86.destroy();
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
                    (dispatchX86.assembly.indexOf(
                        "mov_eax_dword_ptr_eax()") < 0 &&
                     dispatchX86.assembly.indexOf(
                        "mov_eax_ptr_ebx_plus_eax(") < 0 &&
                     dispatchX86.assembly.indexOf(
                        "mov_eax_ptr_esi_plus_eax(") < 0 &&
                     dispatchX86.assembly.indexOf(
                        "mov_eax_ptr_edi_plus_eax(") < 0 &&
                     dispatchX86.assembly.indexOf("mov_eax_ptr_scaled(") < 0)) {
                    throw new Error("control-flow backend bypassed macro assembly");
                }
            } finally {
                dispatchHeap.destroy();
                dispatchX86.destroy();
            }
            var VECTOR_CELLS = 24;
            var VALUE_CELL_BYTES = 16;
            var GraphLayout = {BIAS: 1};
            var LOCAL_WEIGHT = 2;
            function graphEntry(base, address, value, fourth, fifth) {
                var LOCAL_WEIGHT = 1;
                LOCAL_WEIGHT = LOCAL_WEIGHT - 1;
                var carried = fourth + value + LOCAL_WEIGHT;
                graphSink(base, address, value);
                return graphMiddle(base, address, value, carried, fifth) + GraphLayout.BIAS;
            }
            function graphSink(base, address, value) {
                store32(vectorCellAddress(base, address, 2), value);
                return 0;
            }
            function graphMiddle(base, address, value, fourth, fifth) {
                var LOCAL_WEIGHT = 3;
                return graphLeaf(base, address, value * LOCAL_WEIGHT, fourth, fifth);
            }
            function graphLeaf(base, address, value, fourth, fifth) {
                /* This member sees the external weight, not either caller's
                 * same-named local. Bookkeeping names are ordinary source
                 * identifiers too, not reserved kernel-language locals. */
                var kernelFunctions = LOCAL_WEIGHT;
                var kernelFunctionName = kernelFunctions;
                var result = value + fourth + fifth + kernelFunctionName;
                store32(vectorCellAddress(base, address, 1), result);
                return result;
            }
            var preparedGraphSource = compiler.prepareSource(
                graphEntry.toString() + "\n" + graphMiddle.toString() + "\n" +
                graphLeaf.toString() + "\n" + graphSink.toString());
            /* Only explicit external bindings join the graph environment.
             * A name cannot denote both a scalar and a namespace there. */
            var rejectedGraphBinding = false;
            try {
                compiler.compileGraph(graphMiddle, {graphLeaf: graphLeaf}, {
                    constantBindings: {LOCAL_WEIGHT: 3},
                    constantNamespaces: {LOCAL_WEIGHT: {VALUE: 3}}
                });
            } catch (graphBindingError) {
                rejectedGraphBinding = String(graphBindingError).indexOf(
                    "both scalar and namespace: LOCAL_WEIGHT") >= 0;
            }
            if (!rejectedGraphBinding) {
                throw new Error("merged graph binding conflict was not rejected");
            }
            var graphIR = compiler.compileGraph(graphEntry, {
                graphMiddle: graphMiddle,
                graphLeaf: graphLeaf,
                graphSink: graphSink
            }, {preparedSource: preparedGraphSource,
                constantNamespaces: {GraphLayout: GraphLayout}, constantBindings: {
                VECTOR_CELLS: VECTOR_CELLS,
                VALUE_CELL_BYTES: VALUE_CELL_BYTES,
                LOCAL_WEIGHT: LOCAL_WEIGHT
            }});
            var graphJS = new JSBackend().compile(graphIR);
            var graphX86 = new X86Backend().compile(graphIR);
            var graphHeap = new Heap({heapBytes: 4096});
            try {
                if (graphJS.fn(graphHeap.memory, 0, 64, 7, 11, 13) !== 55 ||
                    graphHeap.memory.readU32(104) !== 54 ||
                    graphHeap.memory.readU32(120) !== 7) {
                    throw new Error("JavaScript kernel function graph mismatch");
                }
                graphHeap.memory.writeU32(104, 0);
                if (graphX86.fn &&
                    (graphX86.fn(graphHeap.memory.nativeAddress(0), 64, 9,
                                 11, 13) !== 63 ||
                     graphHeap.memory.readU32(104) !== 62 ||
                     graphHeap.memory.readU32(120) !== 9)) {
                    throw new Error("i386 kernel function graph mismatch");
                }
                /* Calls may be inlined or tail-jumped. Check behavior above,
                 * not a particular choice of call lowering. The dump must
                 * still expose the graph's named native entry point. */
                if (graphX86.assembly.indexOf("kernel_function_graphEntry") < 0) {
                    throw new Error("kernel graph macro dump lost its entry point");
                }
                if (graphX86.fn) {
                    var retainedEntry = graphX86.fn, retainedTypedEntry = graphX86.callI32;
                    graphX86.destroy();
                    var refusedGeneric = false, refusedTyped = false;
                    try { retainedEntry(0, 0, 0, 0); }
                    catch (entryError) { refusedGeneric = entryError.message === "kernel executable is destroyed"; }
                    try { retainedTypedEntry(0, 0, 0, 0); }
                    catch (typedError) { refusedTyped = typedError.message === "kernel executable is destroyed"; }
                    if (!refusedGeneric || !refusedTyped) throw new Error("destroyed kernel binding remained callable");
                }
            } finally {
                graphHeap.destroy();
                graphX86.destroy();
            }
            /* The same graph must preserve observable effects without the
             * optimizing policy; exercise calls/locals through both backends. */
            var unoptimizedGraph = compiler.compileGraph(graphEntry,
                {graphMiddle: graphMiddle, graphLeaf: graphLeaf, graphSink: graphSink},
                {optimization: "none", constantNamespaces: {GraphLayout: GraphLayout},
                    constantBindings: {VECTOR_CELLS: VECTOR_CELLS,
                        VALUE_CELL_BYTES: VALUE_CELL_BYTES, LOCAL_WEIGHT: LOCAL_WEIGHT}});
            var unoptimizedJS = new JSBackend().compile(unoptimizedGraph);
            var unoptimizedX86 = new X86Backend().compile(unoptimizedGraph);
            var unoptimizedHeap = new Heap({heapBytes: 4096});
            try {
                unoptimizedHeap.memory.writeU32(64, 0);
                var unoptimizedExpected = graphJS.fn(unoptimizedHeap.memory,
                    0, 64, 9, 11, 13);
                unoptimizedHeap.memory.writeU32(64, 0);
                if (unoptimizedJS.fn(unoptimizedHeap.memory, 0, 64, 9, 11, 13) !== unoptimizedExpected) {
                    throw new Error("unoptimized JS graph differs");
                }
                unoptimizedHeap.memory.writeU32(64, 0);
                if (unoptimizedX86.fn && unoptimizedX86.fn(
                        unoptimizedHeap.memory.nativeAddress(0), 64, 9, 11, 13) !== unoptimizedExpected) {
                    throw new Error("unoptimized native graph differs");
                }
            } finally {
                unoptimizedX86.destroy(); unoptimizedHeap.destroy();
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
