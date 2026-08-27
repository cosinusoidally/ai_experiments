/* Stable IDs stored in native-function heap records. The native interpreter
 * recognizes only operations whose semantics can be completed without a host
 * callback; all other functions retain the ordinary embedding boundary. */
(function (root) {
    var Intrinsics = {NONE: 0, PEEK8: 1, POKE8: 2, PEEK32: 3, POKE32: 4};
    root.GuestVMNativeIntrinsics = Intrinsics;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = Intrinsics;
    }
}(this));
