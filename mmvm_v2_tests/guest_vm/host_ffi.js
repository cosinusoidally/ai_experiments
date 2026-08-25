/* Sole raw MMVM FFI boundary for the guest VM. Guest exposure is opt-in. */
(function (root) {
    var isMMVM = typeof ffi_call === "function" && typeof get_dlsym === "function";

    function HostFFI() {
        this.isMMVM = isMMVM;
        this.dlsym = isMMVM ? get_dlsym() : 0;
    }

    HostFFI.prototype.getDlsym = function () {
        return this.dlsym;
    };

    HostFFI.prototype.callNative = function (pointer, args) {
        var count = args.length;
        if (count === 0) return ffi_call(pointer);
        if (count === 1) return ffi_call(pointer, args[0]);
        if (count === 2) return ffi_call(pointer, args[0], args[1]);
        if (count === 3) return ffi_call(pointer, args[0], args[1], args[2]);
        if (count === 4) return ffi_call(pointer, args[0], args[1], args[2], args[3]);
        if (count === 5) return ffi_call(pointer, args[0], args[1], args[2],
                                         args[3], args[4]);
        if (count === 6) return ffi_call(pointer, args[0], args[1], args[2],
                                         args[3], args[4], args[5]);
        if (count === 7) return ffi_call(pointer, args[0], args[1], args[2],
                                         args[3], args[4], args[5], args[6]);
        if (count === 8) return ffi_call(pointer, args[0], args[1], args[2],
                                         args[3], args[4], args[5], args[6], args[7]);
        throw new RangeError("MMVM ffi_call accepts at most eight arguments");
    };

    HostFFI.prototype.call = function (pointer, args) {
        if (!this.isMMVM) throw new Error("raw FFI is unavailable on this host");
        return this.callNative(pointer, args);
    };

    HostFFI.prototype.resolve = function (name) {
        var pointer = this.call(this.dlsym, [0, name]);
        if (!pointer) throw new Error("could not resolve libc symbol: " + name);
        return pointer;
    };

    HostFFI.prototype.peek8 = function (pointer) {
        if (!this.isMMVM) throw new Error("raw memory is unavailable on this host");
        return peek8(pointer);
    };

    HostFFI.prototype.poke8 = function (pointer, value) {
        if (!this.isMMVM) throw new Error("raw memory is unavailable on this host");
        poke8(pointer, value);
        return undefined;
    };

    HostFFI.prototype.peek32 = function (pointer) {
        if (!this.isMMVM) throw new Error("raw memory is unavailable on this host");
        return peek32(pointer);
    };

    HostFFI.prototype.poke32 = function (pointer, value) {
        if (!this.isMMVM) throw new Error("raw memory is unavailable on this host");
        poke32(pointer, value);
        return undefined;
    };

    root.GuestVMHostFFI = HostFFI;
    if (typeof module !== "undefined" && module.exports) module.exports = HostFFI;
}(this));
