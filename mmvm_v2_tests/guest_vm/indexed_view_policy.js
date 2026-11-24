/* Shared leaf policy: ordinary JS, kernel-compiled native code, and guest
 * bytecode all load this source. No host services or free semantic bindings. */
(function (root) {
    function indexedViewDescriptorAllowedKernel(accessor, writablePresent, writable,
            enumerablePresent, enumerable, configurablePresent, configurable) {
        if (accessor !== 0) return 0;
        if (writablePresent !== 0 && writable === 0) return 0;
        if (enumerablePresent !== 0 && enumerable === 0) return 0;
        if (configurablePresent !== 0 && configurable === 0) return 0;
        return 1;
    }
    root.GuestVMIndexedViewDescriptorAllowed = indexedViewDescriptorAllowedKernel;
    if (typeof module !== "undefined" && module.exports) module.exports = indexedViewDescriptorAllowedKernel;
}(this));
