assertEqual(parseInt("8000", 10), 8000, "parseInt decimal");
assertEqual(String(42), "42", "String conversion");
assertEqual(String.fromCharCode(65, 66), "AB", "String.fromCharCode");

var text = "hello.txt";
assertEqual(text.charAt(1), "e", "String.charAt");
assertEqual(text.charCodeAt(0), 104, "String.charCodeAt");
assertEqual(text.indexOf("lo"), 3, "String.indexOf");
assertEqual(text.substring(1, 4), "ell", "String.substring");

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
assertEqual(Math.floor(2.9), 2, "Math.floor");
assertEqual(Math.ceil(2.1), 3, "Math.ceil");
assertEqual(Math.round(2.6), 3, "Math.round");
assertEqual(Math.sqrt(81), 9, "Math.sqrt");
assertEqual(Math.min(7, 3), 3, "Math.min");
assertEqual(Math.cos(0), 1, "Math.cos");
assertEqual(Math.sin(0), 0, "Math.sin");
assertEqual(Math.floor(Math.exp(1)), 2, "Math.exp");

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
