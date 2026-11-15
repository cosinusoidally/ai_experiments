/* Run the existing heap/accessor/isolation/binary-search integration workload
 * directly on either embedding host, without compiling a second full VM. */
(function (root) {
    var Heap, check;
    if (typeof module !== "undefined" && module.exports) {
        Heap = require("../heap.js");
        check = require("../tests/heap_access_test.js");
    } else {
        load("guest_vm/guest_vm.js");
        load("guest_vm/tests/heap_access_test.js");
        Heap = root.GuestVMHeap; check = root.GuestVMRunHeapAccessTest;
    }
    var result = check(Heap);
    if (typeof print === "function") print(result); else console.log(result);
}(this));
