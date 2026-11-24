(function (root) {
    function runErrorLocationTest(VM) {
        var source =
            "function broken() {\n" +
            "    missingValue();\n" +
            "}\n" +
            "broken();\n";
        for (var mode = 0; mode < 2; mode++) {
            var vm = new VM();
            try {
                var execution;
                if (mode === 0) execution = vm.start(source, "location_probe.js");
                else {
                    var frontend = VM.Frontend;
                    var ast = new frontend.Parser(source, "location_probe.js").parseProgram();
                    var program = new frontend.Compiler(null, null, false,
                        {compactLocations: true}).compile(ast);
                    execution = vm.startProgram(frontend.verify(program));
                }
                var result = execution.resume(10000);
                if (result.status !== "threw") {
                    throw new Error("location probe did not throw");
                }
                var error = result.exception;
                if (error.guestFilename !== "location_probe.js" ||
                    error.guestLine !== 2 || error.guestColumn !== 5) {
                    throw new Error("wrong guest error location: " +
                        error.guestFilename + ":" + error.guestLine + ":" +
                        error.guestColumn);
                }
            } finally { vm.destroy(); }
        }
        return "guest errors retain filename, line, and column";
    }

    root.GuestVMRunErrorLocationTest = runErrorLocationTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runErrorLocationTest;
    }
}(this));
