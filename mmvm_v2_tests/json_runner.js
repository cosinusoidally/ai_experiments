/* Bounded everyday-JSON integration checks from the unchanged external suite.
 * node json_runner.js --reference uses stock Node JSON as a black-box control.
 * node json_runner.js checks our codec in fresh Node contexts.
 * js_min.exe guest_runner.js json_runner.js checks the guest implementation.
 * js_runner.exe SNAP json_runner.js checks the standalone implementation. */
(function (root, shellArguments) {
    var nodeHost = typeof process !== "undefined" && process.versions && process.versions.node;
    var args = nodeHost ? process.argv.slice(2) : shellArguments;
    var fs = require("fs");
    var directory = "../../js_tests/tests/ecma_5/JSON/";
    var selected = ["parse-primitives.js", "parse-crockford-01.js",
        "parse-number-syntax.js", "parse-octal-syntax-error.js",
        "parse-syntax-errors-01.js", "parse-syntax-errors-02.js",
        "parse-syntax-errors-03.js", "trailing-comma.js", "small-codepoints.js",
        "stringify-special-escapes.js", "stringify-dropping-elements.js",
        "stringify-missing-arguments.js"];
    var reference = false, requested = [], index = 0;
    while (index < args.length) {
        var argument = args[index++];
        if (argument === "--reference") reference = true;
        else requested.push(argument);
    }
    if (reference && !nodeHost) throw new Error("--reference requires stock Node");
    if (requested.length) selected = requested;
    var available = fs.readdirSync(directory);
    for (index = 0; index < selected.length; index++) {
        if (available.indexOf(selected[index]) < 0 || selected[index] === "shell.js" ||
                selected[index] === "browser.js") throw new Error("unknown JSON test " + selected[index]);
    }
    var output = nodeHost ? function (line) { console.log(line); } : print;
    var checks = 0;
    function assertEq(actual, expected, message) {
        checks++;
        var same = actual === expected && (actual !== 0 || 1 / actual === 1 / expected);
        if (!same && !(actual !== actual && expected !== expected)) {
            throw new Error((message || "JSON assertion") + ": expected " + expected + ", got " + actual);
        }
    }
    function reportCompare(expected, actual, message) { assertEq(actual, expected, message); }
    /* Same parse/error and four-whitespace-variant checks as the external
     * testJSON harness, without concatenating caught Error objects merely to
     * construct a successful assertion's diagnostic message. That diagnostic
     * would test unrelated native Object-to-primitive support. */
    function testJSON(text, expectSyntaxError) {
        var variants = [text, text + " ", " " + text, " " + text + " "];
        for (var variant = 0; variant < variants.length; variant++) {
            var caught = null;
            try { JSON.parse(variants[variant]); } catch (error) { caught = error; }
            if (caught !== null && !(caught instanceof SyntaxError)) {
                assertEq(false, true, "non-SyntaxError while parsing JSON");
            }
            assertEq(caught !== null, expectSyntaxError, "JSON syntax acceptance");
        }
    }
    var codecSource = nodeHost && !reference ? fs.readFileSync("guest_vm/json.js", "utf8") : "";
    var vm = nodeHost ? require("vm") : null;
    var passed = 0, failed = 0;
    if (!nodeHost) {
        root.assertEq = assertEq;
        root.reportCompare = reportCompare;
        root.testJSON = testJSON;
        root.print = function () {};
    }
    for (index = 0; index < selected.length; index++) {
        var name = selected[index];
        try {
            if (nodeHost) {
                var context = vm.createContext({assertEq: assertEq,
                    reportCompare: reportCompare, print: function () {}});
                if (!reference) {
                    vm.runInContext(codecSource, context, {filename: "guest_vm/json.js"});
                    vm.runInContext("var codec = GuestVMJSONSupport.forValues();" +
                        "JSON = {parse: function(text) { return codec.parse(String(text)); }," +
                        "stringify: function(value) { return codec.stringify(value); }};", context);
                }
                vm.runInContext("var testJSON = " + testJSON.toString() + ";", context);
                vm.runInContext(fs.readFileSync(directory + name, "utf8"), context,
                    {filename: directory + name});
            } else {
                load(directory + name);
            }
            passed++;
            output("PASS " + name);
        } catch (error) {
            failed++;
            output("FAIL " + name + ": " + error.name + ": " + error.message);
        }
    }
    output("JSON selected checks: " + passed + " passed, " + failed +
        " failed; " + selected.length + " files, " + checks + " assertions" +
        (reference ? " (stock Node reference)" : ""));
    if (failed) throw new Error("JSON integration checks failed");
}(this, typeof arguments === "undefined" ? [] : arguments));
