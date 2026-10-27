/* Authoritative guest-record layouts. Consumers use these named accessors and
 * never calculate record offsets or touch linear memory directly. Host-side
 * handles contain only a runtime identity and a record address. */
(function (root) {
    var Heap = root.GuestVMHeap;
    var ValueCells = root.GuestVMValueCells;
    var Bytecode = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) {
        Heap = require("./heap.js");
        ValueCells = require("./value_cell.js");
        Bytecode = require("./bytecode.js");
    }

    var CELL_BYTES = ValueCells.PAYLOAD_BYTES;
    var INITIAL_ARRAY_CAPACITY = 4;
    var MAX_VECTOR_LENGTH = 134217726;

    /* Shared geometric growth policy for both execution backends. Validate
     * the bound before multiplication so a large index cannot wrap capacity. */
    function grownArrayCapacityKernel(capacity, required) {
        if (required > MAX_VECTOR_LENGTH) return 0;
        if (capacity < INITIAL_ARRAY_CAPACITY) capacity = INITIAL_ARRAY_CAPACITY;
        while (capacity < required) {
            var growth = capacity;
            if (growth > MAX_VECTOR_LENGTH - capacity) capacity = required;
            else capacity = capacity + growth;
        }
        return capacity;
    }

    var OBJECT_PROTOTYPE = 0;
    var OBJECT_PROPERTIES = 4;
    var OBJECT_EXTENSIBLE = 8;
    var OBJECT_PROPERTY_INDEX = 12;
    var OBJECT_BYTES = 16;
    var PROPERTY_INDEX_HEAD = 0;
    var PROPERTY_INDEX_VERSION = 4;
    var PROPERTY_INDEX_COUNT = 8;
    var PROPERTY_INDEX_CAPACITY = 12;
    var PROPERTY_INDEX_SLOTS = 16;
    var PROPERTY_INDEX_MINIMUM_PROPERTIES = 32;
    var PROPERTY_STORAGE_LENGTH = 0;
    var PROPERTY_STORAGE_CAPACITY = 4;
    var PROPERTY_STORAGE_LIVE_COUNT = 8;
    var PROPERTY_STORAGE_HASH = 12;
    var PROPERTY_STORAGE_ENTRIES = 16;
    var PROPERTY_NEXT = 0;
    var PROPERTY_KEY = 4;
    var PROPERTY_ATTRIBUTES = 8;
    var PROPERTY_SETTER = 12;
    var PROPERTY_VALUE = 16;
    var PROPERTY_BYTES = PROPERTY_VALUE + CELL_BYTES;

    /* A transient descriptor view starts at the key in either layout. Put
     * packed padding last: the common value cell is then at the same offset
     * as a legacy descriptor, and its binary64 payload is 8-byte aligned. */
    var PROPERTY_DESCRIPTOR_KEY = 0;
    var PROPERTY_DESCRIPTOR_ATTRIBUTES = PROPERTY_ATTRIBUTES - PROPERTY_KEY;
    var PROPERTY_DESCRIPTOR_SETTER = PROPERTY_SETTER - PROPERTY_KEY;
    var PROPERTY_DESCRIPTOR_VALUE = PROPERTY_VALUE - PROPERTY_KEY;
    var PROPERTY_ENTRY_KEY = PROPERTY_DESCRIPTOR_KEY;
    var PROPERTY_ENTRY_ATTRIBUTES = PROPERTY_DESCRIPTOR_ATTRIBUTES;
    var PROPERTY_ENTRY_SETTER = PROPERTY_DESCRIPTOR_SETTER;
    var PROPERTY_ENTRY_VALUE = PROPERTY_DESCRIPTOR_VALUE;
    var PROPERTY_ENTRY_PADDING = PROPERTY_ENTRY_VALUE + CELL_BYTES;
    var PROPERTY_ENTRY_BYTES = PROPERTY_ENTRY_PADDING + Heap.WORD_BYTES;
    var PROPERTY_STORAGE_INITIAL_CAPACITY = 4;
    var PROPERTY_RECORD_SNAPSHOT_PIN = 0x80000000 | 0;
    var PROPERTY_STORAGE_EPOCH_MASK = 0x7fffffff;

    var STRING_LENGTH = 0;
    var STRING_HASH = 4;
    var STRING_CHARS = 8;
    var STRING_ROPE_LEFT = 8;
    var STRING_ROPE_RIGHT = 12;
    var STRING_ROPE_DEPTH = 16;
    var STRING_ROPE_FLAG = 1;
    var STRING_LATIN1_FLAG = 2;
    var VECTOR_SHARED_METADATA_FLAG = 1;
    var STRING_SLICE_FLAG = 4;
    var STRING_KEY_HASH_FLAG = 8;
    var STRING_HASH_OFFSET_BASIS = -2128831035;
    var STRING_HASH_PRIME = 16777619;
    var STRING_SLICE_BACKING = 8;
    var STRING_SLICE_START = 12;
    var STRING_DECODE_CHUNK_UNITS = 256;

    var VECTOR_LENGTH = 0;
    var VECTOR_CAPACITY = 4;
    var VECTOR_CELLS = 8;

    var ARRAY_PROTOTYPE = 0;
    var ARRAY_PROPERTIES = 4;
    var ARRAY_ELEMENTS = 8;
    var ARRAY_RESERVED = 12;
    var ARRAY_BYTES = 16;

    var ENVIRONMENT_PARENT = 0;
    var ENVIRONMENT_COUNT = 4;
    var ENVIRONMENT_PROGRAM = 8;
    var ENVIRONMENT_RESERVED = 12;
    var ENVIRONMENT_CELLS = 16;

    var FUNCTION_PROTOTYPE = 0;
    var FUNCTION_PROPERTIES = 4;
    var FUNCTION_CLOSURE = 8;
    var FUNCTION_METADATA = 12;
    var FUNCTION_HOME_CONTEXT = 16;
    var FUNCTION_GC_NEXT = 20;
    var FUNCTION_BYTES = 24;

    var FRAME_PROGRAM = 0;
    var FRAME_ENVIRONMENT = 4;
    var FRAME_CALLER = 8;
    var FRAME_PC = 12;
    var FRAME_RETURN_SLOT = 16;
    var FRAME_REGISTER_COUNT = 20;
    var FRAME_HANDLER = 24;
    var FRAME_CONTEXT = 28;
    var FRAME_REGISTERS = 32;

    var HANDLER_NEXT = 0;
    var HANDLER_TARGET = 4;
    var HANDLER_BINDING_SLOT = 8;
    var HANDLER_RESERVED = 12;
    var HANDLER_BYTES = 16;

    var BYTECODE_LENGTH = 0;
    var BYTECODE_EXECUTION_CACHE = 4;
    var BYTECODE_WORDS = 8;
    var BYTECODE_COMPACT_FLAG = 1;
    var BYTECODE_COMPACT8_FLAG = 2;
    var BYTECODE_WIDE_COUNT_SHIFT = 2;
    var BYTECODE_PACKED_UNIT_BYTES = 2;
    var BYTECODE_PACKED_MINUS_ONE = 65534;
    var BYTECODE_PACKED_WIDE = 65535;
    var BYTECODE_PACKED8_MINUS_ONE = 254;
    var BYTECODE_PACKED8_WIDE = 255;
    var BYTECODE_WIDE_ENTRY_WORDS = 2;
    var INTEGER_VECTOR_EXECUTION_CACHE = 8;
    var INTEGER_VECTOR_RESERVED = 12;
    var INTEGER_VECTOR_VALUES = 16;
    var CONSTANT_POOL_LENGTH = 0;
    var CONSTANT_POOL_EXECUTION_CACHE = 4;
    var CONSTANT_POOL_TAGS = 8;
    var CONSTANT_POOL_PAYLOAD_BYTES = 4;

    var PROGRAM_BYTECODE = 0;
    var PROGRAM_CONSTANTS = 4;
    var PROGRAM_CONSTANT_REGISTERS = 8;
    var PROGRAM_BINDING_REGISTERS = 12;
    var PROGRAM_PARAMETER_SLOTS = 16;
    var PROGRAM_REGISTER_COUNT = 20;
    var PROGRAM_ARGUMENTS_SLOT = 24;
    var PROGRAM_THIS_SLOT = 28;
    var PROGRAM_FUNCTION_NAME_SLOT = 32;
    var PROGRAM_METADATA = 36;
    var PROGRAM_FLAGS = 40;
    var PROGRAM_BINDING_COUNT = 44;
    var PROGRAM_SOURCE = 48;
    var PROGRAM_BYTES = 56;

    var CONTEXT_GLOBAL = 0;
    var CONTEXT_ACTIVE_FRAME = 4;
    var CONTEXT_FLAGS = 8;
    var CONTEXT_NEXT = 12;
    var CONTEXT_BYTES = 16;

    var ROOT_SLOT_VALUE = 0;
    var ROOT_SLOT_NEXT = CELL_BYTES;
    var ROOT_SLOT_BYTES = ROOT_SLOT_NEXT + 4;

    var ENGINE_EXIT_REASON = 0;
    var ENGINE_PC = 4;
    var ENGINE_RESULT_CELL = 8;
    var ENGINE_INSTRUCTIONS = 12;
    var ENGINE_HEAP_BUMP = 16;
    var ENGINE_HEAP_LIMIT = 20;
    var ENGINE_CURRENT_FRAME = 24;
    var ENGINE_CALL_REJECT_REASON = 28;
    var ENGINE_FREE_FRAME = 32;
    var ENGINE_SCRATCH_LEFT = 36;
    /* Each scratch area can hold a complete tagged value or a binary64
     * temporary. Word-sized slots let those writes corrupt adjacent fields. */
    var ENGINE_SCRATCH_RIGHT = ENGINE_SCRATCH_LEFT + CELL_BYTES;
    var ENGINE_PLATFORM_SERVICES = ENGINE_SCRATCH_RIGHT + CELL_BYTES;
    var ENGINE_OPCODE_COUNTS = ENGINE_PLATFORM_SERVICES + 4;
    var ENGINE_CLOCK_SECONDS = ENGINE_SCRATCH_LEFT;
    var ENGINE_CLOCK_MICROSECONDS = ENGINE_CLOCK_SECONDS + 4;
    /* Include reserved slot zero; allocator fields follow this vector. */
    var ENGINE_OPCODE_TAG_STRIDE = Bytecode.NAMES.length;
    var ENGINE_OPCODE_TAG_COUNT = ValueCells.Tags.REFERENCE + 1;
    var ENGINE_OPCODE_LEFT_TAG_BASE = ENGINE_OPCODE_TAG_STRIDE;
    var ENGINE_OPCODE_RIGHT_TAG_BASE = ENGINE_OPCODE_TAG_STRIDE *
        (1 + ENGINE_OPCODE_TAG_COUNT);
    var ENGINE_OPCODE_COUNT = ENGINE_OPCODE_TAG_STRIDE *
        (1 + ENGINE_OPCODE_TAG_COUNT * 2);
    var ENGINE_NATIVE_REGION_END =
        ENGINE_OPCODE_COUNTS + ENGINE_OPCODE_COUNT * 4;
    var ENGINE_NATIVE_FREE_REGION = ENGINE_NATIVE_REGION_END + 4;
    var ENGINE_NATIVE_TAIL_BUMP = ENGINE_NATIVE_FREE_REGION + 4;
    var ENGINE_NATIVE_TAIL_LIMIT = ENGINE_NATIVE_TAIL_BUMP + 4;
    var ENGINE_NATIVE_MAX_LIMIT = ENGINE_NATIVE_TAIL_LIMIT + 4;
    var ENGINE_NATIVE_REGION_ACTIVE = ENGINE_NATIVE_MAX_LIMIT + 4;
    var ENGINE_ALLOCATION_FAILED = ENGINE_NATIVE_REGION_ACTIVE + 4;
    var ENGINE_NATIVE_RETIRED_REGION = ENGINE_ALLOCATION_FAILED + 4;
    var ENGINE_PROPERTY_CACHE = ENGINE_NATIVE_RETIRED_REGION + 4;
    var PROPERTY_CACHE_ENTRY_BYTES = 24;
    var PROPERTY_CACHE_ENTRY_COUNT = 256;
    var ENGINE_PROPERTY_CACHE_OBJECT = ENGINE_PROPERTY_CACHE;
    var ENGINE_PROPERTY_CACHE_KEY = ENGINE_PROPERTY_CACHE + 4;
    var ENGINE_PROPERTY_CACHE_VERSION = ENGINE_PROPERTY_CACHE + 8;
    var ENGINE_PROPERTY_CACHE_GENERATION = ENGINE_PROPERTY_CACHE + 12;
    var ENGINE_PROPERTY_CACHE_HEAD = ENGINE_PROPERTY_CACHE + 16;
    var ENGINE_PROPERTY_CACHE_PROPERTY = ENGINE_PROPERTY_CACHE + 20;
    var ENGINE_GC_GENERATION = ENGINE_PROPERTY_CACHE +
        PROPERTY_CACHE_ENTRY_BYTES * PROPERTY_CACHE_ENTRY_COUNT;
    var ENGINE_GC_STACK_BASE = ENGINE_GC_GENERATION + 4;
    var ENGINE_GC_STACK_LIMIT = ENGINE_GC_STACK_BASE + 4;
    var ENGINE_GC_COLLECTIONS = ENGINE_GC_STACK_LIMIT + 4;
    var ENGINE_GC_ROOT = ENGINE_GC_COLLECTIONS + 4;
    var ENGINE_GC_CONTEXT_HEAD = ENGINE_GC_ROOT + 4;
    var ENGINE_GC_NATIVE_FUNCTION_HEAD = ENGINE_GC_CONTEXT_HEAD + 4;
    var ENGINE_GC_ROOT_SLOT_HEAD = ENGINE_GC_NATIVE_FUNCTION_HEAD + 4;
    var ENGINE_GC_MARK_US = ENGINE_GC_ROOT_SLOT_HEAD + 4;
    var ENGINE_GC_SWEEP_US = ENGINE_GC_MARK_US + 4;
    var ENGINE_GC_INDEX_US = ENGINE_GC_SWEEP_US + 4;
    var ENGINE_GC_TOTAL_US = ENGINE_GC_INDEX_US + 4;
    var ENGINE_GC_MAX_PAUSE_US = ENGINE_GC_TOTAL_US + 4;
    var ENGINE_GC_LIVE_BYTES = ENGINE_GC_MAX_PAUSE_US + 4;
    var ENGINE_GC_STRESS_INTERVAL = ENGINE_GC_LIVE_BYTES + 4;
    var GC_STRESS_DEFAULT_INTERVAL = 1000000;
    var ENGINE_GC_STRESS_REMAINING = ENGINE_GC_STRESS_INTERVAL + 4;
    var ENGINE_STATE_BYTES = ENGINE_GC_STRESS_REMAINING + 4;

    var REGEXP_PATTERN = 0;
    var REGEXP_FLAGS = 4;
    var REGEXP_PROTOTYPE = 8;
    var REGEXP_BYTES = 16;

    var BUFFER_VIEW_BACKING = 0;
    var BUFFER_VIEW_OFFSET = 4;
    var BUFFER_VIEW_LENGTH = 8;
    var BUFFER_VIEW_PROTOTYPE = 12;
    var BUFFER_VIEW_PROPERTIES = 16;
    var BUFFER_VIEW_KIND = 20;
    var BUFFER_VIEW_BYTES = 24;

    var BUFFER_BACKING_POINTER = 0;
    var BUFFER_BACKING_LENGTH = 4;
    var BUFFER_BACKING_METADATA = 8;
    var BUFFER_BACKING_DATA = 16;

    var PLATFORM_DLSYM_POINTER = 0;
    var PLATFORM_WRITE_POINTER = 4;
    var PLATFORM_POLL_POINTER = 8;
    var PLATFORM_CLOCK_GETTIME_POINTER = 12;
    var PLATFORM_EXIT_POINTER = 16;
    var PLATFORM_ARRAY_SLICE_POINTER = 20;
    var PLATFORM_ARRAY_CONCAT_POINTER = 24;
    var PLATFORM_GETTIMEOFDAY_POINTER = 28;
    var PLATFORM_DATE_INTRINSIC_POINTER = 32;
    var PLATFORM_NUMERIC_PROPERTY_POINTER = 36;
    var PLATFORM_STRTOD_POINTER = 40;
    var PLATFORM_MALLOC_POINTER = 44;
    var PLATFORM_FREE_POINTER = 48;
    var PLATFORM_SNPRINTF_POINTER = 52;
    var PLATFORM_MEMSET_POINTER = 56;
    var PLATFORM_CALLOC_POINTER = 60;
    var PLATFORM_SERVICES_BYTES = 64;

    var ATTR_WRITABLE = 1;
    var ATTR_ENUMERABLE = 2;
    var ATTR_CONFIGURABLE = 4;
    var ATTR_ACCESSOR = 8;
    var DEFAULT_ATTRIBUTES = ATTR_WRITABLE | ATTR_ENUMERABLE | ATTR_CONFIGURABLE;

    function Records(heap, cells) {
        if (!heap || !cells || cells.heap !== heap) {
            throw new TypeError("heap records require one heap and its value cells");
        }
        if (heap.memory.allocation && heap.memory.allocation.isNative) {
            var records = this;
            heap.bufferBackingReleaser = function (address) {
                records.releaseExternalBufferBacking(address);
            };
        }
        this.heap = heap;
        this.cells = cells;
    }

    Records.Attributes = {WRITABLE: ATTR_WRITABLE,
                          ENUMERABLE: ATTR_ENUMERABLE,
                          CONFIGURABLE: ATTR_CONFIGURABLE,
                          ACCESSOR: ATTR_ACCESSOR,
                          DEFAULT: DEFAULT_ATTRIBUTES};
    Records.BytecodeLayout = {wideCountContract: 60};
    /* Executable compatibility changes independently of the heap layout.
     * Bump when native kernel/backend semantics change: loaders deliberately
     * do not fingerprint current sources at startup. */
    Records.NativeInterpreterContractVersion = 62;
    Records.grownArrayCapacity = grownArrayCapacityKernel;

    Records.PropertyStorageLayout = {
        ENTRY_BYTES: PROPERTY_ENTRY_BYTES,
        ENTRIES: PROPERTY_STORAGE_ENTRIES,
        VALUE: PROPERTY_ENTRY_VALUE
    };
    Records.LegacyPackedPropertyLayout = {compilerVersion: 51, VALUE: 16};
    Records.PropertyRecordSnapshotPin = PROPERTY_RECORD_SNAPSHOT_PIN;

    /* Kernel-dialect source declares same-named constants so it remains
     * independently parseable. The compiler substitutes these authoritative
     * record-layout values, avoiding duplicated offsets in the dispatcher. */
    Records.KernelConstants = {
        BUFFER_BACKING_EXTERNAL_FLAG: Heap.BufferBackingPolicy.EXTERNAL,
        BUFFER_BACKING_POINTER: Heap.HEADER_SIZE + BUFFER_BACKING_POINTER,
        LARGE_BUFFER_BYTES: Heap.BufferBackingPolicy.LARGE_BYTES,
        PLATFORM_CALLOC_POINTER: Heap.HEADER_SIZE + PLATFORM_CALLOC_POINTER,
        INITIAL_ARRAY_CAPACITY: INITIAL_ARRAY_CAPACITY,
        MAX_VECTOR_LENGTH: MAX_VECTOR_LENGTH,
        PROPERTY_RECORD_SNAPSHOT_PIN: PROPERTY_RECORD_SNAPSHOT_PIN,
        PROPERTY_STORAGE_EPOCH_MASK: PROPERTY_STORAGE_EPOCH_MASK,
        PROPERTY_DESCRIPTOR_KEY: PROPERTY_DESCRIPTOR_KEY,
        PROPERTY_DESCRIPTOR_ATTRIBUTES: PROPERTY_DESCRIPTOR_ATTRIBUTES,
        PROPERTY_DESCRIPTOR_SETTER: PROPERTY_DESCRIPTOR_SETTER,
        PROPERTY_DESCRIPTOR_VALUE: PROPERTY_DESCRIPTOR_VALUE,
        HEAP_TYPE_PROPERTY_STORAGE: Heap.Types.PROPERTY_STORAGE,
        PROPERTY_STORAGE_LENGTH: Heap.HEADER_SIZE + PROPERTY_STORAGE_LENGTH,
        PROPERTY_STORAGE_CAPACITY: Heap.HEADER_SIZE + PROPERTY_STORAGE_CAPACITY,
        PROPERTY_STORAGE_LIVE_COUNT: Heap.HEADER_SIZE + PROPERTY_STORAGE_LIVE_COUNT,
        PROPERTY_STORAGE_HASH: Heap.HEADER_SIZE + PROPERTY_STORAGE_HASH,
        PROPERTY_STORAGE_ENTRIES: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES,
        PROPERTY_STORAGE_ENTRY_BYTES: PROPERTY_ENTRY_BYTES,
        PROPERTY_STORAGE_RECORD_BYTES: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES,
        PROPERTY_STORAGE_SINGLE_BYTES: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES + PROPERTY_ENTRY_BYTES,
        PROPERTY_STORAGE_PAIR_BYTES: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES + PROPERTY_ENTRY_BYTES * 2,
        PROPERTY_STORAGE_INITIAL_CAPACITY: PROPERTY_STORAGE_INITIAL_CAPACITY,
        PROPERTY_STORAGE_KEY: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES + PROPERTY_ENTRY_KEY,
        PROPERTY_STORAGE_ATTRIBUTES: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES + PROPERTY_ENTRY_ATTRIBUTES,
        PROPERTY_STORAGE_PADDING: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES + PROPERTY_ENTRY_PADDING,
        PROPERTY_STORAGE_SETTER: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES + PROPERTY_ENTRY_SETTER,
        PROPERTY_STORAGE_VALUE: Heap.HEADER_SIZE + PROPERTY_STORAGE_ENTRIES + PROPERTY_ENTRY_VALUE,
        HEAP_WORD_BYTES: Heap.WORD_BYTES,
        HEAP_RECORD_ALIGNMENT: Heap.RECORD_ALIGNMENT,
        HEAP_TYPE_INTEGER_VECTOR: Heap.Types.INTEGER_VECTOR,
        HEAP_TYPE_CONSTANT_POOL: Heap.Types.CONSTANT_POOL,
        CONSTANT_POOL_LENGTH: Heap.HEADER_SIZE + CONSTANT_POOL_LENGTH,
        CONSTANT_POOL_EXECUTION_CACHE: Heap.HEADER_SIZE + CONSTANT_POOL_EXECUTION_CACHE,
        CONSTANT_POOL_TAGS: Heap.HEADER_SIZE + CONSTANT_POOL_TAGS,
        CONSTANT_POOL_PAYLOAD_BYTES: CONSTANT_POOL_PAYLOAD_BYTES,
        INTEGER_VECTOR_EXECUTION_CACHE: Heap.HEADER_SIZE + INTEGER_VECTOR_EXECUTION_CACHE,
        INTEGER_VECTOR_RESERVED: Heap.HEADER_SIZE + INTEGER_VECTOR_RESERVED,
        INTEGER_VECTOR_VALUES: Heap.HEADER_SIZE + INTEGER_VECTOR_VALUES,
        INTEGER_VECTOR_FIXED_BYTES: Heap.HEADER_SIZE + INTEGER_VECTOR_VALUES,
        HEAP_HEADER_BYTES: Heap.HEADER_SIZE,
        HEAP_LAST_RECORD_TYPE: Heap.LastRecordType,
        HEAP_TYPE_PROPERTY_INDEX: Heap.Types.PROPERTY_INDEX,
        OBJECT_PROPERTY_INDEX: Heap.HEADER_SIZE + OBJECT_PROPERTY_INDEX,
        PROPERTY_INDEX_HEAD: Heap.HEADER_SIZE + PROPERTY_INDEX_HEAD,
        PROPERTY_INDEX_VERSION: Heap.HEADER_SIZE + PROPERTY_INDEX_VERSION,
        PROPERTY_INDEX_COUNT: Heap.HEADER_SIZE + PROPERTY_INDEX_COUNT,
        PROPERTY_INDEX_CAPACITY: Heap.HEADER_SIZE + PROPERTY_INDEX_CAPACITY,
        PROPERTY_INDEX_SLOTS: Heap.HEADER_SIZE + PROPERTY_INDEX_SLOTS,
        PROPERTY_INDEX_RECORD_BYTES: Heap.HEADER_SIZE + PROPERTY_INDEX_SLOTS,
        PROPERTY_INDEX_MINIMUM_PROPERTIES: PROPERTY_INDEX_MINIMUM_PROPERTIES,
        PROPERTY_INDEX_UNAVAILABLE: -1,
        PLATFORM_MEMSET_POINTER: Heap.HEADER_SIZE + PLATFORM_MEMSET_POINTER,
        HEAP_TYPE_BYTECODE: Heap.Types.BYTECODE,
        BYTECODE_COMPACT_FLAG: BYTECODE_COMPACT_FLAG,
        BYTECODE_COMPACT8_FLAG: BYTECODE_COMPACT8_FLAG,
        BYTECODE_WIDE_COUNT_SHIFT: BYTECODE_WIDE_COUNT_SHIFT,
        BYTECODE_PACKED8_MINUS_ONE: BYTECODE_PACKED8_MINUS_ONE,
        BYTECODE_PACKED8_WIDE: BYTECODE_PACKED8_WIDE,
        BYTECODE_PACKED_UNIT_BYTES: BYTECODE_PACKED_UNIT_BYTES,
        BYTECODE_PACKED_MINUS_ONE: BYTECODE_PACKED_MINUS_ONE,
        BYTECODE_PACKED_WIDE: BYTECODE_PACKED_WIDE,
        BYTECODE_WIDE_ENTRY_WORDS: BYTECODE_WIDE_ENTRY_WORDS,
        BYTECODE_EXECUTION_CACHE: Heap.HEADER_SIZE + BYTECODE_EXECUTION_CACHE,
        ENGINE_OPCODE_COUNT: ENGINE_OPCODE_COUNT,
        ENGINE_OPCODE_TAG_STRIDE: ENGINE_OPCODE_TAG_STRIDE,
        ENGINE_OPCODE_TAG_COUNT: ENGINE_OPCODE_TAG_COUNT,
        ENGINE_OPCODE_LEFT_TAG_BASE: ENGINE_OPCODE_LEFT_TAG_BASE,
        ENGINE_OPCODE_RIGHT_TAG_BASE: ENGINE_OPCODE_RIGHT_TAG_BASE,
        RECORD_TYPE: Heap.HeaderFields.TYPE,
        RECORD_SIZE: Heap.HeaderFields.SIZE,
        RECORD_MARK: Heap.HeaderFields.MARK,
        RECORD_FLAGS: Heap.HeaderFields.FLAGS,
        HEAP_TYPE_PROPERTY: Heap.Types.PROPERTY,
        PROPERTY_RECORD_BYTES: Heap.HEADER_SIZE + PROPERTY_BYTES,
        PROPERTY_NEXT: Heap.HEADER_SIZE + PROPERTY_NEXT,
        PROPERTY_KEY: Heap.HEADER_SIZE + PROPERTY_KEY,
        PROPERTY_ATTRIBUTES: Heap.HEADER_SIZE + PROPERTY_ATTRIBUTES,
        PROPERTY_SETTER: Heap.HEADER_SIZE + PROPERTY_SETTER,
        PROPERTY_VALUE: Heap.HEADER_SIZE + PROPERTY_VALUE,
        PROPERTY_ENUMERABLE: ATTR_ENUMERABLE,
        OBJECT_PROPERTY_HEAD: Heap.HEADER_SIZE + OBJECT_PROPERTIES,
        VALUE_CELL_TAG: ValueCells.KernelConstants.VALUE_CELL_TAG,
        VALUE_CELL_LOW: ValueCells.KernelConstants.VALUE_CELL_LOW,
        VALUE_CELL_HIGH: ValueCells.KernelConstants.VALUE_CELL_HIGH,
        VALUE_CELL_AUX: ValueCells.KernelConstants.VALUE_CELL_AUX,
        ENGINE_SCRATCH_LEFT: ENGINE_SCRATCH_LEFT,
        ENGINE_SCRATCH_RIGHT: ENGINE_SCRATCH_RIGHT,
        ENGINE_PLATFORM_SERVICES: ENGINE_PLATFORM_SERVICES,
        ENGINE_RECORD_PLATFORM_SERVICES: Heap.HEADER_SIZE + ENGINE_PLATFORM_SERVICES,
        ENGINE_OPCODE_COUNTS: ENGINE_OPCODE_COUNTS,
        ENGINE_CLOCK_SECONDS: ENGINE_CLOCK_SECONDS,
        ENGINE_CLOCK_MICROSECONDS: ENGINE_CLOCK_MICROSECONDS,
        ENGINE_NATIVE_REGION_END: ENGINE_NATIVE_REGION_END,
        ENGINE_NATIVE_FREE_REGION: ENGINE_NATIVE_FREE_REGION,
        ENGINE_NATIVE_TAIL_BUMP: ENGINE_NATIVE_TAIL_BUMP,
        ENGINE_NATIVE_TAIL_LIMIT: ENGINE_NATIVE_TAIL_LIMIT,
        ENGINE_NATIVE_MAX_LIMIT: ENGINE_NATIVE_MAX_LIMIT,
        ENGINE_NATIVE_REGION_ACTIVE: ENGINE_NATIVE_REGION_ACTIVE,
        ENGINE_ALLOCATION_FAILED: ENGINE_ALLOCATION_FAILED,
        ENGINE_NATIVE_RETIRED_REGION: ENGINE_NATIVE_RETIRED_REGION,
        ENGINE_PROPERTY_CACHE_OBJECT: ENGINE_PROPERTY_CACHE_OBJECT,
        ENGINE_PROPERTY_CACHE_KEY: ENGINE_PROPERTY_CACHE_KEY,
        ENGINE_PROPERTY_CACHE_VERSION: ENGINE_PROPERTY_CACHE_VERSION,
        ENGINE_PROPERTY_CACHE_GENERATION: ENGINE_PROPERTY_CACHE_GENERATION,
        ENGINE_PROPERTY_CACHE_HEAD: ENGINE_PROPERTY_CACHE_HEAD,
        ENGINE_PROPERTY_CACHE_PROPERTY: ENGINE_PROPERTY_CACHE_PROPERTY,
        PROPERTY_CACHE_ENTRY_BYTES: PROPERTY_CACHE_ENTRY_BYTES,
        PROPERTY_CACHE_ENTRY_COUNT: PROPERTY_CACHE_ENTRY_COUNT,
        ENGINE_GC_GENERATION: ENGINE_GC_GENERATION,
        ENGINE_GC_STACK_BASE: ENGINE_GC_STACK_BASE,
        ENGINE_GC_STACK_LIMIT: ENGINE_GC_STACK_LIMIT,
        ENGINE_GC_COLLECTIONS: ENGINE_GC_COLLECTIONS,
        ENGINE_GC_ROOT: ENGINE_GC_ROOT,
        ENGINE_GC_CONTEXT_HEAD: ENGINE_GC_CONTEXT_HEAD,
        ENGINE_GC_NATIVE_FUNCTION_HEAD: ENGINE_GC_NATIVE_FUNCTION_HEAD,
        ENGINE_GC_ROOT_SLOT_HEAD: ENGINE_GC_ROOT_SLOT_HEAD,
        ENGINE_GC_MARK_US: ENGINE_GC_MARK_US,
        ENGINE_GC_SWEEP_US: ENGINE_GC_SWEEP_US,
        ENGINE_GC_INDEX_US: ENGINE_GC_INDEX_US,
        ENGINE_GC_TOTAL_US: ENGINE_GC_TOTAL_US,
        ENGINE_GC_MAX_PAUSE_US: ENGINE_GC_MAX_PAUSE_US,
        ENGINE_GC_LIVE_BYTES: ENGINE_GC_LIVE_BYTES,
        ENGINE_GC_STRESS_INTERVAL: ENGINE_GC_STRESS_INTERVAL,
        ENGINE_GC_STRESS_REMAINING: ENGINE_GC_STRESS_REMAINING,
        GC_STRESS_DEFAULT_INTERVAL: GC_STRESS_DEFAULT_INTERVAL,
        HEAP_FIRST_RECORD: Heap.FIRST_RECORD,
        MIN_NATIVE_REGION_BYTES: 256 + Heap.HEADER_SIZE,
        STRING_ROPE_FLAG: STRING_ROPE_FLAG,
        STRING_LATIN1_FLAG: STRING_LATIN1_FLAG,
        VECTOR_SHARED_METADATA_FLAG: VECTOR_SHARED_METADATA_FLAG,
        STRING_SLICE_FLAG: STRING_SLICE_FLAG,
        STRING_KEY_HASH_FLAG: STRING_KEY_HASH_FLAG,
        STRING_HASH_OFFSET_BASIS: STRING_HASH_OFFSET_BASIS,
        STRING_HASH_PRIME: STRING_HASH_PRIME,
        STRING_SLICE_BACKING: Heap.HEADER_SIZE + STRING_SLICE_BACKING,
        STRING_SLICE_START: Heap.HEADER_SIZE + STRING_SLICE_START,
        STRING_SLICE_RECORD_BYTES: Heap.HEADER_SIZE + STRING_SLICE_START + 4,
        STRING_ROPE_RECORD_BYTES:
            Heap.HEADER_SIZE + ((STRING_ROPE_DEPTH + 4 + 7) & -8),
        STRING_ROPE_LEFT: 16 + STRING_ROPE_LEFT,
        STRING_ROPE_RIGHT: 16 + STRING_ROPE_RIGHT,
        STRING_ROPE_DEPTH: 16 + STRING_ROPE_DEPTH
    };

    Records.prototype.makeHandle = function (runtime, address) {
        this.heap.requireRecord(address);
        return {ownerRuntime: runtime, heapAddress: address};
    };

    Records.prototype.addressOf = function (handle) {
        if (!handle || !handle.heapAddress) {
            throw new TypeError("value is not a guest heap handle");
        }
        return this.heap.requireRecord(handle.heapAddress);
    };

    /* Exact low-word multiplication using products representable in binary64.
     * The same source is compiled into the native kernel. Ordinary JS's
     * direct FNV multiplication can round away low bits before truncation. */
    function stringHashStep(hash, code) {
        var word = (hash ^ code) | 0;
        return ((word & 65535) * STRING_HASH_PRIME +
            ((((word >>> 16) * STRING_HASH_PRIME) & 65535) << 16)) | 0;
    }
    Records.stringHashStep = stringHashStep;

    Records.prototype.allocateString = function (value) {
        value = String(value);
        /* Select a lossless storage width. Hashes are computed only on demand.
         * Code-unit indexing/length never change. Wide strings, including
         * unpaired surrogates, retain their exact UTF-16 representation. */
        var index = 0;
        var latin1 = true;
        while (index < value.length) {
            var code = value.charCodeAt(index);
            if (code > 255) latin1 = false;
            index++;
        }
        var unitBytes = latin1 ? 1 : 2;
        var address = this.heap.allocateRecord(
            Heap.Types.STRING, STRING_CHARS + value.length * unitBytes);
        this.heap.writeTrustedFieldU32(address, STRING_LENGTH, value.length,
                                      Heap.Types.STRING);
        if (latin1) {
            this.heap.setFlags(address, STRING_LATIN1_FLAG);
            this.heap.writeStringFieldLatin1(address, STRING_CHARS, value,
                                             Heap.Types.STRING);
        } else {
            this.heap.writeStringFieldUTF16LE(address, STRING_CHARS, value,
                                             Heap.Types.STRING);
        }
        this.heap.writeTrustedFieldU32(address, STRING_HASH, 0, Heap.Types.STRING);
        return address;
    };

    Records.prototype.stringLength = function (address) {
        return this.heap.readTrustedFieldU32(address, STRING_LENGTH, Heap.Types.STRING);
    };

    /* An immutable view retains its backing through the ordinary GC graph.
     * Normalize nested views here so character lookup never walks a chain of
     * source nesting levels. Offsets and lengths are UTF-16 code units. */
    Records.prototype.allocateStringSlice = function (backing, start, length) {
        if (start < 0 || length < 0 || start !== Math.floor(start) ||
                length !== Math.floor(length) ||
                start + length > this.stringLength(backing)) {
            throw new RangeError("string slice is out of bounds");
        }
        if (start === 0 && length === this.stringLength(backing)) return backing;
        while (this.stringIsSlice(backing)) {
            start += this.stringSliceStart(backing);
            backing = this.stringSliceBacking(backing);
        }
        /* Like ropes, views have no precomputed hash. Equality compares code
         * units. The new view starts without a canonical cached hash. */
        var address = this.heap.allocateRecordWords(Heap.Types.STRING,
            STRING_SLICE_START + 4, length, 0, backing, start);
        this.heap.setFlags(address, STRING_SLICE_FLAG);
        return address;
    };

    Records.prototype.stringIsSlice = function (address) {
        this.heap.requireRecord(address, Heap.Types.STRING);
        return !!(this.heap.flags(address) & STRING_SLICE_FLAG);
    };

    Records.prototype.stringSliceBacking = function (address) {
        return this.heap.readTrustedFieldU32(
            address, STRING_SLICE_BACKING, Heap.Types.STRING);
    };

    Records.prototype.stringSliceStart = function (address) {
        return this.heap.readTrustedFieldU32(
            address, STRING_SLICE_START, Heap.Types.STRING);
    };

    Records.prototype.flatStringIndexOf = function (haystack, needle) {
        return this.findPreparedFlatString(
            this.prepareFlatStringSearch(haystack),
            this.prepareFlatStringSearch(needle));
    };

    /* Borrowed metadata for a synchronous batch of immutable backing searches.
     * The caller must keep records live and must discard a descriptor when
     * converting its record into a view. Memory offsets remain relative to
     * the heap, not absolute native pointers. Search ranges are still checked
     * by the memory layer on every search. */
    Records.prototype.prepareFlatStringSearch = function (address) {
        this.heap.requireRecord(address, Heap.Types.STRING);
        var flags = this.heap.flags(address);
        if (flags & (STRING_ROPE_FLAG | STRING_SLICE_FLAG)) {
            throw new TypeError("flat string search requires flat backings");
        }
        return {address: address, length: this.stringLength(address),
            characters: this.heap.trustedPayloadAddress(address, STRING_CHARS),
            latin1: !!(flags & STRING_LATIN1_FLAG), text: null};
    };

    Records.prototype.findPreparedFlatString = function (haystack, needle) {
        if (needle.length > haystack.length) return -1;
        /* Native hosts have bulk memmem. Emulated memory otherwise performs
         * a byte-accessor call for every comparison; decode each immutable
         * prepared span once and use the existing exact UTF-16 search below. */
        if (haystack.latin1 && needle.latin1 && this.heap.memory.host.isMMVM) {
            return this.heap.memory.findBytes(
                haystack.characters, haystack.length,
                needle.characters, needle.length);
        }
        if (haystack.text === null) haystack.text = this.readString(haystack.address);
        if (needle.text === null) needle.text = this.readString(needle.address);
        return haystack.text.indexOf(needle.text);
    };

    /* Snapshot finalization may replace a flat backing without changing the
     * string's address or observable value. Keep its allocation size: other
     * heap records and native references must not move. Clear the unused
     * payload rather than leaving an invisible copy of the old characters.
     * The caller has matched the complete text against this backing range. */
    Records.prototype.shareStringBackingInPlace = function (address, backing, start) {
        var length = this.stringLength(address);
        var payloadBytes = this.heap.recordSize(address) - Heap.HEADER_SIZE;
        if (address === backing || this.stringIsSlice(address) ||
                this.stringIsRope(address) || this.stringIsSlice(backing) ||
                this.stringIsRope(backing) ||
                payloadBytes < STRING_SLICE_START + 4 ||
                start < 0 || start + length > this.stringLength(backing)) {
            throw new RangeError("invalid shared string backing");
        }
        this.heap.writeTrustedFieldU32(address, STRING_SLICE_BACKING, backing);
        this.heap.writeTrustedFieldU32(address, STRING_SLICE_START, start);
        var offset = STRING_SLICE_START + 4;
        if (offset < payloadBytes) {
            /* No references live in the retired flat character storage.
             * Clear it as one checked memory range, not one VM operation
             * per word. Native and emulated heaps share this operation. */
            this.heap.memory.fill(this.heap.trustedPayloadAddress(address, offset),
                                  payloadBytes - offset, 0);
        }
        this.heap.setFlags(address, STRING_SLICE_FLAG |
            (this.heap.flags(address) & STRING_KEY_HASH_FLAG));
    };

    Records.prototype.stringHash = function (address) {
        var flags = this.heap.flags(address);
        if (!(flags & STRING_KEY_HASH_FLAG)) {
            var text = this.readString(address);
            var hash = STRING_HASH_OFFSET_BASIS, index = 0;
            while (index < text.length) hash = stringHashStep(hash, text.charCodeAt(index++));
            this.heap.writeTrustedFieldU32(address, STRING_HASH, hash, Heap.Types.STRING);
            this.heap.setFlags(address, flags | STRING_KEY_HASH_FLAG);
        }
        return this.heap.readTrustedFieldU32(address, STRING_HASH, Heap.Types.STRING);
    };

    Records.prototype.stringIsRope = function (address) {
        this.heap.requireRecord(address, Heap.Types.STRING);
        return !!(this.heap.flags(address) & STRING_ROPE_FLAG);
    };

    Records.prototype.stringIsLatin1 = function (address) {
        this.heap.requireRecord(address, Heap.Types.STRING);
        return !!(this.heap.flags(address) & STRING_LATIN1_FLAG);
    };

    Records.prototype.stringRopeLeft = function (address) {
        return this.heap.readTrustedFieldU32(
            address, STRING_ROPE_LEFT, Heap.Types.STRING);
    };

    Records.prototype.stringRopeRight = function (address) {
        return this.heap.readTrustedFieldU32(
            address, STRING_ROPE_RIGHT, Heap.Types.STRING);
    };

    Records.prototype.stringRopeDepth = function (address) {
        if (!this.stringIsRope(address)) return 0;
        return this.heap.readTrustedFieldU32(
            address, STRING_ROPE_DEPTH, Heap.Types.STRING);
    };

    Records.prototype.stringCharacterCodeUnit = function (address, index) {
        var length = this.stringLength(address);
        if (index < 0 || index >= length || index !== Math.floor(index)) {
            throw new RangeError("string character index is out of bounds");
        }
        var flags = this.heap.flags(address);
        while (flags & (STRING_ROPE_FLAG | STRING_SLICE_FLAG)) {
            if (flags & STRING_SLICE_FLAG) {
                index += this.stringSliceStart(address);
                address = this.stringSliceBacking(address);
                flags = this.heap.flags(address);
                continue;
            }
            var left = this.stringRopeLeft(address);
            var leftLength = this.stringLength(left);
            if (index < leftLength) address = left;
            else {
                index -= leftLength;
                address = this.stringRopeRight(address);
            }
            flags = this.heap.flags(address);
        }
        if (flags & STRING_LATIN1_FLAG) {
            return this.heap.readTrustedFieldU8(
                address, STRING_CHARS + index, Heap.Types.STRING);
        }
        var low = this.heap.readTrustedFieldU8(
            address, STRING_CHARS + index * 2, Heap.Types.STRING);
        var high = this.heap.readTrustedFieldU8(
            address, STRING_CHARS + index * 2 + 1, Heap.Types.STRING);
        return low | (high << 8);
    };

    Records.prototype.readString = function (address) {
        var length = this.stringLength(address);
        var start = 0, chunk = "", chunks = null, pending = null;
        if (!length) return chunk;
        /* Resolve immutable views once per span, not once per character.
         * The explicit stack handles slices crossing rope branches without
         * consuming the host call stack. Chunks bound concatenation work on
         * older hosts which eagerly copy strings instead of building ropes. */
        while (true) {
            this.heap.requireRecord(address, Heap.Types.STRING);
            if (start < 0 || start + length > this.stringLength(address)) {
                throw new RangeError("string decode span is out of bounds");
            }
            var flags = this.heap.flags(address);
            if (flags & STRING_SLICE_FLAG) {
                start += this.stringSliceStart(address);
                address = this.stringSliceBacking(address);
                continue;
            }
            if (flags & STRING_ROPE_FLAG) {
                var left = this.stringRopeLeft(address);
                var leftLength = this.stringLength(left);
                if (start >= leftLength) {
                    start -= leftLength;
                    address = this.stringRopeRight(address);
                    continue;
                }
                var leftCount = Math.min(length, leftLength - start);
                if (leftCount < length) {
                    if (!pending) pending = [];
                    pending.push(this.stringRopeRight(address), 0, length - leftCount);
                }
                address = left;
                length = leftCount;
                continue;
            }
            var unitBytes = flags & STRING_LATIN1_FLAG ? 1 : 2;
            var characters = this.heap.checkPayload(address,
                STRING_CHARS + start * unitBytes, length * unitBytes, Heap.Types.STRING);
            var end = characters + length * unitBytes;
            while (characters < end) {
                var code = this.heap.memory.readU8Trusted(characters++);
                if (unitBytes === 2) code |= this.heap.memory.readU8Trusted(characters++) << 8;
                chunk += String.fromCharCode(code);
                if (chunk.length === STRING_DECODE_CHUNK_UNITS) {
                    if (!chunks) chunks = [];
                    chunks.push(chunk);
                    chunk = "";
                }
            }
            if (!pending || !pending.length) break;
            length = pending.pop();
            start = pending.pop();
            address = pending.pop();
        }
        if (!chunks) return chunk;
        if (chunk.length) chunks.push(chunk);
        return chunks.join("");
    };

    Records.prototype.allocateObject = function (prototype) {
        return this.heap.allocateRecordWords(Heap.Types.OBJECT, OBJECT_BYTES,
                                              prototype || 0, 0, 1, 0);
    };

    Records.prototype.objectIsExtensible = function (address) {
        var type = this.heap.recordType(address);
        if (type === Heap.Types.OBJECT) {
            return !!this.heap.readTrustedFieldU32(
                address, OBJECT_EXTENSIBLE, Heap.Types.OBJECT);
        }
        /* The older layouts have no spare per-object word. Until those
         * layouts are unified, their ordinary ES object state remains
         * extensible. */
        return true;
    };

    Records.prototype.preventObjectExtensions = function (address) {
        var type = this.heap.recordType(address);
        if (type !== Heap.Types.OBJECT) {
            throw new TypeError(
                "non-ordinary object extensibility is not implemented");
        }
        this.heap.writeTrustedFieldU32(
            address, OBJECT_EXTENSIBLE, 0, Heap.Types.OBJECT);
    };

    Records.prototype.objectPrototype = function (address) {
        var type = this.heap.recordType(address);
        if (type === Heap.Types.REGEXP) {
            return this.heap.readTrustedFieldU32(address, REGEXP_PROTOTYPE, type);
        }
        if (type === Heap.Types.BUFFER_VIEW) {
            return this.heap.readTrustedFieldU32(address, BUFFER_VIEW_PROTOTYPE, type);
        }
        return this.heap.readTrustedFieldU32(address, OBJECT_PROTOTYPE, type);
    };

    Records.prototype.setObjectPrototype = function (address, prototype) {
        if (prototype) this.heap.requireRecord(prototype);
        var type = this.heap.recordType(address);
        this.heap.writeTrustedFieldU32(address,
            type === Heap.Types.REGEXP ? REGEXP_PROTOTYPE :
            type === Heap.Types.BUFFER_VIEW ? BUFFER_VIEW_PROTOTYPE : OBJECT_PROTOTYPE,
            prototype || 0, type);
    };

    Records.prototype.objectPropertyHead = function (address) {
        return this.heap.readTrustedFieldU32(address, propertyHeadOffset(
            this.heap.recordType(address)), this.heap.recordType(address));
    };

    Records.prototype.setObjectPropertyHead = function (address, property) {
        var type = this.heap.recordType(address);
        if (type === Heap.Types.OBJECT) this.setObjectPropertyIndex(address, 0);
        this.heap.writeTrustedFieldU32(address, propertyHeadOffset(type), property || 0, type);
    };

    Records.prototype.bumpObjectStructureVersion = function (address) {
        if (this.heap.recordType(address) === Heap.Types.OBJECT) this.setObjectPropertyIndex(address, 0);
        this.heap.setFlags(address, (this.heap.flags(address) + 1) >>> 0);
    };

    Records.prototype.objectPropertyIndex = function (address) {
        return this.heap.readTrustedFieldU32(address, OBJECT_PROPERTY_INDEX, Heap.Types.OBJECT);
    };
    Records.prototype.setObjectPropertyIndex = function (address, index) {
        this.heap.writeTrustedFieldU32(address, OBJECT_PROPERTY_INDEX, index, Heap.Types.OBJECT);
    };
    Records.prototype.propertyIndexCount = function (address) {
        return this.heap.readTrustedFieldU32(address, PROPERTY_INDEX_COUNT, Heap.Types.PROPERTY_INDEX);
    };
    Records.prototype.propertyIndexStorage = function (address) {
        return this.heap.readTrustedFieldU32(address, PROPERTY_INDEX_HEAD, Heap.Types.PROPERTY_INDEX);
    };
    Records.prototype.propertyIndexCapacity = function (address) {
        return this.heap.readTrustedFieldU32(address, PROPERTY_INDEX_CAPACITY, Heap.Types.PROPERTY_INDEX);
    };
    Records.prototype.propertyIndexSlot = function (address, slot) {
        return this.heap.readTrustedFieldU32(address,
            PROPERTY_INDEX_SLOTS + slot * Heap.WORD_BYTES, Heap.Types.PROPERTY_INDEX);
    };

    /* Ordinary-object entries are one-based packed slots. Named entries on
     * special record kinds remain legacy record IDs behind this boundary.
     * Value-cell addresses are temporary, never persistent property handles. */
    Records.prototype.ownPropertyStorage = function (owner) {
        return this.objectPropertyHead(owner);
    };
    Records.prototype.ownPropertyEpoch = function (owner) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(owner);
            return storage ? this.heap.flags(storage) : 0;
        }
        return this.heap.flags(owner);
    };
    Records.prototype.ownPropertyGeneration = function (owner) {
        return this.heap.mark(owner);
    };
    Records.prototype.ownPropertyEntryDescriptor = function (owner, entry) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(owner);
            var offset = this.propertyStorageEntryOffset(storage, entry);
            if (!this.heap.readTrustedFieldU32(storage, offset + PROPERTY_ENTRY_KEY)) {
                throw new RangeError("deleted property storage entry");
            }
            return this.heap.trustedPayloadAddress(storage, offset + PROPERTY_ENTRY_KEY);
        }
        return this.heap.trustedPayloadAddress(entry, PROPERTY_KEY);
    };
    Records.prototype.propertyDescriptorAttributes = function (descriptor) {
        return this.heap.memory.readU32Trusted(descriptor + PROPERTY_DESCRIPTOR_ATTRIBUTES);
    };
    /* Internal semantic accesses have just found or guarded this live entry.
     * Like vectorCellWithinLength, this avoids repeating bounds/key checks.
     * No callback or structural mutation may intervene before using the view.
     * Keep ownPropertyEntryDescriptor as the checked low-level API. */
    Records.prototype.resolvedOwnPropertyEntryDescriptor = function (owner, entry) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            return this.propertyStorageEntriesAddress(this.ownPropertyStorage(owner)) +
                (entry - 1) * PROPERTY_ENTRY_BYTES + PROPERTY_ENTRY_KEY;
        }
        return this.heap.trustedPayloadAddress(entry, PROPERTY_KEY);
    };
    Records.prototype.propertyDescriptorSetter = function (descriptor) {
        return this.heap.memory.readU32Trusted(descriptor + PROPERTY_DESCRIPTOR_SETTER);
    };
    Records.prototype.propertyDescriptorValueCell = function (descriptor) {
        return descriptor + PROPERTY_DESCRIPTOR_VALUE;
    };
    Records.prototype.ownPropertyEntryValueCell = function (owner, entry) {
        return this.propertyDescriptorValueCell(this.ownPropertyEntryDescriptor(owner, entry));
    };
    Records.prototype.resolvedOwnPropertyEntryValueCell = function (owner, entry) {
        return this.propertyDescriptorValueCell(
            this.resolvedOwnPropertyEntryDescriptor(owner, entry));
    };
    Records.prototype.ownPropertyEntryAttributes = function (owner, entry) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            return this.propertyStorageAttributes(this.ownPropertyStorage(owner), entry);
        }
        return this.propertyAttributes(entry);
    };
    Records.prototype.ownPropertyEntryKey = function (owner, entry) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            return this.propertyStorageKey(this.ownPropertyStorage(owner), entry);
        }
        return this.propertyKey(entry);
    };
    Records.prototype.setOwnPropertyEntryAttributes = function (owner, entry, attributes) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(owner);
            this.heap.writeTrustedFieldU32(storage,
                this.propertyStorageEntryOffset(storage, entry) + PROPERTY_ENTRY_ATTRIBUTES,
                attributes);
            return;
        }
        this.setPropertyAttributes(entry, attributes);
    };
    Records.prototype.ownPropertyEntrySetter = function (owner, entry) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            return this.propertyStorageSetter(this.ownPropertyStorage(owner), entry);
        }
        return this.propertySetter(entry);
    };
    Records.prototype.setOwnPropertyEntrySetter = function (owner, entry, setter) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            if (setter) this.heap.requireRecord(setter);
            var storage = this.ownPropertyStorage(owner);
            this.heap.writeTrustedFieldU32(storage,
                this.propertyStorageEntryOffset(storage, entry) + PROPERTY_ENTRY_SETTER,
                setter || 0);
            return;
        }
        this.setPropertySetter(entry, setter);
    };

    Records.prototype.findOwnPropertyEntry = function (owner, key) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(owner);
            if (!storage) return 0;
            if (typeof key === "number") return this.findPropertyStorageEntry(storage, key);
            var entry = this.lastOwnPropertyEntry(owner);
            while (entry) {
                if (this.readString(this.propertyStorageKey(storage, entry)) === key) return entry;
                entry = this.previousOwnPropertyEntry(owner, entry);
            }
            return 0;
        }
        return this.findOwnProperty(owner, key);
    };
    Records.prototype.defineOwnPropertyEntry = function (owner, key, attributes) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var entry = this.findOwnPropertyEntry(owner, key);
            if (entry) {
                this.setOwnPropertyEntryAttributes(owner, entry,
                    attributes === undefined ? DEFAULT_ATTRIBUTES : attributes);
                return entry;
            }
            var storage = this.ownPropertyStorage(owner);
            var previousStorage = storage;
            if (!storage) storage = this.allocatePropertyStorage(PROPERTY_STORAGE_INITIAL_CAPACITY);
            else if (this.propertyStorageLength(storage) === this.propertyStorageCapacity(storage)) {
                if (this.propertyStorageCapacity(storage) === 0) {
                    storage = this.growPropertyStorage(storage, PROPERTY_STORAGE_INITIAL_CAPACITY);
                } else if (this.propertyStorageLiveCount(storage) * 2 <= this.propertyStorageLength(storage)) {
                    storage = this.copyLivePropertyStorage(storage, this.propertyStorageCapacity(storage));
                } else storage = this.growPropertyStorage(storage, this.propertyStorageLength(storage) + 1);
            }
            this.setObjectPropertyHead(owner, storage);
            if (previousStorage && previousStorage !== storage) {
                this.discardPropertyStorageIndex(previousStorage);
                this.retirePropertyStorageRecord(previousStorage);
            }
            return this.appendPropertyStorageEntry(storage, key, attributes);
        }
        return this.defineOwnProperty(owner, key, attributes);
    };
    Records.prototype.deleteOwnPropertyEntry = function (owner, key) {
        var entry = this.findOwnPropertyEntry(owner, key);
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            if (entry) this.deletePropertyStorageEntry(this.ownPropertyStorage(owner), entry);
            return true;
        }
        var deleted = this.deleteOwnProperty(owner, key);
        if (entry && deleted) this.heap.freeRecord(entry);
        return deleted;
    };

    /* Walk backwards in insertion order. Legacy lists are newest first;
     * packed storage walks live slots backwards. Never expose list links
     * or assume that an entry is a separately allocated heap record. */
    Records.prototype.lastOwnPropertyEntry = function (owner) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(owner);
            return storage ? this.previousOwnPropertyEntry(owner,
                this.propertyStorageLength(storage) + 1) : 0;
        }
        return this.objectPropertyHead(owner);
    };
    Records.prototype.previousOwnPropertyEntry = function (owner, entry) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(owner);
            while (--entry > 0) {
                if (this.propertyStorageKey(storage, entry)) return entry;
            }
            return 0;
        }
        return this.propertyNext(entry);
    };
    Records.prototype.releaseOwnPropertyStorage = function (owner) {
        if (this.heap.recordType(owner) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(owner);
            this.setObjectPropertyHead(owner, 0);
            if (storage) {
                var hash = this.propertyStorageHashIndex(storage);
                if (hash) this.heap.freeRecord(hash);
                this.heap.freeRecord(storage);
            }
            return;
        }
        var entry = this.lastOwnPropertyEntry(owner);
        var index = this.heap.recordType(owner) === Heap.Types.OBJECT ?
            this.objectPropertyIndex(owner) : 0;
        this.setObjectPropertyHead(owner, 0);
        while (entry) {
            var previous = this.previousOwnPropertyEntry(owner, entry);
            this.heap.freeRecord(entry);
            entry = previous;
        }
        if (index) this.heap.freeRecord(index);
    };

    Records.prototype.findOwnProperty = function (object, keyString) {
        if (this.heap.recordType(object) === Heap.Types.OBJECT) {
            throw new Error("ordinary properties require owner/entry accessors");
        }
        var keyAddress = typeof keyString === "number" ? keyString : 0;
        var property = this.objectPropertyHead(object);
        while (property) {
            var candidate = this.heap.readTrustedFieldU32(
                property, PROPERTY_KEY, Heap.Types.PROPERTY);
            if ((keyAddress && candidate === keyAddress) ||
                (!keyAddress && this.readString(candidate) === keyString)) {
                return property;
            }
            property = this.heap.readTrustedFieldU32(property, PROPERTY_NEXT,
                                              Heap.Types.PROPERTY);
        }
        return 0;
    };

    Records.prototype.defineOwnProperty = function (object, keyAddress, attributes) {
        if (this.heap.recordType(object) === Heap.Types.OBJECT) {
            throw new Error("ordinary properties require owner/entry accessors");
        }
        this.heap.requireRecord(keyAddress, Heap.Types.STRING);
        var property = this.findOwnProperty(object, keyAddress);
        if (!property) {
            property = this.heap.allocateRecordWords(Heap.Types.PROPERTY,
                PROPERTY_BYTES, this.objectPropertyHead(object), keyAddress,
                attributes === undefined ? DEFAULT_ATTRIBUTES : attributes, 0);
            this.setObjectPropertyHead(object, property);
            return property;
        }
        this.heap.writeTrustedFieldU32(property, PROPERTY_ATTRIBUTES,
            attributes === undefined ? DEFAULT_ATTRIBUTES : attributes,
            Heap.Types.PROPERTY);
        return property;
    };

    Records.prototype.propertyValueCell = function (property) {
        return this.heap.trustedPayloadAddress(property, PROPERTY_VALUE, CELL_BYTES,
                                        Heap.Types.PROPERTY);
    };

    Records.prototype.propertyAttributes = function (property) {
        return this.heap.readTrustedFieldU32(property, PROPERTY_ATTRIBUTES,
                                      Heap.Types.PROPERTY);
    };

    Records.prototype.setPropertyAttributes = function (property, attributes) {
        this.heap.writeTrustedFieldU32(property, PROPERTY_ATTRIBUTES,
            attributes, Heap.Types.PROPERTY);
    };

    Records.prototype.propertySetter = function (property) {
        return this.heap.readTrustedFieldU32(property, PROPERTY_SETTER,
                                             Heap.Types.PROPERTY);
    };

    Records.prototype.setPropertySetter = function (property, setter) {
        if (setter) this.heap.requireRecord(setter);
        this.heap.writeTrustedFieldU32(property, PROPERTY_SETTER, setter || 0,
                                       Heap.Types.PROPERTY);
    };

    Records.prototype.propertyKey = function (property) {
        return this.heap.readTrustedFieldU32(property, PROPERTY_KEY, Heap.Types.PROPERTY);
    };

    Records.prototype.propertyNext = function (property) {
        return this.heap.readTrustedFieldU32(property, PROPERTY_NEXT, Heap.Types.PROPERTY);
    };

    Records.prototype.countEnumerableOwnProperties = function (source) {
        var property = this.lastOwnPropertyEntry(source);
        var count = 0;
        while (property) {
            if (this.ownPropertyEntryAttributes(source, property) & ATTR_ENUMERABLE) count++;
            property = this.previousOwnPropertyEntry(source, property);
        }
        return count;
    };

    Records.prototype.countOwnProperties = function (source) {
        if (this.heap.recordType(source) === Heap.Types.OBJECT) {
            var storage = this.ownPropertyStorage(source);
            return storage ? this.propertyStorageLiveCount(storage) : 0;
        }
        var property = this.lastOwnPropertyEntry(source);
        var count = 0;
        while (property) {
            count++;
            property = this.previousOwnPropertyEntry(source, property);
        }
        return count;
    };

    Records.prototype.cloneEnumerableOwnProperties = function (
            source, target, knownPropertyCount) {
        return this.cloneOwnProperties(
            source, target, knownPropertyCount, true);
    };

    Records.prototype.cloneOwnProperties = function (
            source, target, knownPropertyCount, enumerableOnly) {
        if (this.objectPropertyHead(target)) {
            throw new Error("property clone target must be empty");
        }
        var sourceProperty = this.lastOwnPropertyEntry(source);
        var propertyCount = knownPropertyCount === undefined ?
            (enumerableOnly ? this.countEnumerableOwnProperties(source) :
                              this.countOwnProperties(source)) :
            knownPropertyCount;
        if (!propertyCount) return 0;
        if (this.heap.recordType(target) === Heap.Types.OBJECT) {
            var storage = this.allocatePropertyStorage(propertyCount);
            if (this.heap.recordType(source) === Heap.Types.OBJECT &&
                    this.heap.recordInitializer &&
                    this.heap.recordInitializer.clonePackedProperties) {
                var cloned = this.heap.recordInitializer.clonePackedProperties(
                    this.ownPropertyStorage(source), target, storage,
                    propertyCount, enumerableOnly);
                if (cloned !== storage) throw new Error("packed property clone count changed");
                return storage;
            }
            this.heap.writeTrustedFieldU32(storage, PROPERTY_STORAGE_LENGTH, propertyCount);
            this.heap.writeTrustedFieldU32(storage, PROPERTY_STORAGE_LIVE_COUNT, propertyCount);
            var entry = propertyCount;
            while (sourceProperty) {
                var sourceAttributes = this.ownPropertyEntryAttributes(source, sourceProperty);
                if (!enumerableOnly || (sourceAttributes & ATTR_ENUMERABLE)) {
                    var offset = this.propertyStorageEntryOffset(storage, entry);
                    this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_KEY,
                        this.ownPropertyEntryKey(source, sourceProperty));
                    this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_ATTRIBUTES, sourceAttributes);
                    this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_SETTER,
                        this.ownPropertyEntrySetter(source, sourceProperty));
                    this.cells.copyAt(this.propertyStorageValueCell(storage, entry),
                        this.ownPropertyEntryValueCell(source, sourceProperty));
                    entry--;
                }
                sourceProperty = this.previousOwnPropertyEntry(source, sourceProperty);
            }
            this.setObjectPropertyHead(target, storage);
            return storage;
        }
        if (this.heap.recordInitializer &&
            this.heap.recordInitializer.cloneProperties &&
            this.heap.recordType(source) !== Heap.Types.OBJECT) {
            var recordBytes = Heap.HEADER_SIZE + PROPERTY_BYTES;
            var requestedBytes = propertyCount * recordBytes;
            var block = this.heap.allocateRecord(
                Heap.Types.PROPERTY, requestedBytes - Heap.HEADER_SIZE);
            var blockBytes = this.heap.recordSize(block);
            this.heap.allocationCount += propertyCount - 1;
            return this.heap.recordInitializer.cloneProperties(
                this.objectPropertyHead(source), target, block, blockBytes,
                propertyCount, enumerableOnly);
        }
        sourceProperty = this.lastOwnPropertyEntry(source);
        var firstClone = 0;
        var previousClone = 0;
        while (sourceProperty) {
            var attributes = this.ownPropertyEntryAttributes(source, sourceProperty);
            if (!enumerableOnly || (attributes & ATTR_ENUMERABLE)) {
                var clone = this.heap.allocateRecordWords(Heap.Types.PROPERTY,
                    PROPERTY_BYTES, 0, this.ownPropertyEntryKey(source, sourceProperty),
                    attributes, this.ownPropertyEntrySetter(source, sourceProperty));
                this.cells.copyAt(this.propertyValueCell(clone),
                                  this.ownPropertyEntryValueCell(source, sourceProperty));
                if (!firstClone) firstClone = clone;
                if (previousClone) {
                    this.heap.writeTrustedFieldU32(previousClone,
                        PROPERTY_NEXT, clone, Heap.Types.PROPERTY);
                }
                previousClone = clone;
            }
            sourceProperty = this.previousOwnPropertyEntry(source, sourceProperty);
        }
        this.setObjectPropertyHead(target, firstClone);
        return firstClone;
    };

    Records.prototype.deleteOwnProperty = function (object, keyAddress) {
        if (this.heap.recordType(object) === Heap.Types.OBJECT) {
            return this.deleteOwnPropertyEntry(object, keyAddress);
        }
        var previous = 0;
        var property = this.objectPropertyHead(object);
        while (property) {
            var next = this.propertyNext(property);
            if (this.propertyKey(property) === keyAddress) {
                if (previous) {
                    this.heap.writeTrustedFieldU32(previous, PROPERTY_NEXT, next,
                                            Heap.Types.PROPERTY);
                } else this.setObjectPropertyHead(object, next);
                this.bumpObjectStructureVersion(object);
                return true;
            }
            previous = property;
            property = next;
        }
        return true;
    };

    Records.prototype.allocateValueVector = function (capacity) {
        capacity = Number(capacity) || 0;
        if (capacity < 0 || capacity !== Math.floor(capacity)) {
            throw new RangeError("invalid value-vector capacity");
        }
        var address = this.heap.allocateRecordWords(Heap.Types.VALUE_VECTOR,
            VECTOR_CELLS + capacity * CELL_BYTES, 0, capacity, 0, 0);
        return address;
    };

    Records.prototype.constantPoolLength = function (pool) {
        return this.heap.readTrustedFieldU32(pool, CONSTANT_POOL_LENGTH, Heap.Types.CONSTANT_POOL);
    };
    Records.prototype.constantPoolExecutionCache = function (pool) {
        return this.heap.readTrustedFieldU32(pool, CONSTANT_POOL_EXECUTION_CACHE, Heap.Types.CONSTANT_POOL);
    };
    Records.prototype.constantPoolTag = function (pool, index) {
        return this.heap.memory.readU8(this.heap.trustedPayloadAddress(pool,
            CONSTANT_POOL_TAGS + index, 1, Heap.Types.CONSTANT_POOL));
    };
    Records.prototype.constantPoolDataAddress = function (pool) {
        var tagBytes = (this.constantPoolLength(pool) + Heap.RECORD_ALIGNMENT - 1) &
            ~(Heap.RECORD_ALIGNMENT - 1);
        return this.heap.trustedPayloadAddress(pool, CONSTANT_POOL_TAGS + tagBytes,
            0, Heap.Types.CONSTANT_POOL);
    };
    Records.prototype.constantPoolLow = function (pool, index) {
        return this.heap.memory.readU32(this.constantPoolDataAddress(pool) +
            index * CONSTANT_POOL_PAYLOAD_BYTES);
    };
    Records.prototype.constantPoolHigh = function (pool, index) {
        if (this.constantPoolTag(pool, index) !== ValueCells.Tags.DOUBLE) return 0;
        var ordinal = 0;
        for (var previous = 0; previous < index; previous++) {
            if (this.constantPoolTag(pool, previous) === ValueCells.Tags.DOUBLE) ordinal++;
        }
        return this.heap.memory.readU32(this.constantPoolDataAddress(pool) +
            this.constantPoolLength(pool) * CONSTANT_POOL_PAYLOAD_BYTES + ordinal * Heap.WORD_BYTES);
    };

    Records.prototype.narrowProgramConstants = function (vector) {
        var length = this.vectorLength(vector);
        var tagBytes = (length + Heap.RECORD_ALIGNMENT - 1) & ~(Heap.RECORD_ALIGNMENT - 1);
        var tags = [], highs = [], base = this.vectorCellsAddress(vector), index;
        for (index = 0; index < length; index++) {
            var original = base + index * CELL_BYTES;
            var originalTag = this.cells.tagAt(original);
            tags[index] = originalTag;
            if (originalTag === ValueCells.Tags.DOUBLE) highs.push(this.cells.payloadHighAt(original));
        }
        var payloadBytes = CONSTANT_POOL_TAGS + tagBytes + length * CONSTANT_POOL_PAYLOAD_BYTES +
            highs.length * Heap.WORD_BYTES;
        var size = (Heap.HEADER_SIZE + payloadBytes + Heap.RECORD_ALIGNMENT - 1) &
            ~(Heap.RECORD_ALIGNMENT - 1);
        if (this.heap.recordSize(vector) - size < Heap.HEADER_SIZE + Heap.RECORD_ALIGNMENT) return false;
        /* Pack payloads forwards before shifting the packed run right. Tags
         * are retained until that overlap-safe move completes. No inner-heap
         * allocation or guest callback occurs during this transformation. */
        for (index = 0; index < length; index++) {
            var source = base + index * CELL_BYTES, tag = tags[index];
            var low = tag === ValueCells.Tags.INT32 || tag === ValueCells.Tags.REFERENCE ||
                tag === ValueCells.Tags.DOUBLE ? this.cells.payloadLowAt(source) : 0;
            this.heap.memory.writeU32(base + index * CONSTANT_POOL_PAYLOAD_BYTES, low);
        }
        this.heap.memory.copy(base + tagBytes, base, length * CONSTANT_POOL_PAYLOAD_BYTES);
        this.heap.memory.fill(base, tagBytes, 0);
        for (index = 0; index < length; index++) this.heap.memory.writeU8(base + index, tags[index]);
        var highBase = base + tagBytes + length * CONSTANT_POOL_PAYLOAD_BYTES;
        for (index = 0; index < highs.length; index++) {
            this.heap.memory.writeU32(highBase + index * Heap.WORD_BYTES, highs[index]);
        }
        this.heap.writeTrustedFieldU32(vector, CONSTANT_POOL_EXECUTION_CACHE, 0);
        this.heap.shrinkRecord(vector, payloadBytes, Heap.Types.CONSTANT_POOL);
        return true;
    };

    Records.prototype.executionProgramConstants = function (program) {
        var pool = this.programConstants(program);
        if (this.heap.recordType(pool) !== Heap.Types.CONSTANT_POOL) return pool;
        var cached = this.constantPoolExecutionCache(pool);
        if (cached) return cached;
        var length = this.constantPoolLength(pool), index = 0;
        cached = this.allocateValueVector(length);
        while (index < length) {
            this.cells.writeBitsAt(this.vectorCell(cached, index), this.constantPoolTag(pool, index),
                this.constantPoolLow(pool, index), this.constantPoolHigh(pool, index));
            index++;
        }
        this.setVectorLength(cached, length);
        this.heap.writeTrustedFieldU32(pool, CONSTANT_POOL_EXECUTION_CACHE, cached, Heap.Types.CONSTANT_POOL);
        return cached;
    };

    /* Private program maps contain signed register/slot indices, not values
     * or references. Their length/capacity header matches a value vector, but
     * each element is one int32 and the collector treats the record as a leaf. */
    Records.prototype.allocateIntegerVector = function (length) {
        if (length < 0 || length !== Math.floor(length)) {
            throw new RangeError("invalid integer-vector length");
        }
        return this.heap.allocateRecordWords(Heap.Types.INTEGER_VECTOR,
            INTEGER_VECTOR_VALUES + length * Heap.WORD_BYTES, length, length, 0, 0);
    };

    Records.prototype.integerVectorLength = function (vector) {
        return this.heap.readTrustedFieldU32(vector, VECTOR_LENGTH,
            Heap.Types.INTEGER_VECTOR);
    };

    Records.prototype.integerVectorValue = function (vector, index) {
        if (index < 0 || index >= this.integerVectorLength(vector) ||
                index !== Math.floor(index)) throw new RangeError("invalid integer-vector index");
        return this.heap.readTrustedFieldU32(vector,
            INTEGER_VECTOR_VALUES + index * Heap.WORD_BYTES, Heap.Types.INTEGER_VECTOR) | 0;
    };

    Records.prototype.setIntegerVectorValue = function (vector, index, value) {
        if (index < 0 || index >= this.integerVectorLength(vector) ||
                index !== Math.floor(index) || value !== (value | 0)) {
            throw new RangeError("invalid integer-vector write");
        }
        this.heap.writeTrustedFieldU32(vector,
            INTEGER_VECTOR_VALUES + index * Heap.WORD_BYTES, value, Heap.Types.INTEGER_VECTOR);
    };

    Records.prototype.integerVectorExecutionCache = function (vector) {
        return this.heap.readTrustedFieldU32(vector, INTEGER_VECTOR_EXECUTION_CACHE,
            Heap.Types.INTEGER_VECTOR);
    };

    Records.prototype.vectorLength = function (vector) {
        return this.heap.readTrustedFieldU32(vector, VECTOR_LENGTH, Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.setVectorLength = function (vector, length) {
        if (length < 0 || length > this.vectorCapacity(vector) ||
            length !== Math.floor(length)) throw new RangeError("invalid vector length");
        this.heap.writeTrustedFieldU32(vector, VECTOR_LENGTH, length,
                                Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.vectorCapacity = function (vector) {
        return this.heap.readTrustedFieldU32(vector, VECTOR_CAPACITY,
                                      Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.vectorCell = function (vector, index) {
        var capacity = this.vectorCapacity(vector);
        if (index < 0 || index >= capacity || index !== Math.floor(index)) {
            throw new RangeError("value-vector index is out of bounds");
        }
        return this.heap.trustedPayloadAddress(vector, VECTOR_CELLS + index * CELL_BYTES,
                                        CELL_BYTES, Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.vectorCellWithinLength = function (vector, index) {
        return this.heap.trustedPayloadAddress(vector,
            VECTOR_CELLS + index * CELL_BYTES);
    };

    Records.prototype.allocateArray = function (prototype, capacity) {
        var elements = this.allocateValueVector(capacity || 0);
        return this.heap.allocateRecordWords(Heap.Types.ARRAY, ARRAY_BYTES,
                                              prototype || 0, 0, elements, 0);
    };

    Records.prototype.arrayElements = function (array) {
        return this.heap.readTrustedFieldU32(array, ARRAY_ELEMENTS, Heap.Types.ARRAY);
    };

    Records.prototype.arrayReserved = function (array) {
        return this.heap.readTrustedFieldU32(array, ARRAY_RESERVED,
                                             Heap.Types.ARRAY);
    };

    Records.prototype.setArrayReserved = function (array, value) {
        this.heap.writeTrustedFieldU32(array, ARRAY_RESERVED, value >>> 0,
                                       Heap.Types.ARRAY);
    };

    Records.prototype.arrayLength = function (array) {
        return this.vectorLength(this.arrayElements(array));
    };

    Records.prototype.arrayElementCell = function (array, index) {
        return this.vectorCell(this.arrayElements(array), index);
    };

    Records.prototype.setArrayElements = function (array, vector) {
        this.heap.requireRecord(vector, Heap.Types.VALUE_VECTOR);
        this.heap.writeTrustedFieldU32(array, ARRAY_ELEMENTS, vector, Heap.Types.ARRAY);
    };

    Records.prototype.setArrayLength = function (array, length) {
        this.setVectorLength(this.arrayElements(array), length);
    };

    Records.prototype.allocateEnvironment = function (parent, slotCount, program) {
        if (parent) this.heap.requireRecord(parent, Heap.Types.ENVIRONMENT);
        if (program) this.heap.requireRecord(program, Heap.Types.PROGRAM);
        slotCount = Number(slotCount);
        if (slotCount < 0 || slotCount !== Math.floor(slotCount)) {
            throw new RangeError("invalid environment slot count");
        }
        var address = this.heap.allocateRecordWords(Heap.Types.ENVIRONMENT,
            ENVIRONMENT_CELLS + slotCount * CELL_BYTES,
            parent || 0, slotCount, program || 0, 0);
        var index = 0;
        while (index < slotCount) {
            this.cells.writePrimitiveAt(this.environmentCell(address, index), undefined);
            index++;
        }
        return address;
    };

    Records.prototype.environmentProgram = function (environment) {
        return this.heap.readTrustedFieldU32(
            environment, ENVIRONMENT_PROGRAM, Heap.Types.ENVIRONMENT);
    };

    Records.prototype.environmentObject = function (environment) {
        return this.heap.readTrustedFieldU32(
            environment, ENVIRONMENT_RESERVED, Heap.Types.ENVIRONMENT);
    };

    Records.prototype.setEnvironmentObject = function (environment, object) {
        if (object) this.heap.requireRecord(object);
        this.heap.writeTrustedFieldU32(
            environment, ENVIRONMENT_RESERVED, object || 0,
            Heap.Types.ENVIRONMENT);
    };

    Records.prototype.allocateObjectEnvironment = function (parent, object) {
        var environment = this.allocateEnvironment(parent, 0, 0);
        this.setEnvironmentObject(environment, object);
        return environment;
    };

    Records.prototype.environmentParent = function (environment) {
        return this.heap.readTrustedFieldU32(environment, ENVIRONMENT_PARENT,
                                      Heap.Types.ENVIRONMENT);
    };

    Records.prototype.environmentSlotCount = function (environment) {
        return this.heap.readTrustedFieldU32(environment, ENVIRONMENT_COUNT,
                                      Heap.Types.ENVIRONMENT);
    };

    Records.prototype.environmentCell = function (environment, slot) {
        var count = this.environmentSlotCount(environment);
        if (slot < 0 || slot >= count || slot !== Math.floor(slot)) {
            throw new RangeError("environment slot is out of bounds");
        }
        return this.heap.trustedPayloadAddress(environment,
            ENVIRONMENT_CELLS + slot * CELL_BYTES, CELL_BYTES,
            Heap.Types.ENVIRONMENT);
    };

    Records.prototype.allocateFunction = function (nativeFunction, prototype,
                                                     closure, metadata,
                                                     homeContext) {
        var type = nativeFunction ? Heap.Types.NATIVE_FUNCTION :
                                    Heap.Types.BYTECODE_FUNCTION;
        var address = this.heap.allocateRecordWords(type, FUNCTION_BYTES,
            prototype || 0, 0, closure || 0, metadata || 0);
        this.heap.writeTrustedFieldU32(address, FUNCTION_HOME_CONTEXT,
            homeContext || 0, type);
        return address;
    };

    Records.prototype.allocateRegExp = function (pattern, flags, prototype) {
        var patternAddress = this.allocateString(pattern);
        var flagsAddress = this.allocateString(flags);
        return this.heap.allocateRecordWords(Heap.Types.REGEXP, REGEXP_BYTES,
            patternAddress, flagsAddress, prototype || 0, 0);
    };

    Records.prototype.regexpPattern = function (regexp) {
        return this.readString(this.heap.readTrustedFieldU32(
            regexp, REGEXP_PATTERN, Heap.Types.REGEXP));
    };

    Records.prototype.regexpFlags = function (regexp) {
        return this.readString(this.heap.readTrustedFieldU32(
            regexp, REGEXP_FLAGS, Heap.Types.REGEXP));
    };

    Records.prototype.allocateBufferBacking = function (length) {
        length = Number(length);
        var host = this.heap.memory.host;
        var external = host.isMMVM && length >= Heap.BufferBackingPolicy.LARGE_BYTES;
        var address = this.heap.allocateRecordWords(Heap.Types.BUFFER_BACKING,
            BUFFER_BACKING_DATA + length, 0, length, 0, 0,
            external ? BUFFER_BACKING_DATA : undefined);
        if (external) {
            var externalPointer = host.ffi.call(host.callocPointer, [length, 1]);
            if (!externalPointer) {
                this.heap.freeRecord(address, "failed external backing allocation");
                throw new RangeError("native buffer allocation failed");
            }
            this.heap.setFlags(address, Heap.BufferBackingPolicy.EXTERNAL);
            this.setBufferBackingPointer(address, externalPointer);
            return address;
        }
        var pointer = this.heap.memory.nativeAddress(
            address + Heap.HEADER_SIZE + BUFFER_BACKING_DATA);
        this.heap.writeTrustedFieldU32(address, BUFFER_BACKING_POINTER,
                                       pointer, Heap.Types.BUFFER_BACKING);
        return address;
    };

    Records.prototype.allocateBufferView = function (backing, offset, length,
                                                       prototype, kind) {
        var address = this.heap.allocateRecordWords(Heap.Types.BUFFER_VIEW,
            BUFFER_VIEW_BYTES, backing, offset, length, prototype || 0);
        this.heap.writeTrustedFieldU32(address, BUFFER_VIEW_KIND, kind || 0,
                                       Heap.Types.BUFFER_VIEW);
        return address;
    };

    Records.prototype.bufferViewBacking = function (view) {
        return this.heap.readTrustedFieldU32(view, BUFFER_VIEW_BACKING,
                                      Heap.Types.BUFFER_VIEW);
    };

    Records.prototype.bufferViewOffset = function (view) {
        return this.heap.readTrustedFieldU32(view, BUFFER_VIEW_OFFSET,
                                      Heap.Types.BUFFER_VIEW);
    };

    Records.prototype.bufferViewLength = function (view) {
        return this.heap.readTrustedFieldU32(view, BUFFER_VIEW_LENGTH,
                                      Heap.Types.BUFFER_VIEW);
    };

    Records.prototype.bufferViewKind = function (view) {
        return this.heap.readTrustedFieldU32(view, BUFFER_VIEW_KIND,
                                      Heap.Types.BUFFER_VIEW);
    };

    Records.prototype.bufferBackingMetadata = function (backing) {
        return this.heap.readTrustedFieldU32(backing, BUFFER_BACKING_METADATA,
                                      Heap.Types.BUFFER_BACKING);
    };

    Records.prototype.setBufferBackingMetadata = function (backing, metadata) {
        if (metadata) this.heap.requireRecord(metadata, Heap.Types.BUFFER_VIEW);
        this.heap.writeTrustedFieldU32(backing, BUFFER_BACKING_METADATA,
            metadata || 0, Heap.Types.BUFFER_BACKING);
    };

    Records.prototype.bufferBackingPointer = function (backing) {
        var pointer = this.heap.readTrustedFieldU32(
            backing, BUFFER_BACKING_POINTER, Heap.Types.BUFFER_BACKING);
        return pointer >= 2147483648 ? pointer - 4294967296 : pointer;
    };

    Records.prototype.setBufferBackingPointer = function (backing, pointer) {
        this.heap.writeTrustedFieldU32(backing, BUFFER_BACKING_POINTER,
            pointer, Heap.Types.BUFFER_BACKING);
    };

    Records.prototype.bufferBackingIsExternal = function (backing) {
        if (this.heap.memory.allocation && !this.heap.memory.allocation.isNative) return false;
        return (this.heap.flags(backing) & Heap.BufferBackingPolicy.EXTERNAL) !== 0;
    };

    Records.prototype.releaseExternalBufferBacking = function (backing) {
        if (!this.bufferBackingIsExternal(backing)) return;
        var pointer = this.bufferBackingPointer(backing);
        this.setBufferBackingPointer(backing, 0);
        this.heap.setFlags(backing, this.heap.flags(backing) & ~Heap.BufferBackingPolicy.EXTERNAL);
        var host = this.heap.memory.host;
        host.ffi.call(host.freePointer, [pointer]);
    };

    Records.prototype.suspendBufferPointersForSnapshot = function () {
        var records = this;
        var saved = [];
        this.heap.visitRecords(function (address, type) {
            if (type !== Heap.Types.BUFFER_BACKING) return;
            saved.push({address: address,
                        pointer: records.bufferBackingPointer(address),
                        flags: records.heap.flags(address),
                        length: records.bufferBackingLength(address)});
            records.setBufferBackingPointer(address, 0);
            records.heap.setFlags(address, records.heap.flags(address) &
                ~Heap.BufferBackingPolicy.EXTERNAL);
        });
        return saved;
    };

    Records.prototype.restoreBufferPointersAfterSnapshot = function (saved) {
        var index = 0;
        while (index < saved.length) {
            this.setBufferBackingPointer(saved[index].address, saved[index].pointer);
            this.heap.setFlags(saved[index].address, saved[index].flags);
            index++;
        }
    };

    /* Canonical files always contain inline bytes and no external ownership.
     * Copy into the private snapshot, never relocate a live backing whose
     * address may have escaped through FFI. Region snapshots retain ownership
     * in-process and restore content to the same allocation. */
    Records.prototype.copyExternalBufferDataToSnapshot = function (snapshot, saved, regions) {
        var host = this.heap.memory.host;
        if (!snapshot.isNative) return;
        var index = 0;
        while (index < saved.length) {
            var backing = saved[index++];
            if (!(backing.flags & Heap.BufferBackingPolicy.EXTERNAL)) continue;
            var destination = backing.address;
            if (regions) {
                destination = -1;
                for (var r = 0; r < regions.length; r++) {
                    var region = regions[r];
                    if (backing.address >= region.address && backing.address +
                            Heap.HEADER_SIZE + BUFFER_BACKING_DATA + backing.length <=
                            region.address + region.length) {
                        destination = region.snapshotOffset + backing.address - region.address;
                        break;
                    }
                }
                if (destination < 0) continue;
            }
            var data = destination + Heap.HEADER_SIZE + BUFFER_BACKING_DATA;
            host.ffi.call(host.memcpyPointer, [snapshot.pointer + data, backing.pointer, backing.length]);
            var padding = (Heap.RECORD_ALIGNMENT - backing.length % Heap.RECORD_ALIGNMENT) % Heap.RECORD_ALIGNMENT;
            if (padding) host.fillAllocationRange(snapshot, data + backing.length, padding, 0);
        }
    };

    Records.prototype.externalBufferBackings = function (addresses) {
        var result = [], records = this;
        if (!this.heap.memory.allocation.isNative) return result;
        function visit(address, type) {
            if (type === Heap.Types.BUFFER_BACKING && records.bufferBackingIsExternal(address)) {
                result.push({address: address, pointer: records.bufferBackingPointer(address),
                    flags: records.heap.flags(address), length: records.bufferBackingLength(address)});
            }
        }
        if (addresses) {
            for (var index = 0; index < addresses.length; index++) {
                visit(addresses[index], this.heap.recordType(addresses[index]));
            }
        } else this.heap.visitRecords(visit);
        return result;
    };

    Records.prototype.restoreExternalBufferSnapshotContents = function (regions, addresses) {
        var saved = this.externalBufferBackings(addresses), host = this.heap.memory.host;
        for (var index = 0; index < saved.length; index++) {
            var backing = saved[index];
            var included = false;
            for (var r = 0; r < regions.length; r++) {
                if (backing.address >= regions[r].address && backing.address <
                        regions[r].address + regions[r].length) included = true;
            }
            if (!included) continue;
            host.ffi.call(host.memcpyPointer, [backing.pointer,
                this.heap.memory.nativeAddress(this.bufferBackingDataAddress(backing.address)), backing.length]);
        }
    };

    /* The standalone bootstrap uses this named description to rebuild native
     * Buffer data pointers after mapping the relocatable heap template.  Keep
     * record-layout knowledge in HeapRecords rather than duplicating offsets
     * in the machine-code emitter. */
    Records.prototype.standaloneBufferRebindLayout = function () {
        return {
            firstRecord: 64,
            recordType: 0,
            recordSize: 4,
            bufferBackingType: Heap.Types.BUFFER_BACKING,
            bufferPointer: Heap.HEADER_SIZE + BUFFER_BACKING_POINTER,
            bufferData: Heap.HEADER_SIZE + BUFFER_BACKING_DATA
        };
    };

    Records.prototype.bufferBackingLength = function (backing) {
        return this.heap.readTrustedFieldU32(backing, BUFFER_BACKING_LENGTH,
                                      Heap.Types.BUFFER_BACKING);
    };

    Records.prototype.bufferBackingDataAddress = function (backing) {
        this.heap.requireRecord(backing, Heap.Types.BUFFER_BACKING);
        return backing + Heap.HEADER_SIZE + BUFFER_BACKING_DATA;
    };

    Records.prototype.readBufferByte = function (backing, offset) {
        var length = this.bufferBackingLength(backing);
        if (offset < 0 || offset >= length) {
            throw new RangeError("Buffer index out of range");
        }
        var inlineAddress = this.bufferBackingDataAddress(backing);
        if (this.heap.memory.allocation && this.heap.memory.allocation.isNative) {
            return this.heap.memory.host.ffi.peek8(this.bufferBackingPointer(backing) + offset);
        }
        return this.heap.memory.readU8Trusted(inlineAddress + offset);
    };

    Records.prototype.writeBufferByte = function (backing, offset, value) {
        var length = this.bufferBackingLength(backing);
        if (offset < 0 || offset >= length) {
            throw new RangeError("Buffer index out of range");
        }
        var inlineAddress = this.bufferBackingDataAddress(backing);
        if (this.heap.memory.allocation && this.heap.memory.allocation.isNative) {
            this.heap.memory.host.ffi.poke8(this.bufferBackingPointer(backing) + offset, value);
            return;
        }
        this.heap.memory.writeU8Trusted(inlineAddress + offset, value);
    };

    Records.prototype.readBufferU32LE = function (backing, offset) {
        if (offset < 0 || offset + 4 > this.bufferBackingLength(backing)) {
            throw new RangeError("Buffer read out of range");
        }
        var inlineAddress = this.bufferBackingDataAddress(backing);
        if (this.heap.memory.allocation && this.heap.memory.allocation.isNative) {
            return this.heap.memory.host.ffi.peek32(this.bufferBackingPointer(backing) + offset) >>> 0;
        }
        return this.heap.memory.readU32Trusted(inlineAddress + offset);
    };

    Records.prototype.writeBufferU32LE = function (backing, offset, value) {
        if (offset < 0 || offset + 4 > this.bufferBackingLength(backing)) {
            throw new RangeError("Buffer write out of range");
        }
        var inlineAddress = this.bufferBackingDataAddress(backing);
        if (this.heap.memory.allocation && this.heap.memory.allocation.isNative) {
            this.heap.memory.host.ffi.poke32(this.bufferBackingPointer(backing) + offset, value);
            return;
        }
        this.heap.memory.writeU32Trusted(inlineAddress + offset, value);
    };

    Records.prototype.functionClosure = function (address) {
        var type = this.heap.recordType(address);
        if (type !== Heap.Types.NATIVE_FUNCTION &&
            type !== Heap.Types.BYTECODE_FUNCTION) {
            throw new TypeError("record is not a function");
        }
        return this.heap.readTrustedFieldU32(address, FUNCTION_CLOSURE, type);
    };

    Records.prototype.functionMetadata = function (address) {
        var type = this.heap.recordType(address);
        if (type !== Heap.Types.NATIVE_FUNCTION &&
            type !== Heap.Types.BYTECODE_FUNCTION) {
            throw new TypeError("record is not a function");
        }
        return this.heap.readTrustedFieldU32(address, FUNCTION_METADATA, type);
    };

    Records.prototype.functionHomeContext = function (address) {
        var type = this.heap.recordType(address);
        if (type !== Heap.Types.NATIVE_FUNCTION &&
            type !== Heap.Types.BYTECODE_FUNCTION) {
            throw new TypeError("record is not a function");
        }
        return this.heap.readTrustedFieldU32(
            address, FUNCTION_HOME_CONTEXT, type);
    };

    Records.prototype.functionGCNext = function (address) {
        return this.heap.readTrustedFieldU32(
            address, FUNCTION_GC_NEXT, Heap.Types.NATIVE_FUNCTION);
    };

    Records.prototype.setFunctionGCNext = function (address, next) {
        this.heap.writeTrustedFieldU32(
            address, FUNCTION_GC_NEXT, next || 0,
            Heap.Types.NATIVE_FUNCTION);
    };

    Records.prototype.allocateFrame = function (program, environment, caller,
                                                  returnSlot, registerCount,
                                                  context) {
        var address = this.heap.allocateRecordWords(Heap.Types.FRAME,
            FRAME_REGISTERS + registerCount * CELL_BYTES,
            program || 0, environment || 0, caller || 0, 0);
        this.heap.writeTrustedFieldU32(address, FRAME_RETURN_SLOT, returnSlot >>> 0,
                                Heap.Types.FRAME);
        this.heap.writeTrustedFieldU32(address, FRAME_REGISTER_COUNT, registerCount,
                                Heap.Types.FRAME);
        this.heap.writeTrustedFieldU32(address, FRAME_CONTEXT, context || 0,
                                Heap.Types.FRAME);
        var index = 0;
        while (index < registerCount) {
            this.cells.writePrimitiveAt(this.frameRegisterCell(address, index), undefined);
            index++;
        }
        if (this.frameHandler(address) !== 0) {
            throw new Error("fresh guest frame has a nonempty handler chain: " +
                            this.frameHandler(address));
        }
        return address;
    };

    Records.prototype.framePC = function (frame) {
        return this.heap.readTrustedFieldU32(frame, FRAME_PC, Heap.Types.FRAME);
    };

    Records.prototype.frameProgram = function (frame) {
        return this.heap.readTrustedFieldU32(
            frame, FRAME_PROGRAM, Heap.Types.FRAME);
    };

    Records.prototype.frameCaller = function (frame) {
        return this.heap.readTrustedFieldU32(
            frame, FRAME_CALLER, Heap.Types.FRAME);
    };

    Records.prototype.frameReturnSlot = function (frame) {
        var value = this.heap.readTrustedFieldU32(
            frame, FRAME_RETURN_SLOT, Heap.Types.FRAME);
        return value >= 2147483648 ? value - 4294967296 : value;
    };

    Records.prototype.setFramePC = function (frame, pc) {
        this.heap.writeTrustedFieldU32(frame, FRAME_PC, pc, Heap.Types.FRAME);
    };

    Records.prototype.frameRegisterCount = function (frame) {
        return this.heap.readTrustedFieldU32(frame, FRAME_REGISTER_COUNT, Heap.Types.FRAME);
    };

    Records.prototype.frameEnvironment = function (frame) {
        return this.heap.readTrustedFieldU32(
            frame, FRAME_ENVIRONMENT, Heap.Types.FRAME);
    };

    Records.prototype.setFrameEnvironment = function (frame, environment) {
        if (environment) {
            this.heap.requireRecord(environment, Heap.Types.ENVIRONMENT);
        }
        this.heap.writeTrustedFieldU32(
            frame, FRAME_ENVIRONMENT, environment || 0, Heap.Types.FRAME);
    };

    Records.prototype.frameContext = function (frame) {
        return this.heap.readTrustedFieldU32(
            frame, FRAME_CONTEXT, Heap.Types.FRAME);
    };

    Records.prototype.frameRegisterCell = function (frame, register) {
        var count = this.frameRegisterCount(frame);
        if (register < 0 || register >= count || register !== Math.floor(register)) {
            throw new RangeError("frame register is out of bounds");
        }
        return this.heap.trustedPayloadAddress(frame,
            FRAME_REGISTERS + register * CELL_BYTES, CELL_BYTES, Heap.Types.FRAME);
    };

    Records.prototype.frameRegisterDisplacement = function (register) {
        if (register < 0 || register !== Math.floor(register)) {
            throw new RangeError("invalid frame register");
        }
        return Heap.HEADER_SIZE + FRAME_REGISTERS + register * CELL_BYTES;
    };

    Records.prototype.framePCAddress = function (frame) {
        return this.heap.trustedPayloadAddress(
            frame, FRAME_PC, 4, Heap.Types.FRAME);
    };

    Records.prototype.frameRegistersAddress = function (frame) {
        return this.heap.trustedPayloadAddress(
            frame, FRAME_REGISTERS, 0, Heap.Types.FRAME);
    };

    Records.prototype.frameHandler = function (frame) {
        return this.heap.readTrustedFieldU32(frame, FRAME_HANDLER);
    };

    Records.prototype.setFrameHandler = function (frame, handler) {
        this.heap.writeTrustedFieldU32(frame, FRAME_HANDLER, handler || 0);
    };

    Records.prototype.pushFrameHandler = function (frame, target, bindingSlot) {
        var handler = this.heap.allocateRecordWords(Heap.Types.HANDLER,
            HANDLER_BYTES, this.frameHandler(frame), target, bindingSlot,
            this.frameEnvironment(frame));
        this.setFrameHandler(frame, handler);
        return handler;
    };

    Records.prototype.popFrameHandler = function (frame) {
        var handler = this.frameHandler(frame);
        if (!handler) return 0;
        this.setFrameHandler(frame,
            this.heap.readTrustedFieldU32(handler, HANDLER_NEXT));
        return handler;
    };

    Records.prototype.handlerTarget = function (handler) {
        return this.heap.readTrustedFieldU32(handler, HANDLER_TARGET);
    };

    Records.prototype.handlerBindingSlot = function (handler) {
        return this.heap.readTrustedFieldU32(handler, HANDLER_BINDING_SLOT);
    };

    Records.prototype.handlerEnvironment = function (handler) {
        return this.heap.readTrustedFieldU32(
            handler, HANDLER_RESERVED, Heap.Types.HANDLER);
    };

    Records.prototype.allocateBytecode = function (code, compact) {
        var wideCount = 0, wide8Count = 0, index;
        if (compact) {
            for (index = 0; index < code.length; index++) {
                if (code[index] !== -1 && (code[index] < 0 ||
                        code[index] >= BYTECODE_PACKED_MINUS_ONE)) wideCount++;
                if (code[index] !== -1 && (code[index] < 0 ||
                        code[index] >= BYTECODE_PACKED8_MINUS_ONE)) wide8Count++;
            }
            var packedBytes = (code.length * BYTECODE_PACKED_UNIT_BYTES +
                Heap.RECORD_ALIGNMENT - 1) & ~(Heap.RECORD_ALIGNMENT - 1);
            var tableBytes = wideCount * BYTECODE_WIDE_ENTRY_WORDS * Heap.WORD_BYTES;
            var packed8Bytes = (code.length + Heap.RECORD_ALIGNMENT - 1) & ~(Heap.RECORD_ALIGNMENT - 1);
            var table8Bytes = wide8Count * BYTECODE_WIDE_ENTRY_WORDS * Heap.WORD_BYTES;
            var unitBytes = BYTECODE_PACKED_UNIT_BYTES;
            var minusOne = BYTECODE_PACKED_MINUS_ONE, wideMarker = BYTECODE_PACKED_WIDE;
            if (packed8Bytes + table8Bytes < packedBytes + tableBytes) {
                packedBytes = packed8Bytes; tableBytes = table8Bytes; wideCount = wide8Count;
                unitBytes = 1; minusOne = BYTECODE_PACKED8_MINUS_ONE; wideMarker = BYTECODE_PACKED8_WIDE;
            }
            if (packedBytes + tableBytes < code.length * Heap.WORD_BYTES) {
                var packed = this.heap.allocateRecordWords(Heap.Types.BYTECODE,
                    BYTECODE_WORDS + packedBytes + tableBytes, code.length, 0, 0, 0);
                this.heap.setFlags(packed, BYTECODE_COMPACT_FLAG |
                    (unitBytes === 1 ? BYTECODE_COMPACT8_FLAG : 0) |
                    (wideCount << BYTECODE_WIDE_COUNT_SHIFT));
                var base = this.bytecodeWordsAddress(packed);
                var wideOffset = BYTECODE_WORDS + packedBytes;
                var pendingUnit = 0, unitsPerWord = Heap.WORD_BYTES / unitBytes;
                for (index = 0; index < code.length; index++) {
                    var value = code[index], unit = value;
                    if (value === -1) unit = minusOne;
                    else if (value < 0 || value >= minusOne) {
                        unit = wideMarker;
                        this.heap.writeTrustedFieldU32(packed, wideOffset, index);
                        this.heap.writeTrustedFieldU32(packed, wideOffset + Heap.WORD_BYTES, value);
                        wideOffset += BYTECODE_WIDE_ENTRY_WORDS * Heap.WORD_BYTES;
                    }
                    pendingUnit |= unit << ((index & (unitsPerWord - 1)) * unitBytes * 8);
                    if (((index + 1) & (unitsPerWord - 1)) === 0) {
                        this.heap.memory.writeU32(base + (index + 1 - unitsPerWord) * unitBytes, pendingUnit);
                        pendingUnit = 0;
                    }
                }
                if (code.length & (unitsPerWord - 1)) this.heap.memory.writeU32(base +
                    (code.length & ~(unitsPerWord - 1)) * unitBytes, pendingUnit);
                return packed;
            }
        }
        var address = this.heap.allocateRecordWords(Heap.Types.BYTECODE,
            BYTECODE_WORDS + code.length * 4, code.length, 0, 0, 0);
        var index = 0;
        while (index < code.length) {
            this.heap.writeTrustedFieldU32(address, BYTECODE_WORDS + index * 4,
                                    code[index] >>> 0, Heap.Types.BYTECODE);
            index++;
        }
        return address;
    };

    Records.prototype.bytecodeLength = function (bytecode) {
        return this.heap.readTrustedFieldU32(bytecode, BYTECODE_LENGTH,
                                      Heap.Types.BYTECODE);
    };

    Records.prototype.bytecodeExecutionCache = function (bytecode) {
        return this.heap.readTrustedFieldU32(bytecode,
            BYTECODE_EXECUTION_CACHE, Heap.Types.BYTECODE);
    };

    Records.prototype.setBytecodeExecutionCache = function (bytecode, decoded) {
        this.heap.writeTrustedFieldU32(bytecode,
            BYTECODE_EXECUTION_CACHE, decoded, Heap.Types.BYTECODE);
    };

    Records.prototype.bytecodeWord = function (bytecode, index) {
        if (index < 0 || index >= this.bytecodeLength(bytecode) ||
            index !== Math.floor(index)) throw new RangeError("invalid bytecode index");
        if (this.heap.flags(bytecode) & BYTECODE_COMPACT_FLAG) {
            var flags = this.heap.flags(bytecode);
            var small = !!(flags & BYTECODE_COMPACT8_FLAG);
            var unitBytes = small ? 1 : BYTECODE_PACKED_UNIT_BYTES;
            var unit = small ? this.heap.memory.readU8(this.bytecodeWordsAddress(bytecode) + index) :
                this.heap.memory.readU16(this.bytecodeWordsAddress(bytecode) + index * unitBytes);
            if (unit === (small ? BYTECODE_PACKED8_MINUS_ONE : BYTECODE_PACKED_MINUS_ONE)) return -1;
            if (unit !== (small ? BYTECODE_PACKED8_WIDE : BYTECODE_PACKED_WIDE)) return unit;
            var table = BYTECODE_WORDS + ((this.bytecodeLength(bytecode) *
                unitBytes + Heap.RECORD_ALIGNMENT - 1) &
                ~(Heap.RECORD_ALIGNMENT - 1));
            var pairBytes = BYTECODE_WIDE_ENTRY_WORDS * Heap.WORD_BYTES;
            var low = 0, high = flags >>> BYTECODE_WIDE_COUNT_SHIFT;
            if (this.legacyBytecodeFlags) high =
                (this.heap.recordSize(bytecode) - Heap.HEADER_SIZE - table) / pairBytes;
            while (low < high) {
                var middle = (low + high) >>> 1;
                var offset = table + middle * pairBytes;
                var found = this.heap.readTrustedFieldU32(bytecode, offset);
                if (found < index) low = middle + 1;
                else if (found > index) high = middle;
                else return this.heap.readTrustedFieldU32(bytecode, offset + Heap.WORD_BYTES) | 0;
            }
            throw new Error("compact bytecode wide operand is missing");
        }
        var word = this.heap.readTrustedFieldU32(bytecode,
            BYTECODE_WORDS + index * 4, Heap.Types.BYTECODE);
        return word >= 2147483648 ? word - 4294967296 : word;
    };

    Records.prototype.setBytecodeWord = function (bytecode, index, value) {
        if (this.heap.flags(bytecode) & BYTECODE_COMPACT_FLAG) {
            throw new TypeError("compact bytecode requires an owner-aware writable view");
        }
        if (index < 0 || index >= this.bytecodeLength(bytecode) ||
            index !== Math.floor(index)) throw new RangeError("invalid bytecode index");
        this.heap.writeTrustedFieldU32(bytecode,
            BYTECODE_WORDS + index * 4, value >>> 0, Heap.Types.BYTECODE);
        this.setBytecodeExecutionCache(bytecode, 0);
    };

    Records.prototype.bytecodeWordsAddress = function (bytecode) {
        return this.heap.trustedPayloadAddress(
            bytecode, BYTECODE_WORDS, 0, Heap.Types.BYTECODE);
    };

    Records.prototype.vectorCellsAddress = function (vector) {
        return this.heap.trustedPayloadAddress(
            vector, VECTOR_CELLS, 0, Heap.Types.VALUE_VECTOR);
    };

    /* Ordered packed property storage. Entry IDs are one-based slots (zero
     * means not found), never addresses. Growth preserves IDs; compaction
     * requires the owning object's cache epoch to be invalidated. */
    Records.prototype.allocatePropertyStorage = function (capacity) {
        var maximum = Math.floor((this.heap.maximumAllocationLimit -
            Heap.HEADER_SIZE - PROPERTY_STORAGE_ENTRIES) / PROPERTY_ENTRY_BYTES);
        if (capacity < 0 || capacity > maximum || capacity !== Math.floor(capacity)) {
            throw new RangeError("invalid property storage capacity");
        }
        return this.heap.allocateRecordWords(Heap.Types.PROPERTY_STORAGE,
            PROPERTY_STORAGE_ENTRIES + capacity * PROPERTY_ENTRY_BYTES,
            0, capacity, 0, 0);
    };

    Records.prototype.propertyStorageLength = function (storage) {
        return this.heap.readTrustedFieldU32(storage, PROPERTY_STORAGE_LENGTH);
    };
    Records.prototype.propertyStorageCapacity = function (storage) {
        return this.heap.readTrustedFieldU32(storage, PROPERTY_STORAGE_CAPACITY);
    };
    Records.prototype.propertyStorageLiveCount = function (storage) {
        return this.heap.readTrustedFieldU32(storage, PROPERTY_STORAGE_LIVE_COUNT);
    };
    Records.prototype.propertyStorageHashIndex = function (storage) {
        return this.heap.readTrustedFieldU32(storage, PROPERTY_STORAGE_HASH);
    };
    Records.prototype.propertyStorageEntriesAddress = function (storage) {
        return this.heap.trustedPayloadAddress(storage, PROPERTY_STORAGE_ENTRIES);
    };
    Records.prototype.propertyStorageEntryOffset = function (storage, entry) {
        this.heap.requireRecord(storage, Heap.Types.PROPERTY_STORAGE);
        if (entry < 1 || entry !== Math.floor(entry) ||
                entry > this.propertyStorageLength(storage)) {
            throw new RangeError("invalid property storage entry");
        }
        return PROPERTY_STORAGE_ENTRIES + (entry - 1) * PROPERTY_ENTRY_BYTES;
    };
    Records.prototype.propertyStorageKey = function (storage, entry) {
        return this.heap.readTrustedFieldU32(storage,
            this.propertyStorageEntryOffset(storage, entry) + PROPERTY_ENTRY_KEY);
    };
    /* For a synchronous scan whose complete entry span was checked once.
     * No allocation, callback or structural mutation may invalidate that span. */
    Records.prototype.propertyStorageKeyWithinLength = function (storage, entry) {
        return this.heap.readTrustedFieldU32(storage,
            PROPERTY_STORAGE_ENTRIES + (entry - 1) * PROPERTY_ENTRY_BYTES + PROPERTY_ENTRY_KEY);
    };
    Records.prototype.propertyStorageAttributes = function (storage, entry) {
        return this.heap.readTrustedFieldU32(storage,
            this.propertyStorageEntryOffset(storage, entry) + PROPERTY_ENTRY_ATTRIBUTES);
    };
    Records.prototype.propertyStorageSetter = function (storage, entry) {
        return this.heap.readTrustedFieldU32(storage,
            this.propertyStorageEntryOffset(storage, entry) + PROPERTY_ENTRY_SETTER);
    };
    Records.prototype.propertyStorageValueCell = function (storage, entry) {
        var offset = this.propertyStorageEntryOffset(storage, entry);
        if (!this.propertyStorageKey(storage, entry)) {
            throw new RangeError("deleted property storage entry");
        }
        return this.heap.trustedPayloadAddress(storage, offset + PROPERTY_ENTRY_VALUE);
    };
    Records.prototype.findPropertyStorageEntry = function (storage, key) {
        this.heap.requireRecord(key, Heap.Types.STRING);
        var index = this.preparePropertyStorageIndex(storage);
        if (index) {
            var hash = this.stringHash(key);
            var capacity = this.propertyIndexCapacity(index);
            var bucket = hash & (capacity - 1);
            var probes = 0;
            while (probes++ < capacity) {
                var slot = this.propertyIndexSlot(index, bucket);
                if (!slot) return 0;
                var candidateKey = this.propertyStorageKey(storage, slot);
                if (candidateKey === key || (this.stringHash(candidateKey) === hash &&
                        this.readString(candidateKey) === this.readString(key))) return slot;
                bucket = (bucket + 1) & (capacity - 1);
            }
            return 0;
        }
        var text = null, entry = 1, length = this.propertyStorageLength(storage);
        this.heap.checkPayload(storage, PROPERTY_STORAGE_ENTRIES,
            length * PROPERTY_ENTRY_BYTES, Heap.Types.PROPERTY_STORAGE);
        var keyLength = this.stringLength(key), keyHash = 0, hashReady = false;
        while (entry <= length) {
            var candidate = this.propertyStorageKeyWithinLength(storage, entry);
            if (candidate === key) return entry;
            if (candidate && this.stringLength(candidate) === keyLength) {
                if (!hashReady) {
                    keyHash = this.stringHash(key);
                    hashReady = true;
                }
                if (this.stringHash(candidate) !== keyHash) {
                    entry++;
                    continue;
                }
                if (text === null) text = this.readString(key);
                if (this.readString(candidate) === text) return entry;
            }
            entry++;
        }
        return 0;
    };
    Records.prototype.insertPropertyStorageIndex = function (storage, index, entry) {
        var capacity = this.propertyIndexCapacity(index);
        var bucket = this.stringHash(this.propertyStorageKey(storage, entry)) & (capacity - 1);
        var probes = 0;
        while (probes++ < capacity) {
            if (!this.propertyIndexSlot(index, bucket)) {
                this.heap.writeTrustedFieldU32(index,
                    PROPERTY_INDEX_SLOTS + bucket * Heap.WORD_BYTES, entry);
                return true;
            }
            bucket = (bucket + 1) & (capacity - 1);
        }
        return false;
    };
    Records.prototype.preparePropertyStorageIndex = function (storage) {
        var index = this.propertyStorageHashIndex(storage);
        var epoch = this.heap.flags(storage);
        if (index) {
            if (this.heap.readTrustedFieldU32(index, PROPERTY_INDEX_VERSION) === epoch) return index;
            this.discardPropertyStorageIndex(storage);
        }
        var count = this.propertyStorageLiveCount(storage);
        if (count < PROPERTY_INDEX_MINIMUM_PROPERTIES) return 0;
        var capacity = PROPERTY_INDEX_MINIMUM_PROPERTIES * 2;
        while (capacity < count * 2) capacity *= 2;
        var bytes = Heap.HEADER_SIZE + PROPERTY_INDEX_SLOTS + capacity * Heap.WORD_BYTES;
        if (this.heap.bump + bytes > this.heap.allocationLimit) return 0;
        index = this.heap.allocateRecordWords(Heap.Types.PROPERTY_INDEX,
            PROPERTY_INDEX_SLOTS + capacity * Heap.WORD_BYTES, storage, epoch, count, capacity);
        var length = this.propertyStorageLength(storage);
        for (var entry = 1; entry <= length; entry++) {
            if (this.propertyStorageKey(storage, entry)) {
                if (!this.insertPropertyStorageIndex(storage, index, entry)) return 0;
            }
        }
        this.heap.writeTrustedFieldU32(storage, PROPERTY_STORAGE_HASH, index);
        return index;
    };
    Records.prototype.definePropertyStorageEntry = function (storage, key, attributes, setter) {
        var entry = this.findPropertyStorageEntry(storage, key);
        if (entry) return entry;
        return this.appendPropertyStorageEntry(storage, key, attributes, setter);
    };
    Records.prototype.discardPropertyStorageIndex = function (storage) {
        var index = this.propertyStorageHashIndex(storage);
        if (index) {
            this.heap.writeTrustedFieldU32(storage, PROPERTY_STORAGE_HASH, 0);
            this.retirePropertyStorageRecord(index);
        }
    };
    Records.prototype.retirePropertyStorageRecord = function (record) {
        if (this.heap.flags(record) & PROPERTY_RECORD_SNAPSHOT_PIN) return;
        this.heap.memory.fill(this.heap.trustedPayloadAddress(record, 0),
            this.heap.recordSize(record) - Heap.HEADER_SIZE, 0);
        this.heap.freeRecord(record);
    };
    Records.prototype.nextPropertyStorageEpoch = function (storage) {
        var flags = this.heap.flags(storage);
        return ((flags & PROPERTY_RECORD_SNAPSHOT_PIN) |
            ((flags + 1) & PROPERTY_STORAGE_EPOCH_MASK)) >>> 0;
    };
    Records.prototype.appendPropertyStorageEntry = function (storage, key, attributes, setter) {
        var entry = this.propertyStorageLength(storage) + 1;
        if (entry > this.propertyStorageCapacity(storage)) {
            throw new RangeError("property storage needs growth before insertion");
        }
        if (setter) this.heap.requireRecord(setter);
        this.heap.writeTrustedFieldU32(storage, PROPERTY_STORAGE_LENGTH, entry);
        var offset = this.propertyStorageEntryOffset(storage, entry);
        this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_KEY, key);
        this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_ATTRIBUTES,
            attributes === undefined ? DEFAULT_ATTRIBUTES : attributes);
        this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_SETTER, setter || 0);
        this.cells.writePrimitiveAt(this.propertyStorageValueCell(storage, entry), undefined);
        this.heap.writeTrustedFieldU32(storage, PROPERTY_STORAGE_LIVE_COUNT,
            this.propertyStorageLiveCount(storage) + 1);
        var epoch = this.heap.flags(storage);
        this.heap.setFlags(storage, this.nextPropertyStorageEpoch(storage));
        var index = this.propertyStorageHashIndex(storage);
        if (index) {
            var live = this.propertyStorageLiveCount(storage);
            if (this.heap.readTrustedFieldU32(index, PROPERTY_INDEX_VERSION) === epoch &&
                    live * 2 <= this.propertyIndexCapacity(index) &&
                    this.insertPropertyStorageIndex(storage, index, entry)) {
                this.heap.writeTrustedFieldU32(index, PROPERTY_INDEX_COUNT, live);
                this.heap.writeTrustedFieldU32(index, PROPERTY_INDEX_VERSION, this.heap.flags(storage));
            } else this.discardPropertyStorageIndex(storage);
        }
        return entry;
    };
    Records.prototype.deletePropertyStorageEntry = function (storage, entry) {
        var offset = this.propertyStorageEntryOffset(storage, entry);
        if (!this.propertyStorageKey(storage, entry)) return false;
        this.heap.memory.fill(this.heap.trustedPayloadAddress(storage, offset), PROPERTY_ENTRY_BYTES, 0);
        this.heap.writeTrustedFieldU32(storage, PROPERTY_STORAGE_LIVE_COUNT,
            this.propertyStorageLiveCount(storage) - 1);
        this.discardPropertyStorageIndex(storage);
        this.heap.setFlags(storage, this.nextPropertyStorageEpoch(storage));
        return true;
    };
    Records.prototype.growPropertyStorage = function (storage, required) {
        var maximum = Math.floor((this.heap.maximumAllocationLimit -
            Heap.HEADER_SIZE - PROPERTY_STORAGE_ENTRIES) / PROPERTY_ENTRY_BYTES);
        if (required < 0 || required > maximum || required !== Math.floor(required)) {
            throw new RangeError("invalid required property storage capacity");
        }
        var capacity = this.propertyStorageCapacity(storage);
        if (required <= capacity) return storage;
        capacity = Math.max(1, capacity);
        while (capacity < required) capacity = Math.min(maximum,
            capacity + Math.max(1, capacity >>> 1));
        var grown = this.allocatePropertyStorage(capacity);
        var length = this.propertyStorageLength(storage);
        this.heap.memory.copyDisjointRange(this.propertyStorageEntriesAddress(grown),
            this.propertyStorageEntriesAddress(storage), length * PROPERTY_ENTRY_BYTES);
        this.heap.writeTrustedFieldU32(grown, PROPERTY_STORAGE_LENGTH, length);
        this.heap.writeTrustedFieldU32(grown, PROPERTY_STORAGE_LIVE_COUNT,
            this.propertyStorageLiveCount(storage));
        this.heap.setFlags(grown, this.nextPropertyStorageEpoch(storage) & PROPERTY_STORAGE_EPOCH_MASK);
        return grown;
    };
    Records.prototype.compactPropertyStorage = function (storage) {
        return this.copyLivePropertyStorage(storage, this.propertyStorageLiveCount(storage));
    };
    Records.prototype.copyLivePropertyStorage = function (storage, capacity) {
        var count = this.propertyStorageLiveCount(storage);
        var compacted = this.allocatePropertyStorage(capacity);
        var entry = 1, target = 0, length = this.propertyStorageLength(storage);
        while (entry <= length) {
            var offset = this.propertyStorageEntryOffset(storage, entry);
            if (this.propertyStorageKey(storage, entry)) {
                this.heap.memory.copyDisjointRange(this.heap.trustedPayloadAddress(compacted,
                    PROPERTY_STORAGE_ENTRIES + target * PROPERTY_ENTRY_BYTES),
                    this.heap.trustedPayloadAddress(storage, offset), PROPERTY_ENTRY_BYTES);
                target++;
            }
            entry++;
        }
        this.heap.writeTrustedFieldU32(compacted, PROPERTY_STORAGE_LENGTH, count);
        this.heap.writeTrustedFieldU32(compacted, PROPERTY_STORAGE_LIVE_COUNT, count);
        this.heap.setFlags(compacted, this.nextPropertyStorageEpoch(storage) & PROPERTY_STORAGE_EPOCH_MASK);
        return compacted;
    };

    Records.prototype.updatePropertyStorageDescriptor = function (storage, entry, attributes, setter) {
        var offset = this.propertyStorageEntryOffset(storage, entry);
        if (!this.propertyStorageKey(storage, entry)) throw new RangeError("deleted property entry");
        if (setter) this.heap.requireRecord(setter);
        this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_ATTRIBUTES, attributes);
        this.heap.writeTrustedFieldU32(storage, offset + PROPERTY_ENTRY_SETTER, setter || 0);
        this.heap.setFlags(storage, this.nextPropertyStorageEpoch(storage));
    };

    Records.prototype.propertyStorageKeys = function (storage, enumerableOnly) {
        var length = this.propertyStorageLength(storage), count = 0, entry;
        for (entry = 1; entry <= length; entry++) {
            if (this.propertyStorageKey(storage, entry) && (!enumerableOnly ||
                    (this.propertyStorageAttributes(storage, entry) & ATTR_ENUMERABLE))) count++;
        }
        var keys = this.allocateValueVector(count), target = 0;
        for (entry = 1; entry <= length; entry++) {
            var key = this.propertyStorageKey(storage, entry);
            if (key && (!enumerableOnly ||
                    (this.propertyStorageAttributes(storage, entry) & ATTR_ENUMERABLE))) {
                this.cells.writeReferenceAt(this.vectorCell(keys, target++), key);
            }
        }
        this.setVectorLength(keys, count);
        return keys;
    };

    Records.prototype.allocateProgram = function (bytecode, constants, layout) {
        var address = this.heap.allocateRecordWords(Heap.Types.PROGRAM, PROGRAM_BYTES,
            bytecode, constants, layout.constantRegisters,
            layout.bindingRegisters);
        this.heap.writeTrustedFieldU32(address, PROGRAM_PARAMETER_SLOTS,
            layout.parameterSlots || 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_REGISTER_COUNT,
            layout.registerCount || 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_ARGUMENTS_SLOT,
            layout.argumentsSlot >>> 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_THIS_SLOT,
            layout.thisSlot >>> 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_FUNCTION_NAME_SLOT,
            layout.functionNameSlot >>> 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_METADATA,
            layout.metadata || 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_FLAGS,
            layout.flags || 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_BINDING_COUNT,
            layout.bindingCount || 0, Heap.Types.PROGRAM);
        this.heap.writeTrustedFieldU32(address, PROGRAM_SOURCE,
            layout.source || 0, Heap.Types.PROGRAM);
        return address;
    };

    Records.prototype.programBytecode = function (program) {
        return this.heap.readTrustedFieldU32(program, PROGRAM_BYTECODE, Heap.Types.PROGRAM);
    };

    Records.prototype.programConstants = function (program) {
        return this.heap.readTrustedFieldU32(program, PROGRAM_CONSTANTS, Heap.Types.PROGRAM);
    };

    Records.prototype.programConstantRegisters = function (program) {
        return this.heap.readTrustedFieldU32(
            program, PROGRAM_CONSTANT_REGISTERS, Heap.Types.PROGRAM);
    };

    Records.prototype.setProgramConstantRegisters = function (program, vector) {
        this.heap.writeTrustedFieldU32(program, PROGRAM_CONSTANT_REGISTERS,
            vector, Heap.Types.PROGRAM);
    };

    Records.prototype.setProgramBindingRegisters = function (program, vector) {
        this.heap.writeTrustedFieldU32(program, PROGRAM_BINDING_REGISTERS,
            vector, Heap.Types.PROGRAM);
    };

    Records.prototype.setProgramParameterSlots = function (program, vector) {
        this.heap.writeTrustedFieldU32(program, PROGRAM_PARAMETER_SLOTS,
            vector, Heap.Types.PROGRAM);
    };

    Records.prototype.programBindingRegisters = function (program) {
        return this.heap.readTrustedFieldU32(
            program, PROGRAM_BINDING_REGISTERS, Heap.Types.PROGRAM);
    };

    Records.prototype.programBindingCount = function (program) {
        return this.heap.readTrustedFieldU32(
            program, PROGRAM_BINDING_COUNT, Heap.Types.PROGRAM);
    };

    Records.prototype.programSource = function (program) {
        return this.heap.readTrustedFieldU32(
            program, PROGRAM_SOURCE, Heap.Types.PROGRAM);
    };

    Records.prototype.programFlags = function (program) {
        return this.heap.readTrustedFieldU32(
            program, PROGRAM_FLAGS, Heap.Types.PROGRAM);
    };

    Records.prototype.programParameterSlots = function (program) {
        return this.heap.readTrustedFieldU32(
            program, PROGRAM_PARAMETER_SLOTS, Heap.Types.PROGRAM);
    };

    Records.prototype.programRegisterCount = function (program) {
        return this.heap.readTrustedFieldU32(
            program, PROGRAM_REGISTER_COUNT, Heap.Types.PROGRAM);
    };

    Records.prototype.programArgumentsSlot = function (program) {
        var value = this.heap.readTrustedFieldU32(
            program, PROGRAM_ARGUMENTS_SLOT, Heap.Types.PROGRAM);
        return value >= 2147483648 ? value - 4294967296 : value;
    };

    Records.prototype.programThisSlot = function (program) {
        var value = this.heap.readTrustedFieldU32(
            program, PROGRAM_THIS_SLOT, Heap.Types.PROGRAM);
        return value >= 2147483648 ? value - 4294967296 : value;
    };

    Records.prototype.programFunctionNameSlot = function (program) {
        var value = this.heap.readTrustedFieldU32(
            program, PROGRAM_FUNCTION_NAME_SLOT, Heap.Types.PROGRAM);
        return value >= 2147483648 ? value - 4294967296 : value;
    };

    Records.prototype.allocateContext = function (globalObject) {
        return this.heap.allocateRecordWords(Heap.Types.CONTEXT, CONTEXT_BYTES,
                                              globalObject, 0, 0, 0);
    };

    Records.prototype.allocateRootSlot = function (reference, next) {
        var slot = this.heap.allocateRecord(
            Heap.Types.ROOT_SLOT, ROOT_SLOT_BYTES);
        this.cells.writeReferenceAt(
            this.heap.trustedPayloadAddress(
                slot, ROOT_SLOT_VALUE, CELL_BYTES, Heap.Types.ROOT_SLOT),
            reference);
        this.heap.writeTrustedFieldU32(
            slot, ROOT_SLOT_NEXT, next || 0, Heap.Types.ROOT_SLOT);
        return slot;
    };

    Records.prototype.rootSlotNext = function (slot) {
        return this.heap.readTrustedFieldU32(
            slot, ROOT_SLOT_NEXT, Heap.Types.ROOT_SLOT);
    };

    Records.prototype.setRootSlotNext = function (slot, next) {
        this.heap.writeTrustedFieldU32(
            slot, ROOT_SLOT_NEXT, next || 0, Heap.Types.ROOT_SLOT);
    };

    Records.prototype.contextGlobal = function (context) {
        return this.heap.readTrustedFieldU32(context, CONTEXT_GLOBAL, Heap.Types.CONTEXT);
    };

    Records.prototype.setContextGlobal = function (context, globalObject) {
        this.heap.writeTrustedFieldU32(context, CONTEXT_GLOBAL, globalObject,
                                       Heap.Types.CONTEXT);
    };

    Records.prototype.setContextActiveFrame = function (context, frame) {
        this.heap.writeTrustedFieldU32(context, CONTEXT_ACTIVE_FRAME, frame || 0,
                                Heap.Types.CONTEXT);
    };

    Records.prototype.contextActiveFrame = function (context) {
        return this.heap.readTrustedFieldU32(
            context, CONTEXT_ACTIVE_FRAME, Heap.Types.CONTEXT);
    };

    Records.prototype.contextNext = function (context) {
        return this.heap.readTrustedFieldU32(
            context, CONTEXT_NEXT, Heap.Types.CONTEXT);
    };

    Records.prototype.setContextNext = function (context, next) {
        this.heap.writeTrustedFieldU32(
            context, CONTEXT_NEXT, next || 0, Heap.Types.CONTEXT);
    };

    Records.prototype.allocateEngineState = function () {
        return this.heap.allocateRecordWords(
            Heap.Types.ENGINE_STATE, ENGINE_STATE_BYTES, 0, 0, 0, 0);
    };

    Records.prototype.engineGCGeneration = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_GENERATION, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineGCGeneration = function (state, generation) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_GC_GENERATION, generation || 0,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCStackBase = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_STACK_BASE, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCStackLimit = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_STACK_LIMIT, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCCollections = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_COLLECTIONS, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCMarkMicroseconds = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_MARK_US, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCSweepMicroseconds = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_SWEEP_US, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCIndexMicroseconds = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_INDEX_US, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCTotalMicroseconds = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_TOTAL_US, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCMaximumPauseMicroseconds = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_MAX_PAUSE_US, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCLiveBytes = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_LIVE_BYTES, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCStressInterval = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_STRESS_INTERVAL, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.resetEngineGCStress = function (state) {
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_STRESS_REMAINING,
            this.engineGCStressInterval(state), Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineGCStressInterval = function (state, interval) {
        if (interval === true) interval = GC_STRESS_DEFAULT_INTERVAL;
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_STRESS_INTERVAL,
            interval, Heap.Types.ENGINE_STATE);
        this.resetEngineGCStress(state);
    };

    Records.prototype.engineGCDiagnostics = function (state) {
        return {mark: this.engineGCMarkMicroseconds(state),
                sweep: this.engineGCSweepMicroseconds(state),
                index: this.engineGCIndexMicroseconds(state),
                total: this.engineGCTotalMicroseconds(state),
                maximum: this.engineGCMaximumPauseMicroseconds(state),
                live: this.engineGCLiveBytes(state)};
    };

    Records.prototype.setEngineGCDiagnostics = function (state, diagnostics) {
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_MARK_US,
            diagnostics ? diagnostics.mark : 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_SWEEP_US,
            diagnostics ? diagnostics.sweep : 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_INDEX_US,
            diagnostics ? diagnostics.index : 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_TOTAL_US,
            diagnostics ? diagnostics.total : 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_MAX_PAUSE_US,
            diagnostics ? diagnostics.maximum : 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_LIVE_BYTES,
            diagnostics ? diagnostics.live : 0, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCRoot = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_ROOT, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineGCRoot = function (state, root) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_GC_ROOT, root || 0, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCContextHead = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_CONTEXT_HEAD, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineGCContextHead = function (state, context) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_GC_CONTEXT_HEAD, context || 0,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCNativeFunctionHead = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_NATIVE_FUNCTION_HEAD,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineGCNativeFunctionHead = function (
            state, callable) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_GC_NATIVE_FUNCTION_HEAD, callable || 0,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineGCRootSlotHead = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_GC_ROOT_SLOT_HEAD, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineGCRootSlotHead = function (state, slot) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_GC_ROOT_SLOT_HEAD, slot || 0,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineGCState = function (
            state, generation, stackBase, stackLimit, collections) {
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_GENERATION,
            generation || 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_STACK_BASE,
            stackBase || 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_STACK_LIMIT,
            stackLimit || 0, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_GC_COLLECTIONS,
            collections || 0, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.allocatePlatformServices = function () {
        return this.heap.allocateRecordWords(
            Heap.Types.PLATFORM_SERVICES, PLATFORM_SERVICES_BYTES,
            0, 0, 0, 0);
    };

    Records.prototype.setEnginePlatformServices = function (state, services) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_PLATFORM_SERVICES, services,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.enginePlatformServices = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_PLATFORM_SERVICES, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setPlatformDlsymPointer = function (services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_DLSYM_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformDlsymPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_DLSYM_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformDlsymPointerCellAddress = function (services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        return this.heap.trustedPayloadAddress(services,
                                               PLATFORM_DLSYM_POINTER);
    };

    Records.prototype.setPlatformArraySlicePointer = function (
            services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_ARRAY_SLICE_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformArraySlicePointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_ARRAY_SLICE_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.setPlatformArrayConcatPointer = function (
            services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_ARRAY_CONCAT_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformArrayConcatPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_ARRAY_CONCAT_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.setPlatformGettimeofdayPointer = function (
            services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_GETTIMEOFDAY_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformGettimeofdayPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_GETTIMEOFDAY_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformGettimeofdayPointerCellAddress = function (
            services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        return this.heap.trustedPayloadAddress(
            services, PLATFORM_GETTIMEOFDAY_POINTER);
    };

    Records.prototype.setPlatformDateIntrinsicPointer = function (
            services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_DATE_INTRINSIC_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformDateIntrinsicPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_DATE_INTRINSIC_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.setPlatformNumericPropertyPointer = function (
            services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_NUMERIC_PROPERTY_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformNumericPropertyPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_NUMERIC_PROPERTY_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.setPlatformStrtodPointer = function (services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_STRTOD_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformStrtodPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_STRTOD_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformStrtodPointerCellAddress = function (services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        return this.heap.trustedPayloadAddress(services,
                                               PLATFORM_STRTOD_POINTER);
    };

    Records.prototype.setPlatformMallocPointer = function (services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_MALLOC_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformMallocPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_MALLOC_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformMallocPointerCellAddress = function (services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        return this.heap.trustedPayloadAddress(services,
                                               PLATFORM_MALLOC_POINTER);
    };

    Records.prototype.setPlatformFreePointer = function (services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_FREE_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformFreePointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_FREE_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformFreePointerCellAddress = function (services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        return this.heap.trustedPayloadAddress(services,
                                               PLATFORM_FREE_POINTER);
    };

    Records.prototype.setPlatformSnprintfPointer = function (services, pointer) {
        this.heap.writeTrustedFieldU32(
            services, PLATFORM_SNPRINTF_POINTER, pointer,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformSnprintfPointer = function (services) {
        return this.heap.readTrustedFieldU32(
            services, PLATFORM_SNPRINTF_POINTER,
            Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformSnprintfPointerCellAddress = function (services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        return this.heap.trustedPayloadAddress(services,
                                               PLATFORM_SNPRINTF_POINTER);
    };

    Records.prototype.setPlatformMemsetPointer = function (services, pointer) {
        this.heap.writeTrustedFieldU32(services, PLATFORM_MEMSET_POINTER,
            pointer, Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformMemsetPointer = function (services) {
        return this.heap.readTrustedFieldU32(services,
            PLATFORM_MEMSET_POINTER, Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformMemsetPointerCellAddress = function (services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        return this.heap.trustedPayloadAddress(services, PLATFORM_MEMSET_POINTER);
    };

    Records.prototype.setPlatformCallocPointer = function (services, pointer) {
        this.heap.writeTrustedFieldU32(services, PLATFORM_CALLOC_POINTER,
            pointer, Heap.Types.PLATFORM_SERVICES);
    };

    Records.prototype.platformCallocPointerCellAddress = function (services) {
        return this.heap.trustedPayloadAddress(services, PLATFORM_CALLOC_POINTER,
            4, Heap.Types.PLATFORM_SERVICES);
    };

    /* Native service addresses are process-local capabilities and must never
     * become persistent image data. Snapshot code brackets its memory copy
     * with these two named operations so platform layout remains private to
     * HeapRecords and the live runtime is restored exactly. */
    Records.prototype.suspendPlatformPointersForSnapshot = function (services) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        var saved = [];
        var offset = 0;
        while (offset < PLATFORM_SERVICES_BYTES) {
            saved.push(this.heap.readTrustedFieldU32(
                services, offset, Heap.Types.PLATFORM_SERVICES));
            this.heap.writeTrustedFieldU32(
                services, offset, 0, Heap.Types.PLATFORM_SERVICES);
            offset += 4;
        }
        return saved;
    };

    Records.prototype.restorePlatformPointersAfterSnapshot = function (
            services, saved) {
        this.heap.requireRecord(services, Heap.Types.PLATFORM_SERVICES);
        var offset = 0;
        var index = 0;
        while (offset < PLATFORM_SERVICES_BYTES) {
            this.heap.writeTrustedFieldU32(
                services, offset, saved[index++], Heap.Types.PLATFORM_SERVICES);
            offset += 4;
        }
    };

    Records.prototype.engineStatePayloadAddress = function (state) {
        return this.heap.trustedPayloadAddress(
            state, ENGINE_EXIT_REASON, ENGINE_STATE_BYTES,
            Heap.Types.ENGINE_STATE);
    };

    /* The standalone machine-code bootstrap reports an unsupported opcode
     * without a host VM. Expose the two diagnostic fields as one named ABI
     * description so the emitter never duplicates engine-state offsets. */
    Records.prototype.standaloneEngineDiagnosticLayout = function () {
        return {
            pc: ENGINE_PC,
            opcode: ENGINE_RESULT_CELL,
            detail: ENGINE_CALL_REJECT_REASON,
            allocation: ENGINE_ALLOCATION_FAILED,
            gcCollections: ENGINE_GC_COLLECTIONS,
            gcLiveBytes: ENGINE_GC_LIVE_BYTES,
            heapTail: ENGINE_NATIVE_TAIL_BUMP,
            heapLimit: ENGINE_NATIVE_TAIL_LIMIT,
            heapMaximum: ENGINE_NATIVE_MAX_LIMIT
        };
    };

    Records.prototype.standaloneEngineExecutionLayout = function () {
        return {currentFrame: ENGINE_CURRENT_FRAME};
    };

    Records.prototype.setEngineCurrentFrame = function (state, frame) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_CURRENT_FRAME, frame, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.clearEnginePropertyCache = function (state) {
        var payload = this.engineStatePayloadAddress(state);
        this.heap.memory.fill(payload + ENGINE_PROPERTY_CACHE,
            PROPERTY_CACHE_ENTRY_BYTES * PROPERTY_CACHE_ENTRY_COUNT, 0);
    };

    Records.prototype.engineExitReason = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_EXIT_REASON, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.enginePC = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_PC, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineResultCell = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_RESULT_CELL, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineInstructionCount = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_INSTRUCTIONS, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineHeapBounds = function (state, bump, limit) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_HEAP_BUMP, bump, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(
            state, ENGINE_HEAP_LIMIT, limit, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineHeapBump = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_HEAP_BUMP, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineHeapLimit = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_HEAP_LIMIT, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineNativeAllocator = function (
            state, regionEnd, freeRegion, tailBump, tailLimit, regionActive,
            retiredRegion) {
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_REGION_END,
            regionEnd, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_FREE_REGION,
            freeRegion, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_TAIL_BUMP,
            tailBump, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_TAIL_LIMIT,
            tailLimit, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_REGION_ACTIVE,
            regionActive, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_RETIRED_REGION,
            retiredRegion || 0, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineNativeFreeRegion = function (state, region) {
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_FREE_REGION,
            region, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineNativeRetiredRegion = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_NATIVE_RETIRED_REGION, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineNativeTailBounds = function (
            state, bump, limit) {
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_TAIL_BUMP,
            bump, Heap.Types.ENGINE_STATE);
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_TAIL_LIMIT,
            limit, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineNativeMaximumLimit = function (state, limit) {
        this.heap.writeTrustedFieldU32(state, ENGINE_NATIVE_MAX_LIMIT,
            limit, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineNativeMaximumLimit = function (state) {
        return this.heap.readTrustedFieldU32(state, ENGINE_NATIVE_MAX_LIMIT,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineNativeFreeRegion = function (state) {
        return this.heap.readTrustedFieldU32(state, ENGINE_NATIVE_FREE_REGION,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineNativeRegionEnd = function (state) {
        return this.heap.readTrustedFieldU32(state, ENGINE_NATIVE_REGION_END,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineNativeRegionActive = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_NATIVE_REGION_ACTIVE, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineNativeTailBump = function (state) {
        return this.heap.readTrustedFieldU32(state, ENGINE_NATIVE_TAIL_BUMP,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineAllocationFailed = function (state) {
        return this.heap.readTrustedFieldU32(state, ENGINE_ALLOCATION_FAILED,
            Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineCurrentFrame = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_CURRENT_FRAME, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineCallRejectReason = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_CALL_REJECT_REASON, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.engineFreeFrame = function (state) {
        return this.heap.readTrustedFieldU32(
            state, ENGINE_FREE_FRAME, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.setEngineFreeFrame = function (state, frame) {
        this.heap.writeTrustedFieldU32(
            state, ENGINE_FREE_FRAME, frame, Heap.Types.ENGINE_STATE);
    };

    Records.prototype.cachedFrameNext = function (frame) {
        return this.heap.readTrustedFieldU32(
            frame, FRAME_PROGRAM, Heap.Types.FREE);
    };

    Records.prototype.engineOpcodeCount = function (state, opcode) {
        if (opcode < 0 || opcode >= ENGINE_OPCODE_COUNT) return 0;
        return this.heap.readTrustedFieldU32(
            state, ENGINE_OPCODE_COUNTS + opcode * 4,
            Heap.Types.ENGINE_STATE);
    };

    /* Enumerate the authoritative outgoing guest-heap edges of one record.
     * Layout knowledge stays in this accessor module; collectors and heap
     * inspectors never duplicate offsets. */
    Records.prototype.visitReferences = function (address, visit) {
        var records = this;
        var type = this.heap.recordType(address);
        function reference(target) {
            if (target) visit(target);
        }
        function cell(cellAddress) {
            if (records.cells.tagAt(cellAddress) === ValueCells.Tags.REFERENCE) {
                reference(records.cells.referenceAddressAt(cellAddress));
            }
        }
        function objectEdges() {
            reference(records.objectPrototype(address));
            reference(records.objectPropertyHead(address));
        }
        if (type === Heap.Types.OBJECT) {
            objectEdges();
            reference(records.objectPropertyIndex(address));
        } else if (type === Heap.Types.ARRAY) {
            objectEdges();
            reference(records.arrayElements(address));
            var argumentsEnvironment = records.arrayReserved(address);
            if (argumentsEnvironment && argumentsEnvironment !== 4294967295) {
                reference(argumentsEnvironment);
            }
        } else if (type === Heap.Types.NATIVE_FUNCTION ||
                   type === Heap.Types.BYTECODE_FUNCTION) {
            objectEdges();
            reference(records.functionClosure(address));
            if (type === Heap.Types.BYTECODE_FUNCTION) {
                reference(records.functionMetadata(address));
            }
            reference(records.functionHomeContext(address));
            if (type === Heap.Types.NATIVE_FUNCTION) {
                reference(records.functionGCNext(address));
            }
        } else if (type === Heap.Types.ENVIRONMENT) {
            reference(records.environmentParent(address));
            reference(records.environmentProgram(address));
            reference(records.environmentObject(address));
            var environmentIndex = 0;
            while (environmentIndex < records.environmentSlotCount(address)) {
                cell(records.environmentCell(address, environmentIndex++));
            }
        } else if (type === Heap.Types.PROPERTY_STORAGE) {
            reference(records.propertyStorageHashIndex(address));
            var propertyEntry = 1;
            while (propertyEntry <= records.propertyStorageLength(address)) {
                var entryKey = records.propertyStorageKey(address, propertyEntry);
                if (entryKey) {
                    reference(entryKey);
                    reference(records.propertyStorageSetter(address, propertyEntry));
                    cell(records.propertyStorageValueCell(address, propertyEntry));
                }
                propertyEntry++;
            }
        } else if (type === Heap.Types.PROPERTY) {
            reference(records.propertyNext(address));
            reference(records.propertyKey(address));
            cell(records.propertyValueCell(address));
            if (records.propertyAttributes(address) & ATTR_ACCESSOR) {
                reference(records.propertySetter(address));
            }
        } else if (type === Heap.Types.STRING &&
                   records.stringIsRope(address)) {
            reference(records.stringRopeLeft(address));
            reference(records.stringRopeRight(address));
        } else if (type === Heap.Types.STRING &&
                   records.stringIsSlice(address)) {
            reference(records.stringSliceBacking(address));
        } else if (type === Heap.Types.REGEXP) {
            reference(this.heap.readTrustedFieldU32(
                address, REGEXP_PATTERN, Heap.Types.REGEXP));
            reference(this.heap.readTrustedFieldU32(
                address, REGEXP_FLAGS, Heap.Types.REGEXP));
            objectEdges();
        } else if (type === Heap.Types.BUFFER_VIEW) {
            reference(records.bufferViewBacking(address));
            reference(this.heap.readTrustedFieldU32(
                address, BUFFER_VIEW_PROTOTYPE, Heap.Types.BUFFER_VIEW));
            reference(records.objectPropertyHead(address));
        } else if (type === Heap.Types.BUFFER_BACKING) {
            reference(records.bufferBackingMetadata(address));
        } else if (type === Heap.Types.ROOT_SLOT) {
            cell(this.heap.trustedPayloadAddress(address, 0));
            reference(records.rootSlotNext(address));
        } else if (type === Heap.Types.VALUE_VECTOR) {
            var vectorIndex = 0;
            while (vectorIndex < records.vectorLength(address)) {
                cell(records.vectorCell(address, vectorIndex++));
            }
        } else if (type === Heap.Types.INTEGER_VECTOR) {
            reference(records.integerVectorExecutionCache(address));
        } else if (type === Heap.Types.CONSTANT_POOL) {
            var cachedConstants = records.constantPoolExecutionCache(address);
            if (cachedConstants) reference(cachedConstants);
            else {
                for (var constantIndex = 0; constantIndex < records.constantPoolLength(address); constantIndex++) {
                    if (records.constantPoolTag(address, constantIndex) === ValueCells.Tags.REFERENCE) {
                        reference(records.constantPoolLow(address, constantIndex));
                    }
                }
            }
        } else if (type === Heap.Types.FRAME) {
            reference(records.frameProgram(address));
            reference(records.frameEnvironment(address));
            reference(records.frameCaller(address));
            reference(records.frameHandler(address));
            reference(records.frameContext(address));
            var registerIndex = 0;
            while (registerIndex < records.frameRegisterCount(address)) {
                cell(records.frameRegisterCell(address, registerIndex++));
            }
        } else if (type === Heap.Types.BYTECODE) {
            reference(records.bytecodeExecutionCache(address));
        } else if (type === Heap.Types.PROGRAM) {
            reference(records.programBytecode(address));
            reference(records.programConstants(address));
            reference(records.programConstantRegisters(address));
            reference(records.programBindingRegisters(address));
            reference(records.programParameterSlots(address));
            reference(records.programSource(address));
        } else if (type === Heap.Types.CONTEXT) {
            reference(records.contextGlobal(address));
            reference(records.contextActiveFrame(address));
            reference(records.contextNext(address));
        } else if (type === Heap.Types.HANDLER) {
            reference(this.heap.readTrustedFieldU32(
                address, HANDLER_NEXT, Heap.Types.HANDLER));
            reference(records.handlerEnvironment(address));
        } else if (type === Heap.Types.ENGINE_STATE) {
            reference(records.engineCurrentFrame(address));
            reference(records.enginePlatformServices(address));
        }
    };

    function propertyHeadOffset(type) {
        if (type === Heap.Types.OBJECT || type === Heap.Types.ARRAY ||
            type === Heap.Types.NATIVE_FUNCTION ||
            type === Heap.Types.BYTECODE_FUNCTION) return OBJECT_PROPERTIES;
        if (type === Heap.Types.REGEXP) return 12;
        if (type === Heap.Types.BUFFER_VIEW) return BUFFER_VIEW_PROPERTIES;
        throw new TypeError("record cannot contain object properties");
    }

    root.GuestVMHeapRecords = Records;
    if (typeof module !== "undefined" && module.exports) module.exports = Records;
}(this));
