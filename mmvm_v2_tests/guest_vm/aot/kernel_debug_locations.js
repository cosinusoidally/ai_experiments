/* Conservative definite-assignment and physical-slot ownership tracking.
 * Only debug builds traverse this pass. A loop body cannot establish a value
 * after the loop (it may execute zero times); both arms must agree at a join.
 * Optimized loops discard incoming ownership: backedges may have reused slots.
 * Inlined early returns need a richer CFG; those callers deliberately retain
 * unavailable locals. Under-reporting is safer than displaying stale data. */
(function (root) {
    var own = Object.prototype.hasOwnProperty;
    function copy(set) {
        var result = {}, key;
        for (key in set) if (own.call(set, key)) result[key] = true;
        return result;
    }
    function intersect(left, right) {
        var result = {}, key;
        for (key in left) if (own.call(left, key) && right[key]) result[key] = true;
        return result;
    }
    function containsInline(node) {
        if (!node || typeof node !== "object") return false;
        if (node.op === "inline_call_i32") return true;
        var key;
        for (key in node) {
            if (key !== "debugLocation" && own.call(node, key) && containsInline(node[key])) return true;
        }
        return false;
    }
    function prepare(body, slots, optimized) {
        if (optimized && containsInline(body)) return false;
        function slot(index) { return slots ? slots[index] : index; }
        function sequence(statements, incoming) {
            var defined = incoming, index = 0;
            while (index < statements.length) defined = statement(statements[index++], defined);
            return defined;
        }
        function statement(node, incoming) {
            var outgoing = incoming;
            node.debugDefinedBefore = incoming;
            if (node.op === "set_local") {
                outgoing = copy(incoming);
                if (optimized) {
                    var key;
                    for (key in outgoing) {
                        if (own.call(outgoing, key) && slot(Number(key.substring(1))) === slot(node.index)) {
                            delete outgoing[key];
                        }
                    }
                }
                outgoing["$" + node.index] = true;
            } else if (node.op === "block") outgoing = sequence(node.body, incoming);
            else if (node.op === "if") {
                var yes = statement(node.consequent, incoming);
                var no = node.alternate ? statement(node.alternate, incoming) : incoming;
                outgoing = intersect(yes, no);
            } else if (node.op === "while" || node.op === "opcode_dispatch") {
                var loopIncoming = optimized ? {} : incoming;
                node.debugDefinedBefore = loopIncoming;
                if (node.body instanceof Array) sequence(node.body, loopIncoming);
                else if (node.body) statement(node.body, loopIncoming);
                outgoing = loopIncoming;
            }
            node.debugDefinedAfter = outgoing;
            return outgoing;
        }
        sequence(body, {});
        return true;
    }
    function observe(debug, offset, defined) {
        if (defined) debug.availability.push({offset: offset, defined: defined});
    }
    function finish(debug) {
        var ranges = [], index, points = debug.availability;
        for (index = 0; index < debug.locals.length; index++) ranges.push([]);
        for (index = 0; index < points.length; index++) {
            var point = points[index], end = index + 1 < points.length ?
                points[index + 1].offset : debug.bodyEnd;
            if (end <= point.offset) continue;
            var key;
            for (key in point.defined) {
                if (own.call(point.defined, key)) {
                    var list = ranges[Number(key.substring(1))];
                    var last = list.length ? list[list.length - 1] : null;
                    if (last && last.end === point.offset) last.end = end;
                    else list.push({start: point.offset, end: end});
                }
            }
        }
        debug.localRanges = ranges;
        delete debug.availability;
    }
    var api = {prepare: prepare, observe: observe, finish: finish};
    root.GuestVMKernelDebugLocations = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
