function Counter(start) {
    this.value = start;
}
Counter.prototype.add = function (amount) {
    this.value += amount;
    return this.value;
};

var counter = new Counter(4);
assertEqual(counter.add(3), 7, "constructor receiver and prototype method");
assertEqual(counter.instanceofValue, undefined, "missing inherited property");
assertEqual(typeof Counter, "function", "typeof guest function");
assertEqual((~0) >>> 0, 4294967295, "bitwise not");

var values = {first: 1, second: 2, third: 3};
var names = "";
for (var name in values) {
    if (name === "second") continue;
    names += name;
}
assertEqual(names, "firstthird", "for-in and continue");
delete values.second;
assertEqual(values.hasOwnProperty("second"), false, "delete property");

var turns = 0;
do {
    turns++;
} while (turns < 2);
assertEqual(turns, 2, "do-while");

var flags = 1;
flags |= 4;
flags &= 6;
assertEqual(flags, 4, "compound bitwise assignment");

function switchValue(value) {
    var result = "";
    switch (value) {
    case 1:
        result += "one";
        break;
    case 2:
        result += "two";
    default:
        result += ":default";
        break;
    case 3:
        result += "three";
    }
    return result;
}
assertEqual(switchValue(1), "one", "switch matching case and break");
assertEqual(switchValue(2), "two:default", "switch fallthrough");
assertEqual(switchValue(9), ":default", "switch default clause");
assertEqual(switchValue(3), "three", "switch case after default");
