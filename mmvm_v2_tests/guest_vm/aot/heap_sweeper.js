/* Shared kernel-dialect heap sweep. Marking establishes reachability; this
 * pass turns every remaining unmarked record into a normal free record. */
(function (root) {
    var KernelCompiler = root.GuestVMKernelCompiler;
    var JSBackend = root.GuestVMKernelJSBackend;
    var X86Backend = root.GuestVMKernelX86Backend;
    if (typeof module !== "undefined" && module.exports) {
        KernelCompiler = require("./kernel_compiler.js");
        JSBackend = require("./backend_js.js");
        X86Backend = require("./backend_x86.js");
    }

    var sharedJS = null;
    var sharedX86 = null;
    var sharedMarkJS = null;
    var sharedMarkX86 = null;
    var sharedIndexJS = null;
    var sharedIndexX86 = null;

    function markKernel(heapBase, heapBump, stackBase, heapLimit, generation) {
        var HEAP_FIRST_RECORD = 64;
        var HEAP_TYPE_FREE = 0;
        var HEAP_TYPE_OBJECT = 1;
        var HEAP_TYPE_ARRAY = 2;
        var HEAP_TYPE_NATIVE_FUNCTION = 3;
        var HEAP_TYPE_BYTECODE_FUNCTION = 4;
        var HEAP_TYPE_ENVIRONMENT = 5;
        var HEAP_TYPE_PROPERTY = 6;
        var HEAP_TYPE_STRING = 7;
        var HEAP_TYPE_REGEXP = 9;
        var HEAP_TYPE_BUFFER_VIEW = 10;
        var HEAP_TYPE_ROOT_SLOT = 12;
        var HEAP_TYPE_VALUE_VECTOR = 13;
        var HEAP_TYPE_FRAME = 14;
        var HEAP_TYPE_PROGRAM = 15;
        var HEAP_TYPE_CONTEXT = 17;
        var HEAP_TYPE_HANDLER = 18;
        var HEAP_TYPE_ENGINE_STATE = 19;
        var VALUE_TAG_REFERENCE = 7;
        var RECORD_TYPE = 0;
        var RECORD_SIZE = 4;
        var RECORD_MARK = 8;
        var OBJECT_PROTOTYPE = 16;
        var OBJECT_PROPERTY_HEAD = 20;
        var ARRAY_ELEMENTS = 24;
        var FUNCTION_CLOSURE = 24;
        var FUNCTION_METADATA = 28;
        var FUNCTION_HOME_CONTEXT = 32;
        var ENVIRONMENT_PARENT = 16;
        var ENVIRONMENT_COUNT = 20;
        var ENVIRONMENT_CELLS = 24;
        var PROPERTY_NEXT = 16;
        var PROPERTY_KEY = 20;
        var PROPERTY_VALUE = 32;
        var REGEXP_PATTERN = 16;
        var REGEXP_FLAGS = 20;
        var REGEXP_PROTOTYPE = 24;
        var REGEXP_PROPERTY_HEAD = 28;
        var BUFFER_VIEW_BACKING = 16;
        var BUFFER_VIEW_PROTOTYPE = 28;
        var BUFFER_VIEW_PROPERTY_HEAD = 32;
        var VECTOR_CAPACITY = 20;
        var VECTOR_CELLS = 24;
        var FRAME_PROGRAM = 16;
        var FRAME_ENVIRONMENT = 20;
        var FRAME_CALLER = 24;
        var FRAME_REGISTER_COUNT = 36;
        var FRAME_HANDLER = 40;
        var FRAME_CONTEXT = 44;
        var FRAME_REGISTERS = 48;
        var PROGRAM_BYTECODE = 16;
        var PROGRAM_CONSTANTS = 20;
        var PROGRAM_CONSTANT_REGISTERS = 24;
        var PROGRAM_BINDING_REGISTERS = 28;
        var PROGRAM_PARAMETER_SLOTS = 32;
        var CONTEXT_GLOBAL = 16;
        var CONTEXT_ACTIVE_FRAME = 20;
        var HANDLER_NEXT = 16;
        var ENGINE_CURRENT_FRAME = 40;
        var VALUE_CELL_TAG = 0;
        var VALUE_CELL_REFERENCE = 4;
        var VALUE_CELL_BYTES = 16;
        var address = HEAP_FIRST_RECORD;
        var stackCount = 0;
        while (address < heapBump) {
            var rootType = recordType(heapBase, address);
            if (rootType !== HEAP_TYPE_FREE) {
                var structuralRoot = 0;
                if (rootType === HEAP_TYPE_NATIVE_FUNCTION) structuralRoot = 1;
                else if (rootType === HEAP_TYPE_PROGRAM) structuralRoot = 1;
                else if (rootType === HEAP_TYPE_CONTEXT) structuralRoot = 1;
                else if (rootType === HEAP_TYPE_ENGINE_STATE) structuralRoot = 1;
                if (recordMark(heapBase, address) === generation) {
                    structuralRoot = 1;
                }
                if (structuralRoot !== 0) {
                    if (recordMark(heapBase, address) !== generation) {
                        setRecordMark(heapBase, address, generation);
                    }
                    if (stackBase + (stackCount + 1) * 4 > heapLimit) return -1;
                    store32(heapBase + stackBase + stackCount * 4, address);
                    stackCount = stackCount + 1;
                }
            }
            address = address + recordSize(heapBase, address);
        }
        while (stackCount > 0) {
            stackCount = stackCount - 1;
            address = load32(heapBase + stackBase + stackCount * 4);
            var type = recordType(heapBase, address);
            var referenceIndex = 0;
            var itemIndex = 0;
            var itemCount = 0;
            if (type === HEAP_TYPE_ENVIRONMENT) {
                itemCount = environmentCount(heapBase, address);
            } else if (type === HEAP_TYPE_VALUE_VECTOR) {
                itemCount = vectorCapacity(heapBase, address);
            } else if (type === HEAP_TYPE_FRAME) {
                itemCount = frameRegisterCount(heapBase, address);
            }
            while (referenceIndex >= 0) {
                var target = 0;
                var cellAddress = 0;
                if (type === HEAP_TYPE_OBJECT) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_ARRAY) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else if (referenceIndex === 2) target = arrayElements(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_NATIVE_FUNCTION) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else if (referenceIndex === 2) target = functionClosure(heapBase, address);
                    else if (referenceIndex === 3) target = functionHomeContext(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_BYTECODE_FUNCTION) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else if (referenceIndex === 2) target = functionClosure(heapBase, address);
                    else if (referenceIndex === 3) target = functionMetadata(heapBase, address);
                    else if (referenceIndex === 4) target = functionHomeContext(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_ENVIRONMENT) {
                    if (referenceIndex === 0) target = environmentParent(heapBase, address);
                    else if (itemIndex < itemCount) {
                        cellAddress = address + ENVIRONMENT_CELLS +
                                      itemIndex * VALUE_CELL_BYTES;
                        itemIndex = itemIndex + 1;
                    } else referenceIndex = -2;
                } else if (type === HEAP_TYPE_PROPERTY) {
                    if (referenceIndex === 0) target = propertyNext(heapBase, address);
                    else if (referenceIndex === 1) target = propertyKey(heapBase, address);
                    else if (referenceIndex === 2) cellAddress = address + PROPERTY_VALUE;
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_REGEXP) {
                    if (referenceIndex === 0) target = regexpPattern(heapBase, address);
                    else if (referenceIndex === 1) target = regexpFlags(heapBase, address);
                    else if (referenceIndex === 2) target = regexpPrototype(heapBase, address);
                    else if (referenceIndex === 3) target = regexpPropertyHead(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_BUFFER_VIEW) {
                    if (referenceIndex === 0) target = bufferViewBacking(heapBase, address);
                    else if (referenceIndex === 1) target = bufferViewPrototype(heapBase, address);
                    else if (referenceIndex === 2) target = bufferViewPropertyHead(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_ROOT_SLOT) {
                    if (referenceIndex === 0) cellAddress = address + 16;
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_VALUE_VECTOR) {
                    if (itemIndex < itemCount) {
                        cellAddress = address + VECTOR_CELLS +
                                      itemIndex * VALUE_CELL_BYTES;
                        itemIndex = itemIndex + 1;
                    } else referenceIndex = -2;
                } else if (type === HEAP_TYPE_FRAME) {
                    if (referenceIndex === 0) target = frameProgram(heapBase, address);
                    else if (referenceIndex === 1) target = frameEnvironment(heapBase, address);
                    else if (referenceIndex === 2) target = frameCaller(heapBase, address);
                    else if (referenceIndex === 3) target = frameHandler(heapBase, address);
                    else if (referenceIndex === 4) target = frameContext(heapBase, address);
                    else if (itemIndex < itemCount) {
                        cellAddress = address + FRAME_REGISTERS +
                                      itemIndex * VALUE_CELL_BYTES;
                        itemIndex = itemIndex + 1;
                    } else referenceIndex = -2;
                } else if (type === HEAP_TYPE_PROGRAM) {
                    if (referenceIndex === 0) target = programBytecode(heapBase, address);
                    else if (referenceIndex === 1) target = programConstants(heapBase, address);
                    else if (referenceIndex === 2) target = programConstantRegisters(heapBase, address);
                    else if (referenceIndex === 3) target = programBindingRegisters(heapBase, address);
                    else if (referenceIndex === 4) target = programParameterSlots(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_CONTEXT) {
                    if (referenceIndex === 0) target = contextGlobal(heapBase, address);
                    else if (referenceIndex === 1) target = contextActiveFrame(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_HANDLER) {
                    if (referenceIndex === 0) target = handlerNext(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === HEAP_TYPE_ENGINE_STATE) {
                    if (referenceIndex === 0) target = engineCurrentFrame(heapBase, address);
                    else referenceIndex = -2;
                } else referenceIndex = -2;
                if (cellAddress !== 0) {
                    if (valueCellTag(heapBase, cellAddress) === VALUE_TAG_REFERENCE) {
                        target = valueCellReference(heapBase, cellAddress);
                    }
                }
                if (target !== 0) {
                    if (recordType(heapBase, target) !== HEAP_TYPE_FREE) {
                        if (recordMark(heapBase, target) !== generation) {
                            setRecordMark(heapBase, target, generation);
                            if (stackBase + (stackCount + 1) * 4 > heapLimit) return -1;
                            store32(heapBase + stackBase + stackCount * 4,
                                    target);
                            stackCount = stackCount + 1;
                        }
                    }
                }
                referenceIndex = referenceIndex + 1;
            }
        }
        return 0;
    }

    function sweepKernel(heapBase, heapBump, generation) {
        var HEAP_FIRST_RECORD = 64;
        var HEAP_TYPE_FREE = 0;
        var RECORD_TYPE = 0;
        var RECORD_SIZE = 4;
        var RECORD_MARK = 8;
        var RECORD_FLAGS = 12;
        var address = HEAP_FIRST_RECORD;
        var reclaimedBytes = 0;
        var freeRun = 0;
        while (address < heapBump) {
            var type = recordType(heapBase, address);
            var size = recordSize(heapBase, address);
            if (type !== HEAP_TYPE_FREE) {
                if (recordMark(heapBase, address) !== generation) {
                    setRecordType(heapBase, address, HEAP_TYPE_FREE);
                    setRecordMark(heapBase, address, 0);
                    setRecordFlags(heapBase, address, 0);
                    reclaimedBytes = reclaimedBytes + size;
                    type = HEAP_TYPE_FREE;
                }
            }
            if (type === HEAP_TYPE_FREE) {
                if (recordFlags(heapBase, address) === 0) {
                    if (freeRun === 0) {
                        freeRun = address;
                    } else {
                        setRecordSize(heapBase, freeRun,
                            recordSize(heapBase, freeRun) + size);
                    }
                } else freeRun = 0;
            } else freeRun = 0;
            address = address + size;
        }
        return reclaimedBytes;
    }

    /* Publish the derived host allocator index through collector workspace.
     * Native sweeping has already coalesced adjacent ordinary free records, so
     * this scan needs to report only their addresses and the reclaimable tail.
     * Keeping the record walk in kernel code avoids one host FFI transition for
     * every header word in a large, fragmented heap. */
    function indexFreeBlocksKernel(heapBase, heapBump, outputBase, outputLimit) {
        var HEAP_FIRST_RECORD = 64;
        var HEAP_TYPE_FREE = 0;
        var RECORD_TYPE = 0;
        var RECORD_SIZE = 4;
        var RECORD_FLAGS = 12;
        var WORD_BYTES = 4;
        var OUTPUT_COUNT_WORD = 0;
        var OUTPUT_BUMP_WORD = 1;
        var OUTPUT_FIRST_ADDRESS_WORD = 2;
        var address = HEAP_FIRST_RECORD;
        var count = 0;
        var rebuiltBump = heapBump;
        while (address < heapBump) {
            var size = recordSize(heapBase, address);
            var ordinaryFree = 0;
            if (recordType(heapBase, address) === HEAP_TYPE_FREE) {
                if (recordFlags(heapBase, address) === 0) ordinaryFree = 1;
            }
            if (ordinaryFree === 1) {
                if (address + size === heapBump) {
                    rebuiltBump = address;
                } else {
                    var outputAddress = outputBase +
                        (OUTPUT_FIRST_ADDRESS_WORD + count) * WORD_BYTES;
                    if (outputAddress + WORD_BYTES > outputLimit) return -1;
                    store32(heapBase + outputAddress, address);
                    count = count + 1;
                }
            }
            address = address + size;
        }
        store32(heapBase + outputBase + OUTPUT_COUNT_WORD * WORD_BYTES, count);
        store32(heapBase + outputBase + OUTPUT_BUMP_WORD * WORD_BYTES,
                rebuiltBump);
        return count;
    }

    function HeapSweeper(heap) {
        if (!sharedJS) {
            var ir = new KernelCompiler().compile(sweepKernel, {
                registerPreferences: ["heapBase", "heapBump", "address"]
            });
            sharedJS = new JSBackend().compile(ir);
            sharedX86 = new X86Backend().compile(ir);
            var markIR = new KernelCompiler().compile(markKernel, {
                registerPreferences: ["heapBase", "address", "stackCount"]
            });
            sharedMarkJS = new JSBackend().compile(markIR);
            sharedMarkX86 = new X86Backend().compile(markIR);
            var indexIR = new KernelCompiler().compile(indexFreeBlocksKernel, {
                registerPreferences: ["heapBase", "address", "count"]
            });
            sharedIndexJS = new JSBackend().compile(indexIR);
            sharedIndexX86 = new X86Backend().compile(indexIR);
        }
        this.heap = heap;
        this.compiled = heap.memory.nativeAddress(0) && sharedX86.fn ?
                        sharedX86 : sharedJS;
        this.marker = heap.memory.nativeAddress(0) && sharedMarkX86.fn ?
                      sharedMarkX86 : sharedMarkJS;
        this.indexer = heap.memory.nativeAddress(0) && sharedIndexX86.fn ?
                       sharedIndexX86 : sharedIndexJS;
    }

    HeapSweeper.prototype.mark = function (generation) {
        if (this.marker.backend === "i386") {
            return this.marker.fn(this.heap.memory.nativeAddress(0),
                this.heap.bump, this.heap.collectorStackBase,
                this.heap.byteLength, generation) | 0;
        }
        return this.marker.fn(this.heap.memory, 0, this.heap.bump,
                              this.heap.collectorStackBase,
                              this.heap.byteLength, generation) | 0;
    };

    HeapSweeper.prototype.sweep = function (generation) {
        if (this.compiled.backend === "i386") {
            return this.compiled.fn(this.heap.memory.nativeAddress(0),
                                    this.heap.bump, generation) >>> 0;
        }
        return this.compiled.fn(this.heap.memory, 0,
                                this.heap.bump, generation) >>> 0;
    };

    HeapSweeper.prototype.rebuildFreeBlocks = function () {
        var heap = this.heap;
        var count;
        if (this.indexer.backend === "i386") {
            count = this.indexer.fn(heap.memory.nativeAddress(0), heap.bump,
                heap.collectorStackBase, heap.byteLength) | 0;
        } else {
            count = this.indexer.fn(heap.memory, 0, heap.bump,
                heap.collectorStackBase, heap.byteLength) | 0;
        }
        if (count < 0) return heap.rebuildFreeBlocks();
        var rebuiltBump = heap.memory.readU32Trusted(
            heap.collectorStackBase + 4);
        var blocks = [];
        var index = 0;
        while (index < count) {
            blocks[index] = heap.memory.readU32Trusted(
                heap.collectorStackBase + 8 + index * 4);
            index++;
        }
        heap.bump = rebuiltBump;
        heap.freeBlocks = blocks;
        return count;
    };

    root.GuestVMHeapSweeper = HeapSweeper;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = HeapSweeper;
    }
}(this));
