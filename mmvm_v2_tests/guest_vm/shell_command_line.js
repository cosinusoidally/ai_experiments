/* Shared source-action parsing for the embedded and standalone shell runners.
 * No file reads, evaluation, environment capture or host services happen here. */
(function (root) {
    function parse(args) {
        var actions = [], scriptArguments = [], programName = "-e";
        var index = 0, positional = false;
        while (index < args.length) {
            var option = String(args[index++]);
            if (option === "--no-ion") continue;
            if (option === "-e" || option === "-f") {
                if (index >= args.length) throw new Error(option + " requires an argument");
                var value = String(args[index++]);
                actions.push(option === "-e" ?
                    {filename: "-e", source: value} : {filename: value});
                if (option === "-f" && actions.length === 1) programName = value;
            } else {
                if (option === "--") {
                    if (index >= args.length) break;
                    option = String(args[index++]);
                } else if (option.charAt(0) === "-") {
                    throw new Error("unsupported shell option: " + option);
                }
                programName = option;
                actions.push({filename: option});
                positional = true;
                break;
            }
        }
        if (positional) {
            while (index < args.length) scriptArguments.push(String(args[index++]));
        }
        return {actions: actions, programName: programName,
            scriptArguments: scriptArguments};
    }
    root.GuestShellCommandLine = {parse: parse};
    if (typeof module !== "undefined" && module.exports) module.exports = root.GuestShellCommandLine;
}(this));
