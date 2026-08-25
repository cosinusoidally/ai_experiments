var value = 3;
assertEqual(++value, 4, "prefix increment value");
assertEqual(value, 4, "prefix increment assignment");
assertEqual(--value, 3, "prefix decrement value");

var caught = "none";
try {
    throw "guest failure";
} catch (error) {
    caught = error;
}
assertEqual(caught, "guest failure", "same-frame catch");

function throwNested() {
    throw "nested failure";
}
try {
    throwNested();
} catch (nestedError) {
    caught = nestedError;
}
assertEqual(caught, "nested failure", "catch unwinds guest frames");
