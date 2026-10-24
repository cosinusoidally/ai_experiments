/* Bounded end-to-end GC workload. The embedding driver supplies structural
 * heap checks; standalone snapshots additionally check the surviving data. */
(function () {
    var slots = [], slotCount = 8, rounds = 24;
    var bufferBytes = 128, transientGraphs = 12;
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
        root.read = function () { return root.values[1]; };
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
    }
    for (var round = 0; round < rounds; round++) {
        slots[round % slotCount] = makeGraph(round);
        for (var discarded = 0; discarded < transientGraphs; discarded++) {
            makeGraph(1000 + round * transientGraphs + discarded);
        }
        var current = slots[round % slotCount];
        if (current.values.indexOf(current.seed + 0.25, 0.5) !== 1) {
            throw new Error("GC stress: numeric array search changed its input/result");
        }
        if (typeof __gcStressCheckpoint === "function") __gcStressCheckpoint(round);
        for (var slot = 0; slot < slots.length; slot++) checkGraph(slots[slot]);
    }
    slots = null;
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
