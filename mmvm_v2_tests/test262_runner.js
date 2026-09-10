/* ES5.1 Test262 runner for the external, unmodified corpus.
 *
 * From mmvm_v2_tests:
 *   js_min.exe guest_runner.js --vm-native test262_runner.js
 *   js_min.exe guest_runner.js --vm-native test262_runner.js ch11/11.4
 *   js_min.exe guest_runner.js --vm-native test262_runner.js --fail-fast ch11
 *
 * The default is a complete run: failures are reported and execution moves to
 * the next variant.  Nothing in ../../js_tests/tests is modified.
 */
(function (runnerArguments) {
    var corpusDirectory = "../../js_tests/tests/test262";
    var fs = require("fs");
    load("test262_manifest.js");
    var applicableRoots = [
        "ch06", "ch07", "ch09", "ch10", "ch11", "ch12", "ch13"
    ];
    var failFast = false;
    var verbose = false;
    var quiet = false;
    var listOnly = false;
    var instructionLimit = 20000000;
    var selectors = [];

    function failUsage(message) {
        if (message) console.error("test262 runner: " + message);
        console.error("usage: test262_runner.js [--fail-fast] [--verbose] " +
            "[--quiet] [--list] [--instruction-limit count] [all|path ...]");
        process.exit(2);
    }

    function normalizeRelativePath(path) {
        path = String(path);
        while (path.substring(0, 2) === "./") path = path.substring(2);
        while (path.length && path.charAt(path.length - 1) === "/") {
            path = path.substring(0, path.length - 1);
        }
        if (!path || path === "all") return "";
        if (path.charAt(0) === "/" || path === ".." ||
            path.substring(0, 3) === "../" ||
            path.indexOf("/../") >= 0 ||
            path.substring(path.length - 3) === "/..") {
            failUsage("selector escapes the Test262 directory: " + path);
        }
        return path;
    }

    var argumentIndex = 0;
    while (argumentIndex < runnerArguments.length) {
        var argument = String(runnerArguments[argumentIndex++]);
        if (argument === "--fail-fast") failFast = true;
        else if (argument === "--verbose") verbose = true;
        else if (argument === "--quiet") quiet = true;
        else if (argument === "--list") listOnly = true;
        else if (argument === "--help") failUsage("");
        else if (argument === "--instruction-limit") {
            if (argumentIndex >= runnerArguments.length) {
                failUsage("--instruction-limit requires a count");
            }
            instructionLimit = Number(runnerArguments[argumentIndex++]);
            if (!(instructionLimit > 0) ||
                instructionLimit !== Math.floor(instructionLimit)) {
                failUsage("instruction limit must be a positive integer");
            }
        } else if (argument.substring(0, 2) === "--") {
            failUsage("unknown option " + argument);
        } else selectors.push(normalizeRelativePath(argument));
    }
    if (!selectors.length) selectors.push("");

    function isApplicableRoot(name) {
        var index = 0;
        while (index < applicableRoots.length) {
            if (applicableRoots[index++] === name) return true;
        }
        return false;
    }

    function firstPathPart(path) {
        var slash = path.indexOf("/");
        return slash < 0 ? path : path.substring(0, slash);
    }

    var tests = [];
    var selectorIndex = 0;
    while (selectorIndex < selectors.length) {
        var selector = selectors[selectorIndex++];
        if (selector && !isApplicableRoot(firstPathPart(selector))) {
            failUsage("selector is outside the ES5.1 chapters: " + selector);
        }
        var matched = 0;
        var manifestIndex = 0;
        while (manifestIndex < Test262Manifest.length) {
            var manifestedPath = Test262Manifest[manifestIndex++];
            if (!selector || manifestedPath === selector ||
                manifestedPath.substring(0, selector.length + 1) ===
                    selector + "/") {
                tests.push(manifestedPath);
                matched++;
            }
        }
        if (!matched) failUsage("selector matched no tests: " + selector);
    }
    tests.sort();

    /* Multiple overlapping selectors must not execute a test twice. */
    var uniqueTests = [];
    var testIndex = 0;
    while (testIndex < tests.length) {
        if (!testIndex || tests[testIndex] !== tests[testIndex - 1]) {
            uniqueTests.push(tests[testIndex]);
        }
        testIndex++;
    }
    tests = uniqueTests;

    if (listOnly) {
        testIndex = 0;
        while (testIndex < tests.length) console.log(tests[testIndex++]);
        console.log("Test262: " + tests.length + " test file(s)");
        return;
    }

    function hasDirective(source, name) {
        return source.indexOf("@" + name) >= 0;
    }

    function harnessFilesFor(relativePath) {
        var files = ["test262_harness.js", corpusDirectory + "/shell.js"];
        /* All descendant shell.js files in this imported ES5.1 corpus are
         * empty. Manifest regeneration verifies that invariant. */
        return files;
    }

    function resultDescription(result) {
        var location = result.filename || "";
        if (location && result.line) location += ":" + result.line;
        if (location && result.column) location += ":" + result.column;
        if (location) location += ": ";
        return location + (result.name || result.status) +
            (result.message ? ": " + result.message : "") +
            " [" + result.phase + "]";
    }

    function negativePasses(source, result) {
        if (result.status !== "threw") return false;
        var marker = source.indexOf("@negative");
        var end = marker < 0 ? -1 : source.indexOf("\n", marker);
        var directive = marker < 0 ? "" : source.substring(
            marker, end < 0 ? source.length : end);
        var description = String(result.name) + ": " + String(result.message);
        if (directive.indexOf("NotEarlyError") >= 0 &&
            description.indexOf("NotEarlyError") >= 0) return false;
        if (directive.indexOf("SyntaxError") >= 0 &&
            result.name !== "SyntaxError") return false;
        return true;
    }

    var counts = {tests: tests.length, variants: 0, passed: 0, failed: 0,
                  timedOut: 0};
    var stopped = false;
    testIndex = 0;
    while (testIndex < tests.length && !stopped) {
        var relativePath = tests[testIndex++];
        var filename = corpusDirectory + "/" + relativePath;
        var source = fs.readFileSync(filename, "utf8");
        var onlyStrict = hasDirective(source, "onlyStrict");
        var noStrict = hasDirective(source, "noStrict");
        var negative = hasDirective(source, "negative");
        var variants = onlyStrict ? [true] : noStrict ? [false] : [false, true];
        var harnessFiles = harnessFilesFor(relativePath);
        var variantIndex = 0;
        while (variantIndex < variants.length && !stopped) {
            var strict = variants[variantIndex++];
            var variantName = strict ? "strict" : "non-strict";
            counts.variants++;
            var result = Test262VM.runVariant(
                filename, source, strict, harnessFiles, instructionLimit);
            var passed = negative ? negativePasses(source, result) :
                                    result.status === "completed";
            if (passed) {
                counts.passed++;
                if (verbose) console.log("PASS " + relativePath +
                                         " (" + variantName + ")");
            } else {
                counts.failed++;
                if (result.status === "timeout") counts.timedOut++;
                console.error("FAIL " + relativePath + " (" + variantName +
                    "): " + (negative && result.status === "completed" ?
                    "expected an exception" : resultDescription(result)));
                if (failFast) stopped = true;
            }
        }
        if (!quiet && !verbose && testIndex % 100 === 0) {
            console.log("Test262: " + testIndex + "/" + tests.length +
                " files, " + counts.passed + " passed, " + counts.failed +
                " failed");
        }
    }

    console.log("Test262 ES5.1 summary");
    console.log("  test files: " + counts.tests);
    console.log("  variants:   " + counts.variants);
    console.log("  passed:     " + counts.passed);
    console.log("  failed:     " + counts.failed);
    console.log("  timed out:  " + counts.timedOut);
    if (stopped) console.log("  stopped:    first failure (--fail-fast)");
    if (counts.failed) process.exit(1);
}(arguments));
