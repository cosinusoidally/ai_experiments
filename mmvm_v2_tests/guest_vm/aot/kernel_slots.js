/* Stack-home allocation metadata for shared kernel IR. Logical locals and
 * register selection stay unchanged; backends may reuse nonoverlapping stack
 * homes without introducing runtime transfers or a new calling convention. */
(function (root) {
    var WORD_INDEX_SHIFT = 5;
    var BITS_PER_WORD = 1 << WORD_INDEX_SHIFT;
    var LOCAL_PREFERENCE_PREFIX = "local:";
    function allocate(fn, buildFlow) {
        var progress = {phase: "control-flow construction"};
        try {
            return allocateStorage(fn, buildFlow, progress);
        } catch (error) {
            error.message = "kernel storage " + fn.name + " (" + progress.phase +
                "): " + error.message;
            throw error;
        }
    }
    function allocateStorage(fn, buildFlow, progress) {
        if (typeof buildFlow !== "function") {
            throw new TypeError("kernel storage allocation requires a control-flow builder");
        }
        var names = fn.locals, count = names.length;
        if (!count) return;
        var words = (count + BITS_PER_WORD - 1) >>> WORD_INDEX_SHIFT;
        var flow = buildFlow(fn.body), blocks = flow.blocks;
        var info = {}, first = [], last = [], position = 0, i, j;
        function bits() {
            var result = [], word = 0;
            while (word < words) result[word++] = 0;
            return result;
        }
        function include(set, local) {
            set[local >>> WORD_INDEX_SHIFT] |= 1 << (local & (BITS_PER_WORD - 1));
        }
        function touch(local, at) {
            if (first[local] === undefined || at < first[local]) first[local] = at;
            if (last[local] === undefined || at > last[local]) last[local] = at;
        }
        function reads(node, set, opaque, defined) {
            if (!node || typeof node !== "object") return;
            if (typeof node.length === "number") {
                var item = 0;
                while (item < node.length) reads(node[item++], set, opaque, defined);
                return;
            }
            if (node.op === "local_i32" || (opaque && node.op === "set_local")) {
                if (!(defined[node.index >>> WORD_INDEX_SHIFT] &
                        (1 << (node.index & (BITS_PER_WORD - 1))))) include(set, node.index);
                touch(node.index, position);
            }
            /* Inlined expression bodies have private return edges. Treat all
             * their reads AND writes as simultaneous uses, not as definitions
             * that necessarily execute on every path through the expression. */
            opaque = opaque || node.op === "inline_call_i32";
            var key;
            for (key in node) {
                if (Object.prototype.hasOwnProperty.call(node, key)) {
                    reads(node[key], set, opaque, defined);
                }
            }
        }
        function record(node, block) {
            reads(node, block.use, false, block.def);
            if (node.op === "set_local") {
                include(block.def, node.index);
                touch(node.index, position);
            }
            position++;
        }
        progress.phase = "use/definition discovery";
        for (i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            var data = {use: bits(), def: bits(), input: bits(), output: bits(),
                start: position, end: position, successors: []};
            info[block.id] = data;
            for (j = 0; j < block.statements.length; j++) record(block.statements[j], data);
            var edge = block.terminator;
            if (edge.kind === "branch") {
                record(edge.test, data);
                data.successors = [edge.consequent.id, edge.alternate.id];
            } else if (edge.kind === "return") record(edge.statement, data);
            else if (edge.kind === "jump") data.successors = [edge.target.id];
            data.end = position++;
        }
        /* Reverse traversal settles forward regions in one pass. Iteration
         * accounts for backedges and is independent of source variable names. */
        var changed = true, passes = 0;
        progress.phase = "liveness";
        while (changed) {
            changed = false;
            passes++;
            for (i = blocks.length - 1; i >= 0; i--) {
                data = info[blocks[i].id];
                for (j = 0; j < words; j++) {
                    var out = 0, successor = 0;
                    while (successor < data.successors.length) {
                        out |= info[data.successors[successor++]].input[j];
                    }
                    var incoming = data.use[j] | (out & ~data.def[j]);
                    if (incoming !== data.input[j] || out !== data.output[j]) changed = true;
                    data.input[j] = incoming;
                    data.output[j] = out;
                }
            }
        }
        for (i = 0; i < blocks.length; i++) {
            data = info[blocks[i].id];
            for (j = 0; j < words; j++) {
                var present = data.input[j] | data.output[j], bit = 0;
                while (present !== 0) {
                    if (present & 1) {
                        var mask = 1 << bit;
                        if (data.input[j] & mask) touch(j * BITS_PER_WORD + bit, data.start);
                        if (data.output[j] & mask) touch(j * BITS_PER_WORD + bit, data.end);
                    }
                    present = present >>> 1;
                    bit++;
                }
            }
        }
        progress.phase = "interval construction";
        var intervals = [], slots = [], slotNames = [], reserved = {};
        var preferences = fn.registerPreferences || [];
        /* A whole-function register preference remains a dedicated value.
         * It must not become the preference of an unrelated aliased local. */
        for (i = 0; i < preferences.length; i++) {
            if (preferences[i].indexOf(LOCAL_PREFERENCE_PREFIX) === 0) {
                var preferred = Number(preferences[i].substring(LOCAL_PREFERENCE_PREFIX.length));
                if (slots[preferred] === undefined) {
                    slots[preferred] = slotNames.length;
                    reserved[slots[preferred]] = true;
                    slotNames.push(names[preferred]);
                }
            }
        }
        for (i = 0; i < count; i++) {
            if (slots[i] === undefined) intervals.push({local: i,
                first: first[i] === undefined ? position : first[i],
                last: last[i] === undefined ? position : last[i]});
        }
        progress.phase = "interval ordering";
        intervals.sort(function (a, b) { return a.first - b.first || a.local - b.local; });
        progress.phase = "slot assignment";
        var ends = [], slot;
        for (i = 0; i < intervals.length; i++) {
            var interval = intervals[i];
            slot = 0;
            while (slot < slotNames.length &&
                    (reserved[slot] || ends[slot] >= interval.first)) slot++;
            if (slot === slotNames.length) slotNames.push("$storage" + slot);
            ends[slot] = interval.last;
            slots[interval.local] = slot;
        }
        fn.localStorage = {names: names, slots: slots, passes: passes,
            logicalCount: count, storageCount: slotNames.length};
    }
    root.GuestVMKernelSlots = {allocate: allocate};
    if (typeof module !== "undefined" && module.exports) module.exports = root.GuestVMKernelSlots;
}(this));
