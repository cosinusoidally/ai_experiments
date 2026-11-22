/* End-to-end ES5.1 property operations, run via guest_runner on either host
 * or a standalone image. Modern Node differs on reference-conversion timing.
 * No host-language semantic helpers. */
(function () {
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    check(String() === "" && String(undefined) === "undefined", "String conversion distinguishes a missing argument");
    var stringConversionOrder = [];
    var stringReceiver = {toString: function () { stringConversionOrder.push("receiver"); return "abc"; }};
    var stringSearch = {toString: function () { stringConversionOrder.push("search"); return "b"; }};
    var stringPosition = {valueOf: function () { stringConversionOrder.push("position"); return 0.8; }};
    check(String.prototype.indexOf.call(stringReceiver, stringSearch, stringPosition) === 1 &&
          stringConversionOrder.join(",") === "receiver,search,position",
          "String conversion order is shared with callback-capable arguments");
    var originalRegExp = /a(b)?/gi;
    originalRegExp.lastIndex = 3;
    var copiedRegExp = new RegExp(originalRegExp, undefined);
    check(RegExp(originalRegExp) === originalRegExp && copiedRegExp !== originalRegExp &&
          copiedRegExp.source === originalRegExp.source && copiedRegExp.global &&
          copiedRegExp.ignoreCase && copiedRegExp.lastIndex === 0,
          "RegExp Call preserves identity and Construct copies without lastIndex");
    var malformedPatternCaught = false, malformedPatternDetail = "no exception";
    try { new RegExp("("); } catch (patternError) {
        malformedPatternCaught = patternError instanceof SyntaxError;
        malformedPatternDetail = String(patternError);
    }
    check(malformedPatternCaught, "RegExp constructor validates before the first match: " + malformedPatternDetail);
    originalRegExp.lastIndex = 2;
    "abxab".split(originalRegExp);
    check(originalRegExp.lastIndex === 2, "String.split uses a private matcher without changing separator state");
    var enumerationSource = {first: 1, removed: 2, last: 3};
    var originalEnumerationSource = enumerationSource, enumerationSeen = [];
    for (var enumerationName in enumerationSource) {
        enumerationSeen.push(enumerationName);
        if (enumerationName === "first") {
            delete originalEnumerationSource.removed;
            enumerationSource = {};
        }
    }
    check(enumerationSeen.join(",") === "first,last",
          "enumeration retains its source and suppresses deleted pending keys");
    var enumerationTargetCalls = 0, enumerationTarget = {};
    function enumerationLeft() { enumerationTargetCalls++; return enumerationTarget; }
    for (enumerationLeft().name in {a: 1, b: 2}) {}
    check(enumerationTargetCalls === 2 && enumerationTarget.name === "b",
          "enumeration evaluates its assignment target for each visit");
    var enumerationInitialOrder = [];
    for (var initializedEnumeration = enumerationInitialOrder.push("initial") in
            (enumerationInitialOrder.push("source"), {only: 1})) {}
    check(enumerationInitialOrder.join(",") === "initial,source" &&
          initializedEnumeration === "only", "for-in initializes its var before evaluating the source");
    Number.prototype.enumerationNumber = 1;
    Boolean.prototype.enumerationBoolean = 1;
    var primitiveNames = [];
    for (var numericName in 7) primitiveNames.push(numericName);
    for (var booleanName in false) primitiveNames.push(booleanName);
    delete Number.prototype.enumerationNumber;
    delete Boolean.prototype.enumerationBoolean;
    check(primitiveNames.join(",") === "enumerationNumber,enumerationBoolean",
          "primitive enumeration includes inherited enumerable properties");
    var plain = {label: "object"};
    check("prefix:" + plain === "prefix:[object Object]" &&
          plain + 7 === "[object Object]7" &&
          plain + plain === "[object Object][object Object]",
          "addition applies ordinary default object conversion on both sides");
    function conversionCallback() { return 17; }
    check("callback:" + conversionCallback ===
          "callback:" + Function.prototype.toString.call(conversionCallback),
          "function addition preserves the actual function source");
    var namedArray = [];
    namedArray[-1] = "saved";
    namedArray[-1.5] = "fraction";
    check(namedArray.length === 0 && namedArray[-1] === namedArray["-1"] &&
          namedArray[-1.5] === "fraction", "negative numeric array keys are named properties");
    namedArray[-0] = 7;
    check(namedArray.length === 1 && namedArray[0] === 7, "negative zero remains index zero");
    /* Form the reference before its RHS, retain its normalized key through
     * read/modify/write, and keep callback progress in guest activations. */
    var keyOrder = [], keyTarget = {slot: 10}, keyConversions = 0;
    var callbackKey = {toString: function () {
        keyConversions++;
        keyOrder.push("key");
        var garbage = [], n;
        for (n = 0; n < 48; n++) garbage.push({index: n});
        return keyConversions === 1 ? "slot" : "wrong";
    }};
    function keyRHS() { keyOrder.push("rhs"); return 7; }
    keyTarget[callbackKey] = keyRHS();
    check(keyOrder.join(",") === "key,rhs" && keyTarget.slot === 7,
          "assignment key converts before RHS");
    keyConversions = 0; keyOrder = [];
    keyTarget[callbackKey] += keyRHS();
    check(keyConversions === 1 && keyTarget.slot === 14 &&
          keyOrder.join(",") === "key,rhs", "compound reference converts once");
    keyConversions = 0;
    check(keyTarget[callbackKey]++ === 14 && keyTarget.slot === 15 && keyConversions === 1,
          "update reuses its captured key");
    keyConversions = 0;
    check(keyTarget[callbackKey] === 15 && typeof callbackKey.toString === "function",
          "read conversion does not overwrite source binding");
    keyConversions = 0;
    check(callbackKey in keyTarget, "membership converts callback key");
    check(keyConversions === 1, "membership conversion count");
    var keySentinel = {}, keyCaught, rhsCalls = 0;
    var throwingKey = {toString: function () { throw keySentinel; }};
    try { keyTarget[throwingKey] = ++rhsCalls; } catch (keyError) { keyCaught = keyError; }
    check(keyCaught === keySentinel && rhsCalls === 0, "key exception precedes RHS");
    var nullCaught = false;
    try { null.slot = ++rhsCalls; } catch (nullError) { nullCaught = nullError instanceof TypeError; }
    check(nullCaught && rhsCalls === 0, "null base checked before RHS");
    keyConversions = 0;
    var membershipCaught = false;
    try { callbackKey in 0; } catch (membershipError) { membershipCaught = membershipError instanceof TypeError; }
    check(membershipCaught && keyConversions === 0, "membership validates receiver before conversion");
    keyConversions = 0;
    check(delete keyTarget[callbackKey] && !("slot" in keyTarget), "delete converts callback key");
    Object.defineProperty(keyTarget, "slot", {value: 23, configurable: false});
    keyConversions = 0;
    check(delete keyTarget[callbackKey] === false, "sloppy callback-key delete");
    keyConversions = 0;
    var deleteCaught = false;
    try { (function () { "use strict"; delete keyTarget[callbackKey]; }()); }
    catch (deleteError) { deleteCaught = deleteError instanceof TypeError; }
    check(deleteCaught && keyConversions === 1, "strict callback-key delete");
    var indexed = [], indexCalls = 0;
    var indexKey = {toString: function () { indexCalls++; return "3"; }};
    indexed[indexKey] = 29;
    check(indexCalls === 1 && indexed.length === 4 && indexed[3] === 29,
          "converted index writes retain array length semantics");
    indexCalls = 0;
    check(indexed[indexKey] === 29 && indexKey in indexed && indexCalls === 2,
          "converted indices read and probe dense array properties");
    var characterKey = {toString: function () { return "1"; }};
    check("a\u6f22c"[characterKey] === "\u6f22", "converted index reads a UTF-16 string character");
    var invalidPrimitiveKey = {toString: function () { return {}; }, valueOf: function () { return {}; }};
    var invalidPrimitiveCaught = false;
    try { keyTarget[invalidPrimitiveKey]; } catch (primitiveError) { invalidPrimitiveCaught = primitiveError instanceof TypeError; }
    check(invalidPrimitiveCaught, "failed key conversion throws the guest TypeError");
    var negativeSetter = 0;
    Object.defineProperty(namedArray, "-2", {
        get: function () { return negativeSetter; },
        set: function (value) { negativeSetter = value; }, configurable: true
    });
    namedArray[-2] = 19;
    check(namedArray[-2] === 19 && namedArray.length === 1,
          "negative numeric keys honor accessor descriptors without changing length");
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
    check(Object.getOwnPropertyNames(boxed).join(",") === "0,1,length" &&
          Object.keys(boxed).join(",") === "0,1" && boxed.hasOwnProperty("1") &&
          boxed.propertyIsEnumerable("1") && !boxed.propertyIsEnumerable("length"),
          "wrapper enumeration and own-property predicates");
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
    var view = new Uint16Array(3);
    view[1] = 513;
    check(Object.keys(view).join(",") === "0,1,2" &&
          Object.getOwnPropertyNames(view).join(",") === "0,1,2" &&
          Object.getOwnPropertyDescriptor(view, "1").value === 513,
          "typed view virtual indices participate in shared reflection");
    var viewConversions = 0;
    Object.defineProperty(view, "1", {value: {valueOf: function () { viewConversions++; return 1025; }}});
    check(view[1] === 1025 && viewConversions === 1, "view definition converts value in guest activation");
    var viewRejected = false;
    try { Object.defineProperty(view, "1", {value: {valueOf: function () {
        throw new Error("invalid descriptor must reject before conversion");
    }}, writable: false}); }
    catch (error) { viewRejected = error instanceof TypeError; }
    check(viewRejected && view[1] === 1025, "invalid view descriptor rejects before conversion");
    check(Object.getOwnPropertyDescriptor(target, key).value === 42 && target.hasOwnProperty(key),
          "reflective key conversion uses guest callbacks");
    var invalidKeysRejected = false;
    try { Object.keys(null); } catch (error) { invalidKeysRejected = error instanceof TypeError; }
    check(invalidKeysRejected, "invalid reflection target throws in guest");
    var frozenDuringConversion = [1, 2, 3], freezeConversions = 0;
    Object.defineProperty(frozenDuringConversion, "length", {value: {valueOf: function () {
        if (freezeConversions++ === 0) Object.defineProperty(frozenDuringConversion, "length", {writable: false});
        return 3;
    }}});
    check(freezeConversions === 2 && !Object.getOwnPropertyDescriptor(frozenDuringConversion, "length").writable,
          "conversion cannot resurrect length writability");
    var retainedDescriptor = {};
    Object.defineProperty(retainedDescriptor, "value", {get: function () { return {child: {marker: 17}}; }});
    Object.defineProperty(retainedDescriptor, "writable", {get: function () {
        for (var round = 0; round < 600; round++) {
            var garbage = {round: round, values: [round, round + 1]};
        }
        return true;
    }});
    Object.defineProperty(target, "retained", retainedDescriptor);
    check(target.retained.child.marker === 17, "earlier descriptor result survives later callback allocation");
    var originalCall = Function.prototype.call;
    Function.prototype.call = function () { throw new Error("public call consulted by an internal operation"); };
    try {
        var protectedKey = {toString: function () { return "protectedCall"; }};
        Object.defineProperty(target, protectedKey, {value: 67});
        check(Object.getOwnPropertyDescriptor(target, protectedKey).value === 67,
              "internal conversion does not consult mutable Function.prototype.call");
    } finally { Function.prototype.call = originalCall; }
    var privateArray = [1, 2, 3];
    Object.defineProperty(privateArray, "1", {enumerable: false});
    privateArray.extra = 7;
    check(Object.keys(privateArray).join(",") === "0,2,extra" &&
          Object.getOwnPropertyNames(privateArray).join(",") === "0,1,2,length,extra",
          "materialized indices have numeric ordering and honor enumerability");
    var message = "object operations integration passed";
    if (typeof print === "function") print(message);
    else console.log(message);
}());
