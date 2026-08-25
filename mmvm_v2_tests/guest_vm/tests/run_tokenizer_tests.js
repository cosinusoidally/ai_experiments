if (typeof load === "function") {
    load("guest_vm/tokenizer.js");
    load("guest_vm/tests/tokenizer_test.js");
} else {
    require("./tokenizer_test.js");
}
