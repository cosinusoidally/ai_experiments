/* DWARF 4 for the actual i386 kernel graph. Addresses are kernel-relative;
 * explicit relocations let both the ELF packager and a future mmap debugger
 * choose their own load address. This module does not perform host I/O. */
(function (root) {
    var Binary = root.GuestVMDebugBinary;
    if (typeof module !== "undefined" && module.exports) Binary = require("./debug_binary.js");
    var D = {
        tag: {compileUnit: 17, subprogram: 46, formalParameter: 5, variable: 52,
            baseType: 36, inlinedSubroutine: 29},
        attr: {name: 3, location: 2, byteSize: 11, stmtList: 16, lowPC: 17, highPC: 18,
            language: 19, compDir: 27, producer: 37, type: 73, frameBase: 64,
            declFile: 58, declLine: 59, encoding: 62, abstractOrigin: 49,
            callFile: 88, callLine: 89, inline: 32},
        form: {addr: 1, data1: 11, data2: 5, data4: 6, string: 8,
            ref4: 19, secOffset: 23, exprloc: 24},
        op: {reg0: 80, regEBP: 85, fbreg: 145}, languageC: 2,
        line: {copy: 1, advancePC: 2, advanceLine: 3, setFile: 4, setColumn: 5,
            extended: 0, endSequence: 1, setAddress: 2},
        cfi: {advanceLoc4: 4, offset: 128, defCFA: 12, defCFAOffset: 14,
            defCFARegister: 13, restore: 192, rememberState: 10, restoreState: 11, sameValue: 8},
        reg: {edx: 2, ebx: 3, esp: 4, ebp: 5, esi: 6, edi: 7, eip: 8},
        signedEncoding: 5, inlineInlined: 1
    };

    function build(debug, codeLength) {
        var Writer = Binary.Writer, sections = [], files = [], fileNumbers = {};
        var functions = debug.functions, index = 0;
        function fileNumber(filename) {
            var key = "$" + filename;
            if (!fileNumbers[key]) { files.push(filename); fileNumbers[key] = files.length; }
            return fileNumbers[key];
        }
        while (index < functions.length) {
            var fn = functions[index++];
            fileNumber(fn.location.filename);
            var row = 0;
            while (row < fn.lines.length) fileNumber(fn.lines[row++].filename);
        }
        /* Sort filenames, independently of traversal/inlining order. */
        files.sort(); fileNumbers = {};
        for (index = 0; index < files.length; index++) fileNumbers["$" + files[index]] = index + 1;
        function section(name) {
            var s = {name: name, writer: new Writer(), relocations: []};
            sections.push(s); return s;
        }
        function address(s, offset) {
            s.relocations.push(s.writer.bytes.length); s.writer.u32(offset);
        }
        var abbrev = section(".debug_abbrev"), a = abbrev.writer;
        function abbreviation(number, tag, children, attributes) {
            a.uleb(number); a.uleb(tag); a.u8(children ? 1 : 0);
            var i = 0;
            while (i < attributes.length) { a.uleb(attributes[i++]); a.uleb(attributes[i++]); }
            a.uleb(0); a.uleb(0);
        }
        var A = D.attr, F = D.form;
        abbreviation(1, D.tag.compileUnit, true, [A.producer,F.string,A.language,F.data2,
            A.name,F.string,A.compDir,F.string,A.stmtList,F.secOffset,A.lowPC,F.addr,A.highPC,F.data4]);
        abbreviation(2, D.tag.baseType, false, [A.name,F.string,A.byteSize,F.data1,A.encoding,F.data1]);
        abbreviation(3, D.tag.subprogram, true, [A.name,F.string,A.declFile,F.data4,
            A.declLine,F.data4,A.type,F.ref4,A.lowPC,F.addr,A.highPC,F.data4,A.frameBase,F.exprloc]);
        abbreviation(4, D.tag.formalParameter, false, [A.name,F.string,A.type,F.ref4,A.location,F.secOffset]);
        abbreviation(5, D.tag.variable, false, [A.name,F.string,A.type,F.ref4,A.location,F.secOffset]);
        abbreviation(6, D.tag.inlinedSubroutine, false, [A.abstractOrigin,F.ref4,
            A.lowPC,F.addr,A.highPC,F.data4,A.callFile,F.data4,A.callLine,F.data4]);
        abbreviation(7, D.tag.subprogram, true, [A.name,F.string,A.declFile,F.data4,
            A.declLine,F.data4,A.type,F.ref4,A.inline,F.data1]);
        abbreviation(8, D.tag.formalParameter, false, [A.name,F.string,A.type,F.ref4]);
        abbreviation(9, D.tag.variable, false, [A.name,F.string,A.type,F.ref4]);
        abbreviation(10, D.tag.subprogram, true, [A.abstractOrigin,F.ref4,
            A.lowPC,F.addr,A.highPC,F.data4,A.frameBase,F.exprloc]);
        abbreviation(11, D.tag.formalParameter, false, [A.abstractOrigin,F.ref4,A.location,F.secOffset]);
        abbreviation(12, D.tag.variable, false, [A.abstractOrigin,F.ref4,A.location,F.secOffset]);
        a.uleb(0);

        var line = section(".debug_line"), l = line.writer;
        l.u32(0); l.u16(4); var headerLength = l.bytes.length; l.u32(0);
        var headerStart = l.bytes.length;
        l.u8(1); l.u8(1); l.u8(1); l.u8(0); l.u8(1); l.u8(6);
        /* min instruction/max operations/default is_stmt/line_base=0,
         * line_range=1, opcode_base=6. No special opcodes are emitted. */
        l.append([0,1,1,1,1]); l.u8(0); // operand counts, empty directory table
        for (index = 0; index < files.length; index++) {
            l.string(files[index]); l.uleb(0); l.uleb(0); l.uleb(0);
        }
        l.u8(0); l.patch32(headerLength, l.bytes.length - headerStart);
        for (index = 0; index < functions.length; index++) {
            fn = functions[index];
            l.u8(D.line.extended); l.uleb(5); l.u8(D.line.setAddress); address(line, fn.start);
            var pc = fn.start, sourceLine = 1, sourceFile = 1, column = 0;
            var rows = [{offset: fn.start, filename: fn.location.filename,
                line: fn.location.line, column: fn.location.column}].concat(fn.lines);
            for (row = 0; row < rows.length; row++) {
                var location = rows[row], file = fileNumber(location.filename);
                if (file !== sourceFile) { l.u8(D.line.setFile); l.uleb(file); sourceFile = file; }
                if (location.line !== sourceLine) {
                    l.u8(D.line.advanceLine); l.sleb(location.line - sourceLine); sourceLine = location.line;
                }
                if (location.column !== column) {
                    l.u8(D.line.setColumn); l.uleb(location.column); column = location.column;
                }
                if (location.offset !== pc) { l.u8(D.line.advancePC); l.uleb(location.offset - pc); pc = location.offset; }
                l.u8(D.line.copy);
            }
            l.u8(D.line.advancePC); l.uleb(fn.end - pc);
            l.u8(D.line.extended); l.uleb(1); l.u8(D.line.endSequence);
        }
        l.patch32(0, l.bytes.length - 4);

        var locations = section(".debug_loc"), loc = locations.writer;
        function excludeUnavailable(fn, ranges) {
            var result = [], index = 0;
            while (index < ranges.length) {
                var range = ranges[index++], start = range.start, excluded = 0;
                while (excluded < fn.unavailableRanges.length) {
                    var gap = fn.unavailableRanges[excluded++];
                    if (gap.end <= start || gap.start >= range.end) continue;
                    if (gap.start > start) result.push({start: start, end: gap.start});
                    start = Math.max(start, gap.end);
                }
                if (start < range.end) result.push({start: start, end: range.end});
            }
            return result;
        }
        function variableLocation(fn, displacement, ranges, register) {
            ranges = excludeUnavailable(fn, ranges);
            var offset = loc.bytes.length;
            if (ranges.length) {
                /* Entries below relocate to absolute addresses. Override the
                 * CU's nonzero low_pc base, rather than adding it twice. */
                loc.u32(0xffffffff); loc.u32(0);
                var expression = new Writer();
                if (register && register !== "edx") expression.u8(D.op.reg0 + D.reg[register]);
                else { expression.u8(D.op.fbreg); expression.sleb(displacement); }
                var rangeIndex = 0;
                while (rangeIndex < ranges.length) {
                    var range = ranges[rangeIndex++];
                    address(locations, range.start); address(locations, range.end);
                    loc.u16(expression.bytes.length); loc.append(expression.bytes);
                }
            }
            loc.u32(0); loc.u32(0); return offset;
        }
        var info = section(".debug_info"), i = info.writer;
        i.u32(0); i.u16(4); i.u32(0); i.u8(4);
        i.uleb(1); i.string("GuestVM kernel dialect / i386"); i.u16(D.languageC);
        i.string("guest_vm/kernel"); i.string("."); i.u32(0);
        address(info, 0); i.u32(codeLength);
        var scalarType = i.bytes.length;
        i.uleb(2); i.string("kernel_i32"); i.u8(4); i.u8(D.signedEncoding);
        /* Abstract origins have names/types but no concrete machine homes.
         * Inheriting a concrete callee's parameter locations is unsound for
         * inlining, especially if a function is inlined into its own body. */
        var abstractDIEs = {}, abstractBindings = {}, requiredOrigins = {}, originFixups = [];
        for (index = 0; index < functions.length; index++) {
            var requiredIndex = 0;
            while (requiredIndex < functions[index].inlines.length) {
                requiredOrigins["$" + functions[index].inlines[requiredIndex++].name] = true;
            }
        }
        for (index = 0; index < functions.length; index++) {
            fn = functions[index];
            if (!requiredOrigins["$" + fn.name]) continue;
            abstractDIEs["$" + fn.name] = i.bytes.length;
            var bindingDIEs = {parameters: [], locals: []};
            abstractBindings["$" + fn.name] = bindingDIEs;
            i.uleb(7); i.string(fn.name); i.u32(fileNumber(fn.location.filename));
            i.u32(fn.location.line); i.u32(scalarType); i.u8(D.inlineInlined);
            var abstractBinding;
            for (abstractBinding = 0; abstractBinding < fn.parameters.length; abstractBinding++) {
                bindingDIEs.parameters.push(i.bytes.length);
                i.uleb(8); i.string(fn.parameters[abstractBinding]); i.u32(scalarType);
            }
            for (abstractBinding = 0; abstractBinding < fn.locals.length; abstractBinding++) {
                bindingDIEs.locals.push(i.bytes.length);
                i.uleb(9); i.string(fn.locals[abstractBinding]); i.u32(scalarType);
            }
            i.uleb(0);
        }
        for (index = 0; index < functions.length; index++) {
            fn = functions[index];
            var abstractOrigin = abstractDIEs["$" + fn.name];
            bindingDIEs = abstractBindings["$" + fn.name];
            if (abstractOrigin) { i.uleb(10); i.u32(abstractOrigin); }
            else {
                i.uleb(3); i.string(fn.name); i.u32(fileNumber(fn.location.filename));
                i.u32(fn.location.line); i.u32(scalarType);
            }
            address(info, fn.start); i.u32(fn.end - fn.start);
            i.uleb(1); i.u8(D.op.regEBP);
            var binding;
            var parameterRanges = [], rangeStart = fn.bodyStart, unavailable = 0;
            while (unavailable < fn.unavailableRanges.length) {
                var excluded = fn.unavailableRanges[unavailable++];
                if (excluded.start > rangeStart) parameterRanges.push({start: rangeStart, end: excluded.start});
                rangeStart = excluded.end;
            }
            if (rangeStart < fn.bodyEnd) parameterRanges.push({start: rangeStart, end: fn.bodyEnd});
            for (binding = 0; binding < fn.parameters.length; binding++) {
                if (bindingDIEs) { i.uleb(11); i.u32(bindingDIEs.parameters[binding]); }
                else { i.uleb(4); i.string(fn.parameters[binding]); i.u32(scalarType); }
                i.u32(variableLocation(fn, 8 + binding * 4, parameterRanges, fn.argumentRegisters[binding]));
            }
            for (binding = 0; binding < fn.locals.length; binding++) {
                if (bindingDIEs) { i.uleb(12); i.u32(bindingDIEs.locals[binding]); }
                else { i.uleb(5); i.string(fn.locals[binding]); i.u32(scalarType); }
                i.u32(variableLocation(fn, fn.localDisplacements[binding],
                    fn.localRanges ? fn.localRanges[binding] : [], fn.localRegisters[binding]));
            }
            var inlineIndex = 0;
            while (inlineIndex < fn.inlines.length) {
                var inline = fn.inlines[inlineIndex++];
                if (!inline.callLocation || inline.end === inline.start) continue;
                i.uleb(6); originFixups.push({offset: i.bytes.length, name: inline.name});
                i.u32(0); address(info, inline.start); i.u32(inline.end - inline.start);
                i.u32(fileNumber(inline.callLocation.filename)); i.u32(inline.callLocation.line);
            }
            i.uleb(0);
        }
        i.uleb(0); i.patch32(0, i.bytes.length - 4);
        for (index = 0; index < originFixups.length; index++) {
            var fixup = originFixups[index], origin = abstractDIEs["$" + fixup.name];
            if (!origin) throw new Error("missing DWARF inline origin: " + fixup.name);
            i.patch32(fixup.offset, origin);
        }

        /* CFA is ESP+4 at entry and EBP+8 after the emitted frame setup.
         * The frame-pointer rules alone recover caller PC/EBP. Saved general
         * register rules and alternate tail epilogues are added by ABI events. */
        var frame = section(".debug_frame"), c = frame.writer;
        function advanceFrame(from, target) {
            c.u8(D.cfi.advanceLoc4); c.u32(target - from); return target;
        }
        var cie = c.bytes.length;
        c.u32(0); c.u32(0xffffffff); c.u8(1); c.string("");
        c.uleb(1); c.sleb(-4); c.u8(D.reg.eip);
        c.u8(D.cfi.defCFA); c.uleb(D.reg.esp); c.uleb(4);
        c.u8(D.cfi.offset + D.reg.eip); c.uleb(1);
        c.u8(D.cfi.sameValue); c.uleb(D.reg.ebp);
        c.u8(D.cfi.sameValue); c.uleb(D.reg.ebx);
        c.u8(D.cfi.sameValue); c.uleb(D.reg.esi);
        c.u8(D.cfi.sameValue); c.uleb(D.reg.edi);
        c.align(4); c.patch32(cie, c.bytes.length - cie - 4);
        for (index = 0; index < functions.length; index++) {
            fn = functions[index]; var fde = c.bytes.length;
            c.u32(0); c.u32(cie); address(frame, fn.start); c.u32(fn.end - fn.start);
            pc = fn.start;
            pc = advanceFrame(pc, fn.pushedFrame); c.u8(D.cfi.defCFAOffset); c.uleb(8);
            c.u8(D.cfi.offset + D.reg.ebp); c.uleb(2);
            pc = advanceFrame(pc, fn.establishedFrame); c.u8(D.cfi.defCFARegister); c.uleb(D.reg.ebp);
            var eventIndex = 0;
            while (eventIndex < fn.cfi.length) {
                var event = fn.cfi[eventIndex++];
                pc = advanceFrame(pc, event.offset);
                if (event.kind === "save") {
                    c.u8(D.cfi.offset + D.reg[event.register]); c.uleb(event.words);
                } else if (event.kind === "restore") c.u8(D.cfi.restore + D.reg[event.register]);
                else if (event.kind === "remember") c.u8(D.cfi.rememberState);
                else if (event.kind === "resume") c.u8(D.cfi.restoreState);
                else if (event.kind === "leave") {
                    c.u8(D.cfi.defCFA); c.uleb(D.reg.esp); c.uleb(4);
                    c.u8(D.cfi.restore + D.reg.ebp);
                } else throw new Error("unknown kernel CFI event: " + event.kind);
            }
            pc = advanceFrame(pc, fn.leftFrame); c.u8(D.cfi.defCFA); c.uleb(D.reg.esp); c.uleb(4);
            c.u8(D.cfi.restore + D.reg.ebp);
            c.align(4); c.patch32(fde, c.bytes.length - fde - 4);
        }
        var output = [], sIndex = 0;
        while (sIndex < sections.length) {
            var s = sections[sIndex++];
            output.push({name: s.name, bytes: s.writer.bytes, relocations: s.relocations});
        }
        return {sections: output, codeLength: codeLength, functions: functions};
    }
    var api = {build: build, constants: D};
    root.GuestVMKernelDWARF = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
