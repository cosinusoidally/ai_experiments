function sum(left, right) {
    var total = left + right;
    return total;
}
assertEqual(sum(19, 23), 42, "function parameters and local var");

var scale = 3;
function makeScaler(offset) {
    return function (value) {
        return value * scale + offset;
    };
}
var scaleAndAdd = makeScaler(2);
assertEqual(scaleAndAdd(4), 14, "function expression and closure");

var record = {
    value: 7,
    apply: function (amount) { return amount + 1; }
};
assertEqual(record.apply(record.value), 8, "object literal and method call");

var values = [9, 8, 7];
values[1] = 6;
assertEqual(values.length, 3, "array length");
assertEqual(values[1], 6, "array indexing");

assertEqual((5 & 3) | 8, 9, "bitwise operators");
assertEqual(255 >>> 4, 15, "unsigned shift");
assertEqual(false ? 1 : 2, 2, "conditional expression");
assertEqual(false || "right", "right", "logical or evaluates right when needed");
assertEqual("left" || "right", "left", "logical or short circuits");

var visits = 0;
while (true) {
    visits++;
    if (visits === 4) break;
}
assertEqual(visits, 4, "break exits loop");

function argumentAt(index) {
    return arguments[index];
}
assertEqual(argumentAt(1, "second"), "second", "function arguments object");

function registerLocalEvaluationOrder() {
    var value = 3;
    return value + (value = 7);
}
assertEqual(registerLocalEvaluationOrder(), 10,
            "register local reads preserve expression snapshots");

function leafRecursive(value) {
    if (value <= 1) return 1;
    return value * leafRecursive(value - 1);
}
assertEqual(leafRecursive(5), 120, "register local named-function recursion");

function pair(left, right) { return left * 10 + right; }
function orderedRegisterArguments() {
    var value = 1;
    return pair(value, value = 2);
}
assertEqual(orderedRegisterArguments(), 12,
            "earlier register arguments preserve their value");

function methodReceiverBeforeArguments() {
    var first = {value: 3, read: function () { return this.value; }};
    var second = {value: 9};
    return first.read(first = second);
}
assertEqual(methodReceiverBeforeArguments(), 3,
            "method receiver is fixed before argument evaluation");

function assignmentObjectBeforeValue() {
    var first = {value: 1};
    var second = {value: 2};
    var original = first;
    first.value = (first = second, 7);
    return original.value + second.value;
}
assertEqual(assignmentObjectBeforeValue(), 9,
            "assignment object is fixed before value evaluation");

function registerCompoundEvaluationOrder() {
    var value = 3;
    value += (value = 7);
    return value;
}
assertEqual(registerCompoundEvaluationOrder(), 10,
            "register compound assignment preserves its old value");

function registerPostfixValue() {
    var value = 3;
    var old = value++;
    return old * 10 + value;
}
assertEqual(registerPostfixValue(), 34,
            "register postfix update preserves its result value");
