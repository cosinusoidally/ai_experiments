/* JavaScript-only Node compatibility runner. */
var nodeRunnerArguments = [];
for (var nodeRunnerIndex = 0; nodeRunnerIndex < arguments.length; nodeRunnerIndex++) {
    nodeRunnerArguments.push(arguments[nodeRunnerIndex]);
}

if (nodeRunnerArguments.length === 0) {
    print("usage: js_min.exe node_runner.js program.js [arguments]");
    quit(2);
}

load("node_compat/libc.js");
load("node_compat/events.js");
load("node_compat/process.js");
load("node_compat/net.js");
load("node_compat/fs.js");
load("node_compat/http.js");
load("node_compat/module.js");

NodeProcess.install(nodeRunnerArguments);

try {
    NodeModule.runMain(nodeRunnerArguments[0]);
} catch (nodeRunnerError) {
    if (!NodeProcess.isExit(nodeRunnerError)) {
        NodeProcess.reportException(nodeRunnerError);
        NodeProcess.exitCode = 1;
    }
}

if (!NodeProcess.exiting) {
    NodeRuntime.run();
}
quit(NodeProcess.exitCode);
