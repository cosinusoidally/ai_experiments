/* Reader for the DWARF4 subset produced by kernel_dwarf.js. Unsupported
 * forms/operations fail explicitly; no producer-specific guessed frame sizes. */
(function (root) {
    var D = root.GuestVMKernelDWARF.constants, A = D.attr, F = D.form;
    var dwarfRegisters = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi", "eip"];
    function copy(object) { var out = {}; for (var k in object) if (object.hasOwnProperty(k)) out[k] = object[k]; return out; }
    function DebugInfo(image) {
        this.image = image; this.dies = {}; this.functions = []; this.rows = [];
        this.files = [""]; this.frames = []; this.unitBase = 0;
        this.parseInfo(); this.parseLines(); this.parseFrames();
    }
    DebugInfo.prototype.parseInfo = function () {
        var r = this.image.section(".debug_info"), a = this.image.section(".debug_abbrev");
        var size = r.u32(), end = size + 4;
        if (end !== r.length || r.u16() !== 4 || r.u32() !== 0 || r.u8() !== 4) throw new Error("unsupported DWARF compilation unit");
        var abbrevs = {}, code;
        while ((code = a.uleb())) {
            var definition = {tag: a.uleb(), children: a.u8(), fields: []}, attr, form;
            while ((attr = a.uleb()) | (form = a.uleb())) definition.fields.push({attr: attr, form: form});
            abbrevs["$" + code] = definition;
        }
        var parents = [], self = this;
        function readValue(form) {
            if (form === F.addr || form === F.data4 || form === F.ref4 || form === F.secOffset) return r.u32();
            if (form === F.data1) return r.u8();
            if (form === F.data2) return r.u16();
            if (form === F.string) return r.string();
            if (form === F.exprloc) { var length = r.uleb(), bytes = r.view(r.pos, length); r.pos += length; return bytes; }
            throw new Error("unsupported DWARF form " + form);
        }
        while (r.pos < end) {
            var offset = r.pos; code = r.uleb();
            if (!code) { parents.pop(); continue; }
            definition = abbrevs["$" + code];
            if (!definition) throw new Error("unknown DWARF abbreviation " + code);
            var die = {offset: offset, tag: definition.tag, attrs: {}, parent: parents.length ? parents[parents.length - 1] : null, children: []};
            for (var i = 0; i < definition.fields.length; i++) {
                var field = definition.fields[i]; die.attrs["$" + field.attr] = readValue(field.form);
            }
            if (die.parent) die.parent.children.push(die);
            self.dies["$" + offset] = die;
            if (die.tag === D.tag.compileUnit) self.unitBase = die.attrs["$" + A.lowPC] || 0;
            if (die.tag === D.tag.subprogram && die.attrs.hasOwnProperty("$" + A.lowPC)) self.functions.push(die);
            if (definition.children) parents.push(die);
        }
        this.functions.sort(function (x, y) { return x.attrs["$" + A.lowPC] - y.attrs["$" + A.lowPC]; });
    };
    DebugInfo.prototype.attribute = function (die, attr) {
        for (var limit = 0; die && limit < 8; limit++) {
            if (die.attrs.hasOwnProperty("$" + attr)) return die.attrs["$" + attr];
            die = this.dies["$" + die.attrs["$" + A.abstractOrigin]];
        }
        return undefined;
    };
    DebugInfo.prototype.name = function (die) { return this.attribute(die, A.name) || "<unnamed>"; };
    DebugInfo.prototype.functionAt = function (pc) {
        var low = 0, high = this.functions.length;
        while (low < high) { var mid = (low + high) >>> 1;
            if (this.functions[mid].attrs["$" + A.lowPC] <= pc) low = mid + 1; else high = mid; }
        if (low === 0) return null;
        var fn = this.functions[low - 1];
        return fn && pc < fn.attrs["$" + A.lowPC] + fn.attrs["$" + A.highPC] ? fn : null;
    };
    DebugInfo.prototype.parseLines = function () {
        var r = this.image.section(".debug_line"), end = r.u32() + 4;
        if (end !== r.length || r.u16() !== 4) throw new Error("unsupported line table");
        var headerLength = r.u32(), headerEnd = r.pos + headerLength;
        var minimum = r.u8(), operations = r.u8(); r.u8();
        var lineBase = r.u8(); if (lineBase & 128) lineBase -= 256;
        var range = r.u8(), opcodeBase = r.u8(), counts = [0], i;
        if (minimum !== 1 || operations !== 1 || !range) throw new Error("unsupported line instruction policy");
        for (i = 1; i < opcodeBase; i++) counts.push(r.u8());
        if (r.string() !== "") throw new Error("kernel line directory tables must be empty");
        var filename;
        while ((filename = r.string())) { this.files.push(filename); r.uleb(); r.uleb(); r.uleb(); }
        if (r.pos !== headerEnd) throw new Error("invalid line header length");
        var pc = 0, line = 1, file = 1, column = 0, self = this;
        function emit(ended) { self.rows.push({pc: pc, line: line, file: self.files[file], column: column, ended: ended}); }
        while (r.pos < end) {
            var op = r.u8();
            if (op === D.line.extended) {
                var bytes = r.uleb(), extensionEnd = r.pos + bytes, ext = r.u8();
                if (ext === D.line.setAddress) pc = r.u32();
                else if (ext === D.line.endSequence) { emit(true); pc = 0; line = 1; file = 1; column = 0; }
                else throw new Error("unsupported line extension " + ext);
                if (r.pos !== extensionEnd) throw new Error("invalid extended line length");
            } else if (op >= opcodeBase) {
                var adjusted = op - opcodeBase; pc += Math.floor(adjusted / range); line += lineBase + adjusted % range; emit(false);
            } else if (op === D.line.copy) emit(false);
            else if (op === D.line.advancePC) pc += r.uleb();
            else if (op === D.line.advanceLine) line += r.sleb();
            else if (op === D.line.setFile) file = r.uleb();
            else if (op === D.line.setColumn) column = r.uleb();
            else throw new Error("unsupported line opcode " + op);
        }
        /* Stable order for duplicate PCs matters: a new function's first row
         * follows the prior function's end-sequence row at the same address. */
        for (i = 0; i < this.rows.length; i++) this.rows[i].order = i;
        this.rows.sort(function (x, y) { return x.pc - y.pc || x.order - y.order; });
    };
    DebugInfo.prototype.lineAt = function (pc) {
        var lo = 0, hi = this.rows.length;
        while (lo < hi) { var mid = (lo + hi) >>> 1; if (this.rows[mid].pc <= pc) lo = mid + 1; else hi = mid; }
        if (lo === 0) return null;
        var row = this.rows[lo - 1]; return row && !row.ended ? row : null;
    };
    DebugInfo.prototype.resolve = function (spec) {
        var addresses = [], seen = {}, match = root.KernelDebuggerFormat.sourceLocation(spec), i;
        if (spec.charAt(0) === "*") {
            var address = Number(spec.substring(1));
            if (!(address > 0 && address <= 0xffffffff && address === Math.floor(address))) throw new Error("invalid breakpoint address");
            return [address];
        }
        if (match) {
            for (i = 0; i < this.rows.length; i++) {
                var row = this.rows[i];
                if (!row.ended && row.line === match.line && (row.file === match.file || row.file.substring(row.file.length - match.file.length - 1) === "/" + match.file)) {
                    if (!seen["$" + row.pc]) { addresses.push(row.pc); seen["$" + row.pc] = true; }
                }
            }
        } else {
            for (i = 0; i < this.functions.length; i++) {
                var fn = this.functions[i];
                if (this.name(fn) === spec) {
                    var begin = fn.attrs["$" + A.lowPC], end = begin + fn.attrs["$" + A.highPC];
                    /* Skip the synthetic entry row for a named breakpoint.
                     * Raw *ADDRESS breakpoints retain exact entry semantics. */
                    var chosen = begin;
                    for (var j = 0; j < this.rows.length; j++) if (!this.rows[j].ended && this.rows[j].pc > begin && this.rows[j].pc < end) { chosen = this.rows[j].pc; break; }
                    if (!seen["$" + chosen]) { addresses.push(chosen); seen["$" + chosen] = true; }
                }
                for (var childIndex = 0; childIndex < fn.children.length; childIndex++) {
                    var child = fn.children[childIndex];
                    if (child.tag === D.tag.inlinedSubroutine && this.name(child) === spec) {
                        var inlineStart = child.attrs["$" + A.lowPC];
                        if (!seen["$" + inlineStart]) { addresses.push(inlineStart); seen["$" + inlineStart] = true; }
                    }
                }
            }
        }
        if (!addresses.length) throw new Error("no kernel location for " + spec);
        return addresses;
    };
    DebugInfo.prototype.location = function (die, pc, registers) {
        var offset = this.attribute(die, A.location);
        if (typeof offset !== "number") return {unavailable: "no concrete location (possibly inlined)"};
        var r = this.image.section(".debug_loc"); r.pos = offset;
        var base = this.unitBase;
        while (true) {
            var start = r.u32(), end = r.u32();
            if (!start && !end) return {unavailable: "optimized out or not initialized here"};
            if (start === 0xffffffff) { base = end; continue; }
            var bytes = r.u16(), expr = r.view(r.pos, bytes); r.pos += bytes;
            if (pc < base + start || pc >= base + end) continue;
            var op = expr.u8(), home;
            if (op >= D.op.reg0 && op < D.op.reg0 + dwarfRegisters.length) home = {register: dwarfRegisters[op - D.op.reg0]};
            else if (op === D.op.fbreg) {
                var owner = die.parent, frame = this.attribute(owner, A.frameBase);
                if (!frame || frame.length !== 1 || frame.io.ffi.peek8(frame.address) !== D.op.regEBP) throw new Error("unsupported frame base expression");
                home = {address: (registers.ebp + expr.sleb()) >>> 0};
            } else return {unavailable: "unsupported DWARF location opcode " + op};
            if (expr.pos !== expr.length) return {unavailable: "unsupported compound location expression"};
            return home;
        }
    };
    DebugInfo.prototype.parseFrames = function () {
        var r = this.image.section(".debug_frame"), cies = {};
        while (r.pos < r.length) {
            var offset = r.pos, length = r.u32(), end = r.pos + length;
            if (!length) continue;
            r.check(r.pos, length); var cie = r.u32();
            if (cie === 0xffffffff) {
                if (r.u8() !== 1 || r.string() !== "") throw new Error("unsupported CIE");
                var codeAlignment = r.uleb(), dataAlignment = r.sleb(), returnRegister = r.u8();
                if (codeAlignment !== 1 || dataAlignment !== -4 || returnRegister !== D.reg.eip) throw new Error("unsupported i386 CFI alignment");
                cies["$" + offset] = {instructions: r.view(r.pos, end - r.pos)};
            } else {
                var start = r.u32(), size = r.u32(), common = cies["$" + cie];
                if (!common) throw new Error("unknown CIE reference");
                this.frames.push({start: start, end: start + size, cie: common, instructions: r.view(r.pos, end - r.pos)});
            }
            r.pos = end;
        }
    };
    function cloneState(state) { return {cfaRegister: state.cfaRegister, cfaOffset: state.cfaOffset, rules: copy(state.rules)}; }
    function applyCFI(reader, initialPC, target, state, initialRules) {
        reader.pos = 0; var pc = initialPC, stack = [];
        while (reader.pos < reader.length) {
            var op = reader.u8(), primary = op & 192, reg, advance;
            if (primary === 64 || op === D.cfi.advanceLoc4) {
                advance = primary === 64 ? op & 63 : reader.u32();
                pc += advance; if (pc > target) break;
            } else if (primary === D.cfi.offset) state.rules["$" + (op & 63)] = {offset: reader.uleb() * -4};
            else if (primary === D.cfi.restore) state.rules["$" + (op & 63)] = initialRules["$" + (op & 63)];
            else if (op === D.cfi.defCFA) { state.cfaRegister = reader.uleb(); state.cfaOffset = reader.uleb(); }
            else if (op === D.cfi.defCFAOffset) state.cfaOffset = reader.uleb();
            else if (op === D.cfi.defCFARegister) state.cfaRegister = reader.uleb();
            else if (op === D.cfi.sameValue) { reg = reader.uleb(); state.rules["$" + reg] = {same: true}; }
            else if (op === D.cfi.rememberState) stack.push(cloneState(state));
            else if (op === D.cfi.restoreState) {
                var restored = stack.pop(); if (!restored) throw new Error("unbalanced CFI restore");
                state.cfaRegister = restored.cfaRegister; state.cfaOffset = restored.cfaOffset; state.rules = restored.rules;
            } else if (op !== 0) throw new Error("unsupported CFI opcode " + op);
        }
    }
    DebugInfo.prototype.unwind = function (pc, registers, target) {
        var fde = null;
        for (var i = 0; i < this.frames.length; i++) if (this.frames[i].start <= pc && pc < this.frames[i].end) { fde = this.frames[i]; break; }
        if (!fde) return null;
        var state = {rules: {}}, caller = {}, key;
        applyCFI(fde.cie.instructions, 0, Infinity, state, {});
        var initial = copy(state.rules);
        applyCFI(fde.instructions, fde.start, pc, state, initial);
        var cfaName = dwarfRegisters[state.cfaRegister];
        if (!cfaName || registers[cfaName] === undefined) throw new Error("CFI requires unavailable register");
        var cfa = (registers[cfaName] + state.cfaOffset) >>> 0;
        for (i = 0; i < dwarfRegisters.length; i++) {
            key = dwarfRegisters[i]; var rule = state.rules["$" + i];
            if (rule && rule.same && registers[key] !== undefined) caller[key] = registers[key];
            else if (rule && rule.offset !== undefined) caller[key] = target.readWord((cfa + rule.offset) >>> 0);
        }
        caller.esp = cfa; return caller.eip ? caller : null;
    };
    DebugInfo.attributes = A; root.KernelDebuggerDWARF = DebugInfo;
}(this));
