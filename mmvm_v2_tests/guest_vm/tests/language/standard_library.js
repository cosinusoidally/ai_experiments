assertEqual(parseInt("8000", 10), 8000, "parseInt decimal");
assertEqual(String(42), "42", "String conversion");
assertEqual(String.fromCharCode(65, 66), "AB", "String.fromCharCode");

var text = "hello.txt";
assertEqual(text.charAt(1), "e", "String.charAt");
assertEqual(text.charCodeAt(0), 104, "String.charCodeAt");
assertEqual(text.indexOf("lo"), 3, "String.indexOf");
assertEqual(text.substring(1, 4), "ell", "String.substring");
assertEqual(text.substr(1, 3), "ell", "String.substr");

var parts = "/one/two".split("/");
assertEqual(parts.length, 3, "String.split length");
assertEqual(parts[2], "two", "String.split values");
assertEqual("<&".replace(/</g, "&lt;").replace(/&/g, "&amp;"),
            "&amp;lt;&amp;", "regexp String.replace");

assertEqual(/^[0-9]+$/.test("65535"), true, "RegExp.test match");
assertEqual(/^[0-9]+$/.test("65x"), false, "RegExp.test rejection");
var sizeMatch = /^([0-9]+)x([0-9]+)$/.exec("320x240");
assertEqual(sizeMatch[1], "320", "RegExp.exec first capture");
assertEqual(sizeMatch[2], "240", "RegExp.exec second capture");

assertEqual("mixed".toUpperCase(), "MIXED", "String.toUpperCase");
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
