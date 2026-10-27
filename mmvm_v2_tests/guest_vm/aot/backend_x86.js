/* i386 backend for shared kernel IR. It emits only macro-assembler calls and
 * optionally installs the result in executable memory on an MMVM host. */
(function (root) {
    var WORD_BYTES = 4;
    var Assembler = root.GuestVMX86Assembler;
    var HostFFI = root.GuestVMHostFFI;
    var SnapshotOutput = root.GuestVMSnapshotOutput;
    if (typeof module !== "undefined" && module.exports) {
        Assembler = require("./x86_assembler.js");
        HostFFI = require("../host_ffi.js");
        SnapshotOutput = require("./snapshot_output.js");
    }

    function X86Backend(options) {
        options = options || {};
        this.captureAssembly = options.captureAssembly !== false;
        this.captureBytes = options.captureBytes !== false;
        this.temporaryAssemblers = [];
        this.registerCount = options.registerCount || 3;
        if (this.registerCount !== 3 && this.registerCount !== 4) {
            throw new Error("x86 kernel register count must be 3 or 4");
        }
        /* Indexed dispatch is an explicit experiment, not the default: the
         * measured comparison tree is faster on the current interpreter. */
        this.dispatchStrategy = options.dispatchStrategy || "balanced";
        if (this.dispatchStrategy !== "balanced" &&
            this.dispatchStrategy !== "indexed" &&
            this.dispatchStrategy !== "replicated") {
            throw new Error("unknown x86 dispatch strategy: " + this.dispatchStrategy);
        }
        this.timings = options.timings || null;
        this.ffi = new HostFFI();
        this.mmap = this.ffi.isMMVM ? this.ffi.resolve("mmap") : 0;
        this.munmap = this.ffi.isMMVM ? this.ffi.resolve("munmap") : 0;
    }

    X86Backend.prototype.compile = function (ir) {
        var firstTemporary = this.temporaryAssemblers.length;
        try {
            return compileKernel.call(this, ir);
        } finally {
            while (this.temporaryAssemblers.length > firstTemporary) {
                this.temporaryAssemblers.pop().releaseStorage();
            }
        }
    };

    X86Backend.prototype.createAssembler = function () {
        var assembler = new Assembler(this.captureAssembly);
        if (this.ffi.isMMVM && !this.captureBytes) {
            assembler.useNativeStorage(this.ffi);
            this.temporaryAssemblers.push(assembler);
        }
        return assembler;
    };

    function compileKernel(ir) {
        if (ir.kernelGraph) return compileGraph(this, ir);
        if (ir.controlFlow) return compileControlFlow(this, ir);
        var assembler = this.createAssembler();
        var instructionIndex = 0;
        while (instructionIndex < ir.instructions.length) {
            var instruction = ir.instructions[instructionIndex++];
            if (instruction.op === "store_f64" || instruction.op === "store_raw_f32") {
                emitExpression(assembler, instruction.address);
                assembler.pushEax();
                emitF64Expression(assembler, instruction.value);
                assembler.popEcx();
                if (instruction.op === "store_f64") assembler.storeF64EcxPop();
                else assembler.storeF32EcxPop();
            } else if (instruction.op !== "store_u32") {
                throw new Error("unsupported i386 kernel instruction " + instruction.op);
            } else {
                emitExpression(assembler, instruction.address);
                assembler.pushEax();
                emitExpression(assembler, instruction.value);
                assembler.popEcx();
                assembler.movDwordPtrEcxEax();
            }
        }
        emitExpression(assembler, ir.expression);
        assembler.ret();
        assembler.resolveLabels();
        var result = {fn: null, pointer: 0, length: assembler.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      symbols: assembler.labels,
                      ir: ir, backend: "i386", destroy: function () {}};
        if (!this.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.length / 4096) * 4096);
        var pointer = this.ffi.call(this.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        copyAssemblerToNative(pointer, assembler);
        var ffi = this.ffi;
        var munmap = this.munmap;
        result.pointer = pointer;
        result.fn = function () {
            var args = [];
            var argumentIndex = 0;
            while (argumentIndex < arguments.length && argumentIndex < 8) {
                args[argumentIndex] = Number(arguments[argumentIndex]) | 0;
                argumentIndex++;
            }
            return ffi.call(pointer, args) | 0;
        };
        result.destroy = function () {
            if (!result.pointer) return;
            ffi.call(munmap, [result.pointer, allocationLength]);
            result.pointer = 0;
            result.fn = null;
        };
        installArgumentVectorBridge(this, result, ir.parameters.length);
        return result;
    }

    function emitControlFlowFunction(assembler, ir, functionIndex, dispatchStrategy,
                                     registerCount) {
        var prefix = "kernel_function_" + ir.name;
        var state = {nextLabel: (functionIndex + 1) * 1000000,
                     returnLabel: prefix + "_return",
                     functionReturnLabel: prefix + "_return",
                     parameterCount: ir.parameters.length,
                     registerMap: allocateKernelRegisters(ir, registerCount),
                     preserveEdx: registerCount === 4,
                     dispatchStrategy: dispatchStrategy};
        assembler.label(prefix);
        assembler.pushEbp();
        assembler.movEbpEsp();
        reserveKernelLocals(assembler, ir, state);
        saveKernelRegisters(assembler, state.preserveEdx);
        initializeKernelArgumentRegisters(assembler, state.registerMap);
        emitStatements(assembler, ir.body, state);
        assembler.movEaxImmediate(0);
        assembler.label(state.returnLabel);
        restoreKernelRegisters(assembler, state.preserveEdx);
        assembler.leave();
        assembler.ret();
        return state.registerMap;
    }

    function compileGraph(backend, graph) {
        var assembler = backend.createAssembler();
        var registerAllocations = {};
        var ordered = [];
        var index = 0;
        while (index < graph.functions.length) {
            if (graph.functions[index].name === graph.entry) {
                ordered.push(graph.functions[index]);
                break;
            }
            index++;
        }
        index = 0;
        while (index < graph.functions.length) {
            if (graph.functions[index].name !== graph.entry) {
                ordered.push(graph.functions[index]);
            }
            index++;
        }
        index = 0;
        while (index < ordered.length) {
            var ir = ordered[index];
            var registerMap = emitControlFlowFunction(assembler, ir, index,
                backend.dispatchStrategy, backend.registerCount);
            registerAllocations[ir.name] = describeRegisterAllocation(
                ir, registerMap);
            index++;
        }
        assembler.resolveLabels();
        var result = {fn: null, pointer: 0, length: assembler.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      symbols: assembler.labels,
                      ir: graph, backend: "i386",
                      registerAllocation: registerAllocations,
                      destroy: function () {}};
        if (!backend.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.length / 4096) * 4096);
        var pointer = backend.ffi.call(backend.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        copyAssemblerToNative(pointer, assembler);
        var ffi = backend.ffi;
        var munmap = backend.munmap;
        result.pointer = pointer;
        result.fn = function () {
            var args = [];
            var argumentIndex = 0;
            while (argumentIndex < arguments.length && argumentIndex < 8) {
                args[argumentIndex] = Number(arguments[argumentIndex]) | 0;
                argumentIndex++;
            }
            return ffi.call(pointer, args) | 0;
        };
        result.destroy = function () {
            if (!result.pointer) return;
            ffi.call(munmap, [result.pointer, allocationLength]);
            result.pointer = 0;
            result.fn = null;
        };
        installArgumentVectorBridge(backend, result,
                                    graph.functions[0].parameters.length);
        return result;
    }

    /* The shell FFI accepts eight words. Marshal larger kernel signatures
     * through a vector and a cdecl macro-assembler bridge. */
    function installArgumentVectorBridge(backend, result, arity) {
        if (arity <= 8) return;
        var assembler = backend.createAssembler();
        assembler.pushEbp();
        assembler.movEbpEsp();
        var index = arity;
        while (index > 0) {
            index--;
            assembler.movEaxEbpArgument(0);
            assembler.addEaxImmediate(index * 4);
            assembler.movEaxDwordPtrEax();
            assembler.pushEax();
        }
        assembler.movEaxImmediate(result.pointer);
        assembler.callEax();
        var discardedWord = 0;
        while (discardedWord < arity) {
            assembler.popEcx();
            discardedWord++;
        }
        assembler.leave();
        assembler.ret();
        var bridgeBytes = Math.max(4096,
            Math.ceil(assembler.length / 4096) * 4096);
        var ffi = backend.ffi;
        var bridge = ffi.call(backend.mmap,
            [0, bridgeBytes, 7, 0x22, -1, 0]);
        if (!bridge || bridge === -1) throw new Error("argument bridge mmap failed");
        copyAssemblerToNative(bridge, assembler);
        var calloc = ffi.resolve("calloc");
        var free = ffi.resolve("free");
        result.fn = function () {
            if (arguments.length !== arity) {
                throw new RangeError("kernel expects " + arity + " arguments");
            }
            var vector = ffi.call(calloc, [arity, 4]);
            if (!vector) throw new Error("argument vector allocation failed");
            try {
                var argumentIndex = 0;
                while (argumentIndex < arity) {
                    ffi.poke32(vector + argumentIndex * 4,
                        Number(arguments[argumentIndex]) | 0);
                    argumentIndex++;
                }
                return ffi.call(bridge, [vector]) | 0;
            } finally {
                ffi.call(free, [vector]);
            }
        };
        var destroyKernel = result.destroy;
        result.destroy = function () {
            if (bridge) {
                ffi.call(backend.munmap, [bridge, bridgeBytes]);
                bridge = 0;
            }
            destroyKernel();
        };
    }

    function compileControlFlow(backend, ir) {
        var timings = backend.timings;
        var started = timings ? new Date().getTime() : 0;
        var assembler = backend.createAssembler();
        var state = {nextLabel: 0, returnLabel: "kernel_return",
                     functionReturnLabel: "kernel_return",
                     parameterCount: ir.parameters.length,
                     registerMap: allocateKernelRegisters(ir, backend.registerCount),
                     preserveEdx: backend.registerCount === 4,
                     dispatchStrategy: backend.dispatchStrategy};
        if (timings) timings.analysis = new Date().getTime() - started;
        var emitStarted = timings ? new Date().getTime() : 0;
        assembler.pushEbp();
        assembler.movEbpEsp();
        reserveKernelLocals(assembler, ir, state);
        saveKernelRegisters(assembler, state.preserveEdx);
        initializeKernelArgumentRegisters(assembler, state.registerMap);
        emitStatements(assembler, ir.body, state);
        assembler.movEaxImmediate(0);
        assembler.label(state.returnLabel);
        restoreKernelRegisters(assembler, state.preserveEdx);
        assembler.leave();
        assembler.ret();
        if (timings) timings.emit = new Date().getTime() - emitStarted;
        var resolveStarted = timings ? new Date().getTime() : 0;
        assembler.resolveLabels();
        if (timings) timings.resolve = new Date().getTime() - resolveStarted;
        var result = {fn: null, pointer: 0, length: assembler.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      symbols: assembler.labels,
                      ir: ir, backend: "i386",
                      registerAllocation: describeRegisterAllocation(
                          ir, state.registerMap),
                      destroy: function () {}};
        if (!backend.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.length / 4096) * 4096);
        var pointer = backend.ffi.call(backend.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        var copyStarted = timings ? new Date().getTime() : 0;
        copyAssemblerToNative(pointer, assembler);
        if (timings) timings.install = new Date().getTime() - copyStarted;
        var ffi = backend.ffi;
        var munmap = backend.munmap;
        result.pointer = pointer;
        result.fn = function () {
            var args = [];
            var argumentIndex = 0;
            while (argumentIndex < arguments.length && argumentIndex < 8) {
                args[argumentIndex] = Number(arguments[argumentIndex]) | 0;
                argumentIndex++;
            }
            return ffi.call(pointer, args) | 0;
        };
        result.destroy = function () {
            if (!result.pointer) return;
            ffi.call(munmap, [result.pointer, allocationLength]);
            result.pointer = 0;
            result.fn = null;
        };
        installArgumentVectorBridge(backend, result, ir.parameters.length);
        return result;
    }

    /* MMVM's poke32 is explicitly little-endian.  Installing a large kernel
     * a byte at a time makes more than a million JS/C boundary calls for the
     * main interpreter; pack complete words and reserve poke8 for the tail. */
    function copyBytesToNative(pointer, bytes) {
        var index = 0;
        while (index + 4 <= bytes.length) {
            poke32(pointer + index,
                   bytes[index] |
                   (bytes[index + 1] << 8) |
                   (bytes[index + 2] << 16) |
                   (bytes[index + 3] << 24));
            index += 4;
        }
        while (index < bytes.length) {
            poke8(pointer + index, bytes[index]);
            index++;
        }
    }

    function copyAssemblerToNative(pointer, assembler) {
        if (assembler.storageFFI) {
            assembler.storageFFI.call(assembler.memcpyPointer,
                [pointer, assembler.nativePointer, assembler.length]);
        } else copyBytesToNative(pointer, assembler.bytes);
    }

    var SNAPSHOT_MAGIC = 0x31535647;
    var SNAPSHOT_FORMAT_VERSION = 1;
    var SNAPSHOT_HEADER_BYTES = 32;
    var SNAPSHOT_OPERAND_MODE_OFFSET = 24;
    var STANDALONE_OPERAND_MODE_OFFSET = 92;
    var STANDALONE_SNAPSHOT_MAGIC = 0x32535647;
    var STANDALONE_SNAPSHOT_VERSION = 2;
    var STANDALONE_HEADER_BYTES = 128;
    var STANDALONE_HEADER_FIELDS = {magic: 0, version: 4, fileLength: 8,
        entryOffset: 12, entryLength: 16, codeOffset: 20, codeLength: 24,
        heapOffset: 28, heapLength: 32, heapCapacity: 36, frameAddress: 40,
        contextAddress: 44, dlsymCellAddress: 48, compilerVersion: 80,
        profileMode: 84, sourceHash: 88};
    X86Backend.StandaloneHeaderFields = STANDALONE_HEADER_FIELDS;
    var STANDALONE_ENGINE_BUDGET = 2147483647;
    var ENGINE_EXIT_BUDGET = 1;
    var ENGINE_EXIT_RETURN = 2;
    var ENGINE_EXIT_UNSUPPORTED = 3;
    var ENGINE_EXIT_ALLOCATION = 4;

    X86Backend.prototype.loadExecutableSnapshot = function (path, expected) {
        if (!this.ffi.isMMVM) {
            throw new Error("native snapshots require the js_min.exe host");
        }
        var openPointer = this.ffi.resolve("open");
        var closePointer = this.ffi.resolve("close");
        var readPointer = this.ffi.resolve("read");
        var callocPointer = this.ffi.resolve("calloc");
        var freePointer = this.ffi.resolve("free");
        var descriptor = this.ffi.call(openPointer, [path, 0, 0]);
        if (descriptor < 0) {
            throw new Error("could not open native snapshot: " + path);
        }
        /* Version 2 extends the header for a complete standalone image. Read
         * the larger size up front, then seek explicitly to the code segment;
         * this remains compatible with version-1 code-only snapshots. */
        var headerBytes = STANDALONE_HEADER_BYTES;
        var header = this.ffi.call(callocPointer, [headerBytes, 1]);
        if (!header) {
            this.ffi.call(closePointer, [descriptor]);
            throw new Error("could not allocate native snapshot header");
        }
        if (!readExact(this.ffi, readPointer, descriptor, header,
                       headerBytes)) {
            this.ffi.call(freePointer, [header]);
            this.ffi.call(closePointer, [descriptor]);
            throw new Error("native snapshot header is truncated: " + path);
        }
        var magic = peek32(header) >>> 0;
        var formatVersion = peek32(header + 4) >>> 0;
        var standalone = formatVersion === 2;
        var compilerVersion = peek32(header + (standalone ? STANDALONE_HEADER_FIELDS.compilerVersion : 8)) >>> 0;
        var profileMode = peek32(header + (standalone ? 84 : 12)) >>> 0;
        var operandMode = peek32(header + (standalone ?
            STANDALONE_OPERAND_MODE_OFFSET : SNAPSHOT_OPERAND_MODE_OFFSET)) >>> 0;
        var codeOffset = standalone ? peek32(header + STANDALONE_HEADER_FIELDS.codeOffset) >>> 0 :
                                      SNAPSHOT_HEADER_BYTES;
        var length = peek32(header + (standalone ? STANDALONE_HEADER_FIELDS.codeLength : 20)) >>> 0;
        this.ffi.call(freePointer, [header]);
        if ((!standalone && magic !== SNAPSHOT_MAGIC) ||
            (standalone && magic !== STANDALONE_SNAPSHOT_MAGIC) ||
            (formatVersion !== SNAPSHOT_FORMAT_VERSION && !standalone) ||
            compilerVersion !== (expected.compilerVersion >>> 0) ||
            profileMode !== (expected.profileMode >>> 0) ||
            operandMode !== (expected.operandMode >>> 0) ||
            length <= 0 || length > 16 * 1024 * 1024) {
            this.ffi.call(closePointer, [descriptor]);
            throw new Error("native snapshot is incompatible with this VM: " +
                            path);
        }
        var lseekPointer = this.ffi.resolve("lseek");
        if (this.ffi.call(lseekPointer, [descriptor, codeOffset, 0]) !==
                codeOffset) {
            this.ffi.call(closePointer, [descriptor]);
            throw new Error("native snapshot code offset is invalid: " + path);
        }
        var pointer = this.ffi.call(this.mmap,
            [0, length, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) {
            this.ffi.call(closePointer, [descriptor]);
            throw new Error("could not map native snapshot code");
        }
        if (!readExact(this.ffi, readPointer, descriptor, pointer, length)) {
            this.ffi.call(this.munmap, [pointer, length]);
            this.ffi.call(closePointer, [descriptor]);
            throw new Error("native snapshot code is truncated: " + path);
        }
        this.ffi.call(closePointer, [descriptor]);
        var mprotectPointer = this.ffi.resolve("mprotect");
        if (this.ffi.call(mprotectPointer, [pointer, length, 5]) !== 0) {
            this.ffi.call(this.munmap, [pointer, length]);
            throw new Error("could not protect native snapshot code");
        }
        return executableResult(this.ffi, this.munmap, pointer, length,
                                "i386-snapshot");
    };

    X86Backend.prototype.writeExecutableSnapshot = function (path, result,
                                                              metadata) {
        if (!this.ffi.isMMVM || !result || !result.pointer ||
            result.length <= 0) return false;
        var openPointer = this.ffi.resolve("open");
        var closePointer = this.ffi.resolve("close");
        var writePointer = this.ffi.resolve("write");
        var renamePointer = this.ffi.resolve("rename");
        var unlinkPointer = this.ffi.resolve("unlink");
        var getpidPointer = this.ffi.resolve("getpid");
        var callocPointer = this.ffi.resolve("calloc");
        var freePointer = this.ffi.resolve("free");
        var temporaryPath = path + ".tmp." +
            this.ffi.call(getpidPointer, []);
        var descriptor = this.ffi.call(openPointer,
            [temporaryPath, 577, 384]);
        if (descriptor < 0) return false;
        var header = this.ffi.call(callocPointer, [SNAPSHOT_HEADER_BYTES, 1]);
        if (!header) {
            this.ffi.call(closePointer, [descriptor]);
            this.ffi.call(unlinkPointer, [temporaryPath]);
            return false;
        }
        poke32(header, SNAPSHOT_MAGIC);
        poke32(header + 4, SNAPSHOT_FORMAT_VERSION);
        poke32(header + 8, metadata.compilerVersion | 0);
        poke32(header + 12, metadata.profileMode | 0);
        poke32(header + 16, metadata.sourceHash | 0);
        poke32(header + SNAPSHOT_OPERAND_MODE_OFFSET, metadata.operandMode | 0);
        poke32(header + 20, result.length | 0);
        var complete = writeExact(this.ffi, writePointer, descriptor, header,
                                  SNAPSHOT_HEADER_BYTES) &&
                       writeExact(this.ffi, writePointer, descriptor,
                                  result.pointer, result.length);
        this.ffi.call(freePointer, [header]);
        this.ffi.call(closePointer, [descriptor]);
        if (!complete ||
            this.ffi.call(renamePointer, [temporaryPath, path]) !== 0) {
            this.ffi.call(unlinkPointer, [temporaryPath]);
            return false;
        }
        return true;
    };

    function alignStandalone(value, alignment) {
        return Math.ceil(value / alignment) * alignment;
    }

    function standaloneStringBytes(value) {
        var bytes = [];
        var index = 0;
        while (index < value.length) bytes.push(value.charCodeAt(index++) & 255);
        bytes.push(0);
        return bytes;
    }

    function buildStandaloneBootstrap(layout) {
        var assembler = new Assembler(true);
        var IMAGE_BASE_LOCAL = 0;
        var SYMBOL_POINTER_LOCAL = 1;
        var HEAP_BASE_LOCAL = 2;
        function imageAddress(offset) {
            assembler.movEaxLocal(IMAGE_BASE_LOCAL);
            assembler.addEaxImmediate(offset);
        }
        function discardCallWords(count) {
            while (count-- > 0) assembler.popEcx();
        }
        function resolveSymbol(nameOffset) {
            imageAddress(nameOffset);
            assembler.pushEax();
            assembler.movEaxImmediate(0);
            assembler.pushEax();
            assembler.movEaxEbpArgument(2);
            assembler.callEax();
            discardCallWords(2);
            assembler.testEaxEax();
            assembler.jumpEqual("standalone_runtime_error");
            assembler.movLocalEax(SYMBOL_POINTER_LOCAL);
        }
        function storeBindingPayload(payloadAddress, suppliedDlsym) {
            assembler.movEaxLocal(HEAP_BASE_LOCAL);
            assembler.addEaxImmediate(payloadAddress);
            assembler.movEcxEax();
            if (suppliedDlsym) assembler.movEaxEbpArgument(2);
            else assembler.movEaxLocal(SYMBOL_POINTER_LOCAL);
            assembler.movDwordPtrEcxEax();
        }

        assembler.pushEbp();
        assembler.movEbpEsp();
        assembler.subEspImmediate(12);
        assembler.pushEbx();
        assembler.pushEsi();
        assembler.pushEdi();

        assembler.callLabel("standalone_image_anchor");
        assembler.label("standalone_image_anchor");
        assembler.popInstructionPointerEcx();
        assembler.movEaxEcx();
        assembler.subtractEaxImmediate(
            layout.entryOffset + assembler.labels.standalone_image_anchor);
        assembler.movLocalEax(IMAGE_BASE_LOCAL);

        /* The file contains only initialized heap bytes. Reserve the runtime
         * heap as anonymous memory so file size is independent of capacity. */
        resolveSymbol(layout.mmapNameOffset);
        assembler.movEaxImmediate(0);
        assembler.pushEax();
        assembler.movEaxImmediate(-1);
        assembler.pushEax();
        assembler.movEaxImmediate(0x22);
        assembler.pushEax();
        assembler.movEaxImmediate(3);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.heapCapacity);
        assembler.pushEax();
        assembler.movEaxImmediate(0);
        assembler.pushEax();
        assembler.movEaxLocal(SYMBOL_POINTER_LOCAL);
        assembler.callEax();
        discardCallWords(6);
        assembler.testEaxEax();
        assembler.jumpEqual("standalone_runtime_error");
        assembler.compareEaxImmediate(-1);
        assembler.jumpEqual("standalone_runtime_error");
        assembler.movLocalEax(HEAP_BASE_LOCAL);

        resolveSymbol(layout.memcpyNameOffset);
        assembler.movEaxImmediate(layout.heapImageLength);
        assembler.pushEax();
        imageAddress(layout.heapOffset);
        assembler.pushEax();
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.pushEax();
        assembler.movEaxLocal(SYMBOL_POINTER_LOCAL);
        assembler.callEax();
        discardCallWords(3);

        /* Buffer records contain process-local data pointers for fast FFI.
         * They are zero in the file image and reconstructed from the newly
         * mapped heap base before any guest instruction can observe them. */
        var bufferRebind = layout.bufferRebind;
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.movEsiEax();
        assembler.movEaxImmediate(bufferRebind.firstRecord);
        assembler.movEbxEax();
        assembler.label("standalone_rebind_buffer_loop");
        assembler.movEaxEbx();
        assembler.compareEaxImmediate(layout.heapImageLength);
        assembler.jumpGreaterOrEqual("standalone_rebind_buffer_done");
        assembler.movEaxEbx();
        assembler.movEaxDwordPtrRegisterPlusEax(
            "esi", bufferRebind.recordType);
        assembler.compareEaxImmediate(bufferRebind.bufferBackingType);
        assembler.jumpNotEqual("standalone_rebind_buffer_next");
        assembler.movEaxEbx();
        assembler.addEaxEsi();
        assembler.addEaxImmediate(bufferRebind.bufferPointer);
        assembler.movEcxEax();
        assembler.movEaxEbx();
        assembler.addEaxEsi();
        assembler.addEaxImmediate(bufferRebind.bufferData);
        assembler.movDwordPtrEcxEax();
        assembler.label("standalone_rebind_buffer_next");
        assembler.movEaxEbx();
        assembler.movEaxDwordPtrRegisterPlusEax(
            "esi", bufferRebind.recordSize);
        assembler.movEcxEax();
        assembler.movEaxEbx();
        assembler.addEaxEcx();
        assembler.movEbxEax();
        assembler.jump("standalone_rebind_buffer_loop");
        assembler.label("standalone_rebind_buffer_done");

        /* Rebind the one capability supplied by the loader.  This is a named
         * guest-heap field chosen by HeapRecords, not an open-coded layout. */
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.addEaxImmediate(layout.dlsymCellAddress);
        assembler.movEcxEax();
        assembler.movEaxEbpArgument(2);
        assembler.movDwordPtrEcxEax();

        var nativeBindingIndex = 0;
        while (nativeBindingIndex < layout.nativeBindings.length) {
            var nativeBinding = layout.nativeBindings[nativeBindingIndex++];
            if (!nativeBinding.suppliedDlsym) {
                resolveSymbol(nativeBinding.nameOffset);
            }
            storeBindingPayload(nativeBinding.payload,
                                nativeBinding.suppliedDlsym);
        }

        function storeRuntimeArgument(payloadAddress, argumentIndex) {
            assembler.movEaxLocal(HEAP_BASE_LOCAL);
            assembler.addEaxImmediate(payloadAddress);
            assembler.movEcxEax();
            assembler.movEaxEbpArgument(argumentIndex);
            assembler.movDwordPtrEcxEax();
        }
        if (layout.argumentCells) {
            storeRuntimeArgument(layout.argumentCells.argc, 0);
            storeRuntimeArgument(layout.argumentCells.argv, 1);
            assembler.movEaxLocal(HEAP_BASE_LOCAL);
            assembler.addEaxImmediate(layout.argumentCells.imageBase);
            assembler.movEcxEax();
            assembler.movEaxLocal(IMAGE_BASE_LOCAL);
            assembler.movDwordPtrEcxEax();
            assembler.movEaxLocal(HEAP_BASE_LOCAL);
            assembler.addEaxImmediate(layout.argumentCells.imageLength);
            assembler.movEcxEax();
            assembler.movEaxImmediate(layout.fileLength);
            assembler.movDwordPtrEcxEax();
        }

        assembler.movEaxEbpArgument(0);
        assembler.compareEaxImmediate(1);
        assembler.jumpLess("standalone_usage_error");

        if (!layout.acceptAnyProgram) {
            /* A program-specific image retains the captured-name check. A
             * generic source-runner image obtains its filename from argv. */
            resolveSymbol(layout.strcmpNameOffset);
            imageAddress(layout.expectedNameOffset);
            assembler.pushEax();
            assembler.movEaxEbpArgument(1);
            assembler.movEaxDwordPtrEax();
            assembler.pushEax();
            assembler.movEaxLocal(SYMBOL_POINTER_LOCAL);
            assembler.callEax();
            discardCallWords(2);
            assembler.testEaxEax();
            assembler.jumpNotZero("standalone_usage_error");
        }

        assembler.label("standalone_execute_guest");
        assembler.movEaxImmediate(layout.statePayloadAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(STANDALONE_ENGINE_BUDGET);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.stringSupportAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.arrayPrototypeAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.arrayLengthKeyAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.platformServicesAddress);
        assembler.pushEax();
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.addEaxImmediate(
            layout.statePayloadAddress +
            layout.engineExecution.currentFrame);
        assembler.movEaxDwordPtrEax();
        assembler.pushEax();
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.pushEax();
        imageAddress(layout.codeOffset);
        assembler.callEax();
        discardCallWords(8);
        assembler.compareEaxImmediate(ENGINE_EXIT_BUDGET);
        assembler.jumpEqual("standalone_execute_guest");
        assembler.compareEaxImmediate(ENGINE_EXIT_RETURN);
        assembler.jumpEqual("standalone_execution_complete");
        assembler.compareEaxImmediate(ENGINE_EXIT_UNSUPPORTED);
        assembler.jumpEqual("standalone_unsupported_error");
        assembler.compareEaxImmediate(ENGINE_EXIT_ALLOCATION);
        assembler.jumpEqual("standalone_allocation_error");
        assembler.jump("standalone_runtime_error");
        assembler.label("standalone_execution_complete");
        assembler.movEaxImmediate(0);
        assembler.jump("standalone_return");

        assembler.label("standalone_usage_error");
        assembler.movEaxImmediate(64);
        assembler.jump("standalone_return");
        assembler.label("standalone_runtime_error");
        assembler.movEaxImmediate(70);
        assembler.jump("standalone_return");
        assembler.label("standalone_unsupported_error");
        resolveSymbol(layout.dprintfNameOffset);
        /* Include allocator pressure in cold-exit diagnostics. These are
         * authoritative engine fields, not guesses from process RSS. */
        var allocationDiagnosticFields = ["heapMaximum", "heapLimit",
            "heapTail", "gcLiveBytes", "gcCollections"];
        var diagnosticIndex = 0;
        while (diagnosticIndex < allocationDiagnosticFields.length) {
            assembler.movEaxLocal(HEAP_BASE_LOCAL);
            assembler.addEaxImmediate(layout.statePayloadAddress +
                layout.engineDiagnostic[allocationDiagnosticFields[diagnosticIndex++]]);
            assembler.movEaxDwordPtrEax();
            assembler.pushEax();
        }
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.addEaxImmediate(layout.statePayloadAddress +
                                  layout.engineDiagnostic.allocation);
        assembler.movEaxDwordPtrEax();
        assembler.pushEax();
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.addEaxImmediate(layout.statePayloadAddress +
                                  layout.engineDiagnostic.detail);
        assembler.movEaxDwordPtrEax();
        assembler.pushEax();
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.addEaxImmediate(layout.statePayloadAddress +
                                  layout.engineDiagnostic.pc);
        assembler.movEaxDwordPtrEax();
        assembler.pushEax();
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.addEaxImmediate(layout.statePayloadAddress +
                                  layout.engineDiagnostic.opcode);
        assembler.movEaxDwordPtrEax();
        assembler.pushEax();
        imageAddress(layout.unsupportedFormatOffset);
        assembler.pushEax();
        assembler.movEaxImmediate(2);
        assembler.pushEax();
        assembler.movEaxLocal(SYMBOL_POINTER_LOCAL);
        assembler.callEax();
        discardCallWords(6 + allocationDiagnosticFields.length);
        assembler.movEaxImmediate(70);
        assembler.jump("standalone_return");
        assembler.label("standalone_allocation_error");
        assembler.movEaxImmediate(74);
        assembler.label("standalone_return");
        assembler.popEdi();
        assembler.popEsi();
        assembler.popEbx();
        assembler.leave();
        assembler.ret();
        assembler.resolveLabels();
        return assembler;
    }

    X86Backend.prototype.writeStandaloneSnapshot = function (
            path, result, runtime, execution, expectedProgramPath, metadata) {
        if (!result || (!result.pointer && !result.bytes) || !metadata ||
            !execution || !execution.frames || execution.frames.length !== 1) {
            return false;
        }
        var heap = runtime.linearHeap;
        var records = runtime.heapRecords;
        var nativeInterpreter = runtime.nativeInterpreter;
        /* A standalone image has no host-side free-block index. Publish and
         * retire every arena owned by the previous native run before taking
         * the heap template, then start the image from its contiguous tail. */
        nativeInterpreter.releaseAllocationRegionForCollection();
        var frame = execution.frames[0];
        var expectedNameBytes = standaloneStringBytes(expectedProgramPath || "");
        var strcmpNameBytes = standaloneStringBytes("strcmp");
        var dprintfNameBytes = standaloneStringBytes("dprintf");
        var unsupportedFormatBytes = standaloneStringBytes(
            "guest VM unsupported opcode %d at bytecode pc %d " +
            "(detail %d, allocation %d; GC %u, live %u, " +
            "tail %u, limit %u, maximum %u)\n");
        var layout = {
            entryOffset: STANDALONE_HEADER_BYTES,
            heapOffset: 0,
            dlsymCellAddress: records.platformDlsymPointerCellAddress(
                nativeInterpreter.platformServicesAddress),
            mmapNameOffset: 0,
            memcpyNameOffset: 0,
            strcmpNameOffset: 0,
            dprintfNameOffset: 0,
            unsupportedFormatOffset: 0,
            expectedNameOffset: 0,
            acceptAnyProgram: expectedProgramPath === null,
            codeOffset: 0,
            heapCapacity: 0,
            heapImageLength: 0,
            nativeBindings: runtime.standaloneNativeBindings(frame.context),
            argumentCells: expectedProgramPath === null ?
                runtime.standaloneArgumentCells(frame.context) : null,
            statePayloadAddress: nativeInterpreter.statePayload,
            platformServicesAddress:
                nativeInterpreter.platformServicesAddress,
            stringSupportAddress: nativeInterpreter.stringSupportAddress,
            arrayPrototypeAddress: runtime.arrayPrototype ?
                runtime.arrayPrototype.heapAddress : 0,
            arrayLengthKeyAddress: runtime.internStringAddress("length"),
            contextAddress: frame.context.heapAddress,
            frameAddress: frame.heapAddress
        };
        layout.engineDiagnostic =
            records.standaloneEngineDiagnosticLayout();
        layout.engineExecution =
            records.standaloneEngineExecutionLayout();
        layout.bufferRebind = records.standaloneBufferRebindLayout();
        var mmapNameBytes = standaloneStringBytes("mmap");
        var memcpyNameBytes = standaloneStringBytes("memcpy");
        var bindingNameBytes = [];
        var bindingIndex = 0;
        while (bindingIndex < layout.nativeBindings.length) {
            bindingNameBytes.push(standaloneStringBytes(
                layout.nativeBindings[bindingIndex++].symbol));
        }
        var bootstrap = buildStandaloneBootstrap(layout);
        layout.mmapNameOffset = layout.entryOffset + bootstrap.bytes.length;
        layout.memcpyNameOffset = layout.mmapNameOffset + mmapNameBytes.length;
        layout.strcmpNameOffset = layout.memcpyNameOffset +
                                  memcpyNameBytes.length;
        layout.expectedNameOffset = layout.strcmpNameOffset +
                                    strcmpNameBytes.length;
        var nextDataOffset = layout.expectedNameOffset +
                             expectedNameBytes.length;
        layout.dprintfNameOffset = nextDataOffset;
        nextDataOffset += dprintfNameBytes.length;
        layout.unsupportedFormatOffset = nextDataOffset;
        nextDataOffset += unsupportedFormatBytes.length;
        bindingIndex = 0;
        while (bindingIndex < layout.nativeBindings.length) {
            layout.nativeBindings[bindingIndex].nameOffset = nextDataOffset;
            nextDataOffset += bindingNameBytes[bindingIndex].length;
            bindingIndex++;
        }
        layout.codeOffset = alignStandalone(nextDataOffset, 16);
        var sharingStarted = new Date().getTime();
        var sharedStrings = runtime.shareSnapshotStringBackings();
        if (typeof print === "function") {
            print("shared " + sharedStrings + " remaining string backings in " +
                (new Date().getTime() - sharingStarted) + " ms");
        }
        var heapImageLength = heap.bump;
        var heapCapacity = heap.memory.byteLength;
        layout.heapOffset = alignStandalone(layout.codeOffset + result.length,
                                            4096);
        layout.heapImageLength = heapImageLength;
        layout.heapCapacity = heapCapacity;
        var fileLength = layout.heapOffset + heapImageLength;
        layout.fileLength = fileLength;
        bootstrap = buildStandaloneBootstrap(layout);
        if (fileLength > 1073741824) {
            throw new RangeError("standalone snapshot exceeds 1 GiB");
        }

        /* The file remains compact at heapImageLength. The standalone process
         * maps the runtime's already-reserved maximum address range, so it can
         * grow logically without relocating guest pointers or inflating the
         * snapshot with untouched zero pages. */
        records.setEngineHeapBounds(nativeInterpreter.stateAddress,
                                    heapImageLength,
                                    runtime.gcHeapPressureBump);
        records.setEngineNativeTailBounds(nativeInterpreter.stateAddress,
                                          heapImageLength,
                                          runtime.gcHeapPressureBump);
        records.setEngineNativeMaximumLimit(nativeInterpreter.stateAddress,
                                            heap.maximumAllocationLimit);
        var savedGCState = [
            records.engineGCGeneration(nativeInterpreter.stateAddress),
            records.engineGCStackBase(nativeInterpreter.stateAddress),
            records.engineGCStackLimit(nativeInterpreter.stateAddress),
            records.engineGCCollections(nativeInterpreter.stateAddress)
        ];
        var savedCurrentFrame = records.engineCurrentFrame(
            nativeInterpreter.stateAddress);
        var savedGCDiagnostics = records.engineGCDiagnostics(
            nativeInterpreter.stateAddress);
        /* Timings describe the producing process, never the ready-to-run
         * runtime image. Exclude them from deterministic snapshots. */
        records.setEngineGCDiagnostics(nativeInterpreter.stateAddress, null);
        records.setEngineCurrentFrame(
            nativeInterpreter.stateAddress, frame.heapAddress);
        var snapshotGCGeneration =
            records.engineGCGeneration(nativeInterpreter.stateAddress);
        if (runtime.gcGeneration > snapshotGCGeneration) {
            snapshotGCGeneration = runtime.gcGeneration;
        }
        records.setEngineGCState(nativeInterpreter.stateAddress,
            snapshotGCGeneration, heap.collectorStackBase,
            heap.byteLength, 0);
        var savedPlatformPointers =
            records.suspendPlatformPointersForSnapshot(
                nativeInterpreter.platformServicesAddress);
        var savedBufferPointers =
            records.suspendBufferPointersForSnapshot();
        var savedNativeBindingValues = [];
        bindingIndex = 0;
        while (bindingIndex < layout.nativeBindings.length) {
            var savedBinding = layout.nativeBindings[bindingIndex++];
            if (savedBinding.raw) {
                savedNativeBindingValues.push(null);
            } else {
                var bindingCell = savedBinding.cell;
                savedNativeBindingValues.push(
                    runtime.readHeapValue(bindingCell));
                runtime.writeHeapValue(bindingCell, 0);
            }
        }
        var heapImage = null;
        try {
            heapImage = heap.memory.createSnapshot(heapImageLength);
        } finally {
            bindingIndex = 0;
            while (bindingIndex < layout.nativeBindings.length) {
                if (!layout.nativeBindings[bindingIndex].raw) {
                    runtime.writeHeapValue(
                        layout.nativeBindings[bindingIndex].cell,
                        savedNativeBindingValues[bindingIndex]);
                }
                bindingIndex++;
            }
            records.restorePlatformPointersAfterSnapshot(
                nativeInterpreter.platformServicesAddress,
                savedPlatformPointers);
            records.restoreBufferPointersAfterSnapshot(savedBufferPointers);
            records.setEngineGCState(nativeInterpreter.stateAddress,
                savedGCState[0], savedGCState[1], savedGCState[2],
                savedGCState[3]);
            records.setEngineCurrentFrame(
                nativeInterpreter.stateAddress, savedCurrentFrame);
            records.setEngineGCDiagnostics(
                nativeInterpreter.stateAddress, savedGCDiagnostics);
        }

        var output = null;
        try {
            output = new SnapshotOutput(heap.memory, layout.heapOffset);
            var header = STANDALONE_HEADER_FIELDS;
            output.write32(header.magic, STANDALONE_SNAPSHOT_MAGIC);
            output.write32(header.version, STANDALONE_SNAPSHOT_VERSION);
            output.write32(header.fileLength, fileLength);
            output.write32(header.entryOffset, layout.entryOffset);
            output.write32(header.entryLength, bootstrap.bytes.length);
            output.write32(header.codeOffset, layout.codeOffset);
            output.write32(header.codeLength, result.length);
            output.write32(header.heapOffset, layout.heapOffset);
            output.write32(header.heapLength, heapImageLength);
            output.write32(header.heapCapacity, heapCapacity);
            output.write32(header.frameAddress, layout.frameAddress);
            output.write32(header.contextAddress, layout.contextAddress);
            output.write32(header.dlsymCellAddress, layout.dlsymCellAddress);
            output.write32(header.compilerVersion, metadata.compilerVersion | 0);
            output.write32(header.profileMode, metadata.profileMode | 0);
            output.write32(header.sourceHash, metadata.sourceHash | 0);
            output.write32(STANDALONE_OPERAND_MODE_OFFSET, metadata.operandMode | 0);
            output.copyBytes(layout.entryOffset, bootstrap.bytes);
            output.copyBytes(layout.mmapNameOffset, mmapNameBytes);
            output.copyBytes(layout.memcpyNameOffset, memcpyNameBytes);
            output.copyBytes(layout.strcmpNameOffset, strcmpNameBytes);
            output.copyBytes(layout.expectedNameOffset, expectedNameBytes);
            output.copyBytes(layout.dprintfNameOffset, dprintfNameBytes);
            output.copyBytes(layout.unsupportedFormatOffset, unsupportedFormatBytes);
            bindingIndex = 0;
            while (bindingIndex < layout.nativeBindings.length) {
                output.copyBytes(layout.nativeBindings[bindingIndex].nameOffset,
                    bindingNameBytes[bindingIndex]);
                bindingIndex++;
            }
            output.copyCode(layout.codeOffset, result);
            return output.write(path, heapImage, heapImageLength);
        } finally {
            if (output) output.destroy();
            heap.memory.destroySnapshot(heapImage);
        }
    };

    function readExact(ffi, readPointer, descriptor, pointer, length) {
        var offset = 0;
        while (offset < length) {
            var amount = ffi.call(readPointer,
                [descriptor, pointer + offset, length - offset]);
            if (amount <= 0) return false;
            offset += amount;
        }
        return true;
    }

    function writeExact(ffi, writePointer, descriptor, pointer, length) {
        var offset = 0;
        while (offset < length) {
            var amount = ffi.call(writePointer,
                [descriptor, pointer + offset, length - offset]);
            if (amount <= 0) return false;
            offset += amount;
        }
        return true;
    }

    function executableResult(ffi, munmap, pointer, length, backendName) {
        var result = {fn: null, pointer: pointer, length: length,
            bytes: null, assembly: "", ir: null, backend: backendName,
            destroy: function () {}};
        result.fn = function () {
            var args = [];
            var argumentIndex = 0;
            while (argumentIndex < arguments.length && argumentIndex < 8) {
                args[argumentIndex] = Number(arguments[argumentIndex]) | 0;
                argumentIndex++;
            }
            return ffi.call(pointer, args) | 0;
        };
        result.destroy = function () {
            if (!result.pointer) return;
            ffi.call(munmap, [result.pointer, length]);
            result.pointer = 0;
            result.fn = null;
        };
        return result;
    }

    function describeRegisterAllocation(ir, registerMap) {
        var description = {};
        var key;
        for (key in registerMap) {
            if (!Object.prototype.hasOwnProperty.call(registerMap, key)) continue;
            var separator = key.indexOf(":");
            var kind = key.substring(0, separator);
            var index = Number(key.substring(separator + 1));
            var name = kind === "argument" ? ir.parameters[index] : ir.locals[index];
            description[registerMap[key]] = kind + ":" + name;
        }
        return description;
    }

    /* i386 has only three callee-saved general registers available to a cdecl
     * kernel. Keep the most frequently referenced kernel values in them. This
     * is deliberately an IR-wide backend policy: kernels do not name physical
     * registers and semantic code remains identical in the JS backend. */
    function allocateKernelRegisters(ir, registerCount) {
        var counts = {};
        countStatementUses(ir.body, counts);
        var values = [];
        var key;
        for (key in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
                values.push({key: key, count: counts[key]});
            }
        }
        values.sort(function (left, right) {
            if (left.count !== right.count) return right.count - left.count;
            return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
        });
        var names = ["ebx", "esi", "edi"];
        if (registerCount === 4) names.push("edx");
        var result = {};
        var index = 0;
        var preferences = ir.registerPreferences || [];
        while (index < names.length && index < preferences.length) {
            result[preferences[index]] = names[index];
            index++;
        }
        var valueIndex = 0;
        while (index < names.length && valueIndex < values.length) {
            if (result[values[valueIndex].key] === undefined) {
                result[values[valueIndex].key] = names[index++];
            }
            valueIndex++;
        }
        var occupied = {};
        for (key in result) {
            if (!Object.prototype.hasOwnProperty.call(result, key)) continue;
            if (occupied[result[key]] !== undefined) {
                throw new Error("kernel register " + result[key] +
                    " assigned to both " + occupied[result[key]] + " and " + key);
            }
            occupied[result[key]] = key;
        }
        return result;
    }

    function countStatementUses(node, counts) {
        if (!node) return;
        if (typeof node.length === "number") {
            var index = 0;
            while (index < node.length) countStatementUses(node[index++], counts);
            return;
        }
        if (node.op === "arg_i32") {
            incrementUse(counts, "argument:" + node.index);
            return;
        }
        if (node.op === "local_i32") {
            incrementUse(counts, "local:" + node.index);
            return;
        }
        var key;
        for (key in node) {
            if (key !== "op" && Object.prototype.hasOwnProperty.call(node, key) &&
                node[key] && typeof node[key] === "object") {
                countStatementUses(node[key], counts);
            }
        }
    }

    function incrementUse(counts, key) {
        counts[key] = (counts[key] || 0) + 1;
    }

    function saveKernelRegisters(assembler, preserveEdx) {
        assembler.pushEbx();
        assembler.pushEsi();
        assembler.pushEdi();
        if (preserveEdx) assembler.pushEdx();
    }

    function restoreKernelRegisters(assembler, preserveEdx) {
        if (preserveEdx) assembler.popEdx();
        assembler.popEdi();
        assembler.popEsi();
        assembler.popEbx();
    }

    function initializeKernelArgumentRegisters(assembler, registerMap) {
        var key;
        for (key in registerMap) {
            if (Object.prototype.hasOwnProperty.call(registerMap, key) &&
                key.indexOf("argument:") === 0) {
                var index = Number(key.substring(9));
                moveEbpArgumentToRegister(assembler, index, registerMap[key]);
            }
        }
    }

    function moveEbpArgumentToRegister(assembler, index, registerName) {
        var displacement = 8 + index * 4;
        if (registerName === "ebx") assembler.movEbxEbpDisplacement(displacement);
        else if (registerName === "esi") assembler.movEsiEbpDisplacement(displacement);
        else if (registerName === "edx") assembler.movEdxEbpDisplacement(displacement);
        else assembler.movEdiEbpDisplacement(displacement);
    }

    function moveRegisterToEax(assembler, registerName) {
        if (registerName === "ebx") assembler.movEaxEbx();
        else if (registerName === "esi") assembler.movEaxEsi();
        else if (registerName === "edx") assembler.movEaxEdx();
        else assembler.movEaxEdi();
    }

    function moveEaxToRegister(assembler, registerName) {
        if (registerName === "ebx") assembler.movEbxEax();
        else if (registerName === "esi") assembler.movEsiEax();
        else if (registerName === "edx") assembler.movEdxEax();
        else assembler.movEdiEax();
    }

    function isSimpleIntegerOperand(node) {
        return node.op === "const_i32" || node.op === "arg_i32" ||
               node.op === "local_i32";
    }

    function addSimpleOperandToEax(assembler, node, state) {
        if (node.op === "const_i32") {
            assembler.addEaxImmediate(node.value);
            return;
        }
        var key = (node.op === "arg_i32" ? "argument:" : "local:") + node.index;
        var registerName = state.registerMap[key];
        if (registerName === "ebx") assembler.addEaxEbx();
        else if (registerName === "esi") assembler.addEaxEsi();
        else if (registerName === "edx") assembler.addEaxEdx();
        else if (registerName === "edi") assembler.addEaxEdi();
        else {
            var displacement = node.op === "arg_i32" ?
                8 + node.index * 4 : -(node.index + 1) * 4;
            assembler.addEaxEbpDisplacement(displacement);
        }
    }

    function compareEaxWithSimpleOperand(assembler, node, state) {
        if (node.op === "const_i32") {
            assembler.compareEaxImmediate(node.value);
            return;
        }
        var key = (node.op === "arg_i32" ? "argument:" : "local:") + node.index;
        var registerName = state.registerMap[key];
        if (registerName === "ebx") assembler.compareEaxEbx();
        else if (registerName === "esi") assembler.compareEaxEsi();
        else if (registerName === "edx") assembler.compareEaxEdx();
        else if (registerName === "edi") assembler.compareEaxEdi();
        else {
            var displacement = node.op === "arg_i32" ?
                8 + node.index * 4 : -(node.index + 1) * 4;
            assembler.compareEaxEbpDisplacement(displacement);
        }
    }

    function compareIntegerOperands(assembler, left, right, state) {
        if (right.op === "const_i32" &&
            (left.op === "local_i32" || left.op === "arg_i32")) {
            var argument = left.op === "arg_i32";
            var register = state.registerMap[
                (argument ? "argument:" : "local:") + left.index];
            if (register) assembler.compareRegisterImmediate(register, right.value);
            else assembler.compareEbpDisplacementImmediate(argument ?
                8 + left.index * WORD_BYTES : -(left.index + 1) * WORD_BYTES,
                right.value);
            return;
        }
        emitControlExpression(assembler, left, state);
        compareEaxWithSimpleOperand(assembler, right, state);
    }

    function containsOpcodeDispatch(node) {
        if (!node || typeof node !== "object") return false;
        if (node.op === "opcode_dispatch") return true;
        var key;
        for (key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key) &&
                containsOpcodeDispatch(node[key])) return true;
        }
        return false;
    }

    function reserveKernelLocals(assembler, ir, state) {
        var localWords = ir.locals.length;
        if ((state.dispatchStrategy === "indexed" ||
             state.dispatchStrategy === "replicated") && containsOpcodeDispatch(ir.body)) {
            state.dispatchBaseLocal = localWords++;
            state.dispatchBaseLabel = state.returnLabel + "_dispatch_base";
        }
        if (localWords) assembler.subEspImmediate(localWords * WORD_BYTES);
        if (state.dispatchBaseLabel) {
            /* Discover the relocated address once per invocation, not once
             * per interpreted opcode. The hidden slot is backend-owned and
             * cannot collide with the kernel's declared locals. */
            assembler.callLabel(state.dispatchBaseLabel);
            assembler.label(state.dispatchBaseLabel);
            assembler.popInstructionPointerEcx();
            assembler.movEaxEcx();
            assembler.movLocalEax(state.dispatchBaseLocal);
        }
    }

    function emitStatements(assembler, statements, state) {
        var index = 0;
        while (index < statements.length) {
            emitStatement(assembler, statements[index++], state);
        }
    }

    /* EDX is a write-through register: its canonical argument/local slot is
     * kept current at assignments. A scratch region temporarily reads that
     * slot instead, then reloads EDX without disturbing the EAX result. */
    function borrowEdx(state) {
        var map = state.registerMap, key, found = false, borrowed = {};
        for (key in map) {
            if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
            if (map[key] === "edx") found = true;
            else borrowed[key] = map[key];
        }
        if (!found) return null;
        state.registerMap = borrowed;
        return map;
    }

    function restoreBorrowedEdx(assembler, state, original) {
        if (!original) return;
        state.registerMap = original;
        var key;
        for (key in original) {
            if (!Object.prototype.hasOwnProperty.call(original, key) ||
                original[key] !== "edx") continue;
            var argument = key.indexOf("argument:") === 0;
            var index = Number(key.substring(argument ? 9 : 6));
            assembler.movEdxEbpDisplacement(argument ?
                8 + index * WORD_BYTES : -(index + 1) * WORD_BYTES);
            return;
        }
    }

    function emitStatement(assembler, node, state) {
        if (node.op === "expression") {
            emitControlExpression(assembler, node.value, state);
            return;
        }
        if (node.op === "store_fields") {
            var fieldsEdx = borrowEdx(state);
            emitControlExpression(assembler, node.base, state);
            assembler.movEdxEax();
            var fieldIndex = 0;
            while (fieldIndex < node.values.length) {
                var fieldValue = node.values[fieldIndex];
                if (fieldValue.op === "const_i32") {
                    assembler.movDwordPtrEdxDisplacementImmediate(
                        node.offsets[fieldIndex], fieldValue.value);
                } else {
                    emitControlExpression(assembler, fieldValue, state);
                    assembler.movDwordPtrEdxDisplacementEax(node.offsets[fieldIndex]);
                }
                fieldIndex++;
            }
            restoreBorrowedEdx(assembler, state, fieldsEdx);
            return;
        }
        if (node.op === "copy_words") {
            var copyEdx = borrowEdx(state);
            emitControlExpression(assembler, node.target, state);
            assembler.pushEax();
            emitControlExpression(assembler, node.source, state);
            assembler.movEdxEax();
            assembler.popEcx();
            var wordIndex = 0;
            while (wordIndex < node.wordCount) {
                var wordOffset = wordIndex++ * WORD_BYTES;
                assembler.movEaxDwordPtrEdxDisplacement(wordOffset);
                assembler.movDwordPtrEcxDisplacementEax(wordOffset);
            }
            restoreBorrowedEdx(assembler, state, copyEdx);
            return;
        }
        if (node.op === "block") {
            emitStatements(assembler, node.body, state);
            return;
        }
        if (node.op === "set_local" || node.op === "set_argument") {
            emitControlExpression(assembler, node.value, state);
            var valueKey = (node.op === "set_local" ? "local:" : "argument:") +
                           node.index;
            if (state.registerMap[valueKey]) {
                if (state.registerMap[valueKey] === "edx") {
                    if (node.op === "set_local") assembler.movLocalEax(node.index);
                    else assembler.movEbpArgumentEax(node.index);
                }
                moveEaxToRegister(assembler, state.registerMap[valueKey]);
            } else if (node.op === "set_local") assembler.movLocalEax(node.index);
            else assembler.movEbpArgumentEax(node.index);
            return;
        }
        if (node.op === "store_u32" || node.op === "store_u8" ||
            node.op === "store_raw_u8" || node.op === "store_raw_u32") {
            emitControlExpression(assembler, node.address, state);
            var byteStore = node.op === "store_u8" || node.op === "store_raw_u8";
            if (node.value.op === "const_i32") {
                if (byteStore) assembler.movBytePtrEaxImmediate(node.value.value);
                else assembler.movDwordPtrEaxImmediate(node.value.value);
                return;
            }
            if (isSimpleIntegerOperand(node.value)) {
                assembler.movEcxEax();
                emitControlExpression(assembler, node.value, state);
                if (byteStore) assembler.movBytePtrEcxAl();
                else assembler.movDwordPtrEcxEax();
                return;
            }
            assembler.pushEax();
            emitControlExpression(assembler, node.value, state);
            assembler.popEcx();
            if (byteStore) assembler.movBytePtrEcxAl();
            else assembler.movDwordPtrEcxEax();
            return;
        }
        if (node.op === "store_f64" || node.op === "store_raw_f32") {
            emitControlExpression(assembler, node.address, state);
            assembler.pushEax();
            emitControlF64(assembler, node.value, state);
            assembler.popEcx();
            if (node.op === "store_f64") assembler.storeF64EcxPop();
            else assembler.storeF32EcxPop();
            return;
        }
        if (node.op === "return") {
            if (node.value.op === "call_kernel_i32" &&
                state.returnLabel === state.functionReturnLabel &&
                node.value.arguments.length <= state.parameterCount) {
                /* Reuse only argument space already owned by this cdecl
                 * frame. Evaluate everything before overwriting any argument,
                 * so swaps and repeated argument references remain correct. */
                var tailArguments = node.value.arguments;
                var tailIndex = tailArguments.length;
                while (tailIndex > 0) {
                    emitControlExpression(assembler, tailArguments[--tailIndex], state);
                    assembler.pushEax();
                }
                tailIndex = 0;
                while (tailIndex < tailArguments.length) {
                    assembler.popEax();
                    assembler.movEbpArgumentEax(tailIndex++);
                }
                restoreKernelRegisters(assembler, state.preserveEdx);
                assembler.leave();
                assembler.jump("kernel_function_" + node.value.name);
                return;
            }
            emitControlExpression(assembler, node.value, state);
            assembler.jump(state.returnLabel);
            return;
        }
        if (node.op === "if") {
            if (node.test.op === "const_i32") {
                emitStatement(assembler, node.test.value ?
                    node.consequent : node.alternate, state);
                return;
            }
            var alternateLabel = "kernel_else_" + state.nextLabel;
            var endLabel = "kernel_if_end_" + state.nextLabel++;
            if (!emitIntegerComparisonFalseJump(
                    assembler, node.test, alternateLabel, state)) {
                emitControlExpression(assembler, node.test, state);
                assembler.testEaxEax();
                assembler.jumpEqual(alternateLabel);
            }
            emitStatement(assembler, node.consequent, state);
            assembler.jump(endLabel);
            assembler.label(alternateLabel);
            emitStatement(assembler, node.alternate, state);
            assembler.label(endLabel);
            return;
        }
        if (node.op === "while") {
            if (state.dispatchStrategy === "replicated" &&
                emitReplicatedDispatchLoop(assembler, node, state)) return;
            var loopLabel = "kernel_loop_" + state.nextLabel;
            var exitLabel = "kernel_loop_exit_" + state.nextLabel++;
            assembler.label(loopLabel);
            if (!emitIntegerComparisonFalseJump(assembler, node.test, exitLabel, state)) {
                emitControlExpression(assembler, node.test, state);
                assembler.testEaxEax();
                assembler.jumpEqual(exitLabel);
            }
            emitStatement(assembler, node.body, state);
            assembler.jump(loopLabel);
            assembler.label(exitLabel);
            return;
        }
        if (node.op === "opcode_dispatch") {
            emitOpcodeDispatch(assembler, node, state);
            return;
        }
        throw new Error("unsupported i386 control-flow statement " + node.op);
    }

    function emitIntegerComparisonFalseJump(assembler, node, label, state) {
        /* Conditions need control flow, not a materialized boolean. Preserve
         * JavaScript short-circuit order while branching directly from each
         * comparison's flags. Expression contexts still produce their value. */
        if (node.op === "logical_and_i32") {
            emitConditionJump(assembler, node.left, label, false, state);
            emitConditionJump(assembler, node.right, label, false, state);
            return true;
        }
        if (node.op === "logical_or_i32") {
            var success = "kernel_condition_true_" + state.nextLabel++;
            emitConditionJump(assembler, node.left, success, true, state);
            emitConditionJump(assembler, node.right, label, false, state);
            assembler.label(success);
            return true;
        }
        if (node.op === "logical_not_i32") {
            emitConditionJump(assembler, node.value, label, true, state);
            return true;
        }
        if (node.op !== "eq_i32" && node.op !== "ne_i32" &&
            node.op !== "lt_i32" && node.op !== "le_i32" &&
            node.op !== "gt_i32" && node.op !== "ge_i32") return false;
        var operation = node.op;
        var expression;
        var immediate;
        if (isSimpleIntegerOperand(node.right)) {
            expression = node.left;
            immediate = node.right;
        } else if (isSimpleIntegerOperand(node.left)) {
            expression = node.right;
            immediate = node.left;
            operation = reverseIntegerComparison(operation);
        } else return false;
        compareIntegerOperands(assembler, expression, immediate, state);
        if (operation === "eq_i32") assembler.jumpNotEqual(label);
        else if (operation === "ne_i32") assembler.jumpEqual(label);
        else if (operation === "lt_i32") assembler.jumpGreaterOrEqual(label);
        else if (operation === "le_i32") assembler.jumpGreater(label);
        else if (operation === "gt_i32") assembler.jumpLessOrEqual(label);
        else assembler.jumpLess(label);
        return true;
    }

    function emitConditionJump(assembler, node, label, whenTrue, state) {
        if (whenTrue) {
            var falseLabel = "kernel_condition_false_" + state.nextLabel++;
            if (emitIntegerComparisonFalseJump(assembler, node, falseLabel, state)) {
                assembler.jump(label);
                assembler.label(falseLabel);
                return;
            }
        } else if (emitIntegerComparisonFalseJump(assembler, node, label, state)) {
            return;
        }
        emitControlExpression(assembler, node, state);
        assembler.testEaxEax();
        if (whenTrue) assembler.jumpNotZero(label);
        else assembler.jumpEqual(label);
    }

    function reverseIntegerComparison(operation) {
        if (operation === "lt_i32") return "gt_i32";
        if (operation === "le_i32") return "ge_i32";
        if (operation === "gt_i32") return "lt_i32";
        if (operation === "ge_i32") return "le_i32";
        return operation;
    }

    function emitOpcodeDispatch(assembler, node, state) {
        if (node.value.op !== "local_i32") {
            throw new Error("i386 opcode dispatch requires a kernel local");
        }
        var dispatchId = state.nextLabel++;
        var defaultLabel = "kernel_dispatch_default_" + dispatchId;
        var endLabel = "kernel_dispatch_end_" + dispatchId;
        emitControlExpression(assembler, node.value, state);
        if (state.dispatchStrategy === "indexed") {
            emitIndexedDispatch(assembler, node, state, dispatchId, defaultLabel);
        } else {
            emitBalancedDispatch(assembler, node.minimum, node.maximum,
                                 dispatchId, defaultLabel);
        }
        var opcode = node.minimum;
        while (opcode <= node.maximum) {
            assembler.label(dispatchCaseLabel(dispatchId, opcode));
            emitSpecializedDispatchStatement(assembler, node.body,
                node.value.index, opcode, state);
            assembler.jump(endLabel);
            opcode++;
        }
        assembler.label(defaultLabel);
        emitStatement(assembler, node.body, state);
        assembler.label(endLabel);
    }

    function emitIndexedDispatch(assembler, node, state, dispatchId, defaultLabel) {
        emitIndexedDispatchJump(assembler, node, state, dispatchId, defaultLabel);
        emitIndexedDispatchTable(assembler, node, state, dispatchId);
    }

    function emitIndexedDispatchJump(assembler, node, state, dispatchId, defaultLabel) {
        /* Table words and addressing displacement are label differences.
         * Moving the complete code image requires no pointer rebasing. ECX is
         * scratch; EAX holds the selector, then the selected handler address. */
        var positionLabel = state.dispatchBaseLabel;
        var tableLabel = "kernel_dispatch_table_" + dispatchId;
        assembler.compareEaxImmediate(node.minimum);
        assembler.jumpLess(defaultLabel);
        assembler.compareEaxImmediate(node.maximum);
        assembler.jumpGreater(defaultLabel);
        assembler.subtractEaxImmediate(node.minimum);
        assembler.movEcxEbpDisplacement(
            -(state.dispatchBaseLocal + 1) * WORD_BYTES);
        assembler.movEaxDwordPtrEcxPlusEaxTimes4LabelOffset(tableLabel, positionLabel);
        assembler.addEaxEcx();
        assembler.jumpEax();
    }

    function emitIndexedDispatchTable(assembler, node, state, dispatchId) {
        var positionLabel = state.dispatchBaseLabel;
        var tableLabel = "kernel_dispatch_table_" + dispatchId;
        assembler.label(tableLabel);
        var tableOpcode = node.minimum;
        while (tableOpcode <= node.maximum) {
            assembler.labelDifference32(dispatchCaseLabel(dispatchId, tableOpcode),
                                        positionLabel);
            tableOpcode++;
        }
    }

    /* Tail-duplicate a structured dispatch loop, not the handlers themselves.
     * Each handler then has its own indirect successor branch, allowing the
     * processor to learn opcode transitions rather than one mixed target set.
     * Prefix (safepoints), suffix (accounting), and loop test retain their order.
     * Ineligible loop shapes keep the ordinary structured implementation. */
    function emitReplicatedDispatchLoop(assembler, loop, state) {
        if (!loop.body || loop.body.op !== "block") return false;
        var body = loop.body.body, dispatchIndex = -1, index;
        for (index = 0; index < body.length; index++) {
            if (body[index].op === "opcode_dispatch") {
                if (dispatchIndex >= 0) return false;
                dispatchIndex = index;
            } else if (containsOpcodeDispatch(body[index])) return false;
        }
        if (dispatchIndex < 0) return false;
        var dispatch = body[dispatchIndex];
        if (dispatch.value.op !== "local_i32") return false;
        var id = state.nextLabel++;
        var exitLabel = "kernel_replicated_exit_" + id;
        var defaultLabel = "kernel_replicated_default_" + id;
        var prefix = body.slice(0, dispatchIndex);
        var suffix = body.slice(dispatchIndex + 1);
        function nextIteration(afterHandler) {
            if (afterHandler) emitStatements(assembler, suffix, state);
            if (!emitIntegerComparisonFalseJump(
                    assembler, loop.test, exitLabel, state)) {
                emitControlExpression(assembler, loop.test, state);
                assembler.testEaxEax();
                assembler.jumpEqual(exitLabel);
            }
            emitStatements(assembler, prefix, state);
            emitControlExpression(assembler, dispatch.value, state);
            emitIndexedDispatchJump(assembler, dispatch, state, id, defaultLabel);
        }
        nextIteration(false);
        for (index = dispatch.minimum; index <= dispatch.maximum; index++) {
            assembler.label(dispatchCaseLabel(id, index));
            emitSpecializedDispatchStatement(assembler, dispatch.body,
                dispatch.value.index, index, state);
            nextIteration(true);
        }
        assembler.label(defaultLabel);
        emitStatement(assembler, dispatch.body, state);
        nextIteration(true);
        emitIndexedDispatchTable(assembler, dispatch, state, id);
        assembler.label(exitLabel);
        return true;
    }

    function emitBalancedDispatch(assembler, minimum, maximum, id, defaultLabel) {
        if (minimum > maximum) { assembler.jump(defaultLabel); return; }
        if (minimum === maximum) {
            assembler.compareEaxImmediate(minimum);
            assembler.jumpEqual(dispatchCaseLabel(id, minimum));
            assembler.jump(defaultLabel);
            return;
        }
        var pivot = (minimum + maximum) >> 1;
        var leftLabel = "kernel_dispatch_left_" + id + "_" + minimum + "_" + maximum;
        assembler.compareEaxImmediate(pivot);
        assembler.jumpLess(leftLabel);
        assembler.jumpEqual(dispatchCaseLabel(id, pivot));
        emitBalancedDispatch(assembler, pivot + 1, maximum, id, defaultLabel);
        assembler.label(leftLabel);
        emitBalancedDispatch(assembler, minimum, pivot - 1, id, defaultLabel);
    }

    function dispatchCaseLabel(id, opcode) {
        return "kernel_dispatch_case_" + id + "_" + opcode;
    }

    /* Emit a dispatch case directly from the shared IR.  The former path
     * cloned the complete surviving subtree for every opcode, even though the
     * clone existed only until it was emitted.  Keeping specialization in the
     * emitter preserves constant branch pruning without building that large
     * temporary object graph. */
    function emitSpecializedDispatchStatement(assembler, node, localIndex,
                                               value, state) {
        if (typeof node.length === "number") {
            var statementIndex = 0;
            while (statementIndex < node.length) {
                emitSpecializedDispatchStatement(assembler,
                    node[statementIndex++], localIndex, value, state);
            }
            return;
        }
        if (node.op === "block") {
            emitSpecializedDispatchStatement(assembler, node.body, localIndex,
                                             value, state);
            return;
        }
        if (node.op === "if") {
            var test = specializeDispatchExpression(node.test, localIndex, value);
            if (test.op === "const_i32") {
                emitSpecializedDispatchStatement(assembler,
                    test.value ? node.consequent : node.alternate,
                    localIndex, value, state);
                return;
            }
            var alternateLabel = "kernel_else_" + state.nextLabel;
            var endLabel = "kernel_if_end_" + state.nextLabel++;
            if (!emitIntegerComparisonFalseJump(
                    assembler, test, alternateLabel, state)) {
                emitControlExpression(assembler, test, state);
                assembler.testEaxEax();
                assembler.jumpEqual(alternateLabel);
            }
            emitSpecializedDispatchStatement(assembler, node.consequent,
                                             localIndex, value, state);
            assembler.jump(endLabel);
            assembler.label(alternateLabel);
            emitSpecializedDispatchStatement(assembler, node.alternate,
                                             localIndex, value, state);
            assembler.label(endLabel);
            return;
        }
        emitStatement(assembler, node, state);
    }

    function specializeDispatchExpression(node, localIndex, value) {
        if (!node || typeof node !== "object") return node;
        if (typeof node.length === "number") {
            var specializedExpressions = null;
            var expressionIndex = 0;
            while (expressionIndex < node.length) {
                var originalExpression = node[expressionIndex];
                var specializedExpression = specializeDispatchExpression(
                    originalExpression, localIndex, value);
                if (specializedExpression !== originalExpression) {
                    if (!specializedExpressions) {
                        specializedExpressions = node.slice(0);
                    }
                    specializedExpressions[expressionIndex] =
                        specializedExpression;
                }
                expressionIndex++;
            }
            return specializedExpressions || node;
        }
        if (node.op === "local_i32" && node.index === localIndex) {
            return {op: "const_i32", value: value, type: "i32"};
        }
        var result = null;
        var key;
        for (key in node) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            var child = node[key];
            var specializedChild = child && typeof child === "object" ?
                specializeDispatchExpression(child, localIndex, value) : child;
            if (specializedChild !== child) {
                if (!result) {
                    result = {};
                    var copyKey;
                    for (copyKey in node) {
                        if (Object.prototype.hasOwnProperty.call(node, copyKey)) {
                            result[copyKey] = node[copyKey];
                        }
                    }
                }
                result[key] = specializedChild;
            }
        }
        if (!result) {
            if (node.left && node.right &&
                node.left.op === "const_i32" &&
                node.right.op === "const_i32") {
                return foldSpecializedInteger(node.op, node.left.value,
                                              node.right.value);
            }
            return node;
        }
        if (result.left && result.right &&
            result.left.op === "const_i32" && result.right.op === "const_i32") {
            return foldSpecializedInteger(result.op, result.left.value,
                                          result.right.value);
        }
        return result;
    }

    function foldSpecializedInteger(operation, left, right) {
        var value;
        var comparison = 0;
        if (operation === "eq_i32") { value = left === right; comparison = 1; }
        else if (operation === "ne_i32") { value = left !== right; comparison = 1; }
        else if (operation === "lt_i32") { value = left < right; comparison = 1; }
        else if (operation === "le_i32") { value = left <= right; comparison = 1; }
        else if (operation === "gt_i32") { value = left > right; comparison = 1; }
        else if (operation === "ge_i32") { value = left >= right; comparison = 1; }
        else if (operation === "add_i32") value = (left + right) | 0;
        else if (operation === "sub_i32") value = (left - right) | 0;
        else if (operation === "mul_i32") value = (left * right) | 0;
        else if (operation === "logical_and_i32") value = left && right;
        else if (operation === "logical_or_i32") value = left || right;
        else return {op: operation,
            left: {op: "const_i32", value: left, type: "i32"},
            right: {op: "const_i32", value: right, type: "i32"}, type: "i32"};
        return {op: "const_i32", value: comparison ? (value ? 1 : 0) : value,
                type: "i32"};
    }

    function indexedLoadAddress(node, state) {
        var terms = [];
        function collect(expression) {
            if (expression.op === "add_i32") {
                collect(expression.left);
                collect(expression.right);
            } else terms.push(expression);
        }
        collect(node);
        var baseIndex = -1;
        var baseRegister = null;
        var index = 0;
        while (index < terms.length) {
            var term = terms[index];
            var register = null;
            if (term.op === "arg_i32") {
                register = state.registerMap["argument:" + term.index];
            } else if (term.op === "local_i32") {
                register = state.registerMap["local:" + term.index];
            }
            if (register === "ebx" || register === "esi" ||
                register === "edi" || register === "edx") {
                baseIndex = index;
                baseRegister = register;
                break;
            }
            index++;
        }
        if (baseIndex < 0) return null;
        var displacement = 0;
        var dynamic = null;
        index = 0;
        while (index < terms.length) {
            if (index !== baseIndex) {
                term = terms[index];
                if (term.op === "const_i32") {
                    displacement = (displacement + term.value) | 0;
                } else if (dynamic === null) dynamic = term;
                else dynamic = {op: "add_i32", left: dynamic, right: term,
                                type: "i32"};
            }
            index++;
        }
        /* A base plus immediate already has a compact ordinary lowering. The
         * indexed form pays off when EAX carries a genuine guest offset. */
        if (dynamic === null) return null;
        return {register: baseRegister, index: dynamic,
                displacement: displacement};
    }

    /* Recognize only pure affine register expressions. Distributing a word
     * multiply over a constant offset preserves the kernel's modulo-2^32
     * address arithmetic; no load or call is moved across another operand. */
    function scaledRegisterIndex(node, state) {
        var scale = 1, displacement = 0;
        if (node.op === "mul_i32" && node.right.op === "const_i32") {
            scale = node.right.value;
            node = node.left;
        } else if (node.op === "shl_i32" && node.right.op === "const_i32") {
            scale = 1 << (node.right.value & 31);
            node = node.left;
        }
        if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) return null;
        if (node.op === "add_i32" && node.right.op === "const_i32") {
            displacement = (node.right.value * scale) | 0;
            node = node.left;
        }
        if (node.op !== "local_i32" && node.op !== "arg_i32") return null;
        var register = state.registerMap[
            (node.op === "local_i32" ? "local:" : "argument:") + node.index];
        if (!register) return null;
        return {register: register, scale: scale, displacement: displacement};
    }

    function multiplyEaxByConstant(assembler, value) {
        /* Addresses commonly scale an index by a word or value-cell size.
         * A shift has the same low-word result as IMUL for powers of two. */
        if (value > 0 && (value & (value - 1)) === 0) {
            var shift = 0;
            while (value > 1) { value = value >>> 1; shift++; }
            if (shift) assembler.shiftLeftEaxImmediate(shift);
        } else assembler.multiplyEaxImmediate(value);
    }

    function emitControlExpression(assembler, node, state) {
        if (node.op === "const_i32") assembler.movEaxImmediate(node.value);
        else if (node.op === "inline_call_i32") {
            emitStatements(assembler, node.bindings, state);
            var outerReturn = state.returnLabel;
            var inlineReturn = "kernel_inline_return_" + state.nextLabel++;
            state.returnLabel = inlineReturn;
            emitStatements(assembler, node.body, state);
            assembler.movEaxImmediate(0);
            assembler.label(inlineReturn);
            state.returnLabel = outerReturn;
        }
        else if (node.op === "call_kernel_i32") {
            var kernelArgumentIndex = node.arguments.length;
            while (kernelArgumentIndex > 0) {
                emitControlExpression(assembler,
                    node.arguments[--kernelArgumentIndex], state);
                assembler.pushEax();
            }
            assembler.callLabel("kernel_function_" + node.name);
            /* cdecl argument values are dead after the call. Discard them
             * without reloading every word into a scratch register. */
            assembler.discardStackWords(node.arguments.length);
        }
        else if (node.op === "call_native_i32") {
            /* Keep the target below the cdecl arguments. Every operand can
             * then use the ordinary expression emitter without naming a
             * physical register in the kernel IR. */
            var nativeCallEdx = borrowEdx(state);
            emitControlExpression(assembler, node.pointer, state);
            assembler.pushEax();
            var nativeArgumentIndex = node.arguments.length;
            while (nativeArgumentIndex > 0) {
                emitControlExpression(assembler,
                    node.arguments[--nativeArgumentIndex], state);
                assembler.pushEax();
            }
            assembler.callDwordPtrEspDisplacement(node.arguments.length * 4);
            nativeArgumentIndex = node.arguments.length + 1;
            while (nativeArgumentIndex-- > 0) assembler.popEcx();
            restoreBorrowedEdx(assembler, state, nativeCallEdx);
        }
        else if (node.op === "to_i32_f64") {
            emitControlF64(assembler, node.value, state);
            assembler.reserveStackBytes(12);
            assembler.storeX87ControlWordAtStack(0);
            assembler.loadStackWordToEax(0);
            assembler.orEaxImmediate(0x0c00);
            assembler.storeAxAtStack(2);
            assembler.loadX87ControlWordFromStack(2);
            assembler.storeInt64AtStackFromF64Pop(4);
            assembler.loadX87ControlWordFromStack(0);
            assembler.loadStackDwordToEax(4);
            assembler.releaseStackBytes(12);
        }
        else if (node.op === "to_native_i32_f64") {
            /* js_min's raw-memory/native-call boundary truncates finite
             * in-range values and returns i386's integer-indefinite value
             * (INT32_MIN) for NaN, infinity, and signed overflow.  This is
             * deliberately distinct from ECMAScript ToInt32 modulo 2^32. */
            emitControlF64(assembler, node.value, state);
            assembler.reserveStackBytes(8);
            assembler.storeX87ControlWordAtStack(0);
            assembler.loadStackWordToEax(0);
            assembler.orEaxImmediate(0x0c00);
            assembler.storeAxAtStack(2);
            assembler.loadX87ControlWordFromStack(2);
            assembler.storeInt32AtStackFromF64Pop(4);
            assembler.loadX87ControlWordFromStack(0);
            assembler.loadStackDwordToEax(4);
            assembler.releaseStackBytes(8);
        }
        else if (node.op === "arg_i32") {
            var argumentRegister = state.registerMap["argument:" + node.index];
            if (argumentRegister) moveRegisterToEax(assembler, argumentRegister);
            else assembler.movEaxEbpArgument(node.index);
        }
        else if (node.op === "local_i32") {
            var localRegister = state.registerMap["local:" + node.index];
            if (localRegister) moveRegisterToEax(assembler, localRegister);
            else assembler.movEaxLocal(node.index);
        }
        else if (node.op === "logical_and_i32" || node.op === "logical_or_i32") {
            var logicalEnd = "kernel_logical_end_" + state.nextLabel++;
            emitControlExpression(assembler, node.left, state);
            assembler.testEaxEax();
            if (node.op === "logical_and_i32") assembler.jumpEqual(logicalEnd);
            else assembler.jumpNotZero(logicalEnd);
            emitControlExpression(assembler, node.right, state);
            assembler.label(logicalEnd);
        }
        else if ((node.op === "eq_i32" || node.op === "ne_i32" ||
                  node.op === "lt_i32" || node.op === "le_i32" ||
                  node.op === "gt_i32" || node.op === "ge_i32") &&
                 (isSimpleIntegerOperand(node.left) ||
                  isSimpleIntegerOperand(node.right))) {
            var immediateComparison = node.op;
            var immediateExpression;
            var immediateValue;
            if (isSimpleIntegerOperand(node.right)) {
                immediateExpression = node.left;
                immediateValue = node.right;
            } else {
                immediateExpression = node.right;
                immediateValue = node.left;
                immediateComparison = reverseIntegerComparison(
                    immediateComparison);
            }
            compareIntegerOperands(assembler, immediateExpression, immediateValue, state);
            if (immediateComparison === "eq_i32") assembler.setEqualAl();
            else if (immediateComparison === "ne_i32") assembler.setNotEqualAl();
            else if (immediateComparison === "lt_i32") assembler.setLessAl();
            else if (immediateComparison === "le_i32") assembler.setLessOrEqualAl();
            else if (immediateComparison === "gt_i32") assembler.setGreaterAl();
            else assembler.setGreaterOrEqualAl();
            assembler.movzxEaxAl();
        }
        else if (node.op === "eq_f64" || node.op === "lt_f64" ||
                 node.op === "le_f64" || node.op === "gt_f64" ||
                 node.op === "ge_f64") {
            var reverse = node.op === "gt_f64" || node.op === "ge_f64";
            emitControlF64(assembler, reverse ? node.right : node.left, state);
            emitControlF64(assembler, reverse ? node.left : node.right, state);
            assembler.fucomipSt0St1();
            assembler.fstpSt0();
            if (node.op === "eq_f64") {
                var unorderedLabel = "kernel_compare_unordered_" + state.nextLabel;
                var compareEnd = "kernel_compare_end_" + state.nextLabel++;
                assembler.jumpParity(unorderedLabel);
                assembler.setEqualAl();
                assembler.movzxEaxAl();
                assembler.jump(compareEnd);
                assembler.label(unorderedLabel);
                assembler.movEaxImmediate(0);
                assembler.label(compareEnd);
            } else {
                if (node.op === "lt_f64" || node.op === "gt_f64") {
                    assembler.setAboveAl();
                } else assembler.setAboveOrEqualAl();
                assembler.movzxEaxAl();
            }
        }
        else if (node.op === "load_u32") {
            var indexedAddress = indexedLoadAddress(node.address, state);
            if (indexedAddress) {
                var scaledIndex = scaledRegisterIndex(indexedAddress.index, state);
                if (scaledIndex) {
                    assembler.movEaxDwordPtrScaledRegisters(indexedAddress.register,
                        scaledIndex.register, scaledIndex.scale,
                        (indexedAddress.displacement + scaledIndex.displacement) | 0);
                } else {
                    emitControlExpression(assembler, indexedAddress.index, state);
                    assembler.movEaxDwordPtrRegisterPlusEax(
                        indexedAddress.register, indexedAddress.displacement);
                }
            } else {
                emitControlExpression(assembler, node.address, state);
                assembler.movEaxDwordPtrEax();
            }
        } else if (node.op === "load_u8" || node.op === "load_raw_u8" || node.op === "load_raw_u32") {
            emitControlExpression(assembler, node.address, state);
            if (node.op !== "load_raw_u32") assembler.movzxEaxBytePtrEax();
            else assembler.movEaxDwordPtrEax();
        } else if (node.op === "neg_i32" || node.op === "not_i32" ||
                   node.op === "as_i32" || node.op === "logical_not_i32") {
            emitControlExpression(assembler, node.value, state);
            if (node.op === "neg_i32") assembler.negEax();
            else if (node.op === "not_i32") assembler.notEax();
            else if (node.op === "logical_not_i32") {
                assembler.testEaxEax();
                assembler.setEqualAl();
                assembler.movzxEaxAl();
            }
        } else if (node.op === "add_i32" && indexedLoadAddress(node, state)) {
            var address = indexedLoadAddress(node, state);
            var addressIndex = scaledRegisterIndex(address.index, state);
            if (addressIndex) {
                assembler.leaEaxScaledRegisters(address.register, addressIndex.register,
                    addressIndex.scale, (address.displacement + addressIndex.displacement) | 0);
            } else {
                emitControlExpression(assembler, address.index, state);
                assembler.leaEaxScaledRegisters(address.register, "eax", 1,
                    address.displacement);
            }
        } else if (node.op === "add_i32" && isSimpleIntegerOperand(node.right)) {
            emitControlExpression(assembler, node.left, state);
            addSimpleOperandToEax(assembler, node.right, state);
        } else if (node.op === "add_i32" && isSimpleIntegerOperand(node.left)) {
            emitControlExpression(assembler, node.right, state);
            addSimpleOperandToEax(assembler, node.left, state);
        } else if (node.op === "sub_i32" && node.right.op === "const_i32") {
            emitControlExpression(assembler, node.left, state);
            assembler.subtractEaxImmediate(node.right.value);
        } else if ((node.op === "shl_i32" || node.op === "shr_i32" ||
                    node.op === "ushr_i32" || node.op === "and_i32" ||
                    node.op === "or_i32" || node.op === "xor_i32") &&
                   node.right.op === "const_i32") {
            emitControlExpression(assembler, node.left, state);
            if (node.op === "shl_i32") assembler.shiftLeftEaxImmediate(node.right.value);
            else if (node.op === "shr_i32") assembler.shiftRightEaxImmediate(node.right.value);
            else if (node.op === "ushr_i32") assembler.shiftUnsignedRightEaxImmediate(node.right.value);
            else if (node.op === "and_i32") assembler.andEaxImmediate(node.right.value);
            else if (node.op === "or_i32") assembler.orEaxImmediate(node.right.value);
            else assembler.xorEaxImmediate(node.right.value);
        } else if (node.op === "mul_i32" && node.right.op === "const_i32") {
            emitControlExpression(assembler, node.left, state);
            multiplyEaxByConstant(assembler, node.right.value);
        } else if (node.op === "mul_i32" && node.left.op === "const_i32") {
            emitControlExpression(assembler, node.right, state);
            multiplyEaxByConstant(assembler, node.left.value);
        } else {
            emitControlExpression(assembler, node.left, state);
            assembler.pushEax();
            emitControlExpression(assembler, node.right, state);
            assembler.popEcx();
            if (node.op === "add_i32") assembler.addEaxEcx();
            else if (node.op === "sub_i32") {
                assembler.subEcxEax(); assembler.movEaxEcx();
            } else if (node.op === "mul_i32") assembler.imulEaxEcx();
            else if (node.op === "div_i32") {
                var divisionEdx = borrowEdx(state);
                assembler.exchangeEaxEcx();
                assembler.signExtendEaxIntoEdx();
                assembler.divideEaxByEcx();
                restoreBorrowedEdx(assembler, state, divisionEdx);
            }
            else if (node.op === "rem_i32") {
                var remainderEdx = borrowEdx(state);
                assembler.remainderEcxEax();
                restoreBorrowedEdx(assembler, state, remainderEdx);
            }
            else if (node.op === "and_i32") assembler.andEaxEcx();
            else if (node.op === "or_i32") assembler.orEaxEcx();
            else if (node.op === "xor_i32") assembler.xorEaxEcx();
            else if (node.op === "shl_i32" || node.op === "shr_i32" ||
                     node.op === "ushr_i32") {
                assembler.exchangeEaxEcx();
                if (node.op === "shl_i32") assembler.shiftLeftEaxCl();
                else if (node.op === "shr_i32") assembler.shiftRightEaxCl();
                else assembler.shiftUnsignedRightEaxCl();
            }
            else if (node.op === "eq_i32" || node.op === "ne_i32" ||
                     node.op === "lt_i32" || node.op === "le_i32" ||
                     node.op === "gt_i32" || node.op === "ge_i32") {
                assembler.compareEcxEax();
                if (node.op === "eq_i32") assembler.setEqualAl();
                else if (node.op === "ne_i32") assembler.setNotEqualAl();
                else if (node.op === "lt_i32") assembler.setLessAl();
                else if (node.op === "le_i32") assembler.setLessOrEqualAl();
                else if (node.op === "gt_i32") assembler.setGreaterAl();
                else assembler.setGreaterOrEqualAl();
                assembler.movzxEaxAl();
            } else throw new Error("unsupported i386 control-flow expression " + node.op);
        }
    }

    function emitControlF64(assembler, node, state) {
        if (node.op === "call_native_f64") {
            var nativeCallEdx = borrowEdx(state);
            emitControlExpression(assembler, node.pointer, state);
            assembler.pushEax();
            var nativeArgumentIndex = node.arguments.length;
            while (nativeArgumentIndex > 0) {
                emitControlExpression(assembler,
                    node.arguments[--nativeArgumentIndex], state);
                assembler.pushEax();
            }
            assembler.callDwordPtrEspDisplacement(node.arguments.length * 4);
            nativeArgumentIndex = node.arguments.length + 1;
            while (nativeArgumentIndex-- > 0) assembler.popEcx();
            restoreBorrowedEdx(assembler, state, nativeCallEdx);
            return;
        }
        if (node.op === "floor_f64" || node.op === "ceil_f64") {
            emitControlF64(assembler, node.value, state);
            /* Change only the rounding-control bits, then restore the caller's
             * x87 control word. FRNDINT retains binary64 range and signed zero. */
            var X87_ROUNDING_MASK = 0x0c00;
            var X87_ROUND_DOWN = 0x0400;
            var X87_ROUND_UP = 0x0800;
            assembler.reserveStackBytes(4);
            assembler.storeX87ControlWordAtStack(0);
            assembler.loadStackWordToEax(0);
            assembler.movEcxEax();
            assembler.movEaxImmediate(~X87_ROUNDING_MASK);
            assembler.andEaxEcx();
            assembler.orEaxImmediate(node.op === "floor_f64" ?
                X87_ROUND_DOWN : X87_ROUND_UP);
            assembler.storeAxAtStack(2);
            assembler.loadX87ControlWordFromStack(2);
            assembler.roundF64ToIntegral();
            assembler.loadX87ControlWordFromStack(0);
            assembler.releaseStackBytes(4);
            return;
        }
        if (node.op === "abs_f64") {
            emitControlF64(assembler, node.value, state);
            assembler.absF64();
            return;
        }
        if (node.op === "sqrt_f64") {
            emitControlF64(assembler, node.value, state);
            assembler.sqrtF64();
            return;
        }
        if (node.op === "log_f64") {
            emitControlF64(assembler, node.value, state);
            assembler.loadLn2F64();
            assembler.exchangeF64WithSt1();
            assembler.multiplyLog2F64Pop();
            return;
        }
        if (node.op === "truncate_f64") {
            emitControlF64(assembler, node.value, state);
            truncateF64OnX87Stack(assembler);
            return;
        }
        if (node.op === "sin_f64" || node.op === "cos_f64") {
            emitControlF64(assembler, node.value, state);
            if (node.op === "sin_f64") assembler.sinF64();
            else assembler.cosF64();
            return;
        }
        if (node.op === "load_f64" || node.op === "load_i32_f64" || node.op === "load_raw_f32") {
            emitControlExpression(assembler, node.address, state);
            if (node.op === "load_f64") assembler.loadF64Eax();
            else if (node.op === "load_raw_f32") assembler.loadF32Eax();
            else assembler.loadI32EaxAsF64();
            return;
        }
        if (node.op === "load_number_f64") {
            var doubleLabel = "kernel_number_double_" + state.nextLabel;
            var loadedLabel = "kernel_number_loaded_" + state.nextLabel++;
            emitControlExpression(assembler, node.tag, state);
            assembler.compareEaxImmediate(5);
            assembler.jumpNotEqual(doubleLabel);
            emitControlExpression(assembler, node.address, state);
            assembler.loadI32EaxAsF64();
            assembler.jump(loadedLabel);
            assembler.label(doubleLabel);
            emitControlExpression(assembler, node.address, state);
            assembler.loadF64Eax();
            assembler.label(loadedLabel);
            return;
        }
        if (node.op === "pow_f64") {
            emitControlF64(assembler, node.right, state);
            emitControlF64(assembler, node.left, state);
            assembler.multiplyLog2F64Pop();
            assembler.duplicateF64();
            assembler.roundF64ToIntegral();
            assembler.exchangeF64WithSt1();
            assembler.subtractSt1FromF64();
            assembler.twoPowerF64MinusOne();
            assembler.loadOneF64();
            assembler.addF64Pop();
            assembler.scaleF64BySt1();
            assembler.popSt1F64();
            return;
        }
        emitControlF64(assembler, node.left, state);
        emitControlF64(assembler, node.right, state);
        if (node.op === "add_f64") assembler.addF64Pop();
        else if (node.op === "sub_f64") assembler.subtractF64Pop();
        else if (node.op === "mul_f64") assembler.multiplyF64Pop();
        else if (node.op === "div_f64") assembler.divideF64Pop();
        else if (node.op === "atan2_f64") assembler.atan2F64Pop();
        else if (node.op === "rem_f64") {
            var remainderLabel = "kernel_f64_remainder_" + state.nextLabel++;
            assembler.exchangeF64WithSt1();
            assembler.label(remainderLabel);
            assembler.partialRemainderF64();
            assembler.storeF64StatusInAx();
            assembler.testF64RemainderIncomplete();
            assembler.jumpNotZero(remainderLabel);
            assembler.popSt1F64();
        }
        else throw new Error("unsupported i386 control-flow f64 expression " + node.op);
    }

    function truncateF64OnX87Stack(assembler) {
        /* Select x87 round-toward-zero only for this operation and restore the
         * caller's control word immediately afterwards. */
        assembler.reserveStackBytes(4);
        assembler.storeX87ControlWordAtStack(0);
        assembler.loadStackWordToEax(0);
        assembler.orEaxImmediate(0x0c00);
        assembler.storeAxAtStack(2);
        assembler.loadX87ControlWordFromStack(2);
        assembler.roundF64ToIntegral();
        assembler.loadX87ControlWordFromStack(0);
        assembler.releaseStackBytes(4);
    }

    function emitExpression(assembler, node) {
        if (node.op === "const_i32") assembler.movEaxImmediate(node.value);
        else if (node.op === "arg_i32") assembler.movEaxArgument(node.index);
        else if (node.op === "call_native_i32") {
            emitExpression(assembler, node.pointer);
            assembler.pushEax();
            var nativeArgumentIndex = node.arguments.length;
            while (nativeArgumentIndex > 0) {
                emitExpression(assembler, node.arguments[--nativeArgumentIndex]);
                assembler.pushEax();
            }
            assembler.callDwordPtrEspDisplacement(node.arguments.length * 4);
            nativeArgumentIndex = node.arguments.length + 1;
            while (nativeArgumentIndex-- > 0) assembler.popEcx();
        }
        else if (node.op === "to_i32_f64" ||
                 node.op === "to_native_i32_f64") {
            emitF64Expression(assembler, node.value);
            assembler.reserveStackBytes(12);
            assembler.storeX87ControlWordAtStack(0);
            assembler.loadStackWordToEax(0);
            assembler.orEaxImmediate(0x0c00);
            assembler.storeAxAtStack(2);
            assembler.loadX87ControlWordFromStack(2);
            if (node.op === "to_i32_f64") {
                assembler.storeInt64AtStackFromF64Pop(4);
            } else {
                assembler.storeInt32AtStackFromF64Pop(4);
            }
            assembler.loadX87ControlWordFromStack(0);
            assembler.loadStackDwordToEax(4);
            assembler.releaseStackBytes(12);
        }
        else if (node.op === "neg_i32" || node.op === "not_i32" ||
                 node.op === "as_i32") {
            emitExpression(assembler, node.value);
            if (node.op === "neg_i32") assembler.negEax();
            else if (node.op === "not_i32") assembler.notEax();
        } else {
            emitExpression(assembler, node.left);
            assembler.pushEax();
            emitExpression(assembler, node.right);
            assembler.popEcx();
            if (node.op === "add_i32") assembler.addEaxEcx();
            else if (node.op === "sub_i32") {
                assembler.subEcxEax();
                assembler.movEaxEcx();
            }
            else if (node.op === "mul_i32") assembler.imulEaxEcx();
            else if (node.op === "div_i32") {
                assembler.exchangeEaxEcx();
                assembler.signExtendEaxIntoEdx();
                assembler.divideEaxByEcx();
            }
            else if (node.op === "rem_i32") assembler.remainderEcxEax();
            else if (node.op === "and_i32") assembler.andEaxEcx();
            else if (node.op === "or_i32") assembler.orEaxEcx();
            else if (node.op === "xor_i32") assembler.xorEaxEcx();
            else throw new Error("unsupported i386 kernel IR " + node.op);
        }
    }

    function emitF64Expression(assembler, node) {
        if (node.op === "call_native_f64") {
            emitExpression(assembler, node.pointer);
            assembler.pushEax();
            var nativeArgumentIndex = node.arguments.length;
            while (nativeArgumentIndex > 0) {
                emitExpression(assembler, node.arguments[--nativeArgumentIndex]);
                assembler.pushEax();
            }
            assembler.callDwordPtrEspDisplacement(node.arguments.length * 4);
            nativeArgumentIndex = node.arguments.length + 1;
            while (nativeArgumentIndex-- > 0) assembler.popEcx();
            return;
        }
        if (node.op === "log_f64") {
            emitF64Expression(assembler, node.value);
            assembler.loadLn2F64();
            assembler.exchangeF64WithSt1();
            assembler.multiplyLog2F64Pop();
            return;
        }
        if (node.op === "sin_f64" || node.op === "cos_f64") {
            emitF64Expression(assembler, node.value);
            if (node.op === "sin_f64") assembler.sinF64();
            else assembler.cosF64();
            return;
        }
        if (node.op === "load_f64" || node.op === "load_raw_f32") {
            emitExpression(assembler, node.address);
            if (node.op === "load_f64") assembler.loadF64Eax();
            else assembler.loadF32Eax();
            return;
        }
        emitF64Expression(assembler, node.left);
        emitF64Expression(assembler, node.right);
        if (node.op === "add_f64") assembler.addF64Pop();
        else if (node.op === "sub_f64") assembler.subtractF64Pop();
        else if (node.op === "mul_f64") assembler.multiplyF64Pop();
        else if (node.op === "div_f64") assembler.divideF64Pop();
        else if (node.op === "rem_f64") {
            var remainderExpressionLabel =
                "kernel_f64_expression_remainder_" + assembler.length;
            assembler.exchangeF64WithSt1();
            assembler.label(remainderExpressionLabel);
            assembler.partialRemainderF64();
            assembler.storeF64StatusInAx();
            assembler.testF64RemainderIncomplete();
            assembler.jumpNotZero(remainderExpressionLabel);
            assembler.popSt1F64();
        }
        else throw new Error("unsupported i386 f64 IR " + node.op);
    }

    root.GuestVMKernelX86Backend = X86Backend;
    if (typeof module !== "undefined" && module.exports) module.exports = X86Backend;
}(this));
