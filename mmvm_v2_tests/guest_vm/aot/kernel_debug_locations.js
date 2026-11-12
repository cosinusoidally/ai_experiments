/* Conservative definite-assignment tracking for stable -O0 stack homes.
 * Only debug builds traverse this pass. A loop body cannot establish a value
 * after the loop (it may execute zero times); both arms must agree at a join.
 * Optimized slot/register ownership needs separate location tracking and must
 * not reuse these rules. Under-reporting is safer than displaying stale data. */
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
    function prepare(body) {
        function sequence(statements, incoming) {
            var defined = incoming, index = 0;
            while (index < statements.length) defined = statement(statements[index++], defined);
            return defined;
        }
        function statement(node, incoming) {
            var outgoing = incoming;
            node.debugDefinedBefore = incoming;
            if (node.op === "set_local") {
                outgoing = copy(incoming); outgoing["$" + node.index] = true;
            } else if (node.op === "block") outgoing = sequence(node.body, incoming);
            else if (node.op === "if") {
                var yes = statement(node.consequent, incoming);
                var no = node.alternate ? statement(node.alternate, incoming) : incoming;
                outgoing = intersect(yes, no);
            } else if (node.op === "while" || node.op === "opcode_dispatch") {
                if (node.body instanceof Array) sequence(node.body, incoming);
                else if (node.body) statement(node.body, incoming);
            }
            node.debugDefinedAfter = outgoing;
            return outgoing;
        }
        sequence(body, {});
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
                    var list = ranges[Number(key.substring(1))], last = list[list.length - 1];
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
