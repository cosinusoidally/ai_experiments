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
                      ARRAY_JOIN: 37};
    root.GuestVMNativeIntrinsics = Intrinsics;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = Intrinsics;
    }
}(this));
