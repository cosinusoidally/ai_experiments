/* NativeCompiler dependency-graph test.  Direct Node.js runs validate the
 * ordinary JavaScript reference result; demo8_runner.js additionally compiles
 * and executes the same graph through the js_min.exe native bridge. */

function nativeAdd(left, right) {
    return left + right;
}

function nativeTwicePlus(value, increment) {
    return nativeAdd(nativeAdd(value, increment), increment);
}
nativeTwicePlus.nativeCompile = {dependencies: {nativeAdd: nativeAdd}};

function nativeIsEven(value) {
    if (value === 0) return 1;
    return nativeIsOdd(value - 1);
}

function nativeIsOdd(value) {
    if (value === 0) return 0;
    return nativeIsEven(value - 1);
}
nativeIsEven.nativeCompile = {dependencies: {nativeIsOdd: nativeIsOdd}};
nativeIsOdd.nativeCompile = {dependencies: {nativeIsEven: nativeIsEven}};

function nativePack(left, right) {
    return left * 10 + right;
}

function nativeSumNine(a, b, c, d, e, f, g, h, i) {
    return a + b + c + d + e + f + g + h + i;
}

function nativeDependencyProgram(value, increment, recursionDepth) {
    var order = 1;
    var ordered = nativePack(order = order + 1, order = order + 1);
    return nativeTwicePlus(value, increment) +
           nativeIsEven(recursionDepth) * 100 + ordered * 1000 +
           nativeSumNine(1, 2, 3, 4, 5, 6, 7, 8, 9);
}
nativeDependencyProgram.nativeCompile = {
    dependencies: {
        nativeTwicePlus: nativeTwicePlus,
        nativeIsEven: nativeIsEven,
        nativePack: nativePack,
        nativeSumNine: nativeSumNine
    }
};

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message + ": expected " + expected + ", received " +
                        actual);
    }
}

function referenceTest() {
    var expected = 23158;
    assertEqual(nativeDependencyProgram(7, 3, 6), expected,
                "JavaScript dependency result");
    return expected;
}

function nativeUndeclaredProgram(value) {
    return nativeAdd(value, 1);
}

function nativeWronglyNamedHelper(value) {
    return value;
}

function assertCompilationRejected(action, expectedText) {
    var rejected = false;
    try {
        action();
    } catch (error) {
        var description = error && error.message !== undefined ?
                          String(error.message) : String(error);
        rejected = description.indexOf(expectedText) >= 0;
    }
    assertEqual(rejected, true, "rejection containing " + expectedText);
}

if (typeof DemoRunner === "undefined") {
    referenceTest();
    console.log("NativeCompiler dependency reference test passed under Node.js");
} else {
    DemoRunner.define(function (runner) {
        var expected = referenceTest();
        var compilation = runner.compileNative(nativeDependencyProgram);
        assertEqual(compilation.graphNodes.length, 7,
                    "recursively collected function count");
        assertEqual(compilation.fn(7, 3, 6), expected,
                    "compiled dependency result");
        var variant = compilation.variants["default"];
        assertEqual(variant.functionCount, 7,
                    "emitted native function count");
        if (variant.macroAssembly.indexOf("call(\"nativeFunction_") < 0) {
            throw new Error("compiled dependency graph contains no native call");
        }
        compilation.destroy();
        var rejectedDestroyedCall = false;
        try {
            compilation.fn(7, 3, 6);
        } catch (error) {
            rejectedDestroyedCall = true;
        }
        assertEqual(rejectedDestroyedCall, true,
                    "destroyed dependency graph rejection");
        var undeclared = runner.compileNative(nativeUndeclaredProgram);
        assertCompilationRejected(function () { undeclared.fn(4); },
                                  "unsupported call to nativeAdd");
        undeclared.destroy();
        nativeUndeclaredProgram.nativeCompile = {
            dependencies: {wrongName: nativeWronglyNamedHelper}
        };
        assertCompilationRejected(
            function () { runner.compileNative(nativeUndeclaredProgram); },
            "does not match function name");
        console.log("NativeCompiler dependency graph test passed: 7 functions, " +
                    "nested calls, mutual recursion, 9 arguments, lifetime, " +
                    "and declaration errors");
        runner.process.exit(0);
    });
}
