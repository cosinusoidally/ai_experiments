/* Direct Node.js reference for the existing, unchanged Octane wrapper.
 * Uses only builtin APIs; no guest VM and no npm packages. ES3 syntax.
 * Run from mmvm_v2_tests: node octane_node_runner.js zlib
 */
(function () {
    var fs = require("fs");
    var vm = require("vm");
    var path = require("path");
    process.chdir(__dirname);
    global.print = function (message) { console.log(message); };
    global.load = function (filename) {
        vm.runInThisContext(fs.readFileSync(filename, "utf8"), {
            filename: filename
        });
    };
    /* Octane's generated programs use the ordinary Node environment. The
     * wrapper itself expects the shell's global arguments/load/print API. */
    global.require = require;
    global.arguments = process.argv.slice(2);
    global.load(path.join(__dirname, "octane_runner.js"));
}());
