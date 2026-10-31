print("standalone integration: globals");
var standalonePerformance = standalonePerformance || {};
print("standalone integration: global object ready");
standalonePerformance.now = (function () {
    return standalonePerformance.now || Date.now;
}());
print("standalone integration: callback selected");

print("standalone integration: prototypes");
function StandaloneResult(time) {
    this.time = time;
}
StandaloneResult.prototype.valueOf = function () {
    return this.time;
};

print("standalone integration: static properties");
function StandaloneSuite(name, values) {
    this.name = name;
    this.values = values;
    StandaloneSuite.suites.push(this);
}
StandaloneSuite.suites = [];
StandaloneSuite.config = {
    enabled: undefined,
    deterministic: undefined
};
StandaloneSuite.makeCallback = function () {
    var seed = 49734321;
    return function () {
        seed = ((seed + 2127912214) + (seed << 12)) & -1;
        return seed;
    };
};

print("standalone integration: ES5 native operations");
if ("abc"[1] !== "b" || "\u20ac"[0] !== "\u20ac" ||
    "abc"[9] !== undefined) {
    throw new Error("native string index access is incorrect");
}
if (typeof Date.now() !== "number") {
    throw new Error("Date.now did not return a number");
}
var standaloneEncoded = encodeURIComponent("a b\u00a3");
if (standaloneEncoded !== "a%20b%C2%A3") {
    throw new Error("encodeURIComponent produced " + standaloneEncoded);
}
var standaloneBytes = unescape(standaloneEncoded);
if (standaloneBytes.length !== 5 ||
    standaloneBytes.charCodeAt(3) !== 194 ||
    standaloneBytes.charCodeAt(4) !== 163) {
    throw new Error("legacy unescape did not decode encoded UTF-8 bytes");
}
if (unescape("%u0x41%G1%2") !== "%u0x41%G1%2") {
    throw new Error("legacy unescape consumed an invalid escape");
}
var standaloneSplice = [1, 2, 3];
standaloneSplice.reverse();
standaloneSplice.splice(1, 1, 4, 5);
if (standaloneSplice.join(",") !== "3,4,5,1") {
    throw new Error("native reverse/splice result is incorrect");
}
if (Boolean(null) !== false || Boolean(standaloneSplice) !== true) {
    throw new Error("native Boolean conversion is incorrect");
}
var standaloneTyped = new Uint8Array(4);
standaloneTyped.set([7, 8], 1);
if (standaloneTyped[1] !== 7 || standaloneTyped[2] !== 8) {
    throw new Error("native typed-array set is incorrect");
}
var standaloneCopiedTyped = new Uint8Array([3, 4]);
if (standaloneCopiedTyped[0] !== 3 || standaloneCopiedTyped[1] !== 4) {
    throw new Error("native typed-array array copy is incorrect");
}
var standaloneArrayBuffer = new ArrayBuffer(16);
var standaloneInt32 = new Int32Array(standaloneArrayBuffer);
standaloneInt32[1] = -123456;
if (standaloneInt32.length !== 4 || standaloneInt32[1] !== -123456) {
    throw new Error("native shared ArrayBuffer view is incorrect");
}
if (["Richards"].indexOf("Richards") !== 0) {
    throw new Error("Array.prototype.indexOf failed");
}
if (Math.log(Math.E) < 0.999 || Math.log(Math.E) > 1.001) {
    throw new Error("Math.log failed");
}
if ((89.456).toPrecision(3) !== "89.5") {
    throw new Error("Number.prototype.toPrecision failed");
}

function standaloneSourceRetention(value) {
    /* source-retention-marker */
    return value + 1;
}
if (standaloneSourceRetention.toString().indexOf("source-retention-marker") < 0 ||
        standaloneSourceRetention(4) !== 5) {
    throw new Error("function source or execution was lost");
}
var standaloneLargeBuffer = Buffer.alloc(1024 * 1024 + 3);
standaloneLargeBuffer[0] = 65;
standaloneLargeBuffer[standaloneLargeBuffer.length - 1] = 91;
var standaloneLargeCopy = Buffer.from(standaloneLargeBuffer);
standaloneLargeCopy[1] = 66;
if (standaloneLargeCopy[standaloneLargeCopy.length - 1] !== 91 ||
        standaloneLargeBuffer[1] !== 0 ||
        standaloneLargeCopy.slice(0, 2).toString("ascii") !== "AB") {
    throw new Error("large buffer copy/view contents or ownership are incorrect");
}

