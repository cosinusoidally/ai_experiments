/* ES5.1 9.8.1 decimal formatting. These ordinary kernel-dialect functions
 * operate on caller-owned scratch storage; no host JavaScript conversion,
 * temporary heap records or cached per-number representations are used. */
(function (root) {
    var Binary64 = root.GuestVMBinary64;
    if (typeof module !== "undefined" && module.exports) Binary64 = require("./binary64.js");
    var constants = {
        NUMBER_FORMAT_ASCII_CAPACITY: 48,
        NUMBER_FORMAT_PATTERN_CAPACITY: 8,
        NUMBER_FORMAT_MAX_PRECISION: 17,
        NUMBER_FORMAT_FIXED_MAX_POSITION: 21,
        NUMBER_FORMAT_FIXED_MIN_POSITION: -6,
        ASCII_DECIMAL_POINT: 46,
        ASCII_EXPONENT: 101,
        ASCII_PLUS: 43,
        ASCII_PERCENT: 37,
        ASCII_FORMAT_PRECISION: 42,
        ASCII_GENERAL_FORMAT: 103
    };
    constants.NUMBER_FORMAT_CANDIDATE_OFFSET = constants.NUMBER_FORMAT_ASCII_CAPACITY;
    constants.NUMBER_FORMAT_PATTERN_OFFSET = constants.NUMBER_FORMAT_CANDIDATE_OFFSET +
        constants.NUMBER_FORMAT_ASCII_CAPACITY;
    constants.NUMBER_FORMAT_SCRATCH_BYTES = constants.NUMBER_FORMAT_PATTERN_OFFSET +
        constants.NUMBER_FORMAT_PATTERN_CAPACITY;
    constants.IEEE754_ABSOLUTE_MASK = ~(1 << (Binary64.KernelConstants.IEEE754_WORD_BITS - 1));
    constants.IEEE754_EXPONENT_MASK = Binary64.KernelConstants.IEEE754_EXPONENT_VALUE_MASK <<
        Binary64.KernelConstants.IEEE754_EXPONENT_SHIFT;

    /* printf rounds to the nearest decimal of a requested precision; strtod
     * checks whether it round-trips to the original binary64. Finer decimal
     * grids cannot increase that rounding error, so binary search finds the
     * smallest successful precision. At most five trials plus the final
     * formatting call are needed. Both libc services belong to guest FFI. */
    function shortestDoubleAsciiKernel(heapBase, platformServices, sourceCell, output) {
        var high = valueCellDoubleHigh(0, sourceCell);
        var low = valueCellDoubleLow(0, sourceCell);
        var magnitudeHigh = high & IEEE754_ABSOLUTE_MASK;
        if ((magnitudeHigh === 0 && low === 0) ||
            (magnitudeHigh & IEEE754_EXPONENT_MASK) === IEEE754_EXPONENT_MASK) {
            return formatDoubleStringKernel(
                heapBase, platformServices, sourceCell, output, 0);
        }
        var snprintf = platformSnprintfPointer(heapBase, platformServices);
        var strtod = platformStrtodPointer(heapBase, platformServices);
        if (snprintf === 0 || strtod === 0) return -1;
        var candidate = output + NUMBER_FORMAT_CANDIDATE_OFFSET;
        var pattern = output + NUMBER_FORMAT_PATTERN_OFFSET;
        storeRaw8(pattern, ASCII_PERCENT);
        storeRaw8(pattern + 1, ASCII_DECIMAL_POINT);
        storeRaw8(pattern + 2, ASCII_FORMAT_PRECISION);
        storeRaw8(pattern + 3, ASCII_GENERAL_FORMAT);
        storeRaw8(pattern + 4, 0);
        var lower = 1;
        var upper = NUMBER_FORMAT_MAX_PRECISION;
        while (lower < upper) {
            var precision = (lower + upper) >> 1;
            var length = callNativeI32(snprintf, candidate,
                NUMBER_FORMAT_ASCII_CAPACITY, pattern, precision, low, high);
            if (length < 0 || length >= NUMBER_FORMAT_ASCII_CAPACITY) return -1;
            if (equalF64(callNativeF64(strtod, candidate, 0),
                         loadF64(valueCellPayloadAddress(0, sourceCell))) === 1) {
                upper = precision;
            } else lower = precision + 1;
        }
        var finalLength = callNativeI32(snprintf, candidate,
            NUMBER_FORMAT_ASCII_CAPACITY, pattern, lower, low, high);
        if (finalLength < 0 || finalLength >= NUMBER_FORMAT_ASCII_CAPACITY) return -1;
        return canonicalDecimalAsciiKernel(candidate, finalLength, output);
    }

    /* Remove printf's presentation choices, retaining coefficient digits and
     * decimal position. Then apply ES5's fixed/scientific thresholds and
     * exponent spelling. The coefficient is compacted in its original buffer,
     * which is disjoint from the output buffer. */
    function canonicalDecimalAsciiKernel(candidate, length, output) {
        var negative = 0;
        var input = 0;
        if (loadRaw8(candidate) === ASCII_MINUS) {
            negative = 1;
            input = 1;
        }
        var count = 0;
        var decimalPosition = -1;
        while (input < length && loadRaw8(candidate + input) !== ASCII_EXPONENT) {
            var code = loadRaw8(candidate + input);
            if (code === ASCII_DECIMAL_POINT) decimalPosition = count;
            else {
                storeRaw8(candidate + count, code);
                count = count + 1;
            }
            input = input + 1;
        }
        if (decimalPosition < 0) decimalPosition = count;
        if (input < length) {
            input = input + 1;
            var exponentSign = 1;
            if (loadRaw8(candidate + input) === ASCII_MINUS) {
                exponentSign = -1;
                input = input + 1;
            } else if (loadRaw8(candidate + input) === ASCII_PLUS) input = input + 1;
            var exponent = 0;
            while (input < length) {
                exponent = exponent * DECIMAL_RADIX + loadRaw8(candidate + input) - ASCII_ZERO;
                input = input + 1;
            }
            decimalPosition = decimalPosition + exponentSign * exponent;
        }
        var first = 0;
        while (first < count - 1 && loadRaw8(candidate + first) === ASCII_ZERO) {
            first = first + 1;
            decimalPosition = decimalPosition - 1;
        }
        while (count > first + 1 && loadRaw8(candidate + count - 1) === ASCII_ZERO) {
            count = count - 1;
        }
        var digits = count - first;
        var written = 0;
        if (negative !== 0) {
            storeRaw8(output, ASCII_MINUS);
            written = 1;
        }
        var scientific = 0;
        var digitsBeforePoint = decimalPosition;
        if (decimalPosition > NUMBER_FORMAT_FIXED_MAX_POSITION ||
            decimalPosition <= NUMBER_FORMAT_FIXED_MIN_POSITION) {
            scientific = 1;
            digitsBeforePoint = 1;
        } else if (decimalPosition <= 0) {
            storeRaw8(output + written, ASCII_ZERO);
            storeRaw8(output + written + 1, ASCII_DECIMAL_POINT);
            written = written + 2;
            var zero = decimalPosition;
            while (zero < 0) {
                storeRaw8(output + written, ASCII_ZERO);
                written = written + 1;
                zero = zero + 1;
            }
        }
        var digit = 0;
        while (digit < digits) {
            if (digit === digitsBeforePoint && digitsBeforePoint > 0) {
                storeRaw8(output + written, ASCII_DECIMAL_POINT);
                written = written + 1;
            }
            storeRaw8(output + written, loadRaw8(candidate + first + digit));
            written = written + 1;
            digit = digit + 1;
        }
        if (scientific !== 0) {
            written = appendDecimalExponentAsciiKernel(output, written, decimalPosition - 1);
        } else {
            while (digit < digitsBeforePoint) {
                storeRaw8(output + written, ASCII_ZERO);
                written = written + 1;
                digit = digit + 1;
            }
        }
        storeRaw8(output + written, 0);
        return written;
    }

    function appendDecimalExponentAsciiKernel(output, written, exponent) {
        storeRaw8(output + written, ASCII_EXPONENT);
        written = written + 1;
        if (exponent < 0) {
            storeRaw8(output + written, ASCII_MINUS);
            exponent = -exponent;
        } else storeRaw8(output + written, ASCII_PLUS);
        written = written + 1;
        var divisor = 1;
        while (divideI32(exponent, divisor) >= DECIMAL_RADIX) divisor = divisor * DECIMAL_RADIX;
        while (divisor !== 0) {
            storeRaw8(output + written, ASCII_ZERO + divideI32(exponent, divisor));
            written = written + 1;
            exponent = exponent % divisor;
            divisor = divideI32(divisor, DECIMAL_RADIX);
        }
        return written;
    }

    var exports = {KernelConstants: constants, functions: {
        shortestDoubleAsciiKernel: shortestDoubleAsciiKernel,
        canonicalDecimalAsciiKernel: canonicalDecimalAsciiKernel,
        appendDecimalExponentAsciiKernel: appendDecimalExponentAsciiKernel
    }};
    root.GuestVMNumberFormatKernel = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
