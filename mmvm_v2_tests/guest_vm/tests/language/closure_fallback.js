function exerciseGuardFallback() {
    var data = {length: 94};
    data.readLength = function () { return 3; };
    data.slice = function () { return {length: 3}; };
    function field(state) {
        if (state.offset + 2 > data.length) throw new Error("data binding changed");
        var length = data.readLength(state.offset);
        state.offset += 2;
        if (state.offset + length > data.length) throw new Error("field is truncated");
        var result = data.slice(state.offset, state.offset + length);
        state.offset += length;
        return result;
    }
    var state = {offset: 0};
    field(state);
    field(state);
    assertEqual(data.length, 94,
                "guard fallback preserves captured object bindings");
}

exerciseGuardFallback();

function makeNestedConstructorValue() {
    function NestedBuffer(values) {
        var bytes = [];
        var index;
        if (values && values._nodeBytes) {
            bytes = values._nodeBytes.slice(0);
        } else if (values) {
            for (index = 0; index < values.length; index++) {
                bytes.push(values[index] & 255);
            }
        }
        this._nodeBytes = bytes;
        this.length = bytes.length;
    }
    NestedBuffer.prototype.slice = function (start, end) {
        start = start || 0;
        end = end === undefined ? this.length : end;
        return new NestedBuffer(this._nodeBytes.slice(start, end));
    };
    return new NestedBuffer([1, 2, 3, 4]);
}

var nestedOriginal = makeNestedConstructorValue();
var nestedSlice = nestedOriginal.slice(1, 4);
assertEqual(nestedOriginal === nestedSlice, false,
            "nested constructor returns a distinct receiver");
assertEqual(nestedOriginal.length, 4,
            "nested construction does not mutate the source receiver");
assertEqual(nestedSlice.length, 3, "nested constructor initializes new receiver");

/* Each invocation must own a distinct captured environment.  This is the
 * closure pattern used by module installers and compiler method tables. */
var installedClosures = {};
function installCapturedMethod(name) {
    installedClosures[name] = function () { return name; };
}
installCapturedMethod("first");
installCapturedMethod("second");
assertEqual(installedClosures.first(), "first",
            "first installed closure retains its call environment");
assertEqual(installedClosures.second(), "second",
            "second installed closure retains its call environment");

/* A constructor call is deferred after the semantic path creates its receiver:
 * the guest callee runs on the following interpreter iteration.  Collection
 * during that call must retain the pending receiver, and returning must publish
 * the new value rather than an obsolete destination-register value. */
function CollectingConstructor(value) {
    this.value = value;
    guestCollect();
}
var collectedConstruction = new CollectingConstructor(73);
assertEqual(collectedConstruction.value, 73,
            "constructor result survives collection before return");
