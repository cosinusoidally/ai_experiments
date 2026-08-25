/* Host-independent IEEE-754 binary64 word conversion. Guest memory stores the
 * low word first. This is deliberately a conventional tagged payload, not
 * NaN boxing. */
(function (root) {
    var TWO32 = 4294967296;
    var TWO52 = 4503599627370496;
    var MIN_NORMAL = 2.2250738585072014e-308;
    var MIN_SUBNORMAL = 4.9406564584124654e-324;

    function encode(value) {
        var sign = value < 0 || (value === 0 && 1 / value < 0) ? 0x80000000 : 0;
        var absolute = Math.abs(value);
        if (value !== value) return {low: 0, high: 0x7ff80000};
        if (absolute === Infinity) return {low: 0, high: sign + 0x7ff00000};
        if (absolute === 0) return {low: 0, high: sign};
        var exponent;
        var mantissa;
        if (absolute < MIN_NORMAL) {
            exponent = 0;
            mantissa = Math.round(absolute / MIN_SUBNORMAL);
        } else {
            exponent = Math.floor(Math.log(absolute) / Math.LN2);
            if (exponent > 1023) exponent = 1023;
            if (exponent < -1022) exponent = -1022;
            var power = Math.pow(2, exponent);
            while (absolute < power) { exponent--; power /= 2; }
            while (absolute >= power * 2) { exponent++; power *= 2; }
            mantissa = Math.round((absolute / power - 1) * TWO52);
            if (mantissa >= TWO52) { mantissa = 0; exponent++; }
            exponent += 1023;
            if (exponent >= 2047) return {low: 0, high: sign + 0x7ff00000};
        }
        var highMantissa = Math.floor(mantissa / TWO32);
        var low = mantissa - highMantissa * TWO32;
        return {low: low >>> 0,
                high: (sign + exponent * 1048576 + highMantissa) >>> 0};
    }

    function decode(low, high) {
        low = low >>> 0;
        high = high >>> 0;
        var negative = (high & 0x80000000) !== 0;
        var exponent = (high >>> 20) & 2047;
        var mantissa = (high & 0xfffff) * TWO32 + low;
        var value;
        if (exponent === 2047) value = mantissa ? NaN : Infinity;
        else if (exponent === 0) value = mantissa * MIN_SUBNORMAL;
        else value = (1 + mantissa / TWO52) * Math.pow(2, exponent - 1023);
        return negative ? -value : value;
    }

    var Binary64 = {encode: encode, decode: decode};
    root.GuestVMBinary64 = Binary64;
    if (typeof module !== "undefined" && module.exports) module.exports = Binary64;
}(this));
