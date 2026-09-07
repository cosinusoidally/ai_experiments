/* ES5 JSON support that converts directly between text and guest-heap values.
 * The parser intentionally performs character-by-character scanning so it is
 * usable by the ES3-era shell and does not depend on host JSON objects. */
(function (root) {
    function JSONSupport(runtime) {
        this.runtime = runtime;
        this.install();
    }

    JSONSupport.prototype.install = function () {
        var support = this;
        var json = this.runtime.makeObject();
        this.runtime.setProperty(json, "parse",
            this.runtime.makeNativeFunction("JSON.parse", function (receiver, args) {
                return support.parse(String(args[0]));
            }));
        this.runtime.setProperty(json, "stringify",
            this.runtime.makeNativeFunction("JSON.stringify", function (receiver, args) {
                return support.stringify(args[0]);
            }));
        this.runtime.setGlobal("JSON", json);
    };

    JSONSupport.prototype.parse = function (text) {
        var support = this;
        var position = 0;
        function fail() {
            throw new SyntaxError("invalid JSON at character " + position);
        }
        function space() {
            while (position < text.length) {
                var code = text.charCodeAt(position);
                if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
                position++;
            }
        }
        function stringValue() {
            if (text.charAt(position++) !== '"') fail();
            var result = "";
            while (position < text.length) {
                var character = text.charAt(position++);
                if (character === '"') return result;
                if (character === "\\") {
                    if (position >= text.length) fail();
                    character = text.charAt(position++);
                    if (character === '"' || character === "\\" || character === "/") {
                        result += character;
                    } else if (character === "b") result += "\b";
                    else if (character === "f") result += "\f";
                    else if (character === "n") result += "\n";
                    else if (character === "r") result += "\r";
                    else if (character === "t") result += "\t";
                    else if (character === "u") {
                        var value = 0;
                        var digitIndex = 0;
                        while (digitIndex < 4) {
                            if (position >= text.length) fail();
                            var code = text.charCodeAt(position++);
                            var digit = code >= 48 && code <= 57 ? code - 48 :
                                code >= 65 && code <= 70 ? code - 55 :
                                code >= 97 && code <= 102 ? code - 87 : -1;
                            if (digit < 0) fail();
                            value = value * 16 + digit;
                            digitIndex++;
                        }
                        result += String.fromCharCode(value);
                    } else fail();
                } else {
                    if (character.charCodeAt(0) < 32) fail();
                    result += character;
                }
            }
            fail();
        }
        function numberValue() {
            var start = position;
            if (text.charAt(position) === "-") position++;
            if (text.charAt(position) === "0") position++;
            else {
                if (text.charCodeAt(position) < 49 || text.charCodeAt(position) > 57) fail();
                while (text.charCodeAt(position) >= 48 && text.charCodeAt(position) <= 57) position++;
            }
            if (text.charAt(position) === ".") {
                position++;
                if (text.charCodeAt(position) < 48 || text.charCodeAt(position) > 57) fail();
                while (text.charCodeAt(position) >= 48 && text.charCodeAt(position) <= 57) position++;
            }
            var exponent = text.charAt(position);
            if (exponent === "e" || exponent === "E") {
                position++;
                var sign = text.charAt(position);
                if (sign === "+" || sign === "-") position++;
                if (text.charCodeAt(position) < 48 || text.charCodeAt(position) > 57) fail();
                while (text.charCodeAt(position) >= 48 && text.charCodeAt(position) <= 57) position++;
            }
            return Number(text.substring(start, position));
        }
        function value() {
            space();
            var character = text.charAt(position);
            if (character === '"') return stringValue();
            if (character === "[") {
                position++;
                var array = support.runtime.makeArray();
                space();
                if (text.charAt(position) === "]") {
                    position++;
                    return array;
                }
                while (true) {
                    support.runtime.arraySet(array,
                        support.runtime.arrayLength(array), value());
                    space();
                    character = text.charAt(position++);
                    if (character === "]") return array;
                    if (character !== ",") fail();
                }
            }
            if (character === "{") {
                position++;
                var object = support.runtime.makeObject();
                space();
                if (text.charAt(position) === "}") {
                    position++;
                    return object;
                }
                while (true) {
                    space();
                    if (text.charAt(position) !== '"') fail();
                    var key = stringValue();
                    space();
                    if (text.charAt(position++) !== ":") fail();
                    support.runtime.setProperty(object, key, value());
                    space();
                    character = text.charAt(position++);
                    if (character === "}") return object;
                    if (character !== ",") fail();
                }
            }
            if (text.substring(position, position + 4) === "true") {
                position += 4;
                return true;
            }
            if (text.substring(position, position + 5) === "false") {
                position += 5;
                return false;
            }
            if (text.substring(position, position + 4) === "null") {
                position += 4;
                return null;
            }
            return numberValue();
        }
        var result = value();
        space();
        if (position !== text.length) fail();
        return result;
    };

    JSONSupport.prototype.stringify = function (value) {
        var support = this;
        var active = [];
        function quote(text) {
            text = String(text);
            var result = '"';
            var index = 0;
            while (index < text.length) {
                var code = text.charCodeAt(index++);
                if (code === 34) result += '\\"';
                else if (code === 92) result += "\\\\";
                else if (code === 8) result += "\\b";
                else if (code === 9) result += "\\t";
                else if (code === 10) result += "\\n";
                else if (code === 12) result += "\\f";
                else if (code === 13) result += "\\r";
                else if (code < 32) {
                    var hex = code.toString(16);
                    while (hex.length < 4) hex = "0" + hex;
                    result += "\\u" + hex;
                } else result += String.fromCharCode(code);
            }
            return result + '"';
        }
        function encode(item, inArray) {
            if (item === null) return "null";
            if (typeof item === "string") return quote(item);
            if (typeof item === "number") return isFinite(item) ? String(item) : "null";
            if (typeof item === "boolean") return item ? "true" : "false";
            if (item === undefined || (item && (item.guestType === "function" ||
                                                item.guestType === "bytecodeFunction"))) {
                return inArray ? "null" : undefined;
            }
            if (!item || !item.guestType) return undefined;
            var activeIndex = 0;
            while (activeIndex < active.length) {
                if (active[activeIndex++] === item.heapAddress) {
                    throw new TypeError("cyclic object value");
                }
            }
            active.push(item.heapAddress);
            var parts = [];
            var index;
            if (item.guestType === "array") {
                index = 0;
                while (index < support.runtime.arrayLength(item)) {
                    parts.push(encode(support.runtime.arrayGet(item, index++), true));
                }
                active.pop();
                return "[" + parts.join(",") + "]";
            }
            var keys = support.runtime.keys(item);
            index = 0;
            while (index < support.runtime.arrayLength(keys)) {
                var key = support.runtime.arrayGet(keys, index++);
                var encoded = encode(support.runtime.getProperty(item, key), false);
                if (encoded !== undefined) parts.push(quote(key) + ":" + encoded);
            }
            active.pop();
            return "{" + parts.join(",") + "}";
        }
        return encode(value, false);
    };

    root.GuestVMJSONSupport = JSONSupport;
    if (typeof module !== "undefined" && module.exports) module.exports = JSONSupport;
}(this));
