assertEqual(addBeforeDeclaration(20, 22), 42,
            "function declaration instantiated at scope entry");

function addBeforeDeclaration(left, right) {
    return left + right;
}

function outer() {
    return nestedBeforeDeclaration();
    function nestedBeforeDeclaration() {
        return "nested";
    }
}

assertEqual(outer(), "nested", "nested function declaration hoisting");
