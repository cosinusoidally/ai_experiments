(function (root) {
    var Parser = root.GuestVMParser;
    var Compiler = root.GuestVMCompiler;
    var Runtime = root.GuestVMRuntime;
    var interpret = root.GuestVMInterpret;
    var verify = root.GuestVMVerify;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("./parser.js");
        Compiler = require("./compiler.js");
        Runtime = require("./runtime.js");
        interpret = require("./interpreter.js");
        verify = require("./verifier.js");
    }

    function VM() {
        this.runtime = new Runtime();
    }

    VM.prototype.compile = function (source, filename) {
        var ast = new Parser(source, filename).parseProgram();
        return verify(new Compiler().compile(ast));
    };

    VM.prototype.run = function (source, filename) {
        return this.execute(this.compile(source, filename));
    };

    VM.prototype.execute = function (program) {
        try {
            return interpret(program, this.runtime);
        } finally {
            this.runtime.activeRegisters = null;
        }
    };

    VM.prototype.installGlobal = function (name, value) {
        return this.runtime.setGlobal(name, value);
    };

    VM.prototype.makeNativeFunction = function (name, callback) {
        return this.runtime.makeNativeFunction(name, callback);
    };

    VM.prototype.retain = function (value) {
        return this.runtime.retain(value);
    };

    VM.prototype.retained = function (handle) {
        return this.runtime.retained(handle);
    };

    VM.prototype.release = function (handle) {
        return this.runtime.release(handle);
    };

    VM.prototype.collect = function () {
        return this.runtime.collect();
    };

    VM.prototype.destroy = function () {
        this.runtime.destroy();
    };

    root.GuestVM = VM;
    if (typeof module !== "undefined" && module.exports) module.exports = VM;
}(this));
