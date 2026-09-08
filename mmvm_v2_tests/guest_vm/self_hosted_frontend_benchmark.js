/* High-level check that executes the front end as guest code when launched by
 * guest_runner.js.  It deliberately parses the supplied source on every run.
 * No source-specific or serialized parse cache is read or written.
 *
 *   js_min.exe guest_runner.js --vm-native \
 *       guest_vm/self_hosted_frontend_benchmark.js source.js
 */
var selfHostedFrontend = require("./self_hosted_frontend.js");
var selfHostedFs = require("fs");
var selfHostedPath = arguments[0];
if (!selfHostedPath) {
    throw new Error("usage: self_hosted_frontend_benchmark.js source.js");
}
var selfHostedSource = selfHostedFs.readFileSync(selfHostedPath, "utf8");
if (typeof selfHostedSource !== "string") {
    selfHostedSource = selfHostedSource.toString("utf8");
}
var selfHostedStarted = new Date().getTime();
var selfHostedAst = selfHostedFrontend.parse(selfHostedSource, selfHostedPath);
var selfHostedParsed = new Date().getTime();
var selfHostedParseOnly = arguments[1] === "--parse-only";
var selfHostedProgram = selfHostedParseOnly ? null :
    selfHostedFrontend.compileAst(selfHostedAst);
var selfHostedCompiled = new Date().getTime();
console.log("self-hosted frontend source bytes: " + selfHostedSource.length);
if (selfHostedProgram) {
    console.log("self-hosted frontend bytecode words: " +
                selfHostedProgram.code.length);
}
console.log("self-hosted frontend parse ms: " +
            (selfHostedParsed - selfHostedStarted));
console.log("self-hosted frontend compile ms: " +
            (selfHostedCompiled - selfHostedParsed));
console.log("self-hosted frontend total ms: " +
            (selfHostedCompiled - selfHostedStarted));
