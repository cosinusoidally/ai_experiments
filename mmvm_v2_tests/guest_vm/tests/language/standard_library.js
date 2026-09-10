assertEqual(parseInt("8000", 10), 8000, "parseInt decimal");
assertEqual(parseFloat("12.5px"), 12.5, "parseFloat prefix");
assertEqual(isNaN("not a number"), true, "isNaN conversion");
assertEqual(isFinite("12"), true, "isFinite conversion");
assertEqual(NaN !== NaN, true, "global NaN");
assertEqual(Infinity > 1e308, true, "global Infinity");
assertEqual(Boolean(0), false, "Boolean false conversion");
assertEqual(Boolean("guest"), true, "Boolean true conversion");
assertEqual(typeof Function, "function", "Function constructor exists");
var dynamicAdd = Function("left", "right", "return left + right;");
assertEqual(dynamicAdd(19, 23), 42,
            "Function constructor compiles a guest function");
assertEqual(new Function("return 7;")(), 7,
            "Function constructor is constructible");
var leapDate = new Date(2000, 1, 29, 13, 14, 15, 16);
assertEqual(leapDate.getFullYear(), 2000, "guest Date year");
assertEqual(leapDate.getMonth(), 1, "guest Date month");
assertEqual(leapDate.getDate(), 29, "guest Date date");
assertEqual(leapDate.getHours(), 13, "guest Date hours");
assertEqual(leapDate.getMinutes(), 14, "guest Date minutes");
assertEqual(leapDate.getSeconds(), 15, "guest Date seconds");
assertEqual(leapDate.getMilliseconds(), 16, "guest Date milliseconds");
assertEqual(new Date(1970, 0, 1).getDay(), 4, "guest Date weekday");
assertEqual(new Date(0).getTime(), 0, "guest Date epoch value");
assertEqual(leapDate.getTimezoneOffset(), 0, "guest Date UTC local policy");
assertEqual(unescape("A%20B%u0021"), "A B!", "legacy unescape");
assertEqual(escape("A B!"), "A%20B%21", "legacy escape");
var jsonValue = JSON.parse('{"name":"guest","values":[1,true,null]}');
assertEqual(jsonValue.name, "guest", "JSON.parse object");
assertEqual(jsonValue.values[1], true, "JSON.parse array");
assertEqual(JSON.stringify(jsonValue),
            '{"name":"guest","values":[1,true,null]}', "JSON.stringify");
assertEqual(String(42), "42", "String conversion");
assertEqual(String.fromCharCode(65, 66), "AB", "String.fromCharCode");

var text = "hello.txt";
assertEqual(text.charAt(1), "e", "String.charAt");
assertEqual(text.charCodeAt(0), 104, "String.charCodeAt");
assertEqual(text.indexOf("lo"), 3, "String.indexOf");
assertEqual(text.lastIndexOf("l"), 3, "String.lastIndexOf");
assertEqual(text.substring(1, 4), "ell", "String.substring");
assertEqual(text.substr(1, 3), "ell", "String.substr");

var parts = "/one/two".split("/");
assertEqual(parts.length, 3, "String.split length");
assertEqual(parts[2], "two", "String.split values");
var forEachTotal = 0;
[2, 3, 4].forEach(function (value, index) {
    forEachTotal += value + index;
});
assertEqual(forEachTotal, 12, "Array.forEach callback");
var spliceValues = [1, 2, 3, 4];
var spliceRemoved = spliceValues.splice(1, 2, 8, 9);
assertEqual(spliceValues.join(","), "1,8,9,4", "Array.splice replacement");
assertEqual(spliceRemoved.join(","), "2,3", "Array.splice removed values");
var sortedValues = [10, 2, 5];
sortedValues.sort(function (left, right) { return left - right; });
assertEqual(sortedValues.join(","), "2,5,10", "Array.sort comparator");
var regexpParts = "one, two;three".split(/[,;]\s*/);
assertEqual(regexpParts.length, 3, "String.split regexp length");
assertEqual(regexpParts[1], "two", "String.split regexp values");
var globalMatches = "one ox".match(/o./g);
assertEqual(globalMatches.length, 2, "String.match global length");
assertEqual(globalMatches[1], "ox", "String.match global value");
var captureMatch = "size=320x240".match(/size=(\d+)x(\d+)/);
assertEqual(captureMatch[1], "320", "String.match capture");
assertEqual(captureMatch.index, 0, "String.match index");
assertEqual("<&".replace(/</g, "&lt;").replace(/&/g, "&amp;"),
            "&amp;lt;&amp;", "regexp String.replace");
