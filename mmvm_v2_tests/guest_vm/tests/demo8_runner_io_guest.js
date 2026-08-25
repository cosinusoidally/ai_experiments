/* Runs inside demo8_runner.js to exercise its exact inlined file/Buffer path. */
DemoRunner.define(function () {
    var path = process.env.XAUTHORITY || process.env.HOME + "/.Xauthority";
    var data = NodeFs.readFileSync(path);
    if (data.length < 2) throw new Error("runner probe read too few bytes: " + data.length);
    var firstWord = data.readUInt16BE(0);
    var manualSlice = new DemoRunner.Buffer(data._nodeBytes.slice(2, 5));
    if (data.length < 4 || manualSlice.length !== 3 || data === manualSlice) {
        throw new Error("manual Buffer construction aliased its input");
    }
    var directSlice = data.slice(2, 5);
    if (directSlice.length !== 3 || data === directSlice) {
        throw new Error("Buffer.slice aliased its source");
    }
    function authorityField(state) {
        if (state.offset + 2 > data.length) {
            throw new Error("probe truncated length at " + state.offset +
                            " of " + data.length);
        }
        var length = data.readUInt16BE(state.offset);
        state.offset += 2;
        if (state.offset + length > data.length) {
            throw new Error("probe truncated field length " + length + " at " +
                            state.offset + " of " + data.length);
        }
        var field = data.slice(state.offset, state.offset + length);
        state.offset += length;
        return field;
    }
    var state = {offset: 0};
    var entries = 0;
    while (state.offset < data.length) {
        state.offset += 2;
        var address = authorityField(state);
        if (data === address) throw new Error("authority address aliased input");
        var number = authorityField(state);
        if (data === number) throw new Error("authority display aliased input");
        number.toString("ascii");
        var name = authorityField(state);
        name.toString("ascii");
        authorityField(state);
        entries++;
    }
    if (state.offset !== data.length) {
        throw new Error("runner probe ended at " + state.offset + " of " + data.length);
    }
    console.log("demo8 runner I/O probe: " + data.length +
                " bytes, first BE word " + firstWord + ", entries " + entries);
    process.exit(0);
});
