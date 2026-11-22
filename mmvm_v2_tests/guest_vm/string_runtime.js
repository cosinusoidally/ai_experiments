/* Shared ES5.1 String receiver/argument conversion. Fast primitive calls
 * stay in the kernel; callback-capable conversion uses ordinary guest frames.
 * Private primitive callables have no fallback, avoiding recursive dispatch. */
(function () {
    var primitives = __guestStringPrimitives;
    var call = __guestObjectPrimitives.call;
    var primitive = __guestObjectPrimitives.primitive;
    var string = __guestObjectPrimitives.propertyKey;
    var number = Number, floor = Math.floor, ceil = Math.ceil;
    var typeError = TypeError;
    function toString(value) {
        if (typeof value === "string") return value;
        return string(value);
    }
    function receiver(value) {
        if (typeof value === "string") return value;
        if (value === null || value === undefined) throw new typeError("String method receiver is null or undefined");
        return string(value);
    }
    function toNumber(value) {
        if (typeof value === "number") return value;
        return number(primitive(value, false));
    }
    function integer(value) {
        var result = typeof value === "number" ? value : toNumber(value);
        if (result !== result) return 0;
        return result < 0 ? ceil(result) : floor(result);
    }
    function position(value, length) {
        var result = integer(value);
        return result < 0 ? 0 : result > length ? length : result;
    }
    this.__guestStringOperations = {receiver: receiver, call: call, toString: toString,
        toNumber: toNumber, toInteger: integer};
    this.__guestStringCharAt = function (value) {
        "use strict";
        var text = receiver(this), index = integer(value);
        return index < 0 || index >= text.length ? "" : call(primitives.charAt, text, index);
    };
    this.__guestStringCharCodeAt = function (value) {
        "use strict";
        var text = receiver(this), index = integer(value);
        return index < 0 || index >= text.length ? NaN : call(primitives.charCodeAt, text, index);
    };
    this.__guestStringIndexOf = function (searchValue, start) {
        "use strict";
        var text = receiver(this), search = string(searchValue);
        return call(primitives.indexOf, text, search, position(start, text.length));
    };
    this.__guestStringLastIndexOf = function (searchValue, start) {
        "use strict";
        var text = receiver(this), search = string(searchValue);
        /* Unlike indexOf, undefined and NaN select the end of the string. */
        var converted = number(primitive(start, false));
        var index = converted !== converted ? text.length : position(converted, text.length);
        return call(primitives.lastIndexOf, text, search, index);
    };
    this.__guestStringSubstring = function (start, end) {
        "use strict";
        var text = receiver(this), first = position(start, text.length);
        var last = end === undefined ? text.length : position(end, text.length);
        return call(primitives.substring, text, first, last);
    };
    this.__guestStringToLowerCase = function () {
        "use strict";
        return call(primitives.toLowerCase, receiver(this));
    };
    this.__guestStringToUpperCase = function () {
        "use strict";
        return call(primitives.toUpperCase, receiver(this));
    };
    /* Keep the existing default Unicode case policy for locale variants;
     * they need the same receiver check, not a host locale service or Intl. */
    this.__guestStringToLocaleLowerCase = this.__guestStringToLowerCase;
    this.__guestStringToLocaleUpperCase = this.__guestStringToUpperCase;
    this.__guestStringConcat = function () {
        "use strict";
        var result = receiver(this), index = 0;
        while (index < arguments.length) result += string(arguments[index++]);
        return result;
    };
}());
