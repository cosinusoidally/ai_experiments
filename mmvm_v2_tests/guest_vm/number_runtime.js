/* ES5.1 Number conversion and exact decimal rounding, executed in the guest.
 * Build the exact terminating decimal of the binary64 value, then round once.
 * Do not round value * 10^digits twice or inherit printf's ties-to-even policy. */
(function () {
    var operations = __guestStringOperations;
    var call = operations.call, integer = operations.toInteger;
    var valueOf = Number.prototype.valueOf;
    var objectToString = Object.prototype.toString;
    var primitiveValueOf = __guestNumberValueOfPrimitive;
    var string = String, floor = Math.floor;
    var typeError = TypeError, rangeError = RangeError;
    var primitiveToString = __guestNumberToStringPrimitive;
    var BINARY_LIMB_BASE = 65536, DECIMAL_LIMB_BASE = 10000000;
    var DECIMAL_LIMB_DIGITS = 7;

    function numberValue(receiver) {
        return typeof receiver === "number" ? receiver : call(valueOf, receiver);
    }
    this.__guestNumberValueOf = function () {
        "use strict";
        if (typeof this === "number") return this;
        if (call(objectToString, this) !== "[object Number]") {
            throw new typeError("Number method receiver is not a number");
        }
        return call(primitiveValueOf, this);
    };
    function multiplyAdd(limbs, multiplier, carry) {
        for (var index = 0; index < limbs.length; index++) {
            var value = limbs[index] * multiplier + carry;
            limbs[index] = value % DECIMAL_LIMB_BASE;
            carry = floor(value / DECIMAL_LIMB_BASE);
        }
        while (carry) {
            limbs.push(carry % DECIMAL_LIMB_BASE);
            carry = floor(carry / DECIMAL_LIMB_BASE);
        }
    }
    /* A binary64 is an integer divided by a power of two. Multiplying its
     * integer coefficient by 5^power gives its exact terminating decimal.
     * Limb products stay below 2^53, so intermediates remain exact. */
    function exactDecimal(value) {
        if (value === 0) return {digits: "0", point: 1};
        var denominator = 0;
        while (value % 1 !== 0) { value *= 2; denominator++; }
        var binary = [];
        while (value) {
            binary.push(value % BINARY_LIMB_BASE);
            value = floor(value / BINARY_LIMB_BASE);
        }
        var limbs = [0], index = binary.length;
        while (index) multiplyAdd(limbs, BINARY_LIMB_BASE, binary[--index]);
        for (index = 0; index < denominator; index++) multiplyAdd(limbs, 5, 0);
        index = limbs.length - 1;
        var digits = string(limbs[index]);
        while (index) {
            var part = string(limbs[--index]);
            while (part.length < DECIMAL_LIMB_DIGITS) part = "0" + part;
            digits += part;
        }
        var point = digits.length - denominator;
        while (digits.length > 1 && digits.charAt(digits.length - 1) === "0") {
            digits = digits.substring(0, digits.length - 1);
        }
        return {digits: digits, point: point};
    }
    function zeros(count) {
        var text = "";
        while (count-- > 0) text += "0";
        return text;
    }
    function increment(digits) {
        var index = digits.length - 1;
        while (index >= 0 && digits.charAt(index) === "9") index--;
        if (index < 0) return "1" + zeros(digits.length);
        return digits.substring(0, index) + "123456789".charAt(
            "0123456789".indexOf(digits.charAt(index))) + zeros(digits.length - index - 1);
    }
    function roundedDigits(decimal, count) {
        if (count < 0) return "0";
        var result = decimal.digits.substring(0, count);
        if (count < decimal.digits.length && decimal.digits.charAt(count) >= "5") {
            result = increment(result);
        }
        if (!result) result = "0";
        if (count > decimal.digits.length) result += zeros(count - decimal.digits.length);
        return result;
    }
    function significant(decimal, count) {
        var digits = roundedDigits(decimal, count), point = decimal.point;
        if (digits.length > count) { digits = digits.substring(0, count); point++; }
        return {digits: digits, point: point};
    }
    function scientific(decimal) {
        var digits = decimal.digits, exponent = decimal.point - 1;
        return digits.charAt(0) + (digits.length > 1 ? "." + digits.substring(1) : "") +
            "e" + (exponent >= 0 ? "+" : "") + string(exponent);
    }
    function fixed(decimal) {
        var point = decimal.point, digits = decimal.digits;
        if (point <= 0) return "0." + zeros(-point) + digits;
        if (point >= digits.length) return digits + zeros(point - digits.length);
        return digits.substring(0, point) + "." + digits.substring(point);
    }
    this.__guestNumberToString = function (radix) {
        "use strict";
        var value = numberValue(this);
        radix = radix === undefined ? 10 : integer(radix);
        if (radix < 2 || radix > 36) throw new rangeError("radix out of range");
        return call(primitiveToString, value, radix);
    };
    this.__guestNumberToFixed = function (fractionDigits) {
        "use strict";
        var value = numberValue(this), count = integer(fractionDigits);
        if (count < 0 || count > 20) throw new rangeError("fractionDigits out of range");
        if (value !== value || value === Infinity || value === -Infinity) return string(value);
        var negative = value < 0;
        if (negative) value = -value;
        if (value >= 1e21) return string(negative ? -value : value);
        var decimal = exactDecimal(value), digits = roundedDigits(decimal, decimal.point + count);
        while (digits.length <= count) digits = "0" + digits;
        var split = digits.length - count;
        var result = digits.substring(0, split) + (count ? "." + digits.substring(split) : "");
        return (negative ? "-" : "") + result;
    };
    this.__guestNumberToPrecision = function (precision) {
        "use strict";
        var value = numberValue(this);
        if (precision === undefined) return string(value);
        var count = integer(precision);
        if (value !== value || value === Infinity || value === -Infinity) return string(value);
        if (count < 1 || count > 21) throw new rangeError("precision out of range");
        var negative = value < 0;
        var decimal = significant(exactDecimal(negative ? -value : value), count);
        var result = decimal.point > count || decimal.point <= -6 ? scientific(decimal) : fixed(decimal);
        return (negative ? "-" : "") + result;
    };
    this.__guestNumberToExponential = function (fractionDigits) {
        "use strict";
        var value = numberValue(this), count = integer(fractionDigits);
        if (value !== value || value === Infinity || value === -Infinity) return string(value);
        if (count < 0 || count > 20) throw new rangeError("fractionDigits out of range");
        var negative = value < 0, decimal;
        if (fractionDigits === undefined) {
            var text = string(negative ? -value : value), marker = text.indexOf("e");
            var exponent = marker < 0 ? 0 : +text.substring(marker + 1);
            if (marker >= 0) text = text.substring(0, marker);
            var point = text.indexOf(".");
            if (point < 0) point = text.length;
            else text = text.substring(0, point) + text.substring(point + 1);
            point += exponent;
            while (text.length > 1 && text.charAt(0) === "0") { text = text.substring(1); point--; }
            while (text.length > 1 && text.charAt(text.length - 1) === "0") text = text.substring(0, text.length - 1);
            decimal = {digits: text, point: point};
        } else decimal = significant(exactDecimal(negative ? -value : value), count + 1);
        return (negative ? "-" : "") + scientific(decimal);
    };
}());
