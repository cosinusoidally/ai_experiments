/* External historical ES1--ES5.1 corpus. Run unchanged tests, including
 * extensions and historical expectations. Four pathological slow regressions
 * are skipped by default and can be enabled with --include-slow.
 * js_runner.exe IMAGE ecma_tests_runner.js [options] [ecma/path ...]
 * node ecma_tests_runner_node.js [options] [ecma/path ...] */
(function (args) {
    var fs = require("fs"), root = "../../js_tests/tests";
    var roots = ["ecma", "ecma_2", "ecma_3", "ecma_5"];
    var selectors = [], tests = [], quiet = false, summaryOnly = false;
    var failFast = false, list = false, verbose = false, limit = 20000000, timeoutMs = 10000;
    var includeSlow = false;
    var slowTests = [
        "ecma_3/Array/regress-322135-03.js",
        "ecma_3/Array/regress-322135-04.js",
        "ecma_3/RegExp/regress-307456.js",
        "ecma_3/RegExp/regress-330684.js"
    ];
    var clock = typeof EcmaTestsClock === "function" ? EcmaTestsClock :
        function () { return new Date().getTime(); };
    function usage(message) {
        if (message) console.error(message);
        console.log("usage: ecma_tests_runner.js / ecma_tests_runner_node.js [--fail-fast] [--verbose] [--quiet] " +
            "[--summary-only] [--list] [--include-slow] [--instruction-limit COUNT] [--timeout-ms COUNT] [all|ecma/path ...]");
        if (message) process.exit(2);
    }
    for (var index = 0; index < args.length; index++) {
        var argument = String(args[index]);
        if (argument === "--help") { usage(""); return; }
        else if (argument === "--fail-fast") failFast = true;
        else if (argument === "--quiet") quiet = true;
        else if (argument === "--verbose") verbose = true;
        else if (argument === "--summary-only") { quiet = true; summaryOnly = true; }
        else if (argument === "--list") list = true;
        else if (argument === "--include-slow") includeSlow = true;
        else if (argument === "--instruction-limit") {
            limit = Number(args[++index]);
            if (!(limit >= 1 && limit <= 2147483647) || limit !== Math.floor(limit)) usage("invalid instruction limit");
        } else if (argument === "--timeout-ms") {
            timeoutMs = Number(args[++index]);
            if (!(timeoutMs >= 1 && timeoutMs <= 2147483647) || timeoutMs !== Math.floor(timeoutMs)) usage("invalid timeout");
        } else if (argument.substring(0, 2) === "--") usage("unknown option: " + argument);
        else {
            while (argument.substring(0, 2) === "./") argument = argument.substring(2);
            if (argument === "all") argument = "";
            while (argument.charAt(argument.length - 1) === "/") argument = argument.substring(0, argument.length - 1);
            if (argument && roots.indexOf(argument.split("/")[0]) < 0 ||
                    argument.indexOf("..") >= 0) usage("invalid corpus selector: " + argument);
            selectors.push(argument);
        }
    }
    if (!selectors.length) selectors.push("");
    function walk(relative) {
        var entries = fs.readdirSync(root + "/" + relative).sort();
        for (var item = 0; item < entries.length; item++) {
            var name = entries[item], path = relative + "/" + name;
            if (fs.statSync(root + "/" + path).isDirectory()) walk(path);
            else if (/\.js$/.test(name) && name !== "shell.js" && name !== "browser.js" &&
                    name !== "jsref.js" && name !== "template.js" &&
                    name !== "defineProperty-setup.js") tests.push(path);
        }
    }
    for (index = 0; index < roots.length; index++) walk(roots[index]);
    var selected = [], matches = [];
    for (index = 0; index < tests.length; index++) {
        var include = false;
        for (var selector = 0; selector < selectors.length; selector++) {
            var prefix = selectors[selector];
            if (!prefix || tests[index] === prefix || tests[index].substring(0, prefix.length + 1) === prefix + "/") {
                matches[selector] = true;
                include = true;
            }
        }
        if (include) selected.push(tests[index]);
    }
    for (index = 0; index < selectors.length; index++) {
        if (!matches[index]) usage("selector matched no tests: " + selectors[index]);
    }
    var selectedCount = selected.length, skipped = [], suites = {};
    tests = [];
    for (index = 0; index < selected.length; index++) {
        var selectedRoot = selected[index].split("/")[0];
        if (!suites[selectedRoot]) suites[selectedRoot] = {passed: 0, failed: 0, timedOut: 0, skipped: 0};
        if (!includeSlow && slowTests.indexOf(selected[index]) >= 0) {
            skipped.push(selected[index]);
            suites[selectedRoot].skipped++;
        } else tests.push(selected[index]);
    }
    if (list) {
        for (index = 0; index < tests.length; index++) console.log(tests[index]);
        console.log("ECMA: " + tests.length + " runnable test file(s); selected: " +
            selectedCount + "; skipped: " + skipped.length);
        return;
    }
    if (!summaryOnly) {
        for (index = 0; index < skipped.length; index++) {
            console.log("SKIP " + skipped[index] + ": known slow regression (use --include-slow)");
        }
    }
    var started = clock();
    var backend = null;
    if (tests.length) {
        if (typeof EcmaTestsBackend !== "undefined") backend = EcmaTestsBackend;
        else {
            var guestBackend = require("./ecma_tests_guest.js").create(fs);
            backend = require("./ecma_tests_process.js").create(guestBackend, timeoutMs);
        }
    }
    var total = {passed: 0, failed: 0, timedOut: 0, executed: 0};
    var stopped = false;
    function harnessFiles(path) {
        var parts = path.split("/"), files = [], directory = root;
        for (var part = 0; part < parts.length - 1; part++) {
            directory += "/" + parts[part];
            var shell = directory + "/shell.js";
            try { fs.statSync(shell); files.push(shell); }
            catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        files.push("ecma_tests_capture.js");
        return files;
    }
    function display(value) {
        return String(value).replace(/[\x00-\x1f\x7f]/g, function (character) {
            var hex = "0000" + character.charCodeAt(0).toString(16);
            return "\\u" + hex.substring(hex.length - 4);
        });
    }
    try {
        for (index = 0; index < tests.length; index++) {
            var relative = tests[index], filename = root + "/" + relative;
            var source = fs.readFileSync(filename, "utf8");
            var expected = /\|reftest\|[^\n]*\berror:\s*([A-Za-z]+Error)/.exec(source);
            var negative = /-n\.js$/.test(relative) || !!expected;
            var before = clock();
            if (verbose) console.log("RUN " + relative);
            var result;
            try { result = backend.runTest(filename, source, harnessFiles(relative), negative, limit); }
            catch (error) {
                if (String(error && error.message || error).indexOf("i386 worker received SIGSYS") >= 0) throw error;
                result = {status: "threw", phase: "service", name: String(error && error.name || "Error"),
                    message: String(error && error.message || error), filename: filename, line: 0, column: 0};
            }
            var elapsed = clock() - before;
            var passed = negative ? result.status === "threw" &&
                (result.phase === "compile" || result.phase === "runtime" || result.phase === "test") &&
                (!expected || result.name === expected[1]) : result.status === "completed";
            var suite = relative.split("/")[0];
            total.executed++;
            total[passed ? "passed" : "failed"]++;
            suites[suite][passed ? "passed" : "failed"]++;
            if (result.status === "timeout") { total.timedOut++; suites[suite].timedOut++; }
            var timing = "; elapsed: " + elapsed.toFixed(3) + " ms";
            if (passed) { if (!quiet) console.log("PASS " + relative + timing); }
            else if (!summaryOnly) console.error("FAIL " + relative + ": " +
                (negative && result.status === "completed" ? "expected exception" :
                (result.filename || filename) + ":" + (result.line || 0) + ":" + (result.column || 0) +
                ": " + (result.name || result.status) + ": " + display(result.message) + " [" + result.phase + "]") + timing);
            if (!passed && failFast) { stopped = true; break; }
        }
    } finally { if (backend) backend.destroy(); }
    console.log("ECMA ES1--ES5.1 corpus summary");
    for (index = 0; index < roots.length; index++) {
        var row = suites[roots[index]] || {passed: 0, failed: 0, timedOut: 0, skipped: 0};
        console.log("  " + roots[index] + ": passed=" + row.passed + " failed=" + row.failed +
            " timed_out=" + row.timedOut + " skipped=" + row.skipped);
    }
    console.log("  test files: " + selectedCount + "; executed: " + total.executed +
        "; passed: " + total.passed + "; failed: " + total.failed +
        "; timed out: " + total.timedOut + "; skipped: " + skipped.length +
        "; not run: " + (tests.length - total.executed));
    console.log("  elapsed ms: " + (clock() - started).toFixed(3));
    if (stopped) console.log("  stopped: first failure (--fail-fast)");
    if (total.failed) process.exit(1);
}(arguments));
