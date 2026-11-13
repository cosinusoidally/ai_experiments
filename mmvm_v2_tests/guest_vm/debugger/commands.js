/* Command UI. The engine and target interfaces are the future extension
 * boundary; this module deliberately has no guest heap/bytecode knowledge. */
(function (root) {
    var hex = root.KernelDebuggerFormat.hex32;
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
        this.commands = {}; this.line = ""; this.tty = false; this.sourceCache = {};
        this.registerBuiltins();
    }
    UI.prototype.say = function (text) { this.io.output(text + "\n"); };
    UI.prototype.registerCommand = function (name, handler) { this.commands["$" + name] = handler; };
    UI.prototype.sourceLines = function (path) {
        var key = "$" + path;
        if (!this.sourceCache[key]) this.sourceCache[key] = this.io.textFile(path).split("\n");
        return this.sourceCache[key];
    };
    UI.prototype.location = function (frame) {
        var symbol = this.engine.image.symbol(frame.pc);
        return hex(frame.pc) + " in " + (frame.fn ? this.engine.debug.name(frame.fn) : symbol ? symbol.name : "??") +
            (frame.line ? " at " + frame.line.file + ":" + frame.line.line : "");
    };
    UI.prototype.stopped = function (event) {
        if (event.kind === "exited") this.say("Inferior exited with status " + event.code + ".");
        else if (event.kind === "terminated") this.say("Inferior terminated by signal " + event.signal + ".");
        else {
            this.say((event.timeout ? "Execution timeout; " : "") + (event.breakpoint ? (event.temporary ? "Temporary breakpoint " : "Breakpoint ") + event.breakpoint + ", " : "Stopped (signal " + event.signal + "), ") +
                this.location(this.engine.frame()));
            var row = this.engine.frame().line;
            if (row) {
                try { this.say(row.line + "\t" + this.sourceLines(row.file)[row.line - 1]); }
                catch (error) { this.say("Source unavailable: " + error.message); }
            }
            if (event.timeout) throw new Error("inferior execution timed out");
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
            if (octet === 127 || octet === 8) { if (text) { text = text.substring(0, text.length - 1); if (this.tty) this.io.output("\b \b"); } }
            else if (octet >= 32 && octet < 127) { text += String.fromCharCode(octet); if (this.tty) this.io.output(String.fromCharCode(octet)); }
        }
    };
    UI.prototype.runningInput = function () {
        var octet = this.io.inputByte(10);
        if (octet === -2) return;
        if (octet === -1) { this.io.call("poll", [0, 0, 10]); return; }
        if (octet === 3) { this.engine.interrupt(); this.line = ""; if (this.tty) this.io.output("^C\n"); }
        else if (octet === 10 || octet === 13) {
            var command = this.line; this.line = "";
            if (this.tty) this.io.output("\n");
            if (command === "interrupt") this.engine.interrupt();
            else this.say("Inferior running; use Ctrl-C or interrupt.");
        } else if (octet === 127 || octet === 8) { this.line = this.line.substring(0, this.line.length - 1); }
        else if (octet >= 32 && octet < 127) { this.line += String.fromCharCode(octet); if (this.tty) this.io.output(String.fromCharCode(octet)); }
    };
    UI.prototype.execute = function (line) {
        while (line && (line.charAt(0) === " " || line.charAt(0) === "\t")) line = line.substring(1);
        while (line && (line.charAt(line.length - 1) === "\r" || line.charAt(line.length - 1) === " ")) line = line.substring(0, line.length - 1);
        if (!line || line.charAt(0) === "#") return;
        if (line.substring(0, 2) === "x/") return this.examine(line);
        var args = words(line), name = args.shift(), handler = this.commands["$" + name];
        var modifier = name.indexOf("/");
        if (modifier > 0 && (name.substring(0, modifier) === "disassemble" || name.substring(0, modifier) === "disas")) {
            args = [name.substring(modifier)].concat(args);
            name = name.substring(0, modifier); handler = this.commands["$" + name];
        }
        if (!handler) throw new Error("unknown command " + name + "; try help");
        try { handler(args); }
        catch (error) { throw new Error("command " + name + ": " + error.message +
            (error.stack ? "\n" + error.stack : "")); }
    };
    UI.prototype.number = function (text) {
        if (text.charAt(0) === "$") {
            var registers = this.engine.frame().registers, name = text.substring(1);
            if (registers[name] === undefined) throw new Error("unavailable register " + name); return registers[name];
        }
        if (text.charAt(0) === "-" || text.charAt(0) >= "0" && text.charAt(0) <= "9") {
            var value = Number(text);
            if (value !== value || value !== Math.floor(value) || value < -2147483648 || value > 0xffffffff) throw new Error("value outside i386 word range"); return value;
        }
        return this.engine.value(this.engine.variable(text));
    };
    UI.prototype.registerBuiltins = function () {
        var self = this, e = this.engine, A = root.KernelDebuggerDWARF.attributes, D = root.GuestVMKernelDWARF.constants;
        function command(names, fn) { for (var i = 0; i < names.length; i++) self.registerCommand(names[i], fn); }
        command(["help", "h"], function () {
            self.say([
                "run [args], set args ..., show args",
                "break FUNCTION|FILE:LINE|*ADDRESS, delete ID",
                "continue [signal], stepi, step, next, finish, backtrace, frame N",
                "registers, info breakpoints|args|locals",
                "print NAME|$REGISTER|INTEGER, set variable NAME = VALUE",
                "x/COUNTwx ADDRESS, x/COUNTbx ADDRESS",
                "disassemble [/r] [FUNCTION|*ADDRESS], list [FUNCTION|FILE:LINE|*ADDRESS]",
                "assert NAME|$REGISTER == VALUE, quit",
                "Arguments support quotes/backslash escapes, not shell expansion.",
                "Inferior stdin is /dev/null; while running use Ctrl-C or interrupt."
            ].join("\n"));
        });
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
        command(["disassemble", "disas"], function (args) {
            var showBytes = false;
            if (args.length && args[0].charAt(0) === "/") {
                if (args[0] !== "/r") throw new Error("unsupported disassemble modifier " + args[0] + "; /r shows instruction bytes");
                showBytes = true; args = args.slice(1);
            }
            if (args.length > 1) throw new Error("disassemble [/r] [FUNCTION|*ADDRESS]");
            if (e.target.pid) e.requireStopped();
            var start = 0, end;
            if (!args.length) start = e.frame().pc;
            else start = e.debug.resolve(args[0])[0];
            var fn = e.debug.functionAt(start), symbol = e.image.symbol(start);
            if (fn) { start = fn.attrs["$" + A.lowPC]; end = start + fn.attrs["$" + A.highPC]; }
            else if (symbol) { start = symbol.start; end = start + symbol.size; }
            else end = start + 64;
            var instructions = 0, previous = "";
            while (start < end && instructions++ < 200) {
                var row = e.debug.lineAt(start), source = row ? row.file + ":" + row.line : "";
                if (source && source !== previous) {
                    self.say(source); previous = source;
                    try { self.say(row.line + "\t" + self.sourceLines(row.file)[row.line - 1]); }
                    catch (error) { self.say("Source unavailable: " + error.message); }
                }
                var decoded = root.KernelDebuggerX86.decode(function (address) {
                    if (!e.target.pid) return e.image.codeByte(address);
                    var site = e.sites["$" + address]; return site && site.installed ? site.original : e.target.readByte(address);
                }, start);
                var raw = "";
                if (showBytes) {
                    for (var octet = 0; octet < decoded.bytes.length; octet++) {
                        if (octet) raw += " ";
                        raw += root.KernelDebuggerFormat.hexByte(decoded.bytes[octet]);
                    }
                    var width = root.KernelDebuggerX86.maxInstructionBytes * 3 - 1;
                    while (raw.length < width) raw += " ";
                    raw += "  ";
                }
                self.say(hex(start) + "  " + raw + decoded.text); start += decoded.length;
            }
            if (start < end) self.say("Disassembly limited to 200 instructions.");
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
            if (args.length > 1) throw new Error("list [FUNCTION|FILE:LINE|*ADDRESS]");
            var row = args.length ? e.debug.sourceLocation(args[0]) : null, file, line;
            if (row) { file = row.file; line = row.line; }
            else { var frame = e.frame(); if (!frame.line) throw new Error("no source location"); file = frame.line.file; line = frame.line.line; }
            var lines = self.sourceLines(file);
            var first = Math.max(1, line - 4), last = Math.min(lines.length, first + 9);
            for (var i = first; i <= last; i++) self.say((i === line ? "> " : "  ") + i + "\t" + lines[i - 1]);
        });
        command(["assert"], function (args) {
            if (args.length !== 3 || args[1] !== "==") throw new Error("assert NAME|$REGISTER == VALUE");
            if ((self.number(args[0]) >>> 0) !== (self.number(args[2]) >>> 0)) throw new Error("assertion failed: " + args.join(" "));
            self.say("Assertion passed: " + args.join(" "));
        });
        command(["quit", "q"], function () {
            if (self.io.pid && !self.batch && self.inputLine("Kill inferior and quit? (y/N) ") !== "y") return;
            self.quit = true;
        });
    };
    UI.prototype.examine = function (line) {
        var args = words(line), spec = args[0], kind = spec.substring(spec.length - 2);
        var count = Number(spec.substring(2, spec.length - 2));
        if (args.length !== 2 || (kind !== "wx" && kind !== "bx") || !(count > 0 && count <= 1024 && count === Math.floor(count))) throw new Error("expected x/COUNTwx ADDRESS or x/COUNTbx ADDRESS (1..1024 items)");
        this.engine.requireStopped(); var address = this.number(args[1]);
        for (var i = 0; i < count; i++) {
            var at = (address + i * (kind === "wx" ? 4 : 1)) >>> 0;
            this.say(hex(at) + ": " + hex(kind === "wx" ? this.io.readWord(at) : this.io.readByte(at)));
        }
    };
    function main(args) {
        var batch = false, commands = [], timeout = null, stepLimit = 100000, path = "", inferiorArgs = [];
        var usage = "usage: kernel_debugger.js [--batch] [--commands FILE] [--ex COMMAND] [--timeout-ms N] EXECUTABLE [args]";
        var io = new root.KernelDebuggerLinux(), image = null;
        try {
            for (var i = 0; i < args.length; i++) {
                var arg = String(args[i]);
                if (path) { inferiorArgs.push(arg); continue; }
                if (arg === "--help") { io.output(usage + "\nUse help at the (kdbg) prompt for commands.\n"); return; }
                else if (arg === "--batch") batch = true;
                else if (arg === "--commands") {
                    if (i + 1 >= args.length) throw new Error("--commands requires a filename");
                    commands = commands.concat(io.textFile(String(args[++i])).split("\n"));
                }
                else if (arg === "--ex") {
                    if (i + 1 >= args.length) throw new Error("--ex requires a command");
                    commands.push(String(args[++i]));
                }
                else if (arg === "--timeout-ms") timeout = Number(args[++i]);
                else if (arg.charAt(0) === "-" && !path) throw new Error("unknown option " + arg);
                else if (!path) path = arg;
                else inferiorArgs.push(arg);
            }
            if (timeout === null) timeout = batch ? 30000 : 0;
            if (!path || !(timeout >= 0 && timeout <= 2147483647 && timeout === Math.floor(timeout))) throw new Error(usage);
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
        } catch (error) {
            io.output("Error: " + error.message + "\n"); return 1;
        } finally { try { if (image) image.destroy(); } finally { io.destroy(); } }
    }
    root.KernelDebuggerCommands = {main: main, UI: UI, words: words, hex: hex};
}(this));
