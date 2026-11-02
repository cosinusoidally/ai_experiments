/* ES5 Array algorithms expressed as ordinary guest JavaScript. These methods
 * remain portable between the Node and js_min hosts and execute as bytecode
 * inside a standalone guest image. */
function __guestArrayForEach(callback, thisArgument) {
    "use strict";
    if (this === null || this === undefined) {
        throw new TypeError("Array.prototype.forEach receiver is null or undefined");
    }
    var source = Object(this);
    var length = source.length >>> 0;
    if (typeof callback !== "function") {
        throw new TypeError("Array.prototype.forEach callback is not callable");
    }
    for (var index = 0; index < length; index++) {
        if (index in source) {
            callback.call(thisArgument, source[index], index, source);
        }
    }
}

function __guestArrayMap(callback, thisArgument) {
    "use strict";
    if (this === null || this === undefined) throw new TypeError("Array.map receiver is null or undefined");
    var source = Object(this);
    var length = source.length >>> 0;
    if (typeof callback !== "function") {
        throw new TypeError("Array.prototype.map callback is not callable");
    }
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

(function () {
    function objectReceiver(value) {
        if (value === null || value === undefined) throw new TypeError("Array method receiver is null or undefined");
        return Object(value);
    }
    function iterate(receiver, callback, thisArgument, operation) {
        var object = objectReceiver(receiver), length = object.length >>> 0;
        if (typeof callback !== "function") throw new TypeError("Array callback is not callable");
        var result = [], index, selected;
        for (index = 0; index < length; index++) {
            if (index in object) {
                var value = object[index];
                selected = callback.call(thisArgument, value, index, object);
                if (operation === "every" && !selected) return false;
                if (operation === "some" && selected) return true;
                if (operation === "filter" && selected) result.push(value);
            }
        }
        return operation === "filter" ? result : operation === "every";
    }
    function reduce(receiver, callback, initial, present, right) {
        var object = objectReceiver(receiver), length = object.length >>> 0;
        if (typeof callback !== "function") throw new TypeError("Array callback is not callable");
        var step = right ? -1 : 1, index = right ? length - 1 : 0;
        while (index >= 0 && index < length) {
            if (index in object) {
                if (!present) { initial = object[index]; present = true; }
                else initial = callback.call(undefined, initial, object[index], index, object);
            }
            index += step;
        }
        if (!present) throw new TypeError("reduce of empty array without initial value");
        return initial;
    }
    this.__guestArrayEvery = function (callback, thisArgument) {
        "use strict"; return iterate(this, callback, thisArgument, "every");
    };
    this.__guestArraySome = function (callback, thisArgument) {
        "use strict"; return iterate(this, callback, thisArgument, "some");
    };
    this.__guestArrayFilter = function (callback, thisArgument) {
        "use strict"; return iterate(this, callback, thisArgument, "filter");
    };
    this.__guestArrayReduce = function (callback, initial) {
        "use strict"; return reduce(this, callback, initial, arguments.length > 1, false);
    };
    this.__guestArrayReduceRight = function (callback, initial) {
        "use strict"; return reduce(this, callback, initial, arguments.length > 1, true);
    };
    this.__guestArrayLastIndexOf = function (search, from) {
        "use strict";
        var object = objectReceiver(this), length = object.length >>> 0;
        if (!length) return -1;
        var index = arguments.length > 1 ? Number(from) : length - 1;
        index = index !== index ? 0 : index < 0 ? Math.ceil(index) : Math.floor(index);
        index = index >= 0 ? Math.min(index, length - 1) : length + index;
        while (index >= 0) {
            if (index in object && object[index] === search) return index;
            index--;
        }
        return -1;
    };
}());

/* Generic ES5.1 push for array-like receivers. Dense actual arrays retain
 * the native interpreter's existing fast path. Strict writes must invoke
 * inherited setters and reject non-writable indexed/length properties. */
(function () {
    var activeJoins = [];
    function receiver(value) {
        if (value === null || value === undefined) throw new TypeError("Array method receiver is null or undefined");
        return Object(value);
    }
    function integer(value) {
        value = Number(value);
        return value !== value ? 0 : value < 0 ? Math.ceil(value) : Math.floor(value);
    }
    this.__guestArrayPopGeneric = function () {
        "use strict";
        var object = receiver(this), length = object.length >>> 0;
        if (!length) { object.length = 0; return undefined; }
        var value = object[--length];
        delete object[length]; object.length = length;
        return value;
    };
    this.__guestArrayShiftGeneric = function () {
        "use strict";
        var object = receiver(this), length = object.length >>> 0;
        if (!length) { object.length = 0; return undefined; }
        var value = object[0], index;
        for (index = 1; index < length; index++) {
            if (index in object) object[index - 1] = object[index];
            else delete object[index - 1];
        }
        delete object[length - 1]; object.length = length - 1;
        return value;
    };
    this.__guestArrayUnshiftGeneric = function () {
        "use strict";
        var object = receiver(this), length = object.length >>> 0, count = arguments.length;
        var index = length;
        while (count > 0 && index > 0) {
            index--;
            if (index in object) object[index + count] = object[index];
            else delete object[index + count];
        }
        for (index = 0; index < count; index++) object[index] = arguments[index];
        object.length = length + count;
        return length + count;
    };
    this.__guestArrayReverseGeneric = function () {
        "use strict";
        var object = receiver(this), length = object.length >>> 0;
        for (var lower = 0; lower < Math.floor(length / 2); lower++) {
            var upper = length - lower - 1;
            var lowerExists = lower in object, lowerValue;
            if (lowerExists) lowerValue = object[lower];
            var upperExists = upper in object, upperValue;
            if (upperExists) upperValue = object[upper];
            if (lowerExists && upperExists) { object[lower] = upperValue; object[upper] = lowerValue; }
            else if (upperExists) { object[lower] = upperValue; delete object[upper]; }
            else if (lowerExists) { delete object[lower]; object[upper] = lowerValue; }
        }
        return object;
    };
    this.__guestArraySpliceGeneric = function (start, deleteCount) {
        "use strict";
        var object = receiver(this), length = object.length >>> 0;
        var first = integer(start);
        first = first < 0 ? Math.max(length + first, 0) : Math.min(first, length);
        var removed = arguments.length === 0 ? 0 : arguments.length === 1 ?
            length - first : Math.min(Math.max(integer(deleteCount), 0), length - first);
        var inserted = Math.max(arguments.length - 2, 0), result = new Array(removed), index;
        for (index = 0; index < removed; index++) {
            if ((first + index) in object) result[index] = object[first + index];
        }
        if (inserted < removed) {
            for (index = first; index < length - removed; index++) {
                if ((index + removed) in object) object[index + inserted] = object[index + removed];
                else delete object[index + inserted];
            }
            for (index = length; index > length - removed + inserted; index--) delete object[index - 1];
        } else if (inserted > removed) {
            for (index = length - removed; index > first; index--) {
                if ((index + removed - 1) in object) object[index + inserted - 1] = object[index + removed - 1];
                else delete object[index + inserted - 1];
            }
        }
        for (index = 0; index < inserted; index++) object[first + index] = arguments[index + 2];
        object.length = length - removed + inserted;
        return result;
    };
    this.__guestArrayJoinGeneric = function (separator) {
        "use strict";
        var object = receiver(this), length = object.length >>> 0;
        separator = separator === undefined ? "," : String(separator);
        for (var active = 0; active < activeJoins.length; active++) if (activeJoins[active] === object) return "";
        activeJoins.push(object);
        try {
            var text = "", value;
            for (var index = 0; index < length; index++) {
                if (index) text += separator;
                value = object[index];
                if (value !== null && value !== undefined) text += String(value);
            }
            return text;
        } finally { activeJoins.pop(); }
    };
    this.__guestArrayToStringGeneric = function () {
        "use strict";
        var object = receiver(this), join = object.join;
        return typeof join === "function" ? join.call(object) : Object.prototype.toString.call(object);
    };
    this.__guestArrayToLocaleString = function () {
        "use strict";
        var object = receiver(this), length = object.length >>> 0, text = "";
        for (var index = 0; index < length; index++) {
            if (index) text += ",";
            var value = object[index];
            if (value !== null && value !== undefined) {
                var boxed = Object(value), method = boxed.toLocaleString;
                if (typeof method !== "function") throw new TypeError("toLocaleString is not callable");
                text += String(method.call(boxed));
            }
        }
        return text;
    };
}());

function __guestArrayPushGeneric() {
    "use strict";
    if (this === null || this === undefined) {
        throw new TypeError("Array.prototype.push receiver is null or undefined");
    }
    var object = Object(this);
    var length = object.length >>> 0;
    var index = 0;
    while (index < arguments.length) object[length++] = arguments[index++];
    object.length = length;
    return length;
}

function __guestArraySliceGeneric(start, end) {
    "use strict";
    if (this === null || this === undefined) {
        throw new TypeError("Array.prototype.slice receiver is null or undefined");
    }
    var object = Object(this);
    var length = object.length >>> 0;
    var first = Number(start);
    first = first !== first ? 0 : first < 0 ? Math.ceil(first) : Math.floor(first);
    first = first < 0 ? Math.max(length + first, 0) : Math.min(first, length);
    var last = end === undefined ? length : Number(end);
    last = last !== last ? 0 : last < 0 ? Math.ceil(last) : Math.floor(last);
    last = last < 0 ? Math.max(length + last, 0) : Math.min(last, length);
    var result = new Array(Math.max(last - first, 0)), output = 0;
    while (first < last) {
        if (first in object) {
            Object.defineProperty(result, String(output), {value: object[first],
                writable: true, enumerable: true, configurable: true});
        }
        first++;
        output++;
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
