/* Shared kernel-dialect heap sweep. Marking establishes reachability; this
 * pass turns every remaining unmarked record into a normal free record. */
(function (root) {
    var KernelCompiler = root.GuestVMKernelCompiler;
    var JSBackend = root.GuestVMKernelJSBackend;
    var X86Backend = root.GuestVMKernelX86Backend;
    var Heap = root.GuestVMHeap;
    var HeapRecords = root.GuestVMHeapRecords;
    var FreeIndex = root.GuestVMFreeIndexKernel;
    if (typeof module !== "undefined" && module.exports) {
        KernelCompiler = require("./kernel_compiler.js");
        JSBackend = require("./backend_js.js");
        X86Backend = require("./backend_x86.js");
        Heap = require("../heap.js");
        HeapRecords = require("../heap_records.js");
        FreeIndex = require("./free_index_kernel.js");
    }

    var sharedJS = null;
    var sharedX86 = null;
    var sharedMarkJS = null;
    var sharedMarkX86 = null;
    var sharedIndexJS = null;
    var sharedIndexX86 = null;
    var sharedTrackedIndexJS = null;
    var sharedTrackedIndexX86 = null;
    var sharedClearLinksJS = null;
    var sharedClearLinksX86 = null;
    /* One layout owner, shared by embedding and standalone compilation. */
    var CollectorLayout = HeapRecords.KernelConstants;
    var MarkStatus = {WORK_STACK_EXHAUSTED: -1, INVALID_REFERENCE: -2,
        INVALID_RECORD_LAYOUT: -3, INVALID_LAYOUT_EDGE: 255};
    var collectorNamespaces = {CollectorLayout: CollectorLayout, MarkStatus: MarkStatus};

    /* Free-region links use the otherwise-unused mark word. Release them
     * before weak metadata is filtered: a stale next address must never be
     * mistaken for the collection generation. Layout reads use the same
     * ordinary namespace binding in JavaScript and compiled kernels. */
    function clearFreeRegionLinksKernel(heapBase, heapBump, region) {
        var count = 0;
        while (region !== 0) {
            if (region < CollectorLayout.HEAP_FIRST_RECORD) return -1;
            if (region > heapBump - CollectorLayout.HEAP_HEADER_BYTES) return -1;
            if ((region & CollectorLayout.RECORD_ALIGNMENT_MASK) !== 0) return -1;
            if (recordType(heapBase, region) !== CollectorLayout.HEAP_TYPE_FREE) return -1;
            var next = recordMark(heapBase, region);
            setRecordMark(heapBase, region, 0);
            region = next;
            count = count + 1;
        }
        return count;
    }

    function heapMarkKernel(
            heapBase, heapBump, stackBase, heapLimit, generation,
            rootFrame, rootPlatformServices, rootArrayLengthKey,
            rootArrayPrototype, rootStringSupport, rootGlobal,
            rootContext, rootNativeFunction, rootEngineState,
            rootPersistentSlot, scanStructuralRoots) {
        var address = CollectorLayout.HEAP_FIRST_RECORD;
        var stackCount = 0;
        if (scanStructuralRoots === 0) {
            if (rootFrame !== 0) {
                setRecordMark(heapBase, rootFrame, generation);
                store32(heapBase + stackBase + stackCount * 4, rootFrame);
                stackCount = stackCount + 1;
            }
            if (rootPlatformServices !== 0) {
                setRecordMark(heapBase, rootPlatformServices, generation);
                store32(heapBase + stackBase + stackCount * 4,
                        rootPlatformServices);
                stackCount = stackCount + 1;
            }
            if (rootArrayLengthKey !== 0) {
                setRecordMark(heapBase, rootArrayLengthKey, generation);
                store32(heapBase + stackBase + stackCount * 4,
                        rootArrayLengthKey);
                stackCount = stackCount + 1;
            }
            if (rootArrayPrototype !== 0) {
                setRecordMark(heapBase, rootArrayPrototype, generation);
                store32(heapBase + stackBase + stackCount * 4,
                        rootArrayPrototype);
                stackCount = stackCount + 1;
            }
            if (rootStringSupport !== 0) {
                setRecordMark(heapBase, rootStringSupport, generation);
                store32(heapBase + stackBase + stackCount * 4,
                        rootStringSupport);
                stackCount = stackCount + 1;
            }
            if (rootGlobal !== 0) {
                setRecordMark(heapBase, rootGlobal, generation);
                store32(heapBase + stackBase + stackCount * 4, rootGlobal);
                stackCount = stackCount + 1;
            }
            if (rootContext !== 0) {
                setRecordMark(heapBase, rootContext, generation);
                store32(heapBase + stackBase + stackCount * 4, rootContext);
                stackCount = stackCount + 1;
            }
            if (rootNativeFunction !== 0) {
                setRecordMark(heapBase, rootNativeFunction, generation);
                store32(heapBase + stackBase + stackCount * 4,
                        rootNativeFunction);
                stackCount = stackCount + 1;
            }
            if (rootEngineState !== 0) {
                setRecordMark(heapBase, rootEngineState, generation);
                store32(heapBase + stackBase + stackCount * 4,
                        rootEngineState);
                stackCount = stackCount + 1;
            }
            if (rootPersistentSlot !== 0) {
                setRecordMark(heapBase, rootPersistentSlot, generation);
                store32(heapBase + stackBase + stackCount * 4,
                        rootPersistentSlot);
                stackCount = stackCount + 1;
            }
            address = heapBump;
        }
        while (address < heapBump) {
            var rootType = recordType(heapBase, address);
            if (rootType !== CollectorLayout.HEAP_TYPE_FREE) {
                var structuralRoot = 0;
                /* Callback roots are explicitly seeded by the embedder.
                 * Native-function type alone does not imply host ownership:
                 * a guest-created bound function must be collectible. */
                if (rootType === CollectorLayout.HEAP_TYPE_CONTEXT) structuralRoot = 1;
                else if (rootType === CollectorLayout.HEAP_TYPE_ENGINE_STATE) structuralRoot = 1;
                if (recordMark(heapBase, address) === generation) {
                    structuralRoot = 1;
                }
                if (structuralRoot !== 0) {
                    if (recordMark(heapBase, address) !== generation) {
                        setRecordMark(heapBase, address, generation);
                    }
                    if (stackBase + (stackCount + 1) * 4 > heapLimit) return MarkStatus.WORK_STACK_EXHAUSTED;
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
            var itemPart = 0;
            var itemCount = 0;
            if (type === CollectorLayout.HEAP_TYPE_ENVIRONMENT) {
                itemCount = environmentCount(heapBase, address);
            } else if (type === CollectorLayout.HEAP_TYPE_VALUE_VECTOR) {
                itemCount = vectorLength(heapBase, address);
            } else if (type === CollectorLayout.HEAP_TYPE_FRAME) {
                itemCount = frameRegisterCount(heapBase, address);
            } else if (type === CollectorLayout.HEAP_TYPE_PROPERTY_STORAGE) {
                itemCount = propertyStorageLength(heapBase, address);
            }
            var recordBytes = recordSize(heapBase, address);
            var cellBytes = 0;
            var itemStride = CollectorLayout.VALUE_CELL_BYTES;
            if (type === CollectorLayout.HEAP_TYPE_ENVIRONMENT) {
                cellBytes = CollectorLayout.ENVIRONMENT_CELLS;
            } else if (type === CollectorLayout.HEAP_TYPE_VALUE_VECTOR) {
                cellBytes = CollectorLayout.VECTOR_CELLS;
            } else if (type === CollectorLayout.HEAP_TYPE_FRAME) {
                cellBytes = CollectorLayout.FRAME_REGISTERS;
            } else if (type === CollectorLayout.HEAP_TYPE_PROPERTY_STORAGE) {
                cellBytes = CollectorLayout.PROPERTY_STORAGE_ENTRIES;
                itemStride = CollectorLayout.PROPERTY_STORAGE_ENTRY_BYTES;
            }
            var recordLayoutValid = 1;
            if (recordBytes < CollectorLayout.HEAP_HEADER_BYTES) recordLayoutValid = 0;
            else if ((recordBytes & CollectorLayout.RECORD_ALIGNMENT_MASK) !== 0) {
                recordLayoutValid = 0;
            } else if (address + recordBytes > heapBump) {
                recordLayoutValid = 0;
            } else if (address + recordBytes < address) {
                recordLayoutValid = 0;
            } else if (cellBytes !== 0) {
                if (recordBytes < cellBytes) recordLayoutValid = 0;
                else if (itemCount > divideI32(
                        recordBytes - cellBytes, itemStride)) {
                    recordLayoutValid = 0;
                }
            }
            if (recordLayoutValid !== 0 && type === CollectorLayout.HEAP_TYPE_PROPERTY_STORAGE) {
                var packedCapacity = propertyStorageCapacity(heapBase, address);
                if (itemCount < 0 || packedCapacity < itemCount ||
                        packedCapacity > divideI32(recordBytes - CollectorLayout.PROPERTY_STORAGE_ENTRIES,
                            CollectorLayout.PROPERTY_STORAGE_ENTRY_BYTES)) recordLayoutValid = 0;
            }
            if (recordLayoutValid === 0) {
                store32(heapBase + stackBase, address);
                store32(heapBase + stackBase + 4, type);
                store32(heapBase + stackBase + 8,
                        MarkStatus.INVALID_LAYOUT_EDGE);
                store32(heapBase + stackBase + 12, recordBytes);
                return MarkStatus.INVALID_RECORD_LAYOUT;
            }
            while (referenceIndex >= 0) {
                var target = 0;
                var cellAddress = 0;
                if (type === CollectorLayout.HEAP_TYPE_OBJECT) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else if (referenceIndex === 2) target = objectPropertyIndex(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_ARRAY) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else if (referenceIndex === 2) target = arrayElements(heapBase, address);
                    else if (referenceIndex === 3) {
                        target = arrayReserved(heapBase, address);
                        if (target === -1) target = 0;
                    }
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_NATIVE_FUNCTION) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else if (referenceIndex === 2) target = functionClosure(heapBase, address);
                    else if (referenceIndex === 3) target = functionHomeContext(heapBase, address);
                    else if (referenceIndex === 4) target = functionGCNext(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_BYTECODE_FUNCTION) {
                    if (referenceIndex === 0) target = objectPrototype(heapBase, address);
                    else if (referenceIndex === 1) target = objectPropertyHead(heapBase, address);
                    else if (referenceIndex === 2) target = functionClosure(heapBase, address);
                    else if (referenceIndex === 3) target = functionMetadata(heapBase, address);
                    else if (referenceIndex === 4) target = functionHomeContext(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_ENVIRONMENT) {
                    if (referenceIndex === 0) target = environmentParent(heapBase, address);
                    else if (referenceIndex === 1) {
                        target = environmentProgram(heapBase, address);
                    } else if (referenceIndex === 2) {
                        target = environmentScopeData(heapBase, address);
                    } else if (itemIndex < itemCount) {
                        cellAddress = address + CollectorLayout.ENVIRONMENT_CELLS +
                                      itemIndex * CollectorLayout.VALUE_CELL_BYTES;
                        itemIndex = itemIndex + 1;
                    } else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_PROPERTY) {
                    if (referenceIndex === 0) target = propertyNext(heapBase, address);
                    else if (referenceIndex === 1) target = propertyKey(heapBase, address);
                    else if (referenceIndex === 2) cellAddress = address + CollectorLayout.PROPERTY_VALUE;
                    else if (referenceIndex === 3) {
                        if ((propertyAttributes(heapBase, address) &
                             CollectorLayout.PROPERTY_ATTRIBUTE_ACCESSOR) !== 0) {
                            target = propertySetter(heapBase, address);
                        }
                    }
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_STRING) {
                    if ((recordFlags(heapBase, address) &
                         CollectorLayout.STRING_ROPE_FLAG) !== 0) {
                        if (referenceIndex === 0) {
                            target = stringRopeLeft(heapBase, address);
                        } else if (referenceIndex === 1) {
                            target = stringRopeRight(heapBase, address);
                        } else referenceIndex = -2;
                    } else if ((recordFlags(heapBase, address) &
                                CollectorLayout.STRING_SLICE_FLAG) !== 0) {
                        if (referenceIndex === 0) {
                            target = stringSliceBacking(heapBase, address);
                        } else referenceIndex = -2;
                    } else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_REGEXP) {
                    if (referenceIndex === 0) target = regexpPattern(heapBase, address);
                    else if (referenceIndex === 1) target = regexpFlags(heapBase, address);
                    else if (referenceIndex === 2) target = regexpPrototype(heapBase, address);
                    else if (referenceIndex === 3) target = regexpPropertyHead(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_BUFFER_VIEW) {
                    if (referenceIndex === 0) target = bufferViewBacking(heapBase, address);
                    else if (referenceIndex === 1) target = bufferViewPrototype(heapBase, address);
                    else if (referenceIndex === 2) target = bufferViewPropertyHead(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_BUFFER_BACKING) {
                    if (referenceIndex === 0) {
                        target = bufferBackingMetadata(heapBase, address);
                    } else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_ROOT_SLOT) {
                    if (referenceIndex === 0) cellAddress = address + 16;
                    else if (referenceIndex === 1) {
                        target = rootSlotNext(heapBase, address);
                    }
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_PROPERTY_STORAGE) {
                    if (referenceIndex === 0) target = propertyStorageHashIndex(heapBase, address);
                    else if (itemIndex < itemCount) {
                        var packedKey = propertyStorageKeyAt(heapBase, address, itemIndex);
                        if (packedKey === 0) itemIndex = itemIndex + 1;
                        else if (itemPart === 0) {
                            target = packedKey;
                            itemPart = 1;
                        } else if (itemPart === 1) {
                            target = propertyStorageSetterAt(heapBase, address, itemIndex);
                            itemPart = 2;
                        } else {
                            /* Marker cells are heap-relative; the common
                             * tagged-cell reader applies heapBase below. */
                            cellAddress = propertyStorageValueCellAt(0, address, itemIndex);
                            itemIndex = itemIndex + 1;
                            itemPart = 0;
                        }
                    } else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_VALUE_VECTOR) {
                    if (itemIndex < itemCount) {
                        cellAddress = address + CollectorLayout.VECTOR_CELLS +
                                      itemIndex * CollectorLayout.VALUE_CELL_BYTES;
                        itemIndex = itemIndex + 1;
                    } else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_FRAME) {
                    if (referenceIndex === 0) target = frameProgram(heapBase, address);
                    else if (referenceIndex === 1) target = frameEnvironment(heapBase, address);
                    else if (referenceIndex === 2) target = frameCaller(heapBase, address);
                    else if (referenceIndex === 3) target = frameHandler(heapBase, address);
                    else if (referenceIndex === 4) target = frameContext(heapBase, address);
                    else if (itemIndex < itemCount) {
                        cellAddress = address + CollectorLayout.FRAME_REGISTERS +
                                      itemIndex * CollectorLayout.VALUE_CELL_BYTES;
                        itemIndex = itemIndex + 1;
                    } else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_CONSTANT_POOL) {
                    var poolCache = constantPoolExecutionCache(heapBase, address);
                    if (poolCache !== 0) {
                        if (referenceIndex === 0) target = poolCache;
                        else referenceIndex = -2;
                    } else {
                        var poolLength = constantPoolLength(heapBase, address);
                        var poolData = address + CollectorLayout.CONSTANT_POOL_TAGS +
                            ((poolLength + CollectorLayout.HEAP_RECORD_ALIGNMENT - 1) & (0 - CollectorLayout.HEAP_RECORD_ALIGNMENT));
                        while (itemIndex < poolLength && target === 0) {
                            var poolTag = constantPoolTag(heapBase, address, itemIndex);
                            var poolIndex = itemIndex;
                            itemIndex = itemIndex + 1;
                            if (poolTag === CollectorLayout.VALUE_TAG_REFERENCE) {
                                target = constantPoolLowWord(heapBase, poolData, poolIndex);
                            }
                        }
                        if (itemIndex >= poolLength && target === 0) referenceIndex = -2;
                    }
                } else if (type === CollectorLayout.HEAP_TYPE_INTEGER_VECTOR) {
                    if (referenceIndex === 0) target = integerVectorExecutionCache(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_BYTECODE) {
                    if (referenceIndex === 0) target = bytecodeExecutionCache(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_PROGRAM) {
                    if (referenceIndex === 0) target = programBytecode(heapBase, address);
                    else if (referenceIndex === 1) target = programConstants(heapBase, address);
                    else if (referenceIndex === 2) target = programConstantRegisters(heapBase, address);
                    else if (referenceIndex === 3) target = programBindingRegisters(heapBase, address);
                    else if (referenceIndex === 4) target = programParameterSlots(heapBase, address);
                    else if (referenceIndex === 5) target = programSource(heapBase, address);
                    else if (referenceIndex === CollectorLayout.PROGRAM_BINDING_NAMES_EDGE) target = programBindingNames(heapBase, address);
                    else if (referenceIndex === CollectorLayout.PROGRAM_DEBUG_EDGE) target = programDebugReference(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_CONTEXT) {
                    if (referenceIndex === 0) target = contextGlobal(heapBase, address);
                    else if (referenceIndex === 1) target = contextActiveFrame(heapBase, address);
                    else if (referenceIndex === 2) target = contextNext(heapBase, address);
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_HANDLER) {
                    if (referenceIndex === 0) target = handlerNext(heapBase, address);
                    else if (referenceIndex === 1) {
                        target = handlerEnvironment(heapBase, address);
                    }
                    else referenceIndex = -2;
                } else if (type === CollectorLayout.HEAP_TYPE_ENGINE_STATE) {
                    if (referenceIndex === 0) {
                        target = engineRecordCurrentFrame(heapBase, address);
                    }
                    else if (referenceIndex === 1) {
                        target = engineRecordPlatformServices(
                            heapBase, address);
                    }
                    else referenceIndex = -2;
                } else referenceIndex = -2;
                if (cellAddress !== 0) {
                    if (valueCellTag(heapBase, cellAddress) === CollectorLayout.VALUE_TAG_REFERENCE) {
                        target = valueCellReference(heapBase, cellAddress);
                    }
                }
                if (target !== 0) {
                    var targetValid = 1;
                    if (target < CollectorLayout.HEAP_FIRST_RECORD) targetValid = 0;
                    else if (target >= heapBump) targetValid = 0;
                    else if ((target & CollectorLayout.RECORD_ALIGNMENT_MASK) !== 0) {
                        targetValid = 0;
                    }
                    var targetType = 0;
                    var targetBytes = 0;
                    if (targetValid === 1) {
                        targetType = recordType(heapBase, target);
                        targetBytes = recordSize(heapBase, target);
                        if (targetType <= CollectorLayout.HEAP_TYPE_FREE) targetValid = 0;
                        else if (targetType > CollectorLayout.HEAP_LAST_RECORD_TYPE) {
                            targetValid = 0;
                        } else if (targetBytes < CollectorLayout.HEAP_HEADER_BYTES) {
                            targetValid = 0;
                        } else if ((targetBytes & CollectorLayout.RECORD_ALIGNMENT_MASK) !== 0) {
                            targetValid = 0;
                        } else if (target + targetBytes > heapBump) {
                            targetValid = 0;
                        } else if (target + targetBytes < target) {
                            targetValid = 0;
                        }
                    }
                    if (targetValid === 0) {
                        /* The collector workspace is private while marking.
                         * Preserve the complete bad edge for the engine's
                         * structured standalone diagnostic instead of
                         * dereferencing corrupt guest state. */
                        store32(heapBase + stackBase, address);
                        store32(heapBase + stackBase + 4, type);
                        var diagnosticReferenceIndex = referenceIndex;
                        if (cellAddress !== 0) {
                            diagnosticReferenceIndex = itemIndex;
                        }
                        store32(heapBase + stackBase + 8,
                                diagnosticReferenceIndex);
                        store32(heapBase + stackBase + 12, target);
                        return MarkStatus.INVALID_REFERENCE;
                    }
                    if (recordType(heapBase, target) !== CollectorLayout.HEAP_TYPE_FREE) {
                        if (recordMark(heapBase, target) !== generation) {
                            setRecordMark(heapBase, target, generation);
                            if (stackBase + (stackCount + 1) * 4 > heapLimit) return MarkStatus.WORK_STACK_EXHAUSTED;
                            store32(heapBase + stackBase + stackCount * 4,
                                    target);
                            stackCount = stackCount + 1;
                        }
                    }
                }
                /* Environment, vector and frame cells are homogeneous runs.
                 * Keep their selector fixed while itemIndex advances instead
                 * of growing an unrelated referenceIndex once per cell. This
                 * makes the generated loop smaller and avoids carrying a
                 * potentially large synthetic selector through the native
                 * marker. Fixed cell fields (property values and root slots)
                 * still advance normally. */
                var advanceReferenceIndex = 1;
                if (cellAddress !== 0) {
                    if (type === CollectorLayout.HEAP_TYPE_ENVIRONMENT) {
                        advanceReferenceIndex = 0;
                    } else if (type === CollectorLayout.HEAP_TYPE_VALUE_VECTOR) {
                        advanceReferenceIndex = 0;
                    } else if (type === CollectorLayout.HEAP_TYPE_FRAME) {
                        advanceReferenceIndex = 0;
                    }
                }
                if (advanceReferenceIndex !== 0) {
                    referenceIndex = referenceIndex + 1;
                }
            }
        }
        return 0;
    }

    function heapSweepKernel(heapBase, heapBump, generation, freePointer) {
        var address = CollectorLayout.HEAP_FIRST_RECORD;
        var reclaimedBytes = 0;
        var freeRun = 0;
        while (address < heapBump) {
            var type = recordType(heapBase, address);
            var size = recordSize(heapBase, address);
            if (type !== CollectorLayout.HEAP_TYPE_FREE) {
                if (recordMark(heapBase, address) !== generation) {
                    if (type === CollectorLayout.HEAP_TYPE_BUFFER_BACKING) {
                        if ((recordFlags(heapBase, address) & CollectorLayout.BUFFER_BACKING_EXTERNAL_FLAG) !== 0) {
                            var released = callNativeI32(freePointer,
                                bufferBackingPointer(heapBase, address));
                        }
                    }
                    setRecordType(heapBase, address, CollectorLayout.HEAP_TYPE_FREE);
                    setRecordMark(heapBase, address, 0);
                    setRecordFlags(heapBase, address, 0);
                    reclaimedBytes = reclaimedBytes + size;
                    type = CollectorLayout.HEAP_TYPE_FREE;
                }
            }
            if (type === CollectorLayout.HEAP_TYPE_FREE) {
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
        var address = CollectorLayout.HEAP_FIRST_RECORD;
        var count = 0;
        var freeBytes = 0;
        var rebuiltBump = heapBump;
        while (address < heapBump) {
            var size = recordSize(heapBase, address);
            var ordinaryFree = 0;
            var type = recordType(heapBase, address);
            if (type === CollectorLayout.HEAP_TYPE_FREE) {
                if (recordFlags(heapBase, address) === 0) ordinaryFree = 1;
            }
            if (ordinaryFree === 1) {
                if (address + size === heapBump) {
                    rebuiltBump = address;
                } else {
                    freeBytes = freeBytes + size;
                    var outputAddress = outputBase +
                        (OUTPUT_FIRST_ADDRESS_WORD + count) * WORD_BYTES;
                    if (outputAddress + WORD_BYTES > outputLimit) return -1;
                    store32(heapBase + outputAddress, address);
                    count = count + 1;
                }
            } else if (type === CollectorLayout.HEAP_TYPE_FREE) {
                freeBytes = freeBytes + size;
            }
            address = address + size;
        }
        store32(heapBase + outputBase + OUTPUT_COUNT_WORD * WORD_BYTES, count);
        store32(heapBase + outputBase + OUTPUT_BUMP_WORD * WORD_BYTES,
                rebuiltBump);
        store32(heapBase + outputBase + OUTPUT_FREE_BYTES_WORD * WORD_BYTES,
                freeBytes);
        return count;
    }

    function HeapSweeper(heap) {
        var nativeMemory = !!heap.memory.nativeAddress(0);
        if (nativeMemory ? !sharedX86 : !sharedJS) {
            var backend = nativeMemory ? new X86Backend() : new JSBackend();
            var ir = new KernelCompiler().compile(heapSweepKernel, {
                constantBindings: CollectorLayout,
                constantNamespaces: collectorNamespaces,
                registerPreferences: ["heapBase", "heapBump", "address"]
            });
            var sweeper = backend.compile(ir);
            var markIR = new KernelCompiler().compile(heapMarkKernel, {
                constantBindings: CollectorLayout,
                constantNamespaces: collectorNamespaces,
                registerPreferences: ["heapBase", "address", "stackCount"]
            });
            var marker = backend.compile(markIR);
            var indexBindings = {}, binding;
            for (binding in CollectorLayout) {
                if (Object.prototype.hasOwnProperty.call(CollectorLayout, binding)) indexBindings[binding] = CollectorLayout[binding];
            }
            for (binding in FreeIndex.constants) {
                if (Object.prototype.hasOwnProperty.call(FreeIndex.constants, binding)) indexBindings[binding] = FreeIndex.constants[binding];
            }
            var indexIR = new KernelCompiler().compile(indexFreeBlocksKernel, {
                constantBindings: indexBindings,
                constantNamespaces: collectorNamespaces,
                registerPreferences: ["heapBase", "address", "count"]
            });
            var indexer = backend.compile(indexIR);
            var trackedBindings = {RECORD_HEADER_BYTES: Heap.HEADER_SIZE};
            for (binding in indexBindings) {
                if (Object.prototype.hasOwnProperty.call(indexBindings, binding)) trackedBindings[binding] = indexBindings[binding];
            }
            var trackedIR = new KernelCompiler().compileGraph(
                FreeIndex.functions.recoverTrackedFreeBlocksKernel,
                FreeIndex.functions, {constantBindings: trackedBindings});
            var trackedIndexer = backend.compile(trackedIR);
            var clearLinksIR = new KernelCompiler().compile(
                clearFreeRegionLinksKernel, {
                    constantBindings: CollectorLayout,
                    constantNamespaces: collectorNamespaces
                });
            var linkReleaser = backend.compile(clearLinksIR);
            if (nativeMemory) {
                sharedX86 = sweeper;
                sharedMarkX86 = marker;
                sharedIndexX86 = indexer;
                sharedTrackedIndexX86 = trackedIndexer;
                sharedClearLinksX86 = linkReleaser;
            } else {
                sharedJS = sweeper;
                sharedMarkJS = marker;
                sharedIndexJS = indexer;
                sharedTrackedIndexJS = trackedIndexer;
                sharedClearLinksJS = linkReleaser;
            }
        }
        this.heap = heap;
        this.compiled = heap.memory.nativeAddress(0) && sharedX86.fn ?
                        sharedX86 : sharedJS;
        this.marker = heap.memory.nativeAddress(0) && sharedMarkX86.fn ?
                      sharedMarkX86 : sharedMarkJS;
        this.indexer = heap.memory.nativeAddress(0) && sharedIndexX86.fn ?
                       sharedIndexX86 : sharedIndexJS;
        this.trackedIndexer = heap.memory.nativeAddress(0) && sharedTrackedIndexX86.fn ?
                       sharedTrackedIndexX86 : sharedTrackedIndexJS;
        this.linkReleaser = heap.memory.nativeAddress(0) &&
            sharedClearLinksX86.fn ? sharedClearLinksX86 : sharedClearLinksJS;
    }

    HeapSweeper.prototype.clearFreeRegionLinks = function (head) {
        if (!head) return 0;
        var heap = this.heap;
        var cleared = this.linkReleaser.backend === "i386" ?
            this.linkReleaser.fn(heap.memory.nativeAddress(0), heap.bump, head) :
            this.linkReleaser.fn(heap.memory, 0, heap.bump, head);
        if (cleared < 0) {
            throw new Error("invalid native allocator free-region chain");
        }
        return cleared;
    };

    HeapSweeper.prototype.mark = function (generation) {
        if (this.marker.backend === "i386") {
            return this.marker.fn(this.heap.memory.nativeAddress(0),
                this.heap.bump, this.heap.collectorStackBase,
                this.heap.byteLength, generation,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1) | 0;
        }
        return this.marker.fn(this.heap.memory, 0, this.heap.bump,
                              this.heap.collectorStackBase,
                              this.heap.byteLength, generation,
                              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1) | 0;
    };

    /* The marker publishes four diagnostic words before returning an invalid
     * edge/layout status. Read them only for those statuses: on stack overflow
     * the same workspace still contains ordinary pending mark addresses. */
    HeapSweeper.prototype.describeMarkFailure = function (status) {
        if (status === MarkStatus.WORK_STACK_EXHAUSTED) {
            return "native guest marker exhausted its work stack";
        }
        if (status !== MarkStatus.INVALID_REFERENCE && status !== MarkStatus.INVALID_RECORD_LAYOUT) {
            return "native guest marker returned unknown status " + status;
        }
        var workspace = this.heap.collectorStackBase;
        var diagnostic = this.heap.memory;
        var field = 0;
        function nextWord() {
            var value = diagnostic.readU32Trusted(workspace + field * Heap.WORD_BYTES);
            field++;
            return value;
        }
        var record = nextWord();
        var type = nextWord();
        var referenceIndex = nextWord();
        var target = nextWord();
        return "native guest marker found " +
            (status === MarkStatus.INVALID_REFERENCE ? "an invalid reference" : "an invalid record layout") +
            ": record=" + record + " type=" + type +
            " referenceIndex=" + referenceIndex +
            (status === MarkStatus.INVALID_REFERENCE ? " target=" : " recordBytes=") + target;
    };

    HeapSweeper.prototype.sweep = function (generation) {
        if (this.compiled.backend === "i386") {
            return this.compiled.fn(this.heap.memory.nativeAddress(0),
                                    this.heap.bump, generation,
                                    this.heap.memory.host.freePointer) >>> 0;
        }
        return this.compiled.fn(this.heap.memory, 0,
                                this.heap.bump, generation, 0) >>> 0;
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
        return this.installFreeBlockIndex(count);
    };

    HeapSweeper.prototype.recoverTrackedFreeBlocks = function (freeHead, retiredHead, remainder) {
        var heap = this.heap, layout = FreeIndex.layout;
        var index = 0, count = heap.freeBlocks.length;
        if (heap.collectorStackBase + (layout.FIRST_ADDRESS_WORD + count) * Heap.WORD_BYTES > heap.byteLength) {
            this.clearFreeRegionLinks(freeHead);
            this.clearFreeRegionLinks(retiredHead);
            return this.rebuildFreeBlocks();
        }
        while (index < count) {
            heap.memory.writeU32(heap.collectorStackBase +
                (layout.FIRST_ADDRESS_WORD + index) * Heap.WORD_BYTES, heap.freeBlocks[index]);
            index++;
        }
        if (this.trackedIndexer.backend === "i386") {
            count = this.trackedIndexer.fn(heap.memory.nativeAddress(0), heap.bump,
                heap.collectorStackBase, heap.byteLength, freeHead, retiredHead, remainder, count) | 0;
        } else {
            count = this.trackedIndexer.fn(heap.memory, 0, heap.bump,
                heap.collectorStackBase, heap.byteLength, freeHead, retiredHead, remainder, count) | 0;
        }
        if (count === -1) return this.rebuildFreeBlocks();
        if (count < 0) throw new Error("invalid tracked native free region");
        return this.installFreeBlockIndex(count);
    };

    HeapSweeper.prototype.installFreeBlockIndex = function (count) {
        var heap = this.heap, layout = FreeIndex.layout;
        var rebuiltBump = heap.memory.readU32Trusted(
            heap.collectorStackBase + layout.BUMP_WORD * Heap.WORD_BYTES);
        this.reusableBytes = heap.memory.readU32Trusted(
            heap.collectorStackBase + layout.FREE_BYTES_WORD * Heap.WORD_BYTES);
        var blocks = [];
        var index = 0;
        while (index < count) {
            blocks[index] = heap.memory.readU32Trusted(
                heap.collectorStackBase + (layout.FIRST_ADDRESS_WORD + index) * Heap.WORD_BYTES);
            index++;
        }
        heap.bump = rebuiltBump;
        heap.freeBlocks = blocks;
        heap.freeBlocksAreMaxHeap = false;
        return count;
    };

    /* The standalone interpreter compiles these same kernels into its native
     * dependency graph. Export the kernel-dialect sources as properties of
     * the implementation object so host-coordinated and self-coordinated
     * collection cannot drift into separate marking or sweeping semantics. */
    HeapSweeper.markKernel = heapMarkKernel;
    HeapSweeper.kernelNamespaces = collectorNamespaces;
    HeapSweeper.sweepKernel = heapSweepKernel;

    root.GuestVMHeapSweeper = HeapSweeper;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = HeapSweeper;
    }
}(this));
