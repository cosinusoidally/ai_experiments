/* Small i386 JS-shell ctypes compatibility layer over the existing FFI.
 * No JS-to-C callbacks, C helpers, or dependency on another JS engine. */
(function (root) {
    function create(dlsym, call) {
        var api = {default_abi: "cdecl"};
        function scalar(name, signed) {
            var type = function (value) { return signed ? value | 0 : value >>> 0; };
            type.typeName = name;
            type.signed = signed;
            return type;
        }
        api.uint32_t = scalar("uint32_t", false);
        api.int32_t = scalar("int32_t", true);
        api.int = api.int32_t;
        api.voidptr_t = scalar("void*", false);
        api.char = {ptr: {typeName: "char*"}};
        api.void_t = {typeName: "void"};
        function invoke(pointer, args) {
            switch (args.length) {
            case 0: return call(pointer);
            case 1: return call(pointer, args[0]);
            case 2: return call(pointer, args[0], args[1]);
            case 3: return call(pointer, args[0], args[1], args[2]);
            case 4: return call(pointer, args[0], args[1], args[2], args[3]);
            case 5: return call(pointer, args[0], args[1], args[2], args[3], args[4]);
            case 6: return call(pointer, args[0], args[1], args[2], args[3], args[4], args[5]);
            case 7: return call(pointer, args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
            case 8: return call(pointer, args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7]);
            }
            throw new RangeError("ctypes supports at most eight native arguments");
        }
        function callable(pointer, resultType) {
            var fn = function () {
                var result = invoke(pointer, arguments);
                if (resultType === api.void_t) return undefined;
                return resultType.signed ? result | 0 : result >>> 0;
            };
            fn.address = pointer;
            return fn;
        }
        api.FunctionType = function (abi, resultType, argumentTypes) {
            if (abi !== api.default_abi) throw new Error("unsupported ctypes ABI");
            var pointerType = function () {
                throw new Error("ctypes JS-to-C callbacks are not supported");
            };
            pointerType.functionResult = resultType;
            pointerType.argumentTypes = argumentTypes;
            return {ptr: pointerType};
        };
        api.cast = function (value, type) {
            var pointer = typeof value === "function" ? value.address : value;
            if (type.functionResult) return callable(pointer, type.functionResult);
            return {value: type(pointer)};
        };
        var dlopen = call(dlsym, 0, "dlopen");
        var dlclose = call(dlsym, 0, "dlclose");
        api.open = function (name) {
            var handle = call(dlopen, String(name), 1);
            if (!handle) throw new Error("ctypes could not open " + name);
            return {
                declare: function (name, abi, resultType) {
                    if (!handle) throw new Error("ctypes library is closed");
                    if (abi !== api.default_abi) throw new Error("unsupported ctypes ABI");
                    var pointer = call(dlsym, handle, String(name));
                    if (!pointer) throw new Error("ctypes symbol not found: " + name);
                    return callable(pointer, resultType);
                },
                close: function () {
                    if (handle) { call(dlclose, handle); handle = 0; }
                }
            };
        };
        return api;
    }
    root.GuestShellCTypes = {create: create};
    if (typeof module !== "undefined" && module.exports) module.exports = root.GuestShellCTypes;
}(this));
