/* Bounded end-to-end GC workload. The embedding driver supplies structural
 * heap checks; standalone snapshots additionally check the surviving data. */
(function () {
    var slots = [], slotCount = 8, rounds = 24;
    var bufferBytes = 128, transientGraphs = 12;
    var largeView = null, largeSeed = 0, largeBytes = 1024 * 1024 + 32;
    var initialCollections = typeof __guestVMGCStress === "function" ?
        __guestVMGCStress() : 0;
    if (typeof __guestVMGCStress === "function") __guestVMGCStress(50000);

    function bytePattern(seed, index) { return (seed * 17 + index * 13) & 255; }
    function makeGraph(seed) {
        var bytes = Buffer.alloc(bufferBytes), index = 0;
        while (index < bufferBytes) {
            bytes[index] = bytePattern(seed, index);
            index++;
        }
        var root = {seed: seed, bytes: bytes, view: bytes.slice(16, 48),
            values: [seed, seed + 0.25, -seed], wide: "\u0100\ud800" + seed};
        root.self = root;
        root.child = {parent: root, shared: root.values};
        /* Exercise retained capacity and discarded references across the
         * same collections as the rest of the graph, including regrowth. */
        root.history = new Array(32);
        root.history.length = 0;
        root.history.push(seed, {discarded: root.child});
        root.history.length = 1;
        root.history.length = 3;
        root.dictionary = {};
        for (index = 0; index < 48; index++) {
            root.dictionary["field-" + index] = seed + index * 3;
        }
        root.read = function () { return root.values[1]; };
        try {
            throw {seed: seed, parent: root};
        } catch (caught) {
            root.readCaught = function () { return caught; };
        }
        root.detachedArguments = (function (parameter) {
            var saved = arguments;
            delete saved[0];
            saved[0] = seed + 1;
            return {saved: saved, readParameter: function () { return parameter; }};
        }(seed));
        var orphan = Buffer.alloc(32);
        for (index = 0; index < 32; index++) orphan[index] = bytePattern(seed, index);
        root.orphanView = orphan.slice(8, 24);
        var text = "";
        for (index = 0; index < 12; index++) text += "payload-" + seed + ":";
        root.text = text.substring(5, 50);
        return root;
    }
    function checkGraph(root) {
        if (root.self !== root || root.child.parent !== root ||
                root.child.shared !== root.values ||
                root.read() !== root.seed + 0.25 ||
                root.readCaught().seed !== root.seed ||
                root.readCaught().parent !== root ||
                root.detachedArguments.saved[0] !== root.seed + 1 ||
                root.detachedArguments.readParameter() !== root.seed ||
                root.values[0] !== root.seed || root.values[2] !== -root.seed ||
                root.wide.charCodeAt(0) !== 256 ||
                root.wide.charCodeAt(1) !== 55296 || root.text.length !== 45) {
            throw new Error("GC stress: corrupt graph/closure/string for seed " + root.seed);
        }
        for (var index = 0; index < bufferBytes; index++) {
            if (root.bytes[index] !== bytePattern(root.seed, index)) {
                throw new Error("GC stress: corrupt Buffer at seed " + root.seed + ", byte " + index);
            }
        }
        if (root.history.length !== 3 || root.history[0] !== root.seed ||
                1 in root.history || 2 in root.history) {
            throw new Error("GC stress: array truncation/regrowth resurrected an element");
        }
        var seen = 0, expected = 0, name;
        for (name in root.dictionary) {
            if (expected === 7) expected++;
            if (seen === 47) expected = 7;
            if (name !== "field-" + expected) throw new Error("GC stress: dictionary insertion order changed");
            seen++;
            expected++;
        }
        if (seen !== 48) throw new Error("GC stress: dictionary enumeration lost a name");
        if (root.compacting.k20 !== root.seed + 140) {
            throw new Error("GC stress: cached property changed after dictionary regrowth");
        }
        seen = 0;
        for (name in root.compacting) {
            expected = seen < 4 ? seen + 20 : seen - 4;
            if (name !== "k" + expected ||
                    root.compacting[name] !== root.seed + expected * 7) {
                throw new Error("GC stress: sparse dictionary regrowth lost order/data");
            }
            seen++;
        }
        if (seen !== 24) throw new Error("GC stress: sparse dictionary enumeration lost a name");
        for (index = 0; index < 32; index++) {
            if (root.view[index] !== bytePattern(root.seed, index + 16)) {
                throw new Error("GC stress: corrupt shared Buffer view");
            }
        }
        var unit = "payload-" + root.seed + ":";
        for (index = 0; index < root.text.length; index++) {
            if (root.text.charCodeAt(index) !== unit.charCodeAt((index + 5) % unit.length)) {
                throw new Error("GC stress: corrupt rope/substring backing");
            }
        }
        for (index = 0; index < 16; index++) {
            if (root.orphanView[index] !== bytePattern(root.seed, index + 8)) {
                throw new Error("GC stress: orphan Buffer view lost its backing");
            }
        }
        for (index = 0; index < 48; index++) {
            if (root.dictionary["field-" + index] !== root.seed + index * 3) {
                throw new Error("GC stress: corrupt indexed dictionary for seed " + root.seed);
            }
        }
    }
    for (var round = 0; round < rounds; round++) {
        /* Exercise separately owned large data, shared views, zeroing on
         * replacement and collection of old backings without a large live
         * set. Only the small view retains each ArrayBuffer. */
        if (round % 6 === 0) {
            if (round % 12 === 0) {
                largeView = new Uint8Array(new ArrayBuffer(largeBytes)).subarray(16, 32);
            } else largeView = Buffer.alloc(largeBytes).slice(16, 32);
            if (largeView[0] !== 0 || largeView[15] !== 0) {
                throw new Error("GC stress: large backing was not zero initialized");
            }
            largeSeed = round + 1;
            largeView[0] = largeSeed;
            largeView[15] = largeSeed + 7;
        }
        slots[round % slotCount] = makeGraph(round);
        for (var discarded = 0; discarded < transientGraphs; discarded++) {
            makeGraph(1000 + round * transientGraphs + discarded);
        }
        var current = slots[round % slotCount];
        if (current.values.indexOf(current.seed + 0.25, 0.5) !== 1) {
            throw new Error("GC stress: numeric array search changed its input/result");
        }
        current.compacting = {};
        for (var compactKey = 0; compactKey < 24; compactKey++) {
            current.compacting["k" + compactKey] = current.seed + compactKey * 7;
        }
        for (compactKey = 0; compactKey < 20; compactKey++) {
            delete current.compacting["k" + compactKey];
        }
        delete current.dictionary["field-7"];
        if (typeof __gcStressCheckpoint === "function") __gcStressCheckpoint(round);
        if (current.compacting.k20 !== current.seed + 140) {
            throw new Error("GC stress: sparse dictionary did not survive collection");
        }
        for (compactKey = 0; compactKey < 20; compactKey++) {
            current.compacting["k" + compactKey] = current.seed + compactKey * 7;
        }
        current.dictionary["field-7"] = current.seed + 21;
        for (var slot = 0; slot < slots.length; slot++) checkGraph(slots[slot]);
        if (largeView[0] !== largeSeed || largeView[15] !== largeSeed + 7 ||
                largeView[1] !== 0) {
            throw new Error("GC stress: orphan large view lost its backing");
        }
    }
    slots = null;
    largeView = null;
    if (typeof __gcStressCheckpoint === "function") __gcStressCheckpoint(rounds);
    var collections = typeof __guestVMGCStress === "function" ?
        __guestVMGCStress() - initialCollections : 0;
    if (typeof __guestVMGCStress === "function") __guestVMGCStress(0);
    if (typeof __guestVMGCStress === "function" &&
            typeof __gcStressCheckpoint !== "function" && collections < 3) {
        throw new Error("GC stress: automatic native collection was not exercised");
    }
    print("GC stress workload passed: " + rounds + " rounds, " + collections +
        " native-counter collections (embedding collections reported separately)");
}());
