/* Run with a shell-policy standalone executable, with or without --no-ion. */
(function () {
    function check(value, message) { if (!value) throw new Error(message); }
    check(typeof process === "undefined" && typeof require === "undefined", "shell environment detection");
    check(typeof load === "function" && typeof read === "function", "shell source services");
    var binarySource = read("guest_vm/tests/shell_integration.js", "binary");
    check(binarySource.constructor === Uint8Array &&
        binarySource.buffer.constructor === ArrayBuffer && binarySource[0] === 47,
        "shell binary reads expose a typed byte array and ArrayBuffer backing");
    check(typeof ctypes.open === "function", "ctypes library API");
    check((4294967295).toString(16) === "ffffffff" &&
        (2147483648).toString(2) === "10000000000000000000000000000000" &&
        (-2147483648).toString(16) === "-80000000" &&
        (4294967295).toString(36) === "1z141z3",
        "radix formatting preserves signed and unsigned word magnitudes: " +
        [(4294967295).toString(16), (2147483648).toString(2),
            (-2147483648).toString(16), (4294967295).toString(36)].join(", "));
    var libc = ctypes.open("libc.so.6");
    var malloc = libc.declare("malloc", ctypes.default_abi, ctypes.uint32_t, ctypes.uint32_t);
    var free = libc.declare("free", ctypes.default_abi, ctypes.void_t, ctypes.voidptr_t);
    var memcpy = libc.declare("memcpy", ctypes.default_abi, ctypes.voidptr_t,
        ctypes.voidptr_t, ctypes.voidptr_t, ctypes.uint32_t);
    var memcmp = libc.declare("memcmp", ctypes.default_abi, ctypes.int,
        ctypes.voidptr_t, ctypes.voidptr_t, ctypes.uint32_t);
    var strlen = libc.declare("strlen", ctypes.default_abi, ctypes.uint32_t, ctypes.char.ptr);
    check(strlen("hello") === 5, "native string conversion");
    var pointer = malloc(3);
    check(pointer !== 0, "native allocation");
    try {
        var bytes = new Uint8Array([99, 1, 2, 3, 88]);
        var view = bytes.subarray(1, 4);
        memcpy(pointer, view, 3);
        check(memcmp(pointer, new Uint8Array([1, 2, 3]), 3) === 0, "offset view passed to native code");
        memcpy(view, new Uint8Array([4, 5, 6]), 3);
        check(bytes[0] === 99 && bytes[1] === 4 && bytes[3] === 6 && bytes[4] === 88,
            "native writes preserve shared-view bounds");
        var signature = ctypes.FunctionType(ctypes.default_abi, ctypes.uint32_t, [ctypes.char.ptr]);
        var rebound = ctypes.cast(ctypes.voidptr_t(ctypes.cast(strlen, ctypes.uint32_t).value), signature.ptr);
        check(rebound("abc") === 3, "function pointer cast");
        var refused = false;
        try { signature.ptr(function () {}); } catch (error) { refused = true; }
        check(refused, "callbacks must be rejected");
        check("abcdef".slice(-4, -1) === "cde" && "abcdef".slice(4, 2) === "", "String.slice relative bounds");
        check(String.fromCharCode.apply(null, new Uint8Array([65, 66, 67])) === "ABC",
            "native apply accepts typed-array arguments");
        function sum(a, b, c) { return this.bias + a + b + c; }
        check(sum.apply({bias: 10}, new Int32Array([1, 2, 3])) === 16,
            "bytecode apply accepts typed-array arguments and receiver");
        var signedBytes = new Int8Array(4);
        signedBytes.set(new Uint8Array([255, 128, 3]), 1);
        check(signedBytes[1] === -1 && signedBytes[2] === -128 && signedBytes[3] === 3,
            "typed set converts unsigned to signed bytes without changing bits");
    } finally { free(pointer); }
    print("shell/ctypes integration passed");
}());
