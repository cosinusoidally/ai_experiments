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
        return interpret(this.compile(source, filename), this.runtime);
    };

    VM.prototype.destroy = function () {
        this.runtime.destroy();
    };

    root.GuestVM = VM;
    if (typeof module !== "undefined" && module.exports) module.exports = VM;
}(this));
