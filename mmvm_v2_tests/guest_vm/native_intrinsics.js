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
                      PROGRAM_SET_BINDING_NAME: 130};
    Intrinsics.LAST_ID = Intrinsics.PROGRAM_SET_BINDING_NAME;
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
            Intrinsics.STRING_SPLIT], 0);
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
