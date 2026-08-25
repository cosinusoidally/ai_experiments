(function (root) {
    var Parser = root.GuestVMParser;
    var Compiler = root.GuestVMCompiler;
    var Runtime = root.GuestVMRuntime;
    var interpret = root.GuestVMInterpret;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("./parser.js");
        Compiler = require("./compiler.js");
        Runtime = require("./runtime.js");
        interpret = require("./interpreter.js");
    }

    function VM() {
        this.runtime = new Runtime();
    }

    VM.prototype.compile = function (source, filename) {
        var ast = new Parser(source, filename).parseProgram();
        return new Compiler().compile(ast);
    };

    VM.prototype.run = function (source, filename) {
        return interpret(this.compile(source, filename), this.runtime);
    };

    root.GuestVM = VM;
    if (typeof module !== "undefined" && module.exports) module.exports = VM;
}(this));
