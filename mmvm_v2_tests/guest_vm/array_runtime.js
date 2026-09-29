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
