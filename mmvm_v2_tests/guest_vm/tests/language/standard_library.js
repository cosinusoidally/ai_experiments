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

var names = ["z", "a", "m"];
assertEqual(names.push("b"), 4, "Array.push length");
names.sort();
assertEqual(names[0], "a", "Array.sort first value");
assertEqual(names[3], "z", "Array.sort final value");
