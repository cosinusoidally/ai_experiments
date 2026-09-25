/* i386 backend for shared kernel IR. It emits only macro-assembler calls and
 * optionally installs the result in executable memory on an MMVM host. */
(function (root) {
    var Assembler = root.GuestVMX86Assembler;
    var HostFFI = root.GuestVMHostFFI;
    if (typeof module !== "undefined" && module.exports) {
        Assembler = require("./x86_assembler.js");
        HostFFI = require("../host_ffi.js");
    }

    function X86Backend(options) {
        options = options || {};
        this.captureAssembly = options.captureAssembly !== false;
        this.timings = options.timings || null;
        this.ffi = new HostFFI();
        this.mmap = this.ffi.isMMVM ? this.ffi.resolve("mmap") : 0;
        this.munmap = this.ffi.isMMVM ? this.ffi.resolve("munmap") : 0;
    }

    X86Backend.prototype.compile = function (ir) {
        if (ir.kernelGraph) return compileGraph(this, ir);
        if (ir.controlFlow) return compileControlFlow(this, ir);
        var assembler = new Assembler(this.captureAssembly);
        var instructionIndex = 0;
        while (instructionIndex < ir.instructions.length) {
            var instruction = ir.instructions[instructionIndex++];
            if (instruction.op === "store_f64") {
                emitExpression(assembler, instruction.address);
                assembler.pushEax();
                emitF64Expression(assembler, instruction.value);
                assembler.popEcx();
                assembler.storeF64EcxPop();
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
        var result = {fn: null, pointer: 0, length: assembler.bytes.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      symbols: assembler.labels,
                      ir: ir, backend: "i386", destroy: function () {}};
        if (!this.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.bytes.length / 4096) * 4096);
        var pointer = this.ffi.call(this.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        copyBytesToNative(pointer, assembler.bytes);
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
        return result;
    };

    function emitControlFlowFunction(assembler, ir, functionIndex) {
        var prefix = "kernel_function_" + ir.name;
        var state = {nextLabel: (functionIndex + 1) * 1000000,
                     returnLabel: prefix + "_return",
                     registerMap: allocateKernelRegisters(ir)};
        assembler.label(prefix);
        assembler.pushEbp();
        assembler.movEbpEsp();
        if (ir.locals.length) assembler.subEspImmediate(ir.locals.length * 4);
        saveKernelRegisters(assembler);
        initializeKernelArgumentRegisters(assembler, state.registerMap);
        emitStatements(assembler, ir.body, state);
        assembler.movEaxImmediate(0);
        assembler.label(state.returnLabel);
        restoreKernelRegisters(assembler);
        assembler.leave();
        assembler.ret();
        return state.registerMap;
    }

    function compileGraph(backend, graph) {
        var assembler = new Assembler(backend.captureAssembly);
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
            var registerMap = emitControlFlowFunction(assembler, ir, index);
            registerAllocations[ir.name] = describeRegisterAllocation(
                ir, registerMap);
            index++;
        }
        assembler.resolveLabels();
        var result = {fn: null, pointer: 0, length: assembler.bytes.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      symbols: assembler.labels,
                      ir: graph, backend: "i386",
                      registerAllocation: registerAllocations,
                      destroy: function () {}};
        if (!backend.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.bytes.length / 4096) * 4096);
        var pointer = backend.ffi.call(backend.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        copyBytesToNative(pointer, assembler.bytes);
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
        return result;
    }

    function compileControlFlow(backend, ir) {
        var timings = backend.timings;
        var started = timings ? new Date().getTime() : 0;
        var assembler = new Assembler(backend.captureAssembly);
        var state = {nextLabel: 0, returnLabel: "kernel_return",
                     registerMap: allocateKernelRegisters(ir)};
        if (timings) timings.analysis = new Date().getTime() - started;
        var emitStarted = timings ? new Date().getTime() : 0;
        assembler.pushEbp();
        assembler.movEbpEsp();
        if (ir.locals.length) assembler.subEspImmediate(ir.locals.length * 4);
        saveKernelRegisters(assembler);
        initializeKernelArgumentRegisters(assembler, state.registerMap);
        emitStatements(assembler, ir.body, state);
        assembler.movEaxImmediate(0);
        assembler.label(state.returnLabel);
        restoreKernelRegisters(assembler);
        assembler.leave();
        assembler.ret();
        if (timings) timings.emit = new Date().getTime() - emitStarted;
        var resolveStarted = timings ? new Date().getTime() : 0;
        assembler.resolveLabels();
        if (timings) timings.resolve = new Date().getTime() - resolveStarted;
        var result = {fn: null, pointer: 0, length: assembler.bytes.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      symbols: assembler.labels,
                      ir: ir, backend: "i386",
                      registerAllocation: describeRegisterAllocation(
                          ir, state.registerMap),
                      destroy: function () {}};
        if (!backend.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.bytes.length / 4096) * 4096);
        var pointer = backend.ffi.call(backend.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        var copyStarted = timings ? new Date().getTime() : 0;
        copyBytesToNative(pointer, assembler.bytes);
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

    var SNAPSHOT_MAGIC = 0x31535647;
    var SNAPSHOT_FORMAT_VERSION = 1;
    var SNAPSHOT_HEADER_BYTES = 32;
    var STANDALONE_SNAPSHOT_MAGIC = 0x32535647;
    var STANDALONE_SNAPSHOT_VERSION = 2;
    var STANDALONE_HEADER_BYTES = 128;

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
        var compilerVersion = peek32(header + (standalone ? 80 : 8)) >>> 0;
        var profileMode = peek32(header + (standalone ? 84 : 12)) >>> 0;
        var sourceHash = peek32(header + (standalone ? 88 : 16)) >>> 0;
        var codeOffset = standalone ? peek32(header + 20) >>> 0 :
                                      SNAPSHOT_HEADER_BYTES;
        var length = peek32(header + (standalone ? 24 : 20)) >>> 0;
        this.ffi.call(freePointer, [header]);
        if ((!standalone && magic !== SNAPSHOT_MAGIC) ||
            (standalone && magic !== STANDALONE_SNAPSHOT_MAGIC) ||
            (formatVersion !== SNAPSHOT_FORMAT_VERSION && !standalone) ||
            compilerVersion !== (expected.compilerVersion >>> 0) ||
            profileMode !== (expected.profileMode >>> 0) ||
            (!expected.skipSourceHash &&
             sourceHash !== (expected.sourceHash >>> 0)) ||
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

        assembler.movEaxImmediate(layout.statePayloadAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(2147483647);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.stringSupportAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.arrayPrototypeAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.arrayLengthKeyAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.platformServicesAddress);
        assembler.pushEax();
        assembler.movEaxImmediate(layout.frameAddress);
        assembler.pushEax();
        assembler.movEaxLocal(HEAP_BASE_LOCAL);
        assembler.pushEax();
        imageAddress(layout.codeOffset);
        assembler.callEax();
        discardCallWords(8);
        assembler.compareEaxImmediate(2);
        assembler.jumpEqual("standalone_execution_complete");
        assembler.compareEaxImmediate(3);
        assembler.jumpEqual("standalone_unsupported_error");
        assembler.compareEaxImmediate(4);
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
        if (!this.ffi.isMMVM || !result || !result.pointer || !metadata ||
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
        var layout = {
            entryOffset: STANDALONE_HEADER_BYTES,
            heapOffset: 0,
            dlsymCellAddress: records.platformDlsymPointerCellAddress(
                nativeInterpreter.platformServicesAddress),
            mmapNameOffset: 0,
            memcpyNameOffset: 0,
            strcmpNameOffset: 0,
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
        bindingIndex = 0;
        while (bindingIndex < layout.nativeBindings.length) {
            layout.nativeBindings[bindingIndex].nameOffset = nextDataOffset;
            nextDataOffset += bindingNameBytes[bindingIndex].length;
            bindingIndex++;
        }
        layout.codeOffset = alignStandalone(nextDataOffset, 16);
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
                                    heap.maximumAllocationLimit);
        records.setEngineNativeTailBounds(nativeInterpreter.stateAddress,
                                          heapImageLength,
                                          heap.maximumAllocationLimit);
        var savedGCState = [
            records.engineGCGeneration(nativeInterpreter.stateAddress),
            records.engineGCStackBase(nativeInterpreter.stateAddress),
            records.engineGCStackLimit(nativeInterpreter.stateAddress),
            records.engineGCCollections(nativeInterpreter.stateAddress)
        ];
        records.setEngineGCState(nativeInterpreter.stateAddress,
            runtime.gcGeneration, heap.collectorStackBase,
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
        }

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
        if (descriptor < 0) {
            heap.memory.destroySnapshot(heapImage);
            return false;
        }
        var stagingLength = layout.heapOffset;
        var staging = this.ffi.call(callocPointer, [stagingLength, 1]);
        var complete = !!staging;
        if (complete) {
            poke32(staging, STANDALONE_SNAPSHOT_MAGIC);
            poke32(staging + 4, STANDALONE_SNAPSHOT_VERSION);
            poke32(staging + 8, fileLength);
            poke32(staging + 12, layout.entryOffset);
            poke32(staging + 16, bootstrap.bytes.length);
            poke32(staging + 20, layout.codeOffset);
            poke32(staging + 24, result.length);
            poke32(staging + 28, layout.heapOffset);
            poke32(staging + 32, heapImageLength);
            poke32(staging + 36, heapCapacity);
            poke32(staging + 40, layout.frameAddress);
            poke32(staging + 44, layout.contextAddress);
            poke32(staging + 48, layout.dlsymCellAddress);
            poke32(staging + 80, metadata.compilerVersion | 0);
            poke32(staging + 84, metadata.profileMode | 0);
            poke32(staging + 88, metadata.sourceHash | 0);
            copyBytesToNative(staging + layout.entryOffset, bootstrap.bytes);
            copyBytesToNative(staging + layout.mmapNameOffset,
                              mmapNameBytes);
            copyBytesToNative(staging + layout.memcpyNameOffset,
                              memcpyNameBytes);
            copyBytesToNative(staging + layout.strcmpNameOffset,
                              strcmpNameBytes);
            copyBytesToNative(staging + layout.expectedNameOffset,
                              expectedNameBytes);
            bindingIndex = 0;
            while (bindingIndex < layout.nativeBindings.length) {
                copyBytesToNative(staging +
                    layout.nativeBindings[bindingIndex].nameOffset,
                    bindingNameBytes[bindingIndex]);
                bindingIndex++;
            }
            this.ffi.call(this.ffi.resolve("memcpy"),
                [staging + layout.codeOffset, result.pointer, result.length]);
            complete = writeExact(this.ffi, writePointer, descriptor,
                                  staging, stagingLength) &&
                       writeExact(this.ffi, writePointer, descriptor,
                                  heapImage.pointer, heapImageLength);
        }
        if (staging) this.ffi.call(freePointer, [staging]);
        heap.memory.destroySnapshot(heapImage);
        this.ffi.call(closePointer, [descriptor]);
        if (!complete ||
            this.ffi.call(renamePointer, [temporaryPath, path]) !== 0) {
            this.ffi.call(unlinkPointer, [temporaryPath]);
            return false;
        }
        return true;
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
    function allocateKernelRegisters(ir) {
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

    function saveKernelRegisters(assembler) {
        assembler.pushEbx();
        assembler.pushEsi();
        assembler.pushEdi();
    }

    function restoreKernelRegisters(assembler) {
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
        else assembler.movEdiEbpDisplacement(displacement);
    }

    function moveRegisterToEax(assembler, registerName) {
        if (registerName === "ebx") assembler.movEaxEbx();
        else if (registerName === "esi") assembler.movEaxEsi();
        else assembler.movEaxEdi();
    }

    function moveEaxToRegister(assembler, registerName) {
        if (registerName === "ebx") assembler.movEbxEax();
        else if (registerName === "esi") assembler.movEsiEax();
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
        else if (registerName === "edi") assembler.compareEaxEdi();
        else {
            var displacement = node.op === "arg_i32" ?
                8 + node.index * 4 : -(node.index + 1) * 4;
            assembler.compareEaxEbpDisplacement(displacement);
        }
    }

    function emitStatements(assembler, statements, state) {
        var index = 0;
        while (index < statements.length) {
            emitStatement(assembler, statements[index++], state);
        }
    }

    function emitStatement(assembler, node, state) {
        if (node.op === "block") {
            emitStatements(assembler, node.body, state);
            return;
        }
        if (node.op === "set_local" || node.op === "set_argument") {
            emitControlExpression(assembler, node.value, state);
            var valueKey = (node.op === "set_local" ? "local:" : "argument:") +
                           node.index;
            if (state.registerMap[valueKey]) {
                moveEaxToRegister(assembler, state.registerMap[valueKey]);
            } else if (node.op === "set_local") assembler.movLocalEax(node.index);
            else assembler.movEbpArgumentEax(node.index);
            return;
        }
        if (node.op === "store_u32" || node.op === "store_u8") {
            emitControlExpression(assembler, node.address, state);
            assembler.pushEax();
            emitControlExpression(assembler, node.value, state);
            assembler.popEcx();
            if (node.op === "store_u8") assembler.movBytePtrEcxAl();
            else assembler.movDwordPtrEcxEax();
            return;
        }
        if (node.op === "store_f64") {
            emitControlExpression(assembler, node.address, state);
            assembler.pushEax();
            emitControlF64(assembler, node.value, state);
            assembler.popEcx();
            assembler.storeF64EcxPop();
            return;
        }
        if (node.op === "store_raw_u8" || node.op === "store_raw_u32") {
            emitControlExpression(assembler, node.address, state);
            assembler.pushEax();
            emitControlExpression(assembler, node.value, state);
            assembler.popEcx();
            if (node.op === "store_raw_u8") assembler.movBytePtrEcxAl();
            else assembler.movDwordPtrEcxEax();
            return;
        }
        if (node.op === "return") {
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
            var loopLabel = "kernel_loop_" + state.nextLabel;
            var exitLabel = "kernel_loop_exit_" + state.nextLabel++;
            assembler.label(loopLabel);
            emitControlExpression(assembler, node.test, state);
            assembler.testEaxEax();
            assembler.jumpEqual(exitLabel);
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
        emitControlExpression(assembler, expression, state);
        compareEaxWithSimpleOperand(assembler, immediate, state);
        if (operation === "eq_i32") assembler.jumpNotEqual(label);
        else if (operation === "ne_i32") assembler.jumpEqual(label);
        else if (operation === "lt_i32") assembler.jumpGreaterOrEqual(label);
        else if (operation === "le_i32") assembler.jumpGreater(label);
        else if (operation === "gt_i32") assembler.jumpLessOrEqual(label);
        else assembler.jumpLess(label);
        return true;
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
        emitBalancedDispatch(assembler, node.minimum, node.maximum,
                             dispatchId, defaultLabel);
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

    function emitBalancedDispatch(assembler, minimum, maximum, id,
                                  defaultLabel) {
        if (minimum > maximum) {
            assembler.jump(defaultLabel);
            return;
        }
        if (minimum === maximum) {
            assembler.compareEaxImmediate(minimum);
            assembler.jumpEqual(dispatchCaseLabel(id, minimum));
            assembler.jump(defaultLabel);
            return;
        }
        var pivot = (minimum + maximum) >> 1;
        var leftLabel = "kernel_dispatch_left_" + id + "_" + minimum +
                        "_" + maximum;
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
                register === "edi") {
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

    function emitControlExpression(assembler, node, state) {
        if (node.op === "const_i32") assembler.movEaxImmediate(node.value);
        else if (node.op === "call_kernel_i32") {
            var kernelArgumentIndex = node.arguments.length;
            while (kernelArgumentIndex > 0) {
                emitControlExpression(assembler,
                    node.arguments[--kernelArgumentIndex], state);
                assembler.pushEax();
            }
            assembler.callLabel("kernel_function_" + node.name);
            kernelArgumentIndex = node.arguments.length;
            while (kernelArgumentIndex-- > 0) assembler.popEcx();
        }
        else if (node.op === "call_native_i32") {
            /* Keep the target below the cdecl arguments. Every operand can
             * then use the ordinary expression emitter without naming a
             * physical register in the kernel IR. */
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
            emitControlExpression(assembler, immediateExpression, state);
            compareEaxWithSimpleOperand(assembler, immediateValue, state);
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
                emitControlExpression(assembler, indexedAddress.index, state);
                assembler.movEaxDwordPtrRegisterPlusEax(
                    indexedAddress.register, indexedAddress.displacement);
            } else {
                emitControlExpression(assembler, node.address, state);
                assembler.movEaxDwordPtrEax();
            }
        } else if (node.op === "load_raw_u8" || node.op === "load_raw_u32") {
            emitControlExpression(assembler, node.address, state);
            if (node.op === "load_raw_u8") assembler.movzxEaxBytePtrEax();
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
        } else if (node.op === "add_i32" && isSimpleIntegerOperand(node.right)) {
            emitControlExpression(assembler, node.left, state);
            addSimpleOperandToEax(assembler, node.right, state);
        } else if (node.op === "add_i32" && isSimpleIntegerOperand(node.left)) {
            emitControlExpression(assembler, node.right, state);
            addSimpleOperandToEax(assembler, node.left, state);
        } else if (node.op === "sub_i32" && node.right.op === "const_i32") {
            emitControlExpression(assembler, node.left, state);
            assembler.subtractEaxImmediate(node.right.value);
        } else if (node.op === "mul_i32" && node.right.op === "const_i32") {
            emitControlExpression(assembler, node.left, state);
            assembler.multiplyEaxImmediate(node.right.value);
        } else if (node.op === "mul_i32" && node.left.op === "const_i32") {
            emitControlExpression(assembler, node.right, state);
            assembler.multiplyEaxImmediate(node.left.value);
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
                assembler.exchangeEaxEcx();
                assembler.signExtendEaxIntoEdx();
                assembler.divideEaxByEcx();
            }
            else if (node.op === "rem_i32") assembler.remainderEcxEax();
            else if (node.op === "and_i32") assembler.andEaxEcx();
            else if (node.op === "or_i32") assembler.orEaxEcx();
            else if (node.op === "xor_i32") assembler.xorEaxEcx();
            else if (node.op === "shl_i32" || node.op === "shr_i32" ||
                     node.op === "ushr_i32") {
                assembler.movEdxEax();
                assembler.movEaxEcx();
                assembler.movEcxEdx();
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
        if (node.op === "load_f64" || node.op === "load_i32_f64") {
            emitControlExpression(assembler, node.address, state);
            if (node.op === "load_f64") assembler.loadF64Eax();
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
        if (node.op === "load_f64") {
            emitExpression(assembler, node.address);
            assembler.loadF64Eax();
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
                "kernel_f64_expression_remainder_" + assembler.bytes.length;
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