print("standalone integration: dynamic library loading");
var standaloneIndirectEval = eval;
var standaloneLoadedLibrary = standaloneIndirectEval(
    "var standaloneLibrary = (function () {" +
    "var list = {length: 0};" +
    "Array.prototype.push.apply(list, ['a', 'b']);" +
    "var key = (function () {return this;}).call('named'); list[key] = 'ok';" +
    "var copied = Array.prototype.slice.call(list, 0);" +
    "var caught = false; try {Array.prototype.slice.call(undefined);} catch (e) {caught = true;}" +
    "return {text: copied[0] + copied[1], named: list[key], caught: caught," +
    "arrayText: ['a'] + ['b']," +
    "missing: (function () {})['notThere']," +
    "errorClass: Object.prototype.toString.call(new Error('probe'))};" +
    "}()); standaloneLibrary;");
if (standaloneLoadedLibrary.text !== "ab" ||
    standaloneLoadedLibrary.named !== "ok" || !standaloneLoadedLibrary.caught ||
    standaloneLoadedLibrary.arrayText !== "ab" ||
    standaloneLoadedLibrary.missing !== undefined ||
    standaloneLoadedLibrary.errorClass !== "[object Error]") {
    throw new Error("dynamic library loading/call semantics are incorrect");
}
if (standaloneIndirectEval("'use strict'; var standaloneStrictPrivate = 7; standaloneStrictPrivate;") !== 7 ||
    typeof standaloneStrictPrivate !== "undefined") {
    throw new Error("strict indirect eval completion or declaration isolation is incorrect");
}

print("standalone integration: callbacks and typed views");
var standaloneView = new Uint16Array(new ArrayBuffer(24), 4, 3);
var standaloneViewByteKey = "byte" + "Length";
if (standaloneView.byteLength !== 6 || standaloneView[standaloneViewByteKey] !== 6 ||
        standaloneView.byteOffset !== 4 || standaloneView.buffer.byteLength !== 24) {
    throw new Error("typed view byte metadata is incorrect");
}
function StandaloneBoundExample(left, right) { this.sum = left + right; return this.sum; }
var standaloneBoundReceiver = {};
var standaloneBoundCall = StandaloneBoundExample.bind(standaloneBoundReceiver, 7);
if (standaloneBoundCall(5) !== 12 || standaloneBoundReceiver.sum !== 12 ||
        standaloneBoundCall.length !== 1) throw new Error("bound call is incorrect");
var standaloneBoundInstance = new standaloneBoundCall(9);
if (standaloneBoundInstance.sum !== 16 ||
        !(standaloneBoundInstance instanceof StandaloneBoundExample) ||
        !(standaloneBoundInstance instanceof standaloneBoundCall)) {
    throw new Error("bound construction is incorrect");
}
var standaloneCallbackSource = [1, , 3], standaloneCallbackTotal = 0;
standaloneCallbackSource.forEach(function (value, index, source) {
    if (source !== standaloneCallbackSource || this !== standaloneBoundReceiver) {
        throw new Error("forEach callback arguments are incorrect");
    }
    standaloneCallbackTotal += value;
    if (index === 0) source.push(9);
}, standaloneBoundReceiver);
if (standaloneCallbackTotal !== 4) throw new Error("forEach visitation is incorrect");
var standaloneKeySource = Object.create({inherited: true});
standaloneKeySource.first = 1;
standaloneKeySource.second = 2;
Object.defineProperty(standaloneKeySource, "hidden", {value: 3});
if (Object.keys(standaloneKeySource).join(",") !== "first,second" ||
        " \ttext\u00a0".trim() !== "text" || Math.tan(0) !== 0) {
    throw new Error("own enumeration/string/numeric library operations are incorrect");
}

function standaloneNamedClosure() {
    var privateState = {value: 42};
    /* Direct eval makes descendant free-name resolution dynamic even though
     * this empty evaluation does not itself change the environment. */
    eval("");
    return function () { return privateState.value; };
}
if (standaloneNamedClosure()() !== 42 ||
        Object.prototype.hasOwnProperty.call("abc", "length") !== true ||
        Object.prototype.hasOwnProperty.call("abc", "1") !== true ||
        Object.prototype.hasOwnProperty.call("abc", "type") !== false ||
        [0.5, true, false, -0, NaN, Infinity].join("|") !== "0.5|true|false|0|NaN|Infinity") {
    throw new Error("dynamic closure lookup or primitive string conversion is incorrect");
}

print(require("./heap_access_test.js")(require("../heap.js")));
print("standalone integration: passed");
