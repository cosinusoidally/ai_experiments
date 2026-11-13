/* Sparse diagnostics for the real embedding compileEval path. ES3 syntax.
 * Standalone: js_runner.exe IMAGE guest_vm/tools/profile_eval_phases.js
 *             --every 64 test262_runner.js TEST
 * Hosted: node (or js_min) guest_vm/tools/profile_eval_phases.js --every 64
 *         --vm-native test262_runner.js TEST
 * --every 0 is an unwrapped control, with the same VM-module reload.
 * --detail adds inclusive registration children; do not sum those with parents.
 * No VM/test source changes or retained program cache. Run in a fresh process.
 * Reload only vm.js so its lexical verifier binding captures the diagnostic
 * wrapper; the parser/compiler/runtime implementations remain the seeded ones.
 * Wrappers/cache invalidation and module reload perturb execution. Timings
 * locate costs, not throughput; cross-check against unmodified stack samples.
 */
(function (root, shellArguments) {
    var node = typeof module !== "undefined" && module.exports;
    var standalone = typeof guestStandaloneExecute === "function";
    var args = node ? process.argv.slice(2) : shellArguments.slice(0);
    var every = 64, detail = false;
    while (args[0] === "--every" || args[0] === "--detail") {
        var option = args.shift();
        if (option === "--detail") detail = true;
        else {
            every = Number(args.shift());
            if (!(every >= 0 && every <= 65536) || every !== Math.floor(every)) {
                throw new Error("--every requires an integer from 0 to 65536");
            }
        }
    }
    if (!args.length) throw new Error("expected runner arguments after --every COUNT");
    var VM, Runtime, Parser, Compiler, originalVerify, oldVMModule, verifyModule;
    var state = {every: every, calls: 0, sampled: 0, evalMs: 0, active: false,
        phases: [], methods: [], codeWords: 0, constants: 0, registers: 0,
        executableAllocations: 0};
    state.now = function () { return new Date().getTime(); };
    root.GuestEvalPhaseProfile = state;
    if (node) {
        VM = require("../vm.js"); Runtime = require("../runtime.js");
        Parser = require("../parser.js"); Compiler = require("../compiler.js");
        verifyModule = require.cache[require.resolve("../verifier.js")];
        originalVerify = verifyModule.exports;
    } else {
        if (typeof GuestVM === "undefined") load("guest_vm/guest_vm.js");
        VM = GuestVM; Runtime = GuestVMRuntime;
        Parser = GuestVMParser; Compiler = GuestVMCompiler;
        originalVerify = GuestVMVerify;
    }
    state.originalVerify = originalVerify;
    state.verification = {name: "verification", calls: 0, ms: 0, depth: 0};
    var verifier = every ? Function(
        "var s = GuestEvalPhaseProfile;" +
        "if (!s.active) return s.originalVerify.apply(this, arguments);" +
        "var p = s.verification, outer = p.depth === 0, t = outer ? s.now() : 0;" +
        "p.depth++; try { return s.originalVerify.apply(this, arguments); }" +
        "finally { p.depth--; if (outer) { p.calls++; p.ms += s.now() - t; } }") : originalVerify;
    if (node) {
        oldVMModule = require.cache[require.resolve("../vm.js")];
        verifyModule.exports = verifier;
        delete require.cache[require.resolve("../vm.js")];
        try { VM = require("../vm.js"); }
        finally { verifyModule.exports = originalVerify; }
    } else {
        GuestVMVerify = verifier;
        try { load("guest_vm/vm.js"); VM = GuestVM; }
        finally { GuestVMVerify = originalVerify; }
    }

    function phase(name, parent) {
        var value = {name: name, parent: parent || null, calls: 0, ms: 0, depth: 0};
        state.phases.push(value); return value;
    }
    function method(owner, name, value) {
        if (typeof owner[name] !== "function") throw new Error("missing measured method " + name);
        var index = state.methods.length;
        state.methods.push({owner: owner, name: name, original: owner[name], phase: value,
            wrapper: Function("var s = GuestEvalPhaseProfile, m = s.methods[" + index + "], p = m.phase;" +
                "var outer = p.depth === 0, t = outer ? s.now() : 0;" +
                "p.depth++; try {return m.original.apply(this, arguments);}" +
                "finally {p.depth--; if (outer) {p.calls++; p.ms += s.now() - t;}}")});
    }
    method(Parser.prototype, "parseProgram", phase("parse_program"));
    var lowering = phase("lowering");
    method(Compiler, "compileSloppyDirectEval", lowering);
    method(Compiler, "compileStrictEval", lowering);
    method(Compiler.prototype, "compile", lowering);
    method(Compiler, "environmentScopesForProgram", phase("caller_scopes"));
    method(Runtime.prototype, "registerProgram", phase("register_program"));
    state.phases.push(state.verification);
    if (detail) {
        var details = ["internProgramIntegerVector", "internProgramSource",
            "programArgumentConstants", "writeConstantHeapValue"];
        for (var index = 0; index < details.length; index++) {
            method(Runtime.prototype, details[index], phase(details[index], "register_program"));
        }
        var Records = node ? require("../heap_records.js") : GuestVMHeapRecords;
        details = ["allocateBytecode", "allocateValueVector", "allocateProgram"];
        for (index = 0; index < details.length; index++) {
            method(Records.prototype, details[index], phase(details[index], "register_program"));
        }
    }
    state.originalEval = VM.JSContext.prototype.compileEval;
    if (every) VM.JSContext.prototype.compileEval = Function(
        "var s = GuestEvalPhaseProfile; s.calls++;" +
        "if (s.active || (s.calls - 1) % s.every !== 0) return s.originalEval.apply(this, arguments);" +
        "s.active = true; var i, m, program, t, allocations = this.runtime.linearHeap.allocationCount;" +
        "for (i = 0; i < s.methods.length; i++) {m = s.methods[i]; m.owner[m.name] = m.wrapper;}" +
        "t = s.now(); try {program = s.originalEval.apply(this, arguments); return program;}" +
        "finally {s.evalMs += s.now() - t; s.sampled++;" +
        "for (i = 0; i < s.methods.length; i++) {m = s.methods[i]; m.owner[m.name] = m.original;}" +
        "s.active = false; s.executableAllocations += this.runtime.linearHeap.allocationCount - allocations;" +
        "if (program) {s.codeWords += program.code.length; s.constants += program.constants.length; s.registers += program.registerCount;}}"
    );
    var started = state.now();
    function output(text) {
        if (node) console.log(text); else print(text);
    }
    function report() {
        if (state.reported) return;
        state.reported = true;
        var sum = 0;
        for (var i = 0; i < state.phases.length; i++) {
            var p = state.phases[i];
            if (!p.parent) sum += p.ms;
        }
        /* Scalar lines also work in the ES3 shell, which has no JSON API.
         * Keep reporting independent of the feature being investigated. */
        output("EVAL_PHASES every=" + every + " detail=" + detail +
            " compileEvalCalls=" + state.calls + " sampled=" + state.sampled +
            " elapsedMs=" + (state.now() - started) + " sampledEvalMs=" + state.evalMs +
            " sampledResidualMs=" + (state.evalMs - sum) +
            " sampledCodeWords=" + state.codeWords + " sampledConstants=" + state.constants +
            " sampledRegisters=" + state.registers + " sampledExecutableAllocations=" + state.executableAllocations);
        for (i = 0; i < state.phases.length; i++) {
            p = state.phases[i];
            output("EVAL_PHASE name=" + p.name + " parent=" + (p.parent || "-") +
                " calls=" + p.calls + " ms=" + p.ms);
        }
    }
    /* The shell runner calls native quit after cleanup; it does not unwind
     * through this file's finally. Report before that existing exit call. */
    if (!node && !standalone) {
        state.report = report; state.originalQuit = root.quit;
        root.quit = Function("status",
            "GuestEvalPhaseProfile.report(); return GuestEvalPhaseProfile.originalQuit(status);");
    }
    try {
        if (standalone) {
            var program = args.shift();
            guestStandaloneExecute(program, args);
        } else if (node) {
            process.argv = [process.argv[0], "guest_runner.js"].concat(args);
            require("../../guest_runner.js");
        } else {
            root.arguments = args;
            load("guest_runner.js");
        }
    } finally {
        VM.JSContext.prototype.compileEval = state.originalEval;
        if (node && oldVMModule) require.cache[require.resolve("../vm.js")] = oldVMModule;
        if (!node && !standalone) root.quit = state.originalQuit;
        report();
    }
}(typeof global !== "undefined" ? global : this,
  typeof arguments !== "undefined" ? arguments : []));
