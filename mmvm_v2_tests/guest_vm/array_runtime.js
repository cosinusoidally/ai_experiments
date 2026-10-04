/* ES5 Array algorithms expressed as ordinary guest JavaScript. These methods
 * remain portable between the Node and js_min hosts and execute as bytecode
 * inside a standalone guest image. */
function __guestArrayMap(callback, thisArgument) {
    if (typeof callback !== "function") {
        throw new TypeError("Array.prototype.map callback is not callable");
    }
    var source = Object(this);
    var length = source.length >>> 0;
    var result = new Array(length);
    var index = 0;
    while (index < length) {
        if (index in source) {
            result[index] = callback.call(
                thisArgument, source[index], index, source);
        }
        index++;
    }
    return result;
}

/* Iterative merge sort: comparator calls stay in the guest, and scratch space
 * is linear rather than an unbounded recursive JavaScript/host call stack.
 * Undefined entries precede holes and are never passed to the comparator. */
function __guestArraySort(compare) {
    "use strict";
    if (this === null || this === undefined) {
        throw new TypeError("Array.prototype.sort receiver is null or undefined");
    }
    if (compare !== undefined && typeof compare !== "function") {
        throw new TypeError("Array.prototype.sort comparator is not callable");
    }
    var source = Object(this);
    var length = source.length >>> 0;
    var values = [];
    var undefinedCount = 0;
    var index;
    for (index = 0; index < length; index++) {
        if (index in source) {
            var value = source[index];
            if (value === undefined) undefinedCount++;
            else values.push(value);
        }
    }
    var count = values.length;
    var scratch = new Array(count);
    for (var width = 1; width < count; width *= 2) {
        for (var start = 0; start < count; start += width * 2) {
            var middle = Math.min(start + width, count);
            var end = Math.min(start + width * 2, count);
            var left = start;
            var right = middle;
            for (var output = start; output < end; output++) {
                var takeRight = false;
                if (left >= middle) takeRight = true;
                else if (right < end) {
                    if (compare === undefined) {
                        takeRight = String(values[left]) > String(values[right]);
                    } else takeRight = Number(compare(values[left], values[right])) > 0;
                }
                scratch[output] = takeRight ? values[right++] : values[left++];
            }
        }
        var previous = values;
        values = scratch;
        scratch = previous;
    }
    for (index = 0; index < count; index++) source[index] = values[index];
    for (var missing = 0; missing < undefinedCount; missing++) {
        source[index++] = undefined;
    }
    while (index < length) delete source[index++];
    return source;
}
