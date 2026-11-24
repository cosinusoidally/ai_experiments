/* Run an existing embedding integration check with a full bootstrap stack.
 * js_min.exe guest_vm/tools/run_embedding_check.js FILE GLOBAL_EXPORT
 * node guest_vm/tools/run_embedding_check.js FILE
 * Pass --script as the second argument for an auto-running check script.
 * FILE is relative to the suite working directory; no new test expectations. */
(function (root, shellArguments) {
    var node = typeof module !== "undefined" && module.exports;
    var args = node ? process.argv.slice(2) : shellArguments;
    var VM, check, output = node ? function (text) { console.log(text); } : print;
    try {
        if (!args.length) throw new Error("expected integration check filename");
        if (node) {
            VM = require("../vm.js");
            check = require(require("path").resolve(args[0]));
        } else {
            load("guest_vm/guest_vm.js");
            load(args[0]);
            VM = GuestVM;
            check = root[args[1]];
        }
        if (args[1] === "--script") return;
        if (typeof check !== "function") throw new Error("check export is not callable");
        output(check(VM));
    } catch (error) {
        output(error.stack || error.message || String(error));
        throw error;
    }
}(this, typeof arguments === "undefined" ? [] : arguments));
