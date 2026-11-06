/* ES5.1 composite object operations. Capture primitives once; replacing a
 * public method must not replace another algorithm's internal operations. */
(function () {
    var define = __guestObjectPrimitives.defineProperty;
    var descriptor = __guestObjectPrimitives.getOwnPropertyDescriptor;
    var names = __guestObjectPrimitives.getOwnPropertyNames, keys = __guestObjectPrimitives.keys;
    var create = Object.create, prevent = Object.preventExtensions;
    var extensible = Object.isExtensible;
    var string = String;
    var number = Number, isArray = Array.isArray;
    var fields = ["enumerable", "configurable", "value", "writable", "get", "set"];
    function requireObject(value) {
        if (value === null || (typeof value !== "object" && typeof value !== "function")) {
            throw new TypeError("object required");
        }
        return value;
    }
    function primitive(value, stringHint) {
        if (value !== null && (typeof value === "object" || typeof value === "function")) {
            var method = stringHint ? value.toString : value.valueOf, result;
            if (typeof method === "function") {
                result = method.call(value);
                if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
            }
            method = stringHint ? value.valueOf : value.toString;
            if (typeof method === "function") {
                result = method.call(value);
                if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
            }
            throw new TypeError("cannot convert object to a primitive");
        }
        return value;
    }
    function propertyKey(value) {
        return string(primitive(value, true));
    }
    function propertyDescriptor(source) {
        requireObject(source);
        /* An internal descriptor has no inherited fields. The activation and
         * this object are ordinary guest roots across each observable getter. */
        var result = create(null), index, field, value;
        for (index = 0; index < fields.length; index++) {
            field = fields[index];
            if (field in source) {
                value = source[field];
                if (field === "enumerable" || field === "configurable" || field === "writable") value = !!value;
                if ((field === "get" || field === "set") && value !== undefined && typeof value !== "function") {
                    throw new TypeError("accessor is not callable");
                }
                define(result, field, {value: value, writable: true, enumerable: true, configurable: true});
            }
        }
        if (("get" in result || "set" in result) && ("value" in result || "writable" in result)) {
            throw new TypeError("mixed property descriptor");
        }
        return result;
    }
    this.__guestObjectDefineProperty = function (object, key, attributes) {
        requireObject(object);
        /* ToString precedes ToPropertyDescriptor, including user callbacks.
         * The captured primitive receives only normalized descriptor fields. */
        key = propertyKey(key);
        var normalized = propertyDescriptor(attributes);
        if (isArray(object) && key === "length" && "value" in normalized) {
            var value = normalized.value;
            var length = number(primitive(value, false)) >>> 0;
            if (length !== number(primitive(value, false))) throw new RangeError("invalid array length");
            normalized.value = length;
        }
        return define(object, key, normalized);
    };
    this.__guestObjectGetOwnPropertyDescriptor = function (object, key) {
        requireObject(object);
        return descriptor(object, propertyKey(key));
    };
    this.__guestObjectGetOwnPropertyNames = function (object) { return names(requireObject(object)); };
    this.__guestObjectKeys = function (object) { return keys(requireObject(object)); };
    this.__guestObjectHasOwnProperty = function (key) {
        "use strict";
        key = propertyKey(key);
        if (this === null || this === undefined) throw new TypeError("null or undefined receiver");
        return descriptor(Object(this), key) !== undefined;
    };
    this.__guestObjectPropertyIsEnumerable = function (key) {
        "use strict";
        key = propertyKey(key);
        if (this === null || this === undefined) throw new TypeError("null or undefined receiver");
        var result = descriptor(Object(this), key);
        return result !== undefined && result.enumerable;
    };
    function defineProperties(object, properties) {
        requireObject(object);
        if (properties === null || properties === undefined) throw new TypeError("properties is null or undefined");
        var source = Object(properties), list = names(source), descriptions = [], index;
        /* All conversions precede any target mutation, including getters and
         * validation. Re-read enumerability after earlier getters run. */
        for (index = 0; index < list.length; index++) {
            var current = descriptor(source, list[index]);
            if (current && current.enumerable) descriptions.push([list[index], propertyDescriptor(source[list[index]])]);
        }
        for (index = 0; index < descriptions.length; index++) define(object, descriptions[index][0], descriptions[index][1]);
        return object;
    }
    function integrity(object, frozen) {
        requireObject(object);
        var list = names(object), index, desc;
        for (index = 0; index < list.length; index++) {
            desc = descriptor(object, list[index]);
            if (desc) {
                desc.configurable = false;
                if (frozen && "value" in desc) desc.writable = false;
                define(object, list[index], desc);
            }
        }
        return prevent(object);
    }
    function hasIntegrity(object, frozen) {
        requireObject(object);
        var list = names(object), index, desc;
        for (index = 0; index < list.length; index++) {
            desc = descriptor(object, list[index]);
            if (desc && (desc.configurable || (frozen && "value" in desc && desc.writable))) return false;
        }
        return !extensible(object);
    }
    this.__guestObjectDefineProperties = defineProperties;
    this.__guestObjectCreate = function (prototype, properties) {
        var object = create(prototype);
        return properties === undefined ? object : defineProperties(object, properties);
    };
    this.__guestObjectSeal = function (object) { return integrity(object, false); };
    this.__guestObjectFreeze = function (object) { return integrity(object, true); };
    this.__guestObjectIsSealed = function (object) { return hasIntegrity(object, false); };
    this.__guestObjectIsFrozen = function (object) { return hasIntegrity(object, true); };
    this.__guestObjectToLocaleString = function () {
        "use strict";
        if (this === null || this === undefined) throw new TypeError("null or undefined receiver");
        var object = Object(this), method = object.toString;
        if (typeof method !== "function") throw new TypeError("toString is not callable");
        return method.call(object);
    };
    var numberValue = Number.prototype.valueOf, numberString = Number.prototype.toString;
    this.__guestNumberToLocaleString = function () {
        "use strict";
        return numberString.call(numberValue.call(this));
    };
}());
