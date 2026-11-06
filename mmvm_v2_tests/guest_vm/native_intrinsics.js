/* Stable IDs stored in native-function heap records. The native interpreter
 * recognizes only operations whose semantics can be completed without a host
 * callback; all other functions retain the ordinary embedding boundary. */
(function (root) {
    var Intrinsics = {NONE: 0, PEEK8: 1, POKE8: 2, PEEK32: 3, POKE32: 4,
                      BUFFER_READ_U32_LE: 5, BUFFER_WRITE_U32_LE: 6,
                      MATH_SQRT: 7, MATH_MIN: 8, MATH_ABS: 9, MATH_MAX: 10,
                      ARRAY_PUSH: 11, MATH_FLOOR: 12, MATH_CEIL: 13,
                      MATH_ROUND: 14, MATH_SIN: 15, MATH_COS: 16,
                      BUFFER_READ_U16_LE: 17, BUFFER_READ_U16_BE: 18,
                      BUFFER_WRITE_U16_LE: 19, BUFFER_WRITE_I16_LE: 20,
                      BUFFER_SLICE: 21, STRING_CHAR_AT: 22,
                      BUFFER_ALLOC: 23, BUFFER_COPY: 24,
                      GET_DLSYM: 25, FFI_CALL: 26,
                      STRING_CHAR_CODE_AT: 27, MATH_POW: 28,
                      STRING_SUBSTR: 29, STRING_INDEX_OF: 30,
                      REGEXP_TEST: 31, STRING_REPLACE: 32,
                      FUNCTION_APPLY: 33, OBJECT_HAS_OWN_PROPERTY: 34,
                      STRING_CONSTRUCTOR: 35, MATH_ATAN2: 36,
                      ARRAY_JOIN: 37, ARRAY_SHIFT: 38, ARRAY_SLICE: 39,
                      ARRAY_CONCAT: 40, NUMBER_CONSTRUCTOR: 41,
                      DATE_CONSTRUCTOR: 42, DATE_GET_TIME: 43,
                      FUNCTION_CALL: 44, ARRAY_POP: 45,
                      ARRAY_CONSTRUCTOR: 46, STRING_SUBSTRING: 47,
                      STRING_FROM_CHAR_CODE: 48,
                      PROGRAM_CREATE: 49, PROGRAM_SET_CODE: 50,
                      PROGRAM_SET_CONSTANT: 51, PROGRAM_SET_VECTOR: 52,
                      DATE_GET_TIMEZONE_OFFSET: 53,
                      DATE_GET_DATE: 54, DATE_GET_MONTH: 55,
                      DATE_GET_FULL_YEAR: 56, DATE_GET_HOURS: 57,
                      DATE_GET_MINUTES: 58, DATE_GET_SECONDS: 59,
                      DATE_GET_MILLISECONDS: 60, DATE_GET_DAY: 61,
                      FUNCTION_CONSTRUCTOR: 62,
                      REGEXP_CONSTRUCTOR: 63,
                      EVAL: 64,
                      PARSE_INT: 65,
                      MATH_ATAN: 66,
                      BUFFER_TO_STRING: 67,
                      FUNCTION_TO_STRING: 68,
                      STRING_LAST_INDEX_OF: 69,
                      STRING_SPLIT: 70,
                      BUFFER_READ_U8: 71,
                      BUFFER_WRITE_U8: 72,
                      BUFFER_CONSTRUCTOR: 73,
                      ARRAY_UNSHIFT: 74,
                      ARRAY_INDEX_OF: 75,
                      MATH_LOG: 76,
                      NUMBER_TO_PRECISION: 77,
                      OBJECT_DEFINE_PROPERTY: 78,
                      NUMBER_TO_FIXED: 79,
                      MATH_RANDOM: 80,
                      OBJECT_CONSTRUCTOR: 81,
                      STRING_VALUE_OF: 82,
                      NUMBER_TO_STRING: 83,
                      ARRAY_SPLICE: 84,
                      BOOLEAN_CONSTRUCTOR: 85,
                      DATE_NOW: 86,
                      ARRAY_REVERSE: 87,
                      TYPED_ARRAY_SET: 88,
                      ENCODE_URI_COMPONENT: 89,
                      LEGACY_UNESCAPE: 90,
                      TYPED_ARRAY_CONSTRUCTOR_BASE: 90,
                      ARRAY_BUFFER_CONSTRUCTOR: 91,
                      UINT8_ARRAY_CONSTRUCTOR: 92,
                      UINT16_ARRAY_CONSTRUCTOR: 93,
                      UINT32_ARRAY_CONSTRUCTOR: 94,
                      INT32_ARRAY_CONSTRUCTOR: 95,
                      FLOAT32_ARRAY_CONSTRUCTOR: 96,
                      FLOAT64_ARRAY_CONSTRUCTOR: 97,
                      INT8_ARRAY_CONSTRUCTOR: 98,
                      INT16_ARRAY_CONSTRUCTOR: 99,
                      OBJECT_CREATE: 100,
                      PARSE_FLOAT: 101,
                      IS_NAN: 102,
                      STRING_TO_UPPER_CASE: 103,
                      OBJECT_VALUE_OF: 104,
                      OBJECT_TO_STRING: 105,
                      BUFFER_READ_I16_LE: 106,
                      GC_STRESS_CONTROL: 107,
                      DECODE_URI_COMPONENT: 108,
                      DECODE_URI: 109,
                      STRING_TO_LOWER_CASE: 110,
                      BUFFER_IS_BUFFER: 111,
                      FIRST_ERROR_CONSTRUCTOR: 112,
                      LAST_ERROR_CONSTRUCTOR: 118,
                      OPCODE_COUNTER_WORD: 119,
                      TYPED_ARRAY_SUBARRAY: 120,
                      ARRAY_IS_ARRAY: 121,
                      THROW_TYPE_ERROR: 122,
                      OBJECT_IS_PROTOTYPE_OF: 123,
                      TRY_COPY_INT32_ARRAY: 124,
                      ARRAY_TO_STRING: 125,
                      FUNCTION_BIND: 126,
                      BOUND_FUNCTION: 127,
                      MATH_TAN: 128,
                      OBJECT_KEYS: 129,
                      PROGRAM_SET_BINDING_NAME: 130,
                      OBJECT_GET_OWN_PROPERTY_DESCRIPTOR: 131,
                      GUEST_BUILTIN: 132,
                      OBJECT_PREVENT_EXTENSIONS: 133,
                      OBJECT_IS_EXTENSIBLE: 134,
                      OBJECT_GET_OWN_PROPERTY_NAMES: 135,
                      OBJECT_INDEXED_VIEW_LENGTH: 136};
    Intrinsics.LAST_ID = Intrinsics.OBJECT_INDEXED_VIEW_LENGTH;
    /* A non-constructible native-shaped public function delegates to guest
     * bytecode through a traced closure vector, never a host callback. */
    Intrinsics.GuestBuiltinLayout = {IMPLEMENTATION: 0, LENGTH: 1};
    /* ES5.1 public function lengths, not the native dispatcher's minimum
     * accepted argument counts. Callbacks all have the embedding signature
     * (receiver, args, context), which must never leak into this metadata.
     * Only standard built-ins are listed: embedding functions choose their
     * own descriptors and are not assigned a guessed public signature. */
    Intrinsics.formalLengths = {
        Object: 1, Function: 1, Array: 1, String: 1, Boolean: 1, Number: 1,
        Date: 7, RegExp: 2, Error: 1, EvalError: 1, RangeError: 1,
        ReferenceError: 1, SyntaxError: 1, TypeError: 1, URIError: 1,
        eval: 1, parseInt: 2, parseFloat: 1, isNaN: 1, isFinite: 1,
        escape: 1, unescape: 1, encodeURI: 1, decodeURI: 1,
        encodeURIComponent: 1, decodeURIComponent: 1,
        "Function.prototype": 0, "Function.call": 1, "Function.apply": 2,
        "Function.bind": 1, "Function.toString": 0,
        "Object.toString": 0, "Object.toLocaleString": 0,
        "Object.valueOf": 0, "Object.hasOwnProperty": 1,
        "Object.isPrototypeOf": 1, "Object.propertyIsEnumerable": 1,
        "Object.getPrototypeOf": 1, "Object.getOwnPropertyDescriptor": 2,
        "Object.getOwnPropertyNames": 1, "Object.create": 2,
        "Object.defineProperty": 3, "Object.defineProperties": 2,
        "Object.seal": 1, "Object.freeze": 1, "Object.preventExtensions": 1,
        "Object.isSealed": 1, "Object.isFrozen": 1,
        "Object.isExtensible": 1, "Object.keys": 1,
        "Array.isArray": 1, "Array.toString": 0, "Array.toLocaleString": 0,
        "Array.concat": 1, "Array.join": 1, "Array.pop": 0,
        "Array.push": 1, "Array.reverse": 0, "Array.shift": 0,
        "Array.slice": 2, "Array.sort": 1, "Array.splice": 2,
        "Array.unshift": 1, "Array.indexOf": 1, "Array.lastIndexOf": 1,
        "Array.every": 1, "Array.some": 1, "Array.forEach": 1,
        "Array.map": 1, "Array.filter": 1, "Array.reduce": 1,
        "Array.reduceRight": 1,
        "String.fromCharCode": 1, "String.toString": 0,
        "String.valueOf": 0, "String.charAt": 1, "String.charCodeAt": 1,
        "String.concat": 1, "String.indexOf": 1, "String.lastIndexOf": 1,
        "String.localeCompare": 1, "String.match": 1, "String.replace": 2,
        "String.search": 1, "String.slice": 2, "String.split": 2,
        "String.substring": 2, "String.substr": 2,
        "String.toLowerCase": 0, "String.toLocaleLowerCase": 0,
        "String.toUpperCase": 0, "String.toLocaleUpperCase": 0,
        "String.trim": 0, "Boolean.toString": 0, "Boolean.valueOf": 0,
        "Number.toString": 1, "Number.toLocaleString": 0,
        "Number.valueOf": 0, "Number.toFixed": 1,
        "Number.toExponential": 1, "Number.toPrecision": 1,
        "Math.abs": 1, "Math.acos": 1, "Math.asin": 1, "Math.atan": 1,
        "Math.atan2": 2, "Math.ceil": 1, "Math.cos": 1, "Math.exp": 1,
        "Math.floor": 1, "Math.log": 1, "Math.max": 2, "Math.min": 2,
        "Math.pow": 2, "Math.random": 0, "Math.round": 1, "Math.sin": 1,
        "Math.sqrt": 1, "Math.tan": 1,
        "Date.parse": 1, "Date.UTC": 7, "Date.now": 0,
        "Date.toString": 0, "Date.toDateString": 0, "Date.toTimeString": 0,
        "Date.toLocaleString": 0, "Date.toLocaleDateString": 0,
        "Date.toLocaleTimeString": 0, "Date.valueOf": 0, "Date.getTime": 0,
        "Date.getFullYear": 0, "Date.getUTCFullYear": 0,
        "Date.getMonth": 0, "Date.getUTCMonth": 0,
        "Date.getDate": 0, "Date.getUTCDate": 0,
        "Date.getDay": 0, "Date.getUTCDay": 0,
        "Date.getHours": 0, "Date.getUTCHours": 0,
        "Date.getMinutes": 0, "Date.getUTCMinutes": 0,
        "Date.getSeconds": 0, "Date.getUTCSeconds": 0,
        "Date.getMilliseconds": 0, "Date.getUTCMilliseconds": 0,
        "Date.getTimezoneOffset": 0, "Date.setTime": 1,
        "Date.setMilliseconds": 1, "Date.setUTCMilliseconds": 1,
        "Date.setSeconds": 2, "Date.setUTCSeconds": 2,
        "Date.setMinutes": 3, "Date.setUTCMinutes": 3,
        "Date.setHours": 4, "Date.setUTCHours": 4,
        "Date.setDate": 1, "Date.setUTCDate": 1,
        "Date.setMonth": 2, "Date.setUTCMonth": 2,
        "Date.setFullYear": 3, "Date.setUTCFullYear": 3,
        "Date.toUTCString": 0, "Date.toISOString": 0, "Date.toJSON": 1,
        "RegExp.exec": 1, "RegExp.test": 1, "RegExp.toString": 0,
        "Error.toString": 0, "JSON.parse": 2, "JSON.stringify": 3
    };
    Intrinsics.BoundFunctionLayout = {TARGET: 0, THIS: 1, ARGUMENT_BASE: 2};
    /* This order is the shared mapping from constructor names to IDs and
     * native runtime-support slots. Do not repeat it in either backend. */
    Intrinsics.ERROR_CONSTRUCTOR_NAMES = ["Error", "EvalError", "RangeError",
        "ReferenceError", "SyntaxError", "TypeError", "URIError"];

    /* Minimum argument counts accepted by native handlers, not the public
     * Function.length values. A handler may accept fewer than its advertised
     * arity, or decline a call so the normal semantic path can handle it.
     * Build once per runtime; native execution reads the guest-owned table
     * instead of reclassifying the ID through a comparison chain each call. */
    Intrinsics.createMinimumCallArguments = function () {
        var counts = [], index;
        for (index = 0; index <= Intrinsics.LAST_ID; index++) counts[index] = 1;
        function assign(ids, count) {
            for (var item = 0; item < ids.length; item++) counts[ids[item]] = count;
        }
        assign([Intrinsics.TRY_COPY_INT32_ARRAY, Intrinsics.OBJECT_IS_PROTOTYPE_OF,
            Intrinsics.GET_DLSYM, Intrinsics.ARRAY_PUSH, Intrinsics.ARRAY_TO_STRING,
            Intrinsics.ARRAY_UNSHIFT, Intrinsics.ARRAY_INDEX_OF, Intrinsics.ARRAY_SPLICE,
            Intrinsics.BOOLEAN_CONSTRUCTOR, Intrinsics.DATE_NOW, Intrinsics.PARSE_FLOAT,
            Intrinsics.PARSE_INT, Intrinsics.IS_NAN, Intrinsics.ARRAY_BUFFER_CONSTRUCTOR,
            Intrinsics.ARRAY_REVERSE, Intrinsics.NUMBER_TO_PRECISION,
            Intrinsics.NUMBER_TO_FIXED, Intrinsics.MATH_RANDOM, Intrinsics.OBJECT_CONSTRUCTOR,
            Intrinsics.OBJECT_TO_STRING, Intrinsics.OBJECT_VALUE_OF, Intrinsics.ARRAY_IS_ARRAY,
            Intrinsics.STRING_VALUE_OF, Intrinsics.STRING_TO_UPPER_CASE,
            Intrinsics.STRING_TO_LOWER_CASE, Intrinsics.NUMBER_TO_STRING,
            Intrinsics.GC_STRESS_CONTROL, Intrinsics.OPCODE_COUNTER_WORD,
            Intrinsics.ARRAY_POP, Intrinsics.ARRAY_CONSTRUCTOR, Intrinsics.ARRAY_SHIFT,
            Intrinsics.ARRAY_SLICE, Intrinsics.ARRAY_CONCAT, Intrinsics.NUMBER_CONSTRUCTOR,
            Intrinsics.DATE_CONSTRUCTOR, Intrinsics.DATE_GET_TIME,
            Intrinsics.DATE_GET_TIMEZONE_OFFSET, Intrinsics.FUNCTION_CONSTRUCTOR,
            Intrinsics.REGEXP_CONSTRUCTOR, Intrinsics.STRING_CONSTRUCTOR,
            Intrinsics.BUFFER_SLICE, Intrinsics.TYPED_ARRAY_SUBARRAY,
            Intrinsics.BUFFER_TO_STRING, Intrinsics.BUFFER_IS_BUFFER,
            Intrinsics.FUNCTION_TO_STRING, Intrinsics.STRING_CHAR_AT,
            Intrinsics.STRING_CHAR_CODE_AT, Intrinsics.STRING_SUBSTR,
            Intrinsics.STRING_SUBSTRING, Intrinsics.STRING_FROM_CHAR_CODE,
            Intrinsics.STRING_SPLIT, Intrinsics.GUEST_BUILTIN], 0);
        for (index = Intrinsics.FIRST_ERROR_CONSTRUCTOR;
                index <= Intrinsics.LAST_ERROR_CONSTRUCTOR; index++) counts[index] = 0;
        for (index = Intrinsics.UINT8_ARRAY_CONSTRUCTOR;
                index <= Intrinsics.INT16_ARRAY_CONSTRUCTOR; index++) counts[index] = 0;
        for (index = Intrinsics.DATE_GET_DATE;
                index <= Intrinsics.DATE_GET_DAY; index++) counts[index] = 0;
        assign([Intrinsics.MATH_ATAN2, Intrinsics.STRING_REPLACE, Intrinsics.FUNCTION_APPLY,
            Intrinsics.MATH_POW, Intrinsics.POKE8, Intrinsics.POKE32,
            Intrinsics.BUFFER_WRITE_U32_LE, Intrinsics.BUFFER_WRITE_U8,
            Intrinsics.BUFFER_WRITE_U16_LE, Intrinsics.BUFFER_WRITE_I16_LE], 2);
        assign([Intrinsics.OBJECT_DEFINE_PROPERTY, Intrinsics.PROGRAM_SET_CODE,
            Intrinsics.PROGRAM_SET_BINDING_NAME, Intrinsics.PROGRAM_SET_CONSTANT], 3);
        counts[Intrinsics.PROGRAM_SET_VECTOR] = 4;
        counts[Intrinsics.PROGRAM_CREATE] = 12;
        return counts;
    };
    root.GuestVMNativeIntrinsics = Intrinsics;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = Intrinsics;
    }
}(this));
