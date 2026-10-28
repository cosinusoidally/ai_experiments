/* Test262 embedding executed as guest JS in the standalone control runtime.
 * One persistent test runtime owns the isolated per-test contexts. Neither
 * parsing, context management, nor semantic fallback calls a host JS engine:
 * the embedding implementation itself is running in the outer guest VM.
 * This is intentionally separate from claiming every test opcode is handled
 * by the inner native kernel. No Node process or Node-only API is required. */
/* Generic images already contain the guest-executed embedding library for
 * self-hosted rebuilds. Reuse that implementation rather than parse and retain
 * another copy of the same VM. The test runtime/heap itself is still new. */
if (typeof GuestVM !== "function" || typeof GuestNodeEnvironment !== "function" ||
        typeof GuestNodeEnvironment.prototype.runTest262Variant !== "function") {
    throw new Error("standalone Test262 requires a generic image built from the current VM sources");
}
var VM = GuestVM;
var Environment = GuestNodeEnvironment;

exports.create = function (filesystem, progress) {
    if (progress) progress("constructing guest test runtime");
    var vm = new VM({rawFFI: true, nativeInterpreter: true, gcThreshold: 16384});
    if (progress) progress("guest test runtime ready");
    /* Do not install a second Node environment, mutate the control globals,
     * or register callbacks to a process outside the standalone image. Reuse
     * only the realm scheduler and error-formatting implementation. */
    var embedding = Object.create(Environment.prototype);
    embedding.vm = vm;
    embedding.context = vm.context;
    embedding.runtime = vm.runtime;
    embedding.hostFs = filesystem;
    embedding.test262ProgramCache = {};
    embedding.test262HarnessTemplate = null;
    embedding.moduleCache = {};
    embedding.moduleContexts = [];
    embedding.builtinModules = {};
    return {
        runVariant: function (filename, source, strict, harnessFiles, limit, fresh) {
            var result = embedding.runTest262Variant(filename, source, strict,
                harnessFiles, limit, fresh);
            var visible = {}, index = 0;
            var fields = ["status", "phase", "name", "message", "filename",
                          "line", "column", "instructions"];
            while (index < fields.length) {
                var field = fields[index++];
                visible[field] = vm.runtime.getProperty(result, field);
            }
            return visible;
        },
        installEvalCompiler: function () {
            var frontend = embedding.loadModule(
                "./guest_vm/self_hosted_frontend.js", "test262_runner.js");
            vm.runtime.interpretGuest(vm.runtime.getProperty(frontend,
                "installEvalCompiler"), frontend, [], vm.context);
        },
        destroy: function () { vm.destroy(); }
    };
};
