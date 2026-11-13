/* Target state machine and breakpoint ownership, independent of command UI. */
(function (root) {
    var TRAP = root.KernelDebuggerLinux.signals.trap, BREAK_BYTE = 0xcc;
    function Engine(target, image, debug, options) {
        this.target = target; this.image = image; this.debug = debug;
        this.options = options; this.groups = []; this.sites = {}; this.nextID = 1;
        this.args = []; this.state = "not started"; this.pendingSignal = 0;
        this.interruptRequested = false;
        this.hit = null; this.selectedFrame = 0; this.lastEvent = null;
    }
    Engine.prototype.addBreakpoint = function (spec, temporary) {
        var addresses;
        try { addresses = typeof spec === "string" ? this.debug.resolve(spec) : spec; }
        catch (error) { throw new Error("resolving breakpoint: " + error.message); }
        var group = {id: this.nextID++, spec: typeof spec === "string" ? spec : "temporary", addresses: addresses, temporary: !!temporary};
        this.groups.push(group);
        for (var i = 0; i < addresses.length; i++) {
            var key = "$" + addresses[i], site = this.sites[key];
            if (!site) site = this.sites[key] = {address: addresses[i], owners: [], installed: false};
            site.owners.push(group.id);
            if (this.target.pid && this.state === "stopped" && this.hit !== site.address) this.install(site);
        }
        return group;
    };
    Engine.prototype.install = function (site) {
        if (!site.installed) {
            site.original = this.target.readByte(site.address);
            if (site.original === BREAK_BYTE) throw new Error("target already contains int3 at breakpoint address");
            this.target.writeByte(site.address, BREAK_BYTE); site.installed = true;
        }
    };
    Engine.prototype.removeBreakpoint = function (id) {
        var index = -1, i;
        for (i = 0; i < this.groups.length; i++) if (this.groups[i].id === id) index = i;
        if (index < 0) throw new Error("unknown breakpoint " + id);
        var group = this.groups[index]; this.groups.splice(index, 1);
        for (i = 0; i < group.addresses.length; i++) {
            var key = "$" + group.addresses[i], site = this.sites[key];
            for (var j = site.owners.length - 1; j >= 0; j--) if (site.owners[j] === id) site.owners.splice(j, 1);
            if (!site.owners.length) {
                if (site.installed && this.target.pid) this.target.writeByte(site.address, site.original);
                delete this.sites[key];
            }
        }
    };
    Engine.prototype.clearTemporary = function () {
        for (var i = this.groups.length - 1; i >= 0; i--) if (this.groups[i].temporary) this.removeBreakpoint(this.groups[i].id);
    };
    Engine.prototype.record = function (event, expectedTrap) {
        this.lastEvent = event; this.selectedFrame = 0; this.hit = null;
        if (event.kind !== "stopped") {
            this.state = event.kind; this.pendingSignal = 0; this.interruptRequested = false;
            for (var key in this.sites) if (this.sites.hasOwnProperty(key)) this.sites[key].installed = false;
            return event;
        }
        this.state = "stopped"; this.pendingSignal = event.signal;
        if (event.timeout) this.pendingSignal = 0;
        if (this.interruptRequested && event.signal === root.KernelDebuggerLinux.signals.interrupt) {
            this.pendingSignal = 0; this.interruptRequested = false; event.interrupted = true;
        }
        var registers = this.target.readRegisters(), site = this.sites["$" + ((registers.eip - 1) >>> 0)];
        if (event.signal === TRAP && site && site.installed) {
            this.target.writeByte(site.address, site.original); site.installed = false;
            registers.eip = site.address; this.target.writeRegisters(registers);
            this.hit = site.address; this.pendingSignal = 0;
            event.breakpoint = site.owners[0]; event.temporary = true;
            for (var i = 0; i < this.groups.length; i++) {
                var group = this.groups[i];
                if (!group.temporary) for (var j = 0; j < site.owners.length; j++) {
                    if (site.owners[j] === group.id) { event.breakpoint = group.id; event.temporary = false; }
                }
            }
        } else if (event.signal === TRAP && expectedTrap) this.pendingSignal = 0;
        event.pc = registers.eip; return event;
    };
    Engine.prototype.wait = function (expectedTrap) {
        this.state = "running";
        var started = new Date().getTime(), event;
        while (!(event = this.target.wait(true))) {
            if (this.options.timeout > 0 && new Date().getTime() - started > this.options.timeout) {
                /* Leave an inspectable, stopped child on timeout. */
                this.target.checked("kill", [this.target.pid, root.KernelDebuggerLinux.signals.stop]);
                event = this.target.wait(false); event.timeout = true; break;
            }
            if (this.options.runningInput) this.options.runningInput();
            else this.target.call("poll", [0, 0, 10]);
        }
        return this.record(event, expectedTrap);
    };
    Engine.prototype.start = function () {
        if (this.target.pid) throw new Error("terminate the existing inferior before restarting");
        for (var old in this.sites) if (this.sites.hasOwnProperty(old)) this.sites[old].installed = false;
        var event = this.target.launch(this.image.path, this.args);
        if (event.kind !== "stopped") {
            this.record(event, false);
            throw new Error("inferior could not start (exit " + event.code +
                "; 126 means ptrace TRACEME was denied, 127 means execv failed)");
        }
        this.record(event, true);
        for (var key in this.sites) if (this.sites.hasOwnProperty(key)) this.install(this.sites[key]);
        return this.resume(false);
    };
    Engine.prototype.requireStopped = function () {
        if (!this.target.pid || this.state !== "stopped") throw new Error("inferior is not stopped");
    };
    Engine.prototype.interrupt = function () {
        if (this.state !== "running") throw new Error("inferior is not running");
        this.interruptRequested = true; this.target.interrupt();
    };
    Engine.prototype.resume = function (step, signal) {
        this.requireStopped();
        var delivery = signal === undefined ? this.pendingSignal : signal, event;
        if (this.hit !== null) {
            var address = this.hit;
            this.target.resume(true, delivery); event = this.wait(true);
            var site = this.sites["$" + address];
            if (site && this.target.pid) this.install(site);
            if (event.kind !== "stopped" || this.pendingSignal || event.breakpoint || event.timeout || step) return event;
            delivery = 0;
        }
        this.target.resume(step, delivery); return this.wait(step);
    };
    Engine.prototype.until = function (addresses, expectedStack) {
        this.addBreakpoint(addresses, true);
        var started = new Date().getTime();
        try {
            while (true) {
                var event = this.resume(false);
                if (expectedStack === undefined || event.kind !== "stopped" || !event.temporary ||
                    event.timeout || this.target.readRegisters().esp === expectedStack) return event;
                /* The same return PC can occur in a deeper recursive call.
                 * Keep the breakpoint until the intended activation returns. */
                if (this.options.timeout > 0 && new Date().getTime() - started > this.options.timeout) throw new Error("temporary breakpoint activation timed out");
            }
        } finally { this.clearTemporary(); }
    };
    Engine.prototype.frames = function () {
        this.requireStopped(); var frames = [], registers = this.target.readRegisters(), seen = {};
        for (var i = 0; i < 64 && registers.eip; i++) {
            var pc = (registers.eip - (i ? 1 : 0)) >>> 0;
            var key = "$" + registers.eip + ":" + registers.esp;
            if (seen[key]) throw new Error("cyclic native unwind"); seen[key] = true;
            frames.push({registers: registers, pc: pc, fn: this.debug.functionAt(pc), line: this.debug.lineAt(pc)});
            var caller;
            try { caller = this.debug.unwind(pc, registers, this.target); }
            catch (error) { frames[frames.length - 1].unwindError = error.message; break; }
            if (!caller) break; registers = caller;
        }
        return frames;
    };
    Engine.prototype.frame = function () {
        if (this.selectedFrame === 0) {
            this.requireStopped(); var registers = this.target.readRegisters(), pc = registers.eip;
            return {registers: registers, pc: pc, fn: this.debug.functionAt(pc), line: this.debug.lineAt(pc)};
        }
        var frame = this.frames()[this.selectedFrame];
        if (!frame) throw new Error("selected frame no longer exists"); return frame;
    };
    Engine.prototype.finish = function () {
        this.requireStopped(); var registers = this.target.readRegisters();
        var caller = this.debug.unwind(registers.eip, registers, this.target);
        if (!caller) throw new Error("no unwind information for current function");
        return this.until([caller.eip], caller.esp);
    };
    Engine.prototype.sourceStep = function (over) {
        this.requireStopped(); var initial = this.target.readRegisters(), row = this.debug.lineAt(initial.eip), event;
        for (var count = 0; count < this.options.stepLimit; count++) {
            if (over) {
                var before = this.target.readRegisters(), target = this.target, sites = this.sites;
                var instruction = root.KernelDebuggerX86.decode(function (address) {
                    var site = sites["$" + address]; return site && site.installed ? site.original : target.readByte(address);
                }, before.eip);
                if (instruction.text.substring(0, 5) === "call ") event = this.until([before.eip + instruction.length], before.esp);
                else event = this.resume(true);
            } else event = this.resume(true);
            if (event.kind !== "stopped" || this.pendingSignal || event.breakpoint && !event.temporary || event.timeout) return event;
            var now = this.target.readRegisters(), current = this.debug.lineAt(now.eip);
            if (!row || !current || current.file !== row.file || current.line !== row.line) return event;
        }
        throw new Error("source step reached its instruction limit; inferior remains stopped");
    };
    Engine.prototype.variable = function (name) {
        var frame = this.frame(), A = root.KernelDebuggerDWARF.attributes;
        if (!frame.fn) throw new Error("no kernel variables in selected frame");
        for (var i = 0; i < frame.fn.children.length; i++) {
            var die = frame.fn.children[i];
            if (this.debug.name(die) === name) return {die: die, frame: frame,
                home: this.debug.location(die, frame.pc, frame.registers)};
        }
        throw new Error("unknown variable " + name);
    };
    Engine.prototype.value = function (binding) {
        var home = binding.home;
        if (home.unavailable) throw new Error(home.unavailable);
        if (home.register) {
            if (binding.frame.registers[home.register] === undefined) throw new Error("register unavailable in this frame");
            return binding.frame.registers[home.register];
        }
        return this.target.readWord(home.address);
    };
    Engine.prototype.setVariable = function (name, value) {
        var binding = this.variable(name), home = binding.home;
        if (home.unavailable) throw new Error(home.unavailable);
        if (home.register) {
            if (this.selectedFrame) throw new Error("register writes require frame 0");
            var registers = this.target.readRegisters(); registers[home.register] = value >>> 0; this.target.writeRegisters(registers);
        } else this.target.writeWord(home.address, value);
    };
    root.KernelDebuggerEngine = Engine;
}(this));
