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
    var message = "object operations integration passed";
    if (typeof print === "function") print(message);
    else console.log(message);
}());
