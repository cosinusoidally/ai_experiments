(function (root) {
    function runAutomaticGCTest(VM) {
        var thresholdVM = new VM({gcThreshold: 4});
        thresholdVM.run(
            "var survivor = Buffer.alloc(4);" +
            "survivor[0] = 77;" +
            "for (var i = 0; i < 24; i++) {" +
            "    var garbage = Buffer.alloc(64);" +
            "    garbage[0] = i;" +
            "}" +
            "assertEqual(survivor[0], 77, 'automatic GC retained global');",
            "automatic_gc_threshold.js");
        if (thresholdVM.runtime.collectionCount < 1) {
            throw new Error("allocation threshold did not trigger collection");
        }
        if (thresholdVM.runtime.bufferSupport.liveBackingCount() > 4) {
            throw new Error("automatic GC retained too many unreachable buffers");
        }
        thresholdVM.destroy();

        var stressVM = new VM({gcStress: true});
        stressVM.run(
            "function makeHolder(value) {" +
            "    var bytes = Buffer.alloc(4);" +
            "    bytes[0] = value;" +
            "    return {bytes: bytes};" +
            "}" +
            "var holder = makeHolder(91);" +
            "var arrays = 0;" +
            "for (var j = 0; j < 12; j++) { arrays = [j, arrays]; }" +
            "assertEqual(holder.bytes[0], 91, 'stress GC retained closure result');",
            "automatic_gc_stress.js");
        if (stressVM.runtime.collectionCount < 10) {
            throw new Error("stress GC did not collect at allocation safe points");
        }
        stressVM.destroy();

        var reuseVM = new VM({gcThreshold: 8, heapBytes: 128 * 1024});
        reuseVM.run(
            "var retained = {answer: 42};" +
            "for (var k = 0; k < 2000; k++) {" +
            "    var transient = {x: k, y: k + 1, z: k + 2};" +
            "}" +
            "assertEqual(retained.answer, 42, 'record reuse retained live object');",
            "automatic_gc_record_reuse.js");
        if (reuseVM.runtime.collectionCount < 10) {
            throw new Error("record reuse test did not trigger repeated collections");
        }
        if (!reuseVM.runtime.linearHeap.freeBlocks.length) {
            throw new Error("automatic GC did not return records to the guest heap");
        }
        reuseVM.destroy();
        return "automatic GC threshold and stress modes passed";
    }

    root.GuestVMRunAutomaticGCTest = runAutomaticGCTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runAutomaticGCTest;
    }
}(this));
