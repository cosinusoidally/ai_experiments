/* End-to-end packager acceptance using only real msvcrt file functions.
 * Run inside the Windows guest executable, from mmvm_v2_tests:
 *   win.exe guest_vm/tools/check_snapshot_pe_crt.js INPUT.snap OUTPUT.exe
 * Restrict only the test adapter's resolver namespace, not the VM or compiler.
 * This exercises the native Windows js_min I/O contract without needing a
 * compiler, a second shell binary, or mocked filesystem operations. */
(function (args) {
    if (args.length !== 2) throw new Error("usage: check_snapshot_pe_crt.js INPUT.snap OUTPUT.exe");
    print("raw MSVCRT packager: initialize resolver");
    var FFI = require("../host_ffi.js"), delegate = new FFI();
    var resolver = delegate.getDlsym();
    var crt = delegate.call(delegate.resolve("dlopen"), ["msvcrt.dll", 1]);
    if (!crt) throw new Error("cannot open msvcrt.dll");
    function CRTOnlyFFI() {}
    CRTOnlyFFI.prototype.getDlsym = function () { return resolver; };
    CRTOnlyFFI.prototype.call = function (pointer, parameters) {
        if (pointer === resolver && parameters[0] === 0) {
            return delegate.call(resolver, [crt, parameters[1]]);
        }
        return delegate.call(pointer, parameters);
    };
    CRTOnlyFFI.prototype.resolve = function (name) {
        var pointer = this.call(resolver, [0, name]);
        if (!pointer) throw new Error("missing CRT export: " + name);
        return pointer;
    };
    CRTOnlyFFI.prototype.peek8 = function (pointer) { return delegate.peek8(pointer); };
    CRTOnlyFFI.prototype.peek32 = function (pointer) { return delegate.peek32(pointer); };
    CRTOnlyFFI.prototype.poke8 = function (pointer, value) { return delegate.poke8(pointer, value); };
    print("raw MSVCRT packager: load packager");
    var io = require("./snapshot_exe_io.js"), pe = require("./snapshot_exe_pe.js");
    var Assembler = require("../aot/x86_assembler.js"), format = require("../aot/standalone_format.js");
    function convert() { io.convert(io.nativeAdapter(CRTOnlyFFI), args[0], args[1], pe, Assembler, format); }
    try {
        print("raw MSVCRT packager: convert snapshot");
        convert();
        print("raw MSVCRT packager: first conversion complete");
        var rejected = false;
        try { convert(); } catch (error) {
            print("raw MSVCRT packager: rejection: " + error.message);
            /* Report the actual failure without requiring the optional
             * native Error object's ToPrimitive path. */
            if (!error || typeof error.message !== "string" ||
                    error.message.indexOf("failed (errno") < 0) throw error;
            rejected = true;
        }
        if (!rejected) throw new Error("native CRT publication overwrote an existing output");
        print("raw MSVCRT packager acceptance passed (including no-clobber publication)");
    } finally { delegate.call(delegate.resolve("dlclose"), [crt]); }
}(typeof arguments !== "undefined" ? arguments : []));
