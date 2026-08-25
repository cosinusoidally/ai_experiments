(function (root) {
    function runBufferLifetimeTest(VM) {
        var vm = new VM();
        var runtime = vm.runtime;
        var support = runtime.bufferSupport;
        var initial = support.liveBackingCount();
        var parent = support.allocate(16);
        var slice = support.makeView(parent.backing, 4, 8);
        runtime.setGlobal("retainedSlice", slice);
        runtime.collect();
        if (support.liveBackingCount() !== initial + 1) {
            throw new Error("a rooted slice did not retain its shared backing store");
        }
        runtime.setGlobal("retainedSlice", null);
        runtime.collect();
        if (support.liveBackingCount() !== initial) {
            throw new Error("unreachable final Buffer view did not release backing store");
        }
        if (support.memory.frees !== 1) {
            throw new Error("shared backing store was not freed exactly once");
        }
        var hostName = support.memory.hostName();
        vm.destroy();
        return "buffer lifetime passed on " + hostName;
    }

    root.GuestVMRunBufferLifetimeTest = runBufferLifetimeTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runBufferLifetimeTest;
    }
}(this));
