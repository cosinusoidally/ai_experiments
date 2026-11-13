/* Linux/i386 tracing boundary. No VM layouts or command syntax belong here. */
(function (root) {
    var P = {traceMe: 0, peekData: 2, pokeData: 5, continueProcess: 7,
        singleStep: 9, getRegisters: 12, setRegisters: 13};
    var S = {interrupt: 2, trap: 5, kill: 9, stop: 19};
    var R = {ebx: 0, ecx: 1, edx: 2, esi: 3, edi: 4, ebp: 5, eax: 6,
        ds: 7, es: 8, fs: 9, gs: 10, orig_eax: 11, eip: 12, cs: 13,
        eflags: 14, esp: 15, ss: 16};
    var WORD = 4, REGISTER_BYTES = 17 * WORD, EINTR = 4, WNOHANG = 1;
    var T = {bytes: 60, localFlags: 12, controls: 17, vtime: 5, vmin: 6,
        signals: 1, canonical: 2, echo: 8, immediate: 0};
    function Linux() {
        this.ffi = new root.GuestVMHostFFI();
        if (!this.ffi.isMMVM) throw new Error("kernel debugger requires the i386 MMVM FFI");
        this.functions = {}; this.allocations = []; this.pid = 0;
        var names = ["ptrace", "fork", "execv", "_exit", "waitpid", "kill",
            "calloc", "free", "strdup", "open", "close", "lseek", "read", "write",
            "poll", "dup2", "setpgid", "__errno_location", "isatty", "tcgetattr", "tcsetattr"];
        for (var i = 0; i < names.length; i++) this.functions[names[i]] = this.ffi.resolve(names[i]);
        this.errnoAddress = this.call("__errno_location", []);
        this.registerBuffer = this.allocate(REGISTER_BYTES);
        this.statusBuffer = this.allocate(WORD);
        this.character = this.allocate(WORD);
        this.pollBuffer = this.allocate(8);
        this.savedTerminal = 0;
    }
    Linux.prototype.call = function (name, args) { return this.ffi.call(this.functions[name], args); };
    Linux.prototype.errno = function () { return this.ffi.peek32(this.errnoAddress); };
    Linux.prototype.checked = function (name, args) {
        var value = this.call(name, args);
        if (value < 0) throw new Error(name + " failed: errno " + this.errno());
        return value;
    };
    Linux.prototype.allocate = function (bytes) {
        var address = this.call("calloc", [bytes || 1, 1]);
        if (!address) throw new Error("native buffer allocation failed");
        this.allocations.push(address); return address;
    };
    Linux.prototype.string = function (value) {
        var address = this.call("strdup", [value]);
        if (!address) throw new Error("native string allocation failed");
        this.allocations.push(address); return address;
    };
    Linux.prototype.release = function (address) {
        for (var i = 0; i < this.allocations.length; i++) {
            if (this.allocations[i] === address) {
                this.call("free", [address]); this.allocations.splice(i, 1); return;
            }
        }
        throw new Error("attempt to release an unowned native buffer");
    };
    Linux.prototype.trace = function (request, address, data) {
        this.ffi.poke32(this.errnoAddress, 0);
        var value = this.call("ptrace", [request, this.pid, address | 0, data | 0]);
        if (value === -1 && this.errno()) {
            throw new Error("ptrace request " + request + " at 0x" + (address >>> 0).toString(16) +
                " failed: errno " + this.errno() + "; target pid " + this.pid);
        }
        return value >>> 0;
    };
    Linux.prototype.launch = function (path, args) {
        if (this.pid) throw new Error("inferior already exists");
        var strings = [this.string(path)], argv = this.allocate((args.length + 2) * WORD), i;
        for (i = 0; i < args.length; i++) strings.push(this.string(args[i]));
        for (i = 0; i < strings.length; i++) this.ffi.poke32(argv + i * WORD, strings[i]);
        var pid = this.call("fork", []);
        if (pid === 0) {
            /* The debugger owns stdin. Targets may write normally, but cannot
             * steal command input. A separate inferior terminal is future work. */
            this.call("setpgid", [0, 0]);
            var input = this.call("open", ["/dev/null", 0, 0]);
            if (input >= 0) { this.call("dup2", [input, 0]); if (input) this.call("close", [input]); }
            if (this.call("ptrace", [P.traceMe, 0, 0, 0]) < 0) this.call("_exit", [126]);
            this.call("execv", [strings[0], argv]); this.call("_exit", [127]);
        }
        for (i = 0; i < strings.length; i++) this.release(strings[i]);
        this.release(argv);
        if (pid < 0) throw new Error("fork failed: errno " + this.errno());
        this.pid = pid; return this.wait(false);
    };
    Linux.prototype.wait = function (nonblocking) {
        var result;
        do { result = this.call("waitpid", [this.pid, this.statusBuffer, nonblocking ? WNOHANG : 0]); }
        while (result < 0 && this.errno() === EINTR);
        if (result < 0) throw new Error("waitpid failed: errno " + this.errno());
        if (!result) return null;
        var status = this.ffi.peek32(this.statusBuffer);
        if ((status & 255) === 127) return {kind: "stopped", signal: (status >>> 8) & 255};
        this.pid = 0;
        if (!(status & 127)) return {kind: "exited", code: (status >>> 8) & 255};
        return {kind: "terminated", signal: status & 127, core: !!(status & 128)};
    };
    Linux.prototype.readRegisters = function () {
        this.trace(P.getRegisters, 0, this.registerBuffer);
        var values = {};
        for (var name in R) if (R.hasOwnProperty(name)) values[name] = this.ffi.peek32(this.registerBuffer + R[name] * WORD) >>> 0;
        return values;
    };
    Linux.prototype.writeRegisters = function (values) {
        /* js_min's poke32 takes a signed C int: normalize the bit pattern
         * before crossing that boundary, including high stack addresses. */
        for (var name in R) if (R.hasOwnProperty(name)) this.ffi.poke32(this.registerBuffer + R[name] * WORD, values[name] | 0);
        this.trace(P.setRegisters, 0, this.registerBuffer);
    };
    Linux.prototype.readWord = function (address) { return this.trace(P.peekData, address, 0); };
    Linux.prototype.writeWord = function (address, value) { this.trace(P.pokeData, address, value); };
    Linux.prototype.readByte = function (address) {
        return (this.readWord(address - (address % WORD)) >>> ((address % WORD) * 8)) & 255;
    };
    Linux.prototype.writeByte = function (address, value) {
        var aligned = address - address % WORD, shift = address % WORD * 8;
        this.writeWord(aligned, (this.readWord(aligned) & ~(255 << shift)) | (value << shift));
    };
    Linux.prototype.resume = function (step, signal) { this.trace(step ? P.singleStep : P.continueProcess, 0, signal || 0); };
    Linux.prototype.interrupt = function () { if (this.pid) this.checked("kill", [this.pid, S.interrupt]); };
    Linux.prototype.terminate = function () {
        if (this.pid) { this.checked("kill", [this.pid, S.kill]); this.wait(false); }
    };
    Linux.prototype.readFile = function (path) {
        var fd = this.checked("open", [path, 0, 0]), address = 0;
        try {
            var length = this.checked("lseek", [fd, 0, 2]);
            if (length > 64 * 1024 * 1024) throw new Error("debugger input exceeds 64 MiB limit");
            this.checked("lseek", [fd, 0, 0]); address = this.allocate(length);
            var done = 0;
            while (done < length) {
                var count = this.call("read", [fd, address + done, length - done]);
                if (count < 0 && this.errno() === EINTR) continue;
                if (count <= 0) throw new Error("short input read: " + path);
                done += count;
            }
            return {address: address, length: length};
        } catch (error) { if (address) this.release(address); throw error; }
        finally { this.call("close", [fd]); }
    };
    Linux.prototype.textFile = function (path) {
        var file = this.readFile(path), text = "";
        try { for (var i = 0; i < file.length; i++) text += String.fromCharCode(this.ffi.peek8(file.address + i)); }
        finally { this.release(file.address); }
        return text;
    };
    Linux.prototype.output = function (text) {
        /* FFI strings are temporary native C strings; write needs explicit
         * byte length. All generated diagnostics/terminal controls are ASCII. */
        var address = this.string(text), done = 0;
        try {
            while (done < text.length) {
                var n = this.call("write", [1, address + done, text.length - done]);
                if (n < 0 && this.errno() === EINTR) continue;
                if (n <= 0) throw new Error("terminal write failed"); done += n;
            }
        } finally { this.release(address); }
    };
    Linux.prototype.inputByte = function (milliseconds) {
        this.ffi.poke32(this.pollBuffer, 0); this.ffi.poke32(this.pollBuffer + 4, 1);
        var ready = this.call("poll", [this.pollBuffer, 1, milliseconds]);
        if (ready < 0 && this.errno() === EINTR) return -2;
        if (ready < 0) throw new Error("terminal poll failed");
        if (!ready) return -2;
        var n = this.call("read", [0, this.character, 1]);
        if (n < 0 && this.errno() === EINTR) return -2;
        if (n < 0) throw new Error("terminal read failed");
        return n ? this.ffi.peek8(this.character) : -1;
    };
    Linux.prototype.terminal = function () {
        if (!this.call("isatty", [0])) return false;
        this.savedTerminal = this.allocate(T.bytes);
        this.checked("tcgetattr", [0, this.savedTerminal]);
        var changed = this.allocate(T.bytes), i;
        for (i = 0; i < T.bytes; i++) this.ffi.poke8(changed + i, this.ffi.peek8(this.savedTerminal + i));
        this.ffi.poke32(changed + T.localFlags, this.ffi.peek32(changed + T.localFlags) & ~(T.signals | T.canonical | T.echo));
        this.ffi.poke8(changed + T.controls + T.vmin, 1);
        this.ffi.poke8(changed + T.controls + T.vtime, 0);
        try { this.checked("tcsetattr", [0, T.immediate, changed]); }
        finally { this.release(changed); }
        return true;
    };
    Linux.prototype.destroy = function () {
        try { this.terminate(); }
        finally {
            if (this.savedTerminal) this.call("tcsetattr", [0, T.immediate, this.savedTerminal]);
            while (this.allocations.length) this.call("free", [this.allocations.pop()]);
        }
    };
    Linux.registers = R; Linux.signals = S;
    root.KernelDebuggerLinux = Linux;
}(this));
