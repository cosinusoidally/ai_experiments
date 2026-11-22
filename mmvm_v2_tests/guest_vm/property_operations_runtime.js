/* Deterministic source for private guest continuations. The source executes
 * in the guest, never as bootstrap-host language support. Its captured
 * primitives cannot be replaced by later public prototype/global writes. */
(function (root) {
    var methods = ["PRIMITIVE", "KEY", "GET", "SET", "SET_STRICT", "DELETE", "DELETE_STRICT", "HAS"];
    var slots = {};
    for (var index = 0; index < methods.length; index++) slots[methods[index]] = index;
    var source = [
        "(function (string, call, typeError) {",
        "  function primitive(value, stringHint) {",
        "    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {",
        "      var method = stringHint ? value.toString : value.valueOf, result;",
        "      if (typeof method === 'function') {",
        "        result = call(method, value);",
        "        if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return result;",
        "      }",
        "      method = stringHint ? value.valueOf : value.toString;",
        "      if (typeof method === 'function') {",
        "        result = call(method, value);",
        "        if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return result;",
        "      }",
        "      throw new typeError('cannot convert object to a primitive');",
        "    }",
        "    return value;",
        "  }",
        "  function key(value) { return string(primitive(value, true)); }",
        "  function base(object) {",
        "    if (object === null || object === void 0) throw new typeError('cannot access property of null or undefined');",
        "  }",
        "  function get(object, value) { base(object); return object[key(value)]; }",
        "  function set(object, value, data) { base(object); object[key(value)] = data; return data; }",
        "  function setStrict(object, value, data) { 'use strict'; base(object); object[key(value)] = data; return data; }",
        "  function remove(object, value) { base(object); return delete object[key(value)]; }",
        "  function removeStrict(object, value) { 'use strict'; base(object); return delete object[key(value)]; }",
        "  function has(value, object) {",
        "    if (object === null || (typeof object !== 'object' && typeof object !== 'function'))",
        "      throw new typeError('right operand of in must be an object');",
        "    return key(value) in object;",
        "  }",
        "  return {PRIMITIVE:primitive, KEY:key, GET:get, SET:set, SET_STRICT:setStrict, DELETE:remove, DELETE_STRICT:removeStrict, HAS:has};",
        "})(__guestPropertyString, Function.prototype.call.bind(Function.prototype.call), TypeError);"
    ].join("\n");
    var exports = {source: source, methods: methods, slots: slots};
    root.GuestVMPropertyOperationsRuntime = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
