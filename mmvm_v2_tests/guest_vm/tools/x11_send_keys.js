/* Minimal, dependency-free X11 key sender for repeatable interactive VM
 * profiling. Run with Node, or through node_runner.js under js_min.exe:
 *
 *   node guest_vm/tools/x11_send_keys.js WINDOW_ID KEYCODE...
 *
 * WINDOW_ID may be decimal or hexadecimal. KEYCODE is an X11 physical
 * keycode; the usual Xorg values are 9 for Escape and 42 for G. */
(function () {
    var fs = require("fs");
    var net = require("net");

    function padded4(length) {
        return (length + 3) & ~3;
    }

    function allocateBuffer(length) {
        if (Buffer.alloc) return Buffer.alloc(length);
        var buffer = new Buffer(length);
        buffer.fill(0);
        return buffer;
    }

    function parseDisplay(value) {
        var match = /^([^:]*):([0-9]+)(?:\.([0-9]+))?$/.exec(value || "");
        if (!match || (match[1] && match[1] !== "unix" &&
                       match[1] !== "localhost")) {
            throw new Error("a local Unix-domain DISPLAY is required");
        }
        return {number: match[2],
                socketPath: "/tmp/.X11-unix/X" + match[2]};
    }

    function authorityField(data, state) {
        var length = data.readUInt16BE(state.offset);
        state.offset += 2;
        var field = data.slice(state.offset, state.offset + length);
        state.offset += length;
        return field;
    }

    function loadAuthority(displayNumber) {
        var path = process.env.XAUTHORITY || process.env.HOME + "/.Xauthority";
        var data = fs.readFileSync(path);
        var state = {offset: 0};
        var selected = null;
        while (state.offset + 2 <= data.length) {
            var family = data.readUInt16BE(state.offset);
            state.offset += 2;
            var address = authorityField(data, state);
            var number = authorityField(data, state).toString("ascii");
            var name = authorityField(data, state);
            var cookie = authorityField(data, state);
            if ((number === displayNumber || number === "") &&
                name.toString("ascii") === "MIT-MAGIC-COOKIE-1" &&
                (family === 256 || family === 65535 || address.length === 0)) {
                selected = {name: name, data: cookie};
            }
        }
        if (!selected) throw new Error("no matching MIT-MAGIC-COOKIE-1 entry");
        return selected;
    }

    function setupRequest(authority) {
        var nameLength = authority.name.length;
        var dataLength = authority.data.length;
        var request = allocateBuffer(
            12 + padded4(nameLength) + padded4(dataLength));
        request[0] = 0x6c;
        request.writeUInt16LE(11, 2);
        request.writeUInt16LE(nameLength, 6);
        request.writeUInt16LE(dataLength, 8);
        authority.name.copy(request, 12);
        authority.data.copy(request, 12 + padded4(nameLength));
        return request;
    }

    function sendEventRequest(windowId, rootId, keycode, type) {
        var request = allocateBuffer(44);
        request[0] = 25;                 /* SendEvent */
        request.writeUInt16LE(11, 2);
        request.writeUInt32LE(windowId, 4);
        request.writeUInt32LE(0, 8);     /* deliver to window creator */
        request[12] = type;              /* KeyPress=2, KeyRelease=3 */
        request[13] = keycode;
        request.writeUInt32LE(rootId, 20);
        request.writeUInt32LE(windowId, 24);
        request[42] = 1;                 /* same_screen */
        return request;
    }

    function fail(message) {
        console.error("x11_send_keys: " + message);
        process.exit(1);
    }

    if (process.argv.length < 4) {
        fail("usage: x11_send_keys.js WINDOW_ID KEYCODE...");
    }
    var windowId = Number(process.argv[2]);
    if (!(windowId > 0)) fail("invalid window id");
    var keycodes = [];
    for (var argumentIndex = 3; argumentIndex < process.argv.length;
         argumentIndex++) {
        var keycode = Number(process.argv[argumentIndex]);
        if (!(keycode > 0 && keycode < 256 && keycode === Math.floor(keycode))) {
            fail("invalid X11 keycode: " + process.argv[argumentIndex]);
        }
        keycodes.push(keycode);
    }

    var display = parseDisplay(process.env.DISPLAY || ":0");
    var socket = net.createConnection(display.socketPath);
    var incoming = allocateBuffer(0);
    var setupDone = false;
    socket.on("connect", function () {
        socket.write(setupRequest(loadAuthority(display.number)));
    });
    socket.on("data", function (chunk) {
        if (setupDone) return;
        var combined = allocateBuffer(incoming.length + chunk.length);
        incoming.copy(combined, 0);
        chunk.copy(combined, incoming.length);
        incoming = combined;
        if (incoming.length < 8) return;
        var setupLength = 8 + incoming.readUInt16LE(6) * 4;
        if (incoming.length < setupLength) return;
        if (incoming[0] !== 1) fail("X11 setup was rejected");
        var body = 8;
        var vendorLength = incoming.readUInt16LE(body + 16);
        var formatCount = incoming[body + 21];
        var screenOffset = body + 32 + padded4(vendorLength) + formatCount * 8;
        var rootId = incoming.readUInt32LE(screenOffset);
        setupDone = true;
        var delay = 0;
        for (var index = 0; index < keycodes.length; index++) {
            (function (sentKeycode, sentDelay) {
                setTimeout(function () {
                    socket.write(sendEventRequest(
                        windowId, rootId, sentKeycode, 2));
                    socket.write(sendEventRequest(
                        windowId, rootId, sentKeycode, 3));
                    if (sentDelay === (keycodes.length - 1) * 150) {
                        setTimeout(function () { socket.end(); }, 100);
                    }
                }, sentDelay);
            }(keycodes[index], delay));
            delay += 150;
        }
    });
    socket.on("error", function (error) { fail(error.message); });
}());
