/* Command UI. The engine and target interfaces are the future extension
 * boundary; this module deliberately has no guest heap/bytecode knowledge. */
(function (root) {
    function hex(value) { return "0x" + ("00000000" + (value >>> 0).toString(16)).slice(-8); }
    function words(text) {
        var out = [], value = "", quote = "", active = false;
        for (var i = 0; i < text.length; i++) {
            var c = text.charAt(i);
            if (c === "\\" && quote !== "'") { if (++i >= text.length) throw new Error("trailing argument escape"); value += text.charAt(i); active = true; }
            else if (quote) { if (c === quote) quote = ""; else value += c; }
            else if (c === '"' || c === "'") { quote = c; active = true; }
            else if (c === " " || c === "\t") { if (active) { out.push(value); value = ""; active = false; } }
            else { value += c; active = true; }
        }
        if (quote) throw new Error("unterminated argument quote");
        if (active) out.push(value); return out;
    }
    function UI(io, engine, batch) {
        this.io = io; this.engine = engine; this.batch = batch; this.quit = false;
        this.commands = {}; this.line = ""; this.tty = false;
        this.registerBuiltins();
    }
    UI.prototype.say = function (text) { this.io.output(text + "\n"); };
    UI.prototype.registerCommand = function (name, handler) { this.commands["$" + name] = handler; };
    UI.prototype.location = function (frame) {
        var symbol = this.engine.image.symbol(frame.pc);
        return hex(frame.pc) + " in " + (frame.fn ? this.engine.debug.name(frame.fn) : symbol ? symbol.name : "??") +
            (frame.line ? " at " + frame.line.file + ":" + frame.line.line : "");
    };
    UI.prototype.stopped = function (event) {
        if (event.kind === "exited") this.say("Inferior exited with status " + event.code + ".");
        else if (event.kind === "terminated") this.say("Inferior terminated by signal " + event.signal + ".");
        else {
            this.say((event.timeout ? "Execution timeout; " : "") + (event.breakpoint ? "Breakpoint " + event.breakpoint + ", " : "Stopped (signal " + event.signal + "), ") +
                this.location(this.engine.frame()));
        }
    };
    UI.prototype.inputLine = function (prompt) {
        this.io.output(prompt); var text = "";
        while (true) {
            var octet = this.io.inputByte(-1);
            if (octet === -2) continue;
            if (octet < 0 || octet === 4 && !text) return null;
            if (octet === 3) { if (this.tty) this.io.output("^C\n"); return ""; }
            if (octet === 10 || octet === 13) { if (this.tty) this.io.output("\n"); return text; }
            if (octet === 127 || octet === 8) { if (text) { text = text.slice(0, -1); if (this.tty) this.io.output("\b \b"); } }
            else if (octet >= 32 && octet < 127) { text += String.fromCharCode(octet); if (this.tty) this.io.output(String.fromCharCode(octet)); }
        }
    };
    UI.prototype.runningInput = function () {
        var octet = this.io.inputByte(10);
        if (octet === -2 || octet === -1) return;
        if (octet === 3) { this.io.interrupt(); this.line = ""; if (this.tty) this.io.output("^C\n"); }
        else if (octet === 10 || octet === 13) {
            var command = this.line; this.line = "";
            if (this.tty) this.io.output("\n");
            if (command === "interrupt") this.io.interrupt();
            else this.say("Inferior running; use Ctrl-C or interrupt.");
        } else if (octet === 127 || octet === 8) { this.line = this.line.slice(0, -1); }
        else if (octet >= 32 && octet < 127) { this.line += String.fromCharCode(octet); if (this.tty) this.io.output(String.fromCharCode(octet)); }
    };
    UI.prototype.execute = function (line) {
        if (!line || /^\s*#/.test(line)) return;
        var args = words(line), name = args.shift(), handler = this.commands["$" + name];
        if (!handler) throw new Error("unknown command " + name + "; try help");
        handler(args);
    };
    UI.prototype.number = function (text) {
        if (/^\$[a-z_]+$/.test(text)) {
            var registers = this.engine.frame().registers, name = text.substring(1);
            if (registers[name] === undefined) throw new Error("unavailable register " + name); return registers[name];
        }
        if (/^-?(0x[0-9a-fA-F]+|[0-9]+)$/.test(text)) {
            var value = Number(text);
            if (!isFinite(value) || value < -2147483648 || value > 0xffffffff) throw new Error("value outside i386 word range"); return value;
        }
        return this.engine.value(this.engine.variable(text));
    };
    UI.prototype.registerBuiltins = function () {
        var self = this, e = this.engine, A = root.KernelDebuggerDWARF.attributes, D = root.GuestVMKernelDWARF.constants;
        function command(names, fn) { for (var i = 0; i < names.length; i++) self.registerCommand(names[i], fn); }
        command(["help", "h"], function () { self.say("run [args], set args ..., show args, break FUNCTION|FILE:LINE|*ADDRESS, delete ID\ncontinue [signal], stepi, step, next, finish, backtrace, frame N, registers\ninfo breakpoints|args|locals, print NAME|$REGISTER|INTEGER, set variable NAME = INTEGER\nx/COUNTwx ADDRESS, list [FILE:LINE], assert NAME|$REGISTER == INTEGER, quit\nArguments support quotes/backslash escapes; no shell expansion. Inferior stdin is /dev/null."); });
        command(["run", "r"], function (args) {
            if (self.io.pid) {
                if (!self.batch && self.inputLine("Restart inferior? (y/N) ") !== "y") return;
                self.io.terminate();
            }
            if (args.length) e.args = args;
            self.stopped(e.start());
        });
        command(["break", "b"], function (args) {
            if (args.length !== 1) throw new Error("break requires one location");
            var group = e.addBreakpoint(args[0], false);
            var locations = [];
            for (var i = 0; i < group.addresses.length; i++) locations.push(hex(group.addresses[i]));
            self.say("Breakpoint " + group.id + " at " + locations.join(", "));
        });
        command(["delete"], function (args) { if (args.length !== 1) throw new Error("delete requires breakpoint ID"); e.removeBreakpoint(Number(args[0])); });
        command(["continue", "c"], function (args) { self.stopped(e.resume(false, args.length ? self.number(args[0]) : undefined)); });
        command(["stepi", "si"], function () { self.stopped(e.resume(true)); });
        command(["step", "s"], function () { self.stopped(e.sourceStep(false)); });
        command(["next", "n"], function () { self.stopped(e.sourceStep(true)); });
        command(["finish"], function () { self.stopped(e.finish()); });
        command(["backtrace", "bt"], function () {
            var frames = e.frames();
            for (var i = 0; i < frames.length; i++) {
                self.say("#" + i + " " + self.location(frames[i]));
                if (frames[i].unwindError) self.say("    unwind stopped: " + frames[i].unwindError);
                if (frames[i].fn) for (var j = 0; j < frames[i].fn.children.length; j++) {
                    var child = frames[i].fn.children[j], start = child.attrs["$" + A.lowPC];
                    if (child.tag === D.tag.inlinedSubroutine && start <= frames[i].pc && frames[i].pc < start + child.attrs["$" + A.highPC]) self.say("    [inline] " + e.debug.name(child));
                }
            }
        });
        command(["frame", "f"], function (args) {
            var index = Number(args[0]); if (!(index >= 0 && index === Math.floor(index) && index < e.frames().length)) throw new Error("invalid frame number");
            e.selectedFrame = index; self.say("#" + index + " " + self.location(e.frame()));
        });
        command(["registers"], function () {
            var registers = e.frame().registers;
            for (var name in registers) if (registers.hasOwnProperty(name)) self.say(name + " " + hex(registers[name]));
        });
        command(["info"], function (args) {
            if (args[0] === "registers") return self.commands.$registers([]);
            if (args[0] === "breakpoints") {
                for (var i = 0; i < e.groups.length; i++) self.say(e.groups[i].id + " " + e.groups[i].spec); return;
            }
            var tag = args[0] === "args" ? D.tag.formalParameter : args[0] === "locals" ? D.tag.variable : 0;
            if (!tag) throw new Error("info requires breakpoints, args, locals or registers");
            var frame = e.frame(); if (!frame.fn) throw new Error("not in a kernel function");
            for (i = 0; i < frame.fn.children.length; i++) if (frame.fn.children[i].tag === tag) {
                var name = e.debug.name(frame.fn.children[i]);
                try { self.say(name + " = " + (e.value(e.variable(name)) | 0)); }
                catch (error) { self.say(name + " = <" + error.message + ">"); }
            }
        });
        command(["print", "p"], function (args) { if (args.length !== 1) throw new Error("print accepts a scalar name, register or integer"); var value = self.number(args[0]); self.say((value | 0) + " (" + hex(value) + ")"); });
        command(["set"], function (args) {
            if (args[0] === "args") { e.args = args.slice(1); return; }
            if (args[0] !== "variable" || args.length !== 4 || args[2] !== "=") throw new Error("set variable NAME = VALUE or set args ...");
            e.setVariable(args[1], self.number(args[3]));
        });
        command(["show"], function (args) { if (args[0] !== "args") throw new Error("show args expected"); self.say("Inferior arguments: " + e.args.join(" ")); });
        command(["list", "l"], function (args) {
            var row = args.length ? /^(.*):(\d+)$/.exec(args[0]) : null, file, line;
            if (row) { file = row[1]; line = Number(row[2]); }
            else { var frame = e.frame(); if (!frame.line) throw new Error("no source location"); file = frame.line.file; line = frame.line.line; }
            var lines = self.io.textFile(file).split("\n");
            for (var i = Math.max(1, line - 3); i <= Math.min(lines.length, line + 3); i++) self.say((i === line ? "> " : "  ") + i + "\t" + lines[i - 1]);
        });
        command(["assert"], function (args) {
            if (args.length !== 3 || args[1] !== "==") throw new Error("assert NAME|$REGISTER == VALUE");
            if ((self.number(args[0]) >>> 0) !== (self.number(args[2]) >>> 0)) throw new Error("assertion failed: " + args.join(" "));
            self.say("Assertion passed: " + args.join(" "));
        });
        command(["quit", "q"], function () { self.quit = true; });
    };
    var originalExecute = UI.prototype.execute;
    UI.prototype.execute = function (line) {
        var match = /^x\/(\d+)(wx|bx)\s+(.+)$/.exec(line);
        if (!match) return originalExecute.call(this, line);
        this.engine.requireStopped(); var count = Number(match[1]), address = this.number(match[3]);
        if (count > 1024) throw new Error("memory examination limited to 1024 items");
        for (var i = 0; i < count; i++) {
            var at = (address + i * (match[2] === "wx" ? 4 : 1)) >>> 0;
            this.say(hex(at) + ": " + hex(match[2] === "wx" ? this.io.readWord(at) : this.io.readByte(at)));
        }
    };
    function main(args) {
        var batch = false, commands = [], timeout = 30000, stepLimit = 100000, path = "", inferiorArgs = [];
        var io = new root.KernelDebuggerLinux(), image = null;
        try {
            for (var i = 0; i < args.length; i++) {
                var arg = String(args[i]);
                if (arg === "--batch") batch = true;
                else if (arg === "--commands") commands = commands.concat(io.textFile(String(args[++i])).split(/\r?\n/));
                else if (arg === "--ex") commands.push(String(args[++i]));
                else if (arg === "--timeout-ms") timeout = Number(args[++i]);
                else if (arg.charAt(0) === "-" && !path) throw new Error("unknown option " + arg);
                else if (!path) path = arg;
                else inferiorArgs.push(arg);
            }
            if (!path || !(timeout > 0 && timeout <= 2147483647)) throw new Error("usage: kernel_debugger.js [--batch] [--commands FILE] [--ex COMMAND] [--timeout-ms N] EXECUTABLE [args]");
            image = new root.KernelDebuggerImage(io, path);
            var debug = new root.KernelDebuggerDWARF(image);
            var engine = new root.KernelDebuggerEngine(io, image, debug, {timeout: timeout, stepLimit: stepLimit});
            engine.args = inferiorArgs;
            var ui = new UI(io, engine, batch);
            if (!batch) { ui.tty = io.terminal(); engine.options.runningInput = function () { ui.runningInput(); }; }
            ui.say("Kernel debugger: " + path + " (" + debug.functions.length + " kernel functions). Inferior not started.");
            for (i = 0; i < commands.length && !ui.quit; i++) { ui.say("(kdbg) " + commands[i]); ui.execute(commands[i]); }
            if (!batch) while (!ui.quit) {
                var line = ui.inputLine("(kdbg) "); if (line === null) break;
                try { ui.execute(line); } catch (error) { ui.say("Error: " + error.message); }
            }
        } finally { try { if (image) image.destroy(); } finally { io.destroy(); } }
    }
    root.KernelDebuggerCommands = {main: main, UI: UI, words: words};
}(this));
