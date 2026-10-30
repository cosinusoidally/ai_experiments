/* Optional Node cross-build diagnostic. Symbols are a sidecar, never part of
 * the executable snapshot. Use the ordinary runner arguments after this file. */
var fs = require("fs");
var Backend = require("../aot/backend_x86.js");
var writeSnapshot = Backend.prototype.writeStandaloneSnapshot;
Backend.prototype.writeStandaloneSnapshot = function (
        path, result, runtime, execution, programPath, metadata) {
    var written = writeSnapshot.call(this, path, result, runtime, execution,
        programPath, metadata);
    if (written) fs.writeFileSync(path + ".symbols.json", JSON.stringify({
        sourceHash: metadata.sourceHash >>> 0,
        codeLength: result.length,
        registerAllocation: result.registerAllocation,
        symbols: result.symbols
    }));
    return written;
};
require("../../guest_runner.js");
