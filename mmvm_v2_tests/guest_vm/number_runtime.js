/* Guest-owned Number prototype operations needed by a standalone runtime.
 * Keep this ES3-compatible: the functions are compiled to ordinary guest
 * bytecode and retain no host objects. */
(function () {
    var guestToFixed = function (fractionDigits) {
        "use strict";
        var value = +this;
        var digits = fractionDigits === undefined ? 0 : +fractionDigits;
        if (digits !== Math.floor(digits) || digits < 0 || digits > 20) {
            throw new RangeError("fractionDigits out of range");
        }
        if (value !== value) return "NaN";
        if (value === Infinity) return "Infinity";
        if (value === -Infinity) return "-Infinity";
        var negative = value < 0;
        if (negative) value = -value;
        if (value >= 1e21) return String(negative ? -value : value);
        var scale = 1;
        var scaleIndex = 0;
        while (scaleIndex < digits) {
            scale *= 10;
            scaleIndex++;
        }
        var rounded = Math.floor(value * scale + 0.5);
        var integer = Math.floor(rounded / scale);
        var result = String(integer);
        if (digits) {
            var fraction = String(rounded - integer * scale);
            while (fraction.length < digits) fraction = "0" + fraction;
            result += "." + fraction;
        }
        if (negative && rounded !== 0) result = "-" + result;
        return result;
    };
    this.__guestNumberToFixed = guestToFixed;
}());
