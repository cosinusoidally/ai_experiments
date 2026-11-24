/* Small Node-builtins-only QMP console for disposable VM acceptance.
 * ES3 syntax. No guest agent, Python, GUI automation package or devtools.
 * qmp_control.js SOCKET status|key KEYS|type TEXT|screen OUTPUT.ppm|powerdown|quit
 * `type TEXT [--uk]` selects US/UK keys and does not press Return. */
(function () {
    var net = require("net"), args = process.argv.slice(2), path = args.shift(), action = args.shift();
    if (!path || ["status", "key", "type", "screen", "powerdown", "quit"].indexOf(action) < 0) {
        throw new Error("expected SOCKET status|key KEYS|type TEXT|screen OUTPUT.ppm|powerdown|quit");
    }
    var socket = net.connect(path), text = "", greeting = false, sequence = 0, pending = {};
    var watchdog = setTimeout(function () { fail(new Error("QMP command timed out")); }, 30000);
    function fail(error) { clearTimeout(watchdog); console.error(error.message); socket.destroy(); process.exitCode = 1; }
    function send(name, parameters, callback) {
        var id = ++sequence; pending[id] = callback;
        socket.write(JSON.stringify({execute: name, arguments: parameters || {}, id: id}) + "\n");
    }
    function done(result) { clearTimeout(watchdog); console.log(JSON.stringify(result)); socket.end(); }
    function key(keys, callback) { send("human-monitor-command", {"command-line": "sendkey " + keys + " 25"}, callback); }
    function typed(value) {
        var at = 0, punctuation = {" ": "spc", ".": "dot", "/": "slash", "\\": "backslash",
            ":": "shift-semicolon", ";": "semicolon", "-": "minus", "_": "shift-minus",
            "=": "equal", "'": "apostrophe", '"': "shift-apostrophe",
            "\n": "ret", "&": "shift-7", "|": "shift-backslash"};
        if (args[1] === "--uk") {
            punctuation["\\"] = "less"; punctuation['"'] = "shift-2";
            punctuation["|"] = "shift-less"; punctuation["#"] = "backslash";
            punctuation["@"] = "shift-apostrophe";
        }
        function next() {
            if (at === value.length) { done({typed: at}); return; }
            var ch = value.charAt(at++), code = ch.charCodeAt(0), keys = punctuation[ch];
            if (code >= 65 && code <= 90) keys = "shift-" + ch.toLowerCase();
            else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) keys = ch;
            if (!keys) { fail(new Error("unmapped keyboard character: " + ch)); return; }
            key(keys, function (result) {
                if (result) { fail(new Error(result)); return; }
                setTimeout(next, 70);
            });
        }
        next();
    }
    function run() {
        if (action === "status") send("query-status", {}, done);
        else if (action === "key") key(args[0], done);
        else if (action === "type") typed(args[0] || "");
        else if (action === "screen") send("screendump", {filename: require("path").resolve(args[0])}, done);
        else if (action === "powerdown") send("system_powerdown", {}, done);
        else send("quit", {}, done);
    }
    socket.on("data", function (bytes) {
        text += bytes.toString();
        var newline;
        while ((newline = text.indexOf("\n")) >= 0) {
            var line = text.substring(0, newline); text = text.substring(newline + 1);
            if (!line.trim()) continue;
            var message = JSON.parse(line);
            if (message.QMP && !greeting) {
                greeting = true; send("qmp_capabilities", {}, run);
            } else if (message.id && pending[message.id]) {
                var callback = pending[message.id]; delete pending[message.id];
                if (message.error) { fail(new Error(JSON.stringify(message.error))); return; }
                callback(message.return);
            }
        }
    });
    socket.on("error", fail);
}());
