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
