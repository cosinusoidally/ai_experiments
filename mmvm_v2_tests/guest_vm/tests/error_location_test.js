(function (root) {
    function runErrorLocationTest(VM) {
        var vm = new VM();
        var execution = vm.start(
            "function broken() {\n" +
            "    missingValue();\n" +
            "}\n" +
            "broken();\n", "location_probe.js");
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
        vm.destroy();
        return "guest errors retain filename, line, and column";
    }

    root.GuestVMRunErrorLocationTest = runErrorLocationTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runErrorLocationTest;
    }
}(this));
