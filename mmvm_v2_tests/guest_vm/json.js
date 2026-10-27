/* ES5 JSON support that converts directly between text and guest-heap values.
 * The parser intentionally performs character-by-character scanning so it is
 * usable by the ES3-era shell and does not depend on host JSON objects. */
(function (root) {
    function JSONSupport(runtime) {
        this.runtime = runtime;
        this.values = runtime ? runtimeValues(runtime) : ordinaryValues;
        if (runtime) this.install();
    }

    /* One parser/serializer, with only the value representation abstracted.
     * When this module executes inside the VM, ordinary JS objects already
     * are guest-heap values and none of these operations crosses to a host. */
    var ordinaryValues = {
        makeObject: function () { return {}; },
        makeArray: function () { return []; },
        arrayLength: function (array) { return array.length; },
        arrayGet: function (array, index) { return array[index]; },
        arraySet: function (array, index, value) { array[index] = value; },
        getProperty: function (object, key) { return object[key]; },
        defineProperty: function (object, key, value) {
            Object.defineProperty(object, key, {value: value,
                writable: true, enumerable: true, configurable: true});
        },
        identity: function (object) { return object; },
        kind: function (value) {
            if (typeof value === "function") return "function";
            return Array.isArray(value) ? "array" : "object";
        },
        keys: function (object) {
            var keys = [], key;
            for (key in object) {
                if (Object.prototype.hasOwnProperty.call(object, key)) keys.push(key);
            }
            return keys;
        }
    };

    function runtimeValues(runtime) {
        var dataAttributes = runtime.heapRecords.constructor.Attributes.DEFAULT;
        return {
            makeObject: function () { return runtime.makeObject(); },
            makeArray: function () { return runtime.makeArray(); },
            arrayLength: function (array) { return runtime.arrayLength(array); },
            arrayGet: function (array, index) { return runtime.arrayGet(array, index); },
            arraySet: function (array, index, value) { runtime.arraySet(array, index, value); },
            getProperty: function (object, key) { return runtime.getProperty(object, key); },
            defineProperty: function (object, key, value) {
                runtime.defineDataProperty(object, key, value, dataAttributes);
            },
            identity: function (object) { return object.heapAddress; },
            kind: function (value) {
                if (!value || !value.guestType) return "unsupported";
                if (value.guestType === "function" || value.guestType === "bytecodeFunction") return "function";
                return value.guestType === "array" ? "array" : "object";
            },
            keys: function (object) { return runtime.keys(object); }
        };
    }

    JSONSupport.forValues = function () { return new JSONSupport(null); };

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
        function decimalDigitAt(index) {
            if (index >= text.length) return false;
            var code = text.charCodeAt(index);
            return code >= 48 && code <= 57;
        }
        function numberValue() {
            var start = position;
            if (text.charAt(position) === "-") position++;
            if (text.charAt(position) === "0") position++;
            else {
                if (!decimalDigitAt(position)) fail();
                while (decimalDigitAt(position)) position++;
            }
            if (text.charAt(position) === ".") {
                position++;
                if (!decimalDigitAt(position)) fail();
                while (decimalDigitAt(position)) position++;
            }
            var exponent = text.charAt(position);
            if (exponent === "e" || exponent === "E") {
                position++;
                var sign = text.charAt(position);
                if (sign === "+" || sign === "-") position++;
                if (!decimalDigitAt(position)) fail();
                while (decimalDigitAt(position)) position++;
            }
            return Number(text.substring(start, position));
        }
        function value() {
            space();
            var character = text.charAt(position);
            if (character === '"') return stringValue();
            if (character === "[") {
                position++;
                var array = support.values.makeArray();
                space();
                if (text.charAt(position) === "]") {
                    position++;
                    return array;
                }
                while (true) {
                    support.values.arraySet(array,
                        support.values.arrayLength(array), value());
                    space();
                    character = text.charAt(position++);
                    if (character === "]") return array;
                    if (character !== ",") fail();
                }
            }
            if (character === "{") {
                position++;
                var object = support.values.makeObject();
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
                    support.values.defineProperty(object, key, value());
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
            if (typeof item === "number") return item === item && item !== Infinity && item !== -Infinity ? String(item) : "null";
            if (typeof item === "boolean") return item ? "true" : "false";
            if (item === undefined) return inArray ? "null" : undefined;
            var kind = support.values.kind(item);
            if (kind === "function") {
                return inArray ? "null" : undefined;
            }
            if (kind === "unsupported") return undefined;
            var identity = support.values.identity(item);
            var activeIndex = 0;
            while (activeIndex < active.length) {
                if (active[activeIndex++] === identity) {
                    throw new TypeError("cyclic object value");
                }
            }
            active.push(identity);
            var parts = [];
            var index;
            if (kind === "array") {
                index = 0;
                while (index < support.values.arrayLength(item)) {
                    parts.push(encode(support.values.arrayGet(item, index++), true));
                }
                active.pop();
                return "[" + parts.join(",") + "]";
            }
            var keys = support.values.keys(item);
            index = 0;
            while (index < support.values.arrayLength(keys)) {
                var key = support.values.arrayGet(keys, index++);
                var encoded = encode(support.values.getProperty(item, key), false);
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
