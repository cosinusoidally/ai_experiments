/* ES5.1 argument conversion around the numeric kernel intrinsics. The
 * private primitive functions have no fallback of their own: a numeric
 * operation not yet implemented must report that fact, never recurse back
 * into its public wrapper. All conversions and special cases run as guest
 * bytecode, not as host JavaScript language operations. */
(function () {
    var primitive = __guestMathPrimitives;
    var e = Math.E;
    function unary(method) {
        return function (value) { return method(+value); };
    }
    function trigonometric(method) {
        return function (value) {
            value = +value;
            if (value !== value || value === Infinity || value === -Infinity) return NaN;
            return method(value);
        };
    }
    function rounding(method) {
        return function (value) {
            value = +value;
            if (value === 0 || value !== value || value === Infinity || value === -Infinity) return value;
            return method(value);
        };
    }
    function extreme(args, minimum) {
        var result = minimum ? Infinity : -Infinity;
        for (var index = 0; index < args.length; index++) {
            /* Convert every argument, in order, even after finding NaN. */
            var value = +args[index];
            result = minimum ? primitive.min(result, value) : primitive.max(result, value);
        }
        return result;
    }
    function power(base, exponent) {
        base = +base;
        exponent = +exponent;
        if (exponent !== exponent) return NaN;
        if (exponent === 0) return 1;
        if (base !== base) return NaN;
        var magnitude = primitive.abs(base);
        if (exponent === Infinity || exponent === -Infinity) {
            if (magnitude === 1) return NaN;
            if (magnitude > 1) return exponent > 0 ? Infinity : 0;
            return exponent > 0 ? 0 : Infinity;
        }
        var integer = primitive.floor(exponent) === exponent;
        var odd = integer && primitive.abs(exponent) % 2 === 1;
        var negative = (base < 0 || (base === 0 && 1 / base === -Infinity)) && odd;
        var result;
        if (magnitude === Infinity) result = exponent > 0 ? Infinity : 0;
        else if (magnitude === 0) result = exponent > 0 ? 0 : Infinity;
        else {
            if (base < 0 && !integer) return NaN;
            result = primitive.pow(magnitude, exponent);
        }
        return negative ? -result : result;
    }
    this.__guestMathAbs = unary(primitive.abs);
    this.__guestMathAtan = unary(primitive.atan);
    this.__guestMathAtan2 = function (y, x) { return primitive.atan2(+y, +x); };
    this.__guestMathCeil = rounding(primitive.ceil);
    this.__guestMathFloor = rounding(primitive.floor);
    this.__guestMathRound = rounding(primitive.round);
    this.__guestMathSqrt = unary(primitive.sqrt);
    this.__guestMathLog = unary(primitive.log);
    this.__guestMathSin = trigonometric(primitive.sin);
    this.__guestMathCos = trigonometric(primitive.cos);
    this.__guestMathTan = trigonometric(primitive.tan);
    this.__guestMathMin = function () { return extreme(arguments, true); };
    this.__guestMathMax = function () { return extreme(arguments, false); };
    this.__guestMathPow = power;
    /* ES5 permits implementation-dependent approximations for these
     * functions. Reuse the binary64 sqrt/atan2/exponential primitives rather
     * than introducing a separate polynomial approximation engine. The
     * factored product avoids cancellation in 1-x*x near either endpoint. */
    this.__guestMathAcos = function (value) {
        value = +value;
        if (value !== value || value < -1 || value > 1) return NaN;
        return primitive.atan2(primitive.sqrt((1 - value) * (1 + value)), value);
    };
    this.__guestMathAsin = function (value) {
        value = +value;
        if (value !== value || value < -1 || value > 1) return NaN;
        if (value === 0) return value;
        return primitive.atan2(value, primitive.sqrt((1 - value) * (1 + value)));
    };
    this.__guestMathExp = function (value) {
        value = +value;
        if (value !== value) return NaN;
        if (value === 0) return 1;
        if (value === Infinity) return Infinity;
        if (value === -Infinity) return 0;
        return primitive.pow(e, value);
    };
}());
