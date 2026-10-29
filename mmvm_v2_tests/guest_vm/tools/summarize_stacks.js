/* Summarize the existing read-only stack sampler's JSONL output.
 * Node built-ins only; no VM execution, subprocesses or generated code.
 * node guest_vm/tools/summarize_stacks.js PROFILE.jsonl
 *      [--ancestor SOURCE_PREFIX] [--after-ms COUNT] [--limit COUNT]
 */
(function () {
    var fs = require("fs");
    var args = process.argv.slice(2);
    if (!args.length) throw new Error("expected PROFILE.jsonl [--ancestor PREFIX] [--limit COUNT]");
    var filename = args.shift(), ancestor = "", limit = 20, afterMs = 0;
    while (args.length) {
        var option = args.shift();
        if (option === "--ancestor") {
            if (!args.length) throw new Error("--ancestor requires a source prefix");
            ancestor = args.shift();
        } else if (option === "--after-ms") {
            afterMs = Number(args.shift());
            if (!(afterMs >= 0) || afterMs !== Math.floor(afterMs)) {
                throw new Error("--after-ms requires a nonnegative integer");
            }
        } else if (option === "--limit") {
            limit = Number(args.shift());
            if (!(limit >= 1 && limit <= 100) || limit !== Math.floor(limit)) {
                throw new Error("--limit requires an integer from 1 to 100");
            }
        } else throw new Error("unknown option: " + option);
    }
    var lines = fs.readFileSync(filename, "utf8").split("\n");
    var total = 0, selected = 0, truncated = 0, unknown = 0, beforeWindow = 0;
    var missingTruncated = 0, leaves = {}, inclusive = {}, children = {};
    function count(table, source) {
        var key = "$" + source;
        table[key] = (table[key] || 0) + 1;
    }
    var index = 0;
    while (index < lines.length) {
        var line = lines[index++];
        if (!line) continue;
        var sample = JSON.parse(line);
        if (sample.event !== "stack") continue;
        total++;
        if (sample.elapsedMs < afterMs) {
            beforeWindow++;
            continue;
        }
        if (sample.truncated === true) truncated++;
        else if (sample.truncated !== false) unknown++;
        var stack = sample.stack, ancestorIndex = -1, frameIndex = 0;
        while (frameIndex < stack.length) {
            if (ancestor && stack[frameIndex].source.indexOf(ancestor) === 0) {
                ancestorIndex = frameIndex;
                break;
            }
            frameIndex++;
        }
        if (ancestor && ancestorIndex < 0) {
            if (sample.truncated !== false) missingTruncated++;
            continue;
        }
        selected++;
        if (stack.length) count(leaves, stack[0].source || "<source unavailable>");
        if (ancestor) {
            count(children, ancestorIndex ? stack[ancestorIndex - 1].source ||
                "<source unavailable>" : "<ancestor itself>");
        }
        var seen = {};
        frameIndex = 0;
        while (frameIndex < stack.length) {
            var source = stack[frameIndex++].source || "<source unavailable>";
            if (!seen["$" + source]) {
                seen["$" + source] = true;
                count(inclusive, source);
            }
        }
    }
    function report(title, table) {
        console.log("\n" + title + " (percent of " + selected + " selected samples)");
        var keys = Object.keys(table);
        keys.sort(function (left, right) {
            return table[right] - table[left] || (left < right ? -1 : left > right ? 1 : 0);
        });
        var row = 0;
        while (row < keys.length && row < limit) {
            var key = keys[row++];
            console.log("  " + table[key] + " (" +
                (selected ? table[key] * 100 / selected : 0).toFixed(1) + "%): " +
                key.substring(1).replace(/\s+/g, " "));
        }
    }
    console.log("Stack samples: " + total + "; selected: " + selected +
        "; before window: " + beforeWindow + "; truncated in window: " + truncated +
        "; unknown completeness: " + unknown);
    if (missingTruncated) {
        console.log("WARNING: " + missingTruncated +
            " incomplete stacks lack the requested ancestor; selection may be biased.");
    }
    console.log("Inclusive rows overlap; each source is counted once per sample. " +
        "Source prefixes can conflate functions. Sampled elapsed time is perturbed.");
    if (ancestor) report("Direct child of requested ancestor", children);
    report("Leaf", leaves);
    report("Inclusive", inclusive);
}());
