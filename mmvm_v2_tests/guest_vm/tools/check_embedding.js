/* Focused entry point for the existing broad embedding/context integration
 * checks. No new language tests: avoids rebuilding unrelated native engines
 * on every ownership/descriptor cutover. Run from mmvm_v2_tests on either host. */
(function () {
    var nodeHost = typeof module !== "undefined" && module.exports;
    var VM, embedding, contexts;
    if (nodeHost) {
        VM = require("../vm.js");
        embedding = require("../tests/embedding_api_test.js");
        contexts = require("../tests/runtime_context_execution_test.js");
    } else {
        load("guest_vm/guest_vm.js");
        load("guest_vm/tests/embedding_api_test.js");
        load("guest_vm/tests/runtime_context_execution_test.js");
        VM = GuestVM;
        embedding = GuestVMRunEmbeddingAPITest;
        contexts = GuestVMRunRuntimeContextExecutionTest;
    }
    var first = embedding(VM);
    var second = contexts(VM);
    if (nodeHost) { console.log(first); console.log(second); }
    else { print(first); print(second); }
}());