assertEqual("a12b".replace(/(\d+)/, function (whole, digits) {
    return String(Number(digits) + 1);
}), "a13b", "String.replace callback captures");

assertEqual(/^[0-9]+$/.test("65535"), true, "RegExp.test match");
assertEqual(/^[0-9]+$/.test("65x"), false, "RegExp.test rejection");
var sizeMatch = /^([0-9]+)x([0-9]+)$/.exec("320x240");
assertEqual(sizeMatch[1], "320", "RegExp.exec first capture");
assertEqual(sizeMatch[2], "240", "RegExp.exec second capture");

assertEqual("mixed".toUpperCase(), "MIXED", "String.toUpperCase");
assertEqual("  spaced \n".trim(), "spaced", "String.trim");
assertEqual(Number("12"), 12, "Number conversion");
assertEqual((15).toString(16), "f", "Number.toString radix");
assertEqual((1.25).toFixed(1), "1.3", "Number.toFixed");
assertEqual((12.345).toPrecision(4), "12.35", "Number.toPrecision");
assertEqual(Math.floor(2.9), 2, "Math.floor");
assertEqual(Math.ceil(2.1), 3, "Math.ceil");
assertEqual(Math.round(2.6), 3, "Math.round");
assertEqual(Math.sqrt(81), 9, "Math.sqrt");
assertEqual(Math.min(7, 3), 3, "Math.min");
assertEqual(Math.cos(0), 1, "Math.cos");
assertEqual(Math.sin(0), 0, "Math.sin");
assertEqual(Math.pow(2, 10), 1024, "Math.pow positive base");
assertEqual(Math.pow(-2, 3), -8, "Math.pow negative-base semantics");
assertEqual(Math.floor(Math.exp(1)), 2, "Math.exp");
assertEqual(Math.PI > 3.1415 && Math.PI < 3.1416, true, "Math.PI constant");
assertEqual(Math.SQRT2 > 1.4142 && Math.SQRT2 < 1.4143, true,
            "Math.SQRT2 constant");
assertEqual(Math.atan2(0, 1), 0, "Math.atan2");
assertEqual(Math.log(Math.E), 1, "Math.log and Math.E");
assertEqual(Math.tan(0), 0, "Math.tan");
var randomValue = Math.random();
assertEqual(randomValue >= 0 && randomValue < 1, true, "Math.random range");

var names = ["z", "a", "m"];
assertEqual(names.push("b"), 4, "Array.push length");
names.sort();
assertEqual(names[0], "a", "Array.sort first value");
assertEqual(names[3], "z", "Array.sort final value");
var sized = new Array(4);
assertEqual(sized.length, 4, "Array length constructor");
var ordered = [1, 2, 3];
ordered.reverse();
assertEqual(ordered[0], 3, "Array.reverse");
assertEqual(ordered.unshift(4), 4, "Array.unshift length");
assertEqual(ordered.slice(1, 3)[1], 2, "Array.slice");
assertEqual(["a", null, undefined, "b"].join("-"), "a---b", "Array.join");
var queue = [1, 2, 3];
assertEqual(queue.shift(), 1, "Array.shift returns the first item");
assertEqual(queue.pop(), 3, "Array.pop returns the last item");
assertEqual(queue.length, 1, "Array shift/pop update length");
assertEqual(queue.concat([4, 5], 6).join(","), "2,4,5,6",
            "Array.concat flattens array arguments once");
var indexed = ["first", "second", "first"];
assertEqual(indexed.indexOf("first"), 0, "Array.indexOf first match");
assertEqual(indexed.indexOf("first", 1), 2, "Array.indexOf start offset");
assertEqual(indexed.indexOf("second", -2), 1,
            "Array.indexOf negative start offset");
assertEqual(indexed.indexOf("missing"), -1, "Array.indexOf missing value");
var sparseIndexed = new Array(2);
sparseIndexed[1] = undefined;
assertEqual(sparseIndexed.indexOf(undefined), 1,
            "Array.indexOf skips sparse holes");
var definedObject = {};
Object.defineProperty(definedObject, "hidden", {value: 42});
assertEqual(definedObject.hidden, 42, "Object.defineProperty data value");
assertEqual(Object.keys(definedObject).length, 0,
            "Object.defineProperty defaults to non-enumerable");
var createdObject = Object.create(definedObject);
assertEqual(createdObject.hidden, 42, "Object.create prototype lookup");
assertEqual(Object.prototype.toString.call([]), "[object Array]",
            "Object.prototype.toString array tag");
assertEqual(this.Object, Object, "top-level this is the context global object");
String.prototype.guestExtension = function () { return this.charAt(1); };
assertEqual("abc".guestExtension(), "b",
            "primitive string uses guest String.prototype");
