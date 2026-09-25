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

print("standalone integration: passed");
