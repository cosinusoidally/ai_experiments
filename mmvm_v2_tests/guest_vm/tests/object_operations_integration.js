/* End-to-end property operations, runnable unchanged on stock Node or as a
 * guest (including a standalone image). No host-language semantic helpers. */
(function () {
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    var order = [], target = {}, source = {}, key = {};
    key.toString = function () { order.push("key"); return "answer"; };
    var fields = ["enumerable", "configurable", "value", "writable", "get", "set"];
    var values = [true, true, 42, true, undefined, undefined];
    function fieldGetter(index) {
        return function () {
            order.push(fields[index]);
            /* Allocation and reentrancy while an earlier field result lives
             * in the suspended built-in's activation. */
            var temporary = [], n;
            for (n = 0; n < 24; n++) temporary.push({index: n});
            Object.defineProperty(target, "during", {value: temporary.length, configurable: true});
            return values[index];
        };
    }
    var index;
    for (index = 0; index < 4; index++) {
        Object.defineProperty(source, fields[index], {get: fieldGetter(index)});
    }
    check(Object.defineProperty(target, key, source) === target, "definition result");
    check(order.join(",") === "key,enumerable,configurable,value,writable", "descriptor conversion order");
    check(target.answer === 42 && target.during === 24, "reentrant conversion");
    var sentinel = {}, caught;
    Object.defineProperty(source, "get", {get: function () { throw sentinel; }});
    try { Object.defineProperty(target, "unpublished", source); }
    catch (error) { caught = error; }
    check(caught === sentinel && !target.hasOwnProperty("unpublished"), "getter exception identity/atomicity");
    var accessor = {}, receiver;
    Object.defineProperty(accessor, "value", {get: function () { receiver = this; return 73; }});
    var inherited = Object.create(accessor);
    Object.defineProperty(target, "inherited", inherited);
    check(target.inherited === 73 && receiver === inherited, "inherited descriptor receiver");
    var original = Object.defineProperty;
    Object.defineProperty = function () { throw new Error("public method was consulted internally"); };
    try {
        Object.defineProperties(target, {composite: {value: 91}});
        check(target.composite === 91, "captured primitive ownership");
    } finally { Object.defineProperty = original; }
    var array = [11, , 33];
    var element = Object.getOwnPropertyDescriptor(array, "0");
    var length = Object.getOwnPropertyDescriptor(array, "length");
    check(element.value === 11 && element.writable && element.enumerable && element.configurable,
          "dense element descriptor");
    check(Object.getOwnPropertyDescriptor(array, "1") === undefined, "hole is not an own property");
    check(length.value === 3 && length.writable && !length.enumerable && !length.configurable,
          "virtual array length descriptor");
    check(Object.getOwnPropertyNames(array).join(",") === "0,2,length", "array own names");
    Object.defineProperty(array, "0", {writable: false});
    check(array[0] === 11 && !Object.getOwnPropertyDescriptor(array, "0").writable,
          "dense materialization preserves value and attributes");
    Object.defineProperty(array, "4", {get: function () { return this[2] + 9; }, configurable: true});
    check(array.length === 5 && array[4] === 42, "indexed accessor extends length and preserves receiver");
    var lengthConversions = 0;
    Object.defineProperty(array, "length", {value: {valueOf: function () {
        lengthConversions++;
        return 2;
    }}});
    check(lengthConversions === 2 && array.length === 2 && !array.hasOwnProperty("4"),
          "length conversion and descending deletion");
    Object.defineProperty(array, "length", {writable: false});
    var lengthRejected = false;
    try { Object.defineProperty(array, "3", {value: 9}); }
    catch (error) { lengthRejected = error instanceof TypeError; }
    check(lengthRejected && array.length === 2, "nonwritable length prevents new index");
    var blocked = [1, 2, 3, 4];
    Object.defineProperty(blocked, "2", {configurable: false});
    var truncationRejected = false;
    try { Object.defineProperty(blocked, "length", {value: 1, writable: false}); }
    catch (error) { truncationRejected = error instanceof TypeError; }
    check(truncationRejected && blocked.length === 3 && !blocked.hasOwnProperty("3") &&
          !Object.getOwnPropertyDescriptor(blocked, "length").writable,
          "failed truncation publishes partial length and requested writability");
    (function (parameter) {
        parameter = 29;
        check(Object.getOwnPropertyDescriptor(arguments, "0").value === 29,
              "mapped argument descriptor reads current parameter");
        Object.defineProperty(arguments, "0", {value: 41});
        check(parameter === 41, "argument definition updates parameter");
        parameter = 43;
        check(arguments[0] === 43 && Object.getOwnPropertyDescriptor(arguments, "0").value === 43,
              "materialized data descriptor keeps parameter mapping live");
        Object.defineProperty(arguments, "0", {writable: false});
        parameter = 59;
        check(arguments[0] === 43 && !Object.getOwnPropertyDescriptor(arguments, "0").writable,
              "freezing argument snapshots and detaches parameter mapping");
    }(7));
    var boxed = Object("A\u20ac");
    var character = Object.getOwnPropertyDescriptor(boxed, "1");
    check(character.value === "\u20ac" && character.enumerable &&
          !character.writable && !character.configurable, "boxed string virtual character");
    Object.defineProperty(boxed, "1", {value: "\u20ac"});
    var characterRejected = false;
    try { Object.defineProperty(boxed, "1", {value: "X"}); }
    catch (error) { characterRejected = error instanceof TypeError; }
    check(characterRejected && boxed[1] === "\u20ac", "boxed character immutable definition");
    boxed[1] = "X";
    check(boxed[1] === "\u20ac" && delete boxed[1] === false,
          "sloppy boxed character write/delete");
    var strictWriteRejected = false, strictDeleteRejected = false;
    (function () {
        "use strict";
        try { boxed[1] = "X"; } catch (error) { strictWriteRejected = error instanceof TypeError; }
        try { delete boxed[1]; } catch (error) { strictDeleteRejected = error instanceof TypeError; }
    }());
    check(strictWriteRejected && strictDeleteRejected, "strict virtual-property rejection stays in guest");
    var message = "object operations integration passed";
    if (typeof print === "function") print(message);
    else console.log(message);
}());
