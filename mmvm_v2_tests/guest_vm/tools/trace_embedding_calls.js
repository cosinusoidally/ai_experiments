/* Trace callbacks of VMs constructed by a self-hosted embedding workload.
 * Run: js_runner.exe SNAP guest_vm/tools/trace_embedding_calls.js PROGRAM ...
 * This instruments the existing transition logger, not the tested program. */
(function (args) {
    if (typeof guestStandaloneExecute !== "function" || !args.length) {
        throw new Error("expected standalone snapshot and embedding program");
    }
    var createContext = GuestVM.JSRuntime.prototype.createContext;
    GuestVM.JSRuntime.prototype.createContext = function () {
        this.runtime.logHostCalls = true;
        return createContext.apply(this, arguments);
    };
    var call = GuestVMRuntime.prototype.call;
    GuestVMRuntime.prototype.call = function (callable, receiver, values, context) {
        if (callable && callable.name !== "assertEqual") {
            print("embedding semantic call: " + callable.name);
        }
        return call.apply(this, arguments);
    };
    guestStandaloneExecute(args[0], args.slice(1));
}(arguments));
