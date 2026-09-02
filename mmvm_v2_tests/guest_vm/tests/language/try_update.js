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

var finallyTrace = "";
try {
    finallyTrace += "try";
} finally {
    finallyTrace += ":finally";
}
assertEqual(finallyTrace, "try:finally", "finally after normal completion");

function returnThroughFinally() {
    try {
        return 17;
    } finally {
        finallyTrace += ":return";
    }
}
assertEqual(returnThroughFinally(), 17, "return survives finally");
assertEqual(finallyTrace, "try:finally:return", "finally runs before return");

try {
    try {
        throw "through finally";
    } finally {
        finallyTrace += ":throw";
    }
} catch (finallyError) {
    caught = finallyError;
}
assertEqual(caught, "through finally", "exception survives finally");
assertEqual(finallyTrace, "try:finally:return:throw",
            "finally runs before exception propagation");
