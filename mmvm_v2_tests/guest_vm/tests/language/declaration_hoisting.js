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

var selfReferencedGlobal = selfReferencedGlobal || 42;
assertEqual(selfReferencedGlobal, 42,
            "global var exists before its initializer is evaluated");

var uninitialisedRedeclaration = 42;
var uninitialisedRedeclaration;
assertEqual(uninitialisedRedeclaration, 42,
            "uninitialised var redeclaration preserves its value");

assertEqual(typeof deliberatelyMissingGlobal, "undefined",
            "typeof unresolvable global does not throw");
