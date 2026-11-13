/* Declarative ABI frames shared by bootstrap emission and ELF debug linking.
 * All instruction positions come from macro assembly, never guessed lengths.
 * Existing snapshots are accepted only if their frame boundaries match the
 * same emitted plan. Their payload need not be modified or rebuilt. */
(function (root) {
    var WORD_BYTES = 4, FRAME_HEADER_WORDS = 2;
    var PUSH = {ebx: "pushEbx", esi: "pushEsi", edi: "pushEdi"};
    var POP = {ebx: "popEbx", esi: "popEsi", edi: "popEdi"};
    function bootstrapPlan() {
        return {locals: ["imageBase", "symbolPointer", "heapBase"],
            saved: ["ebx", "esi", "edi"], localsFirst: true};
    }
    function bridgePlan() { return {locals: ["alignmentPad"], saved: ["ebx"], localsFirst: false}; }
    function localIndex(plan, name) {
        for (var i = 0; i < plan.locals.length; i++) if (plan.locals[i] === name) return i;
        throw new Error("unknown snapshot frame local " + name);
    }
    function begin(assembler, plan) {
        var frame = {start: assembler.length, cfi: [], plan: plan};
        assembler.pushEbp(); frame.pushedFrame = assembler.length;
        assembler.movEbpEsp(); frame.establishedFrame = assembler.length;
        if (plan.localsFirst && plan.locals.length) assembler.subEspImmediate(plan.locals.length * WORD_BYTES);
        for (var i = 0; i < plan.saved.length; i++) {
            var reg = plan.saved[i]; if (!PUSH[reg]) throw new Error("unsupported saved register " + reg);
            assembler[PUSH[reg]]();
            frame.cfi.push({kind: "save", register: reg, offset: assembler.length,
                words: FRAME_HEADER_WORDS + (plan.localsFirst ? plan.locals.length : 0) + i + 1});
        }
        if (!plan.localsFirst && plan.locals.length) assembler.subEspImmediate(plan.locals.length * WORD_BYTES);
        frame.bodyStart = assembler.length; return frame;
    }
    function end(assembler, frame) {
        var plan = frame.plan;
        frame.epilogueStart = assembler.length;
        if (!plan.localsFirst && plan.locals.length) assembler.addEspImmediate(plan.locals.length * WORD_BYTES);
        for (var i = plan.saved.length - 1; i >= 0; i--) {
            var reg = plan.saved[i]; assembler[POP[reg]]();
            frame.cfi.push({kind: "restore", register: reg, offset: assembler.length});
        }
        assembler.leave(); frame.leftFrame = assembler.length;
        assembler.ret(); frame.end = assembler.length;
    }
    function absolute(frame, address) {
        var result = {start: address + frame.start, end: address + frame.end,
            pushedFrame: address + frame.pushedFrame, establishedFrame: address + frame.establishedFrame,
            leftFrame: address + frame.leftFrame, cfi: []};
        for (var i = 0; i < frame.cfi.length; i++) {
            var event = frame.cfi[i];
            result.cfi.push({kind: event.kind, register: event.register,
                words: event.words, offset: address + event.offset});
        }
        return result;
    }
    function describe(bytes, plan, Assembler) {
        var template = new Assembler(false), frame = begin(template, plan);
        end(template, frame); template.resolveLabels();
        var tailLength = template.bytes.length - frame.epilogueStart;
        var shift = bytes.length - template.bytes.length, i;
        if (shift < 0) throw new Error("snapshot bootstrap is shorter than its ABI frame");
        for (i = 0; i < frame.bodyStart; i++) {
            if (bytes[i] !== template.bytes[i]) throw new Error("unsupported snapshot ABI prologue; refusing guessed CFI");
        }
        for (i = 0; i < tailLength; i++) {
            if (bytes[bytes.length - tailLength + i] !== template.bytes[frame.epilogueStart + i]) {
                throw new Error("unsupported snapshot ABI epilogue; refusing guessed CFI");
            }
        }
        for (i = 0; i < frame.cfi.length; i++) if (frame.cfi[i].kind === "restore") frame.cfi[i].offset += shift;
        frame.epilogueStart += shift; frame.leftFrame += shift; frame.end = bytes.length;
        return frame;
    }
    function describeBootstrap(bytes, Assembler) { return describe(bytes, bootstrapPlan(), Assembler); }
    var api = {bootstrapPlan: bootstrapPlan, bridgePlan: bridgePlan, localIndex: localIndex,
        begin: begin, end: end, absolute: absolute, describe: describe, describeBootstrap: describeBootstrap};
    root.GuestVMSnapshotFrames = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
