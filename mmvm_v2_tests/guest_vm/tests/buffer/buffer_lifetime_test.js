(function (root) {
    function runBufferLifetimeTest(VM) {
        var vm = new VM();
        var runtime = vm.runtime;
        var support = runtime.bufferSupport;
        var initial = support.liveBackingCount();
        var parent = support.allocate(16);
        var slice = support.makeView(support.viewBacking(parent), 4, 8);
        var handle = vm.retain(slice);
        vm.collect();
        if (support.liveBackingCount() !== initial + 1) {
            throw new Error("a host-rooted slice did not retain its shared backing store");
        }
        if (vm.retained(handle) !== slice) {
            throw new Error("host root handle did not resolve the retained slice");
        }
        vm.release(handle);
        vm.collect();
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
