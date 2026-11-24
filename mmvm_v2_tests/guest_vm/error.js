/* ES5.1 native Error objects and their prototype hierarchy. */
(function (root) {
    var NativeIntrinsics = root.GuestVMNativeIntrinsics;
    var HeapRecords = root.GuestVMHeapRecords;
    if (typeof module !== "undefined" && module.exports) {
        NativeIntrinsics = require("./native_intrinsics.js");
        HeapRecords = require("./heap_records.js");
    }
    function intrinsicImplementedByRuntime() {
        throw new Error("Error intrinsic must be dispatched by Runtime");
    }

    function makeErrorObject(runtime, name, message) {
        var prototype = runtime.errorPrototypes &&
            runtime.errorPrototypes["$" + name];
        if (!prototype && runtime.errorPrototypes) {
            prototype = runtime.errorPrototypes.$Error;
        }
        var error = runtime.makeObjectWithPrototype(
            prototype || runtime.objectPrototype);
        runtime.linearHeap.setFlags(error.heapAddress, HeapRecords.ObjectClassFlags.ERROR);
        runtime.setProperty(error, "name", name || "Error");
        runtime.setProperty(error, "message",
            message === undefined ? "" : String(message));
        return error;
    }

    function makeErrorConstructor(runtime, name, prototype) {
        runtime.linearHeap.setFlags(prototype.heapAddress, HeapRecords.ObjectClassFlags.ERROR);
        /* Runtime.call/construct implement this intrinsic from the metadata.
         * Avoid a constructor-specific host closure: js_min's SpiderMonkey
         * predates modern closure fixes, and the guest operation should be
         * directly recognizable by the native interpreter anyway. */
        var index = 0;
        while (NativeIntrinsics.ERROR_CONSTRUCTOR_NAMES[index] !== name) index++;
        var constructor = runtime.makeNativeFunction(
            name, intrinsicImplementedByRuntime, "intrinsic",
            NativeIntrinsics.FIRST_ERROR_CONSTRUCTOR + index);
        constructor.errorConstructorName = name;
        runtime.defineDataProperty(constructor, "prototype", prototype, 0);
        runtime.defineBuiltinProperty(prototype, "constructor", constructor);
        return constructor;
    }

    function install(runtime) {
        runtime.errorPrototypes = {};
        var errorPrototype = runtime.makeObjectWithPrototype(
            runtime.objectPrototype);
        runtime.defineBuiltinProperty(errorPrototype, "name", "Error");
        runtime.defineBuiltinProperty(errorPrototype, "message", "");
        runtime.errorPrototypes.$Error = errorPrototype;
        runtime.setGlobal("Error",
            makeErrorConstructor(runtime, "Error", errorPrototype));
        var subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.defineBuiltinProperty(subtypePrototype, "name", "EvalError");
        runtime.errorPrototypes.$EvalError = subtypePrototype;
        runtime.setGlobal("EvalError",
            makeErrorConstructor(runtime, "EvalError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.defineBuiltinProperty(subtypePrototype, "name", "RangeError");
        runtime.errorPrototypes.$RangeError = subtypePrototype;
        runtime.setGlobal("RangeError",
            makeErrorConstructor(runtime, "RangeError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.defineBuiltinProperty(subtypePrototype, "name", "ReferenceError");
        runtime.errorPrototypes.$ReferenceError = subtypePrototype;
        runtime.setGlobal("ReferenceError",
            makeErrorConstructor(runtime, "ReferenceError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.defineBuiltinProperty(subtypePrototype, "name", "SyntaxError");
        runtime.errorPrototypes.$SyntaxError = subtypePrototype;
        runtime.setGlobal("SyntaxError",
            makeErrorConstructor(runtime, "SyntaxError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.defineBuiltinProperty(subtypePrototype, "name", "TypeError");
        runtime.errorPrototypes.$TypeError = subtypePrototype;
        runtime.setGlobal("TypeError",
            makeErrorConstructor(runtime, "TypeError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.defineBuiltinProperty(subtypePrototype, "name", "URIError");
        runtime.errorPrototypes.$URIError = subtypePrototype;
        runtime.setGlobal("URIError",
            makeErrorConstructor(runtime, "URIError", subtypePrototype));
        var toStringFunction = runtime.makeNativeFunction(
            "Error.toString", intrinsicImplementedByRuntime);
        toStringFunction.errorToString = true;
        runtime.defineBuiltinProperty(errorPrototype, "toString", toStringFunction);
    }

    var api = {install: install, makeErrorObject: makeErrorObject};
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.GuestVMErrorSupport = api;
}(this));
