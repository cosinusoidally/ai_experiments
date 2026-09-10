/* ES5.1 native Error objects and their prototype hierarchy. */
(function (root) {
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
        runtime.setProperty(error, "name", name || "Error");
        runtime.setProperty(error, "message",
            message === undefined ? "" : String(message));
        return error;
    }

    function makeErrorConstructor(runtime, name, prototype) {
        /* Runtime.call/construct implement this intrinsic from the metadata.
         * Avoid a constructor-specific host closure: js_min's SpiderMonkey
         * predates modern closure fixes, and the guest operation should be
         * directly recognizable by the native interpreter anyway. */
        var constructor = runtime.makeNativeFunction(
            name, intrinsicImplementedByRuntime);
        constructor.errorConstructorName = name;
        runtime.setProperty(constructor, "prototype", prototype);
        runtime.setProperty(prototype, "constructor", constructor);
        return constructor;
    }

    function install(runtime) {
        runtime.errorPrototypes = {};
        var errorPrototype = runtime.makeObjectWithPrototype(
            runtime.objectPrototype);
        runtime.setProperty(errorPrototype, "name", "Error");
        runtime.setProperty(errorPrototype, "message", "");
        runtime.errorPrototypes.$Error = errorPrototype;
        runtime.setGlobal("Error",
            makeErrorConstructor(runtime, "Error", errorPrototype));
        var subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.setProperty(subtypePrototype, "name", "EvalError");
        runtime.errorPrototypes.$EvalError = subtypePrototype;
        runtime.setGlobal("EvalError",
            makeErrorConstructor(runtime, "EvalError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.setProperty(subtypePrototype, "name", "RangeError");
        runtime.errorPrototypes.$RangeError = subtypePrototype;
        runtime.setGlobal("RangeError",
            makeErrorConstructor(runtime, "RangeError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.setProperty(subtypePrototype, "name", "ReferenceError");
        runtime.errorPrototypes.$ReferenceError = subtypePrototype;
        runtime.setGlobal("ReferenceError",
            makeErrorConstructor(runtime, "ReferenceError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.setProperty(subtypePrototype, "name", "SyntaxError");
        runtime.errorPrototypes.$SyntaxError = subtypePrototype;
        runtime.setGlobal("SyntaxError",
            makeErrorConstructor(runtime, "SyntaxError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.setProperty(subtypePrototype, "name", "TypeError");
        runtime.errorPrototypes.$TypeError = subtypePrototype;
        runtime.setGlobal("TypeError",
            makeErrorConstructor(runtime, "TypeError", subtypePrototype));
        subtypePrototype = runtime.makeObjectWithPrototype(errorPrototype);
        runtime.setProperty(subtypePrototype, "name", "URIError");
        runtime.errorPrototypes.$URIError = subtypePrototype;
        runtime.setGlobal("URIError",
            makeErrorConstructor(runtime, "URIError", subtypePrototype));
        var toStringFunction = runtime.makeNativeFunction(
            "Error.toString", intrinsicImplementedByRuntime);
        toStringFunction.errorToString = true;
        runtime.setProperty(errorPrototype, "toString", toStringFunction);
    }

    var api = {install: install, makeErrorObject: makeErrorObject};
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.GuestVMErrorSupport = api;
}(this));
