/*
 * JavaScript-only X11 test driver for demo8 rasterizer-mode switching.
 *
 * This file deliberately carries its own minimal X11 wire bindings.  It uses
 * only the built-in fs and net modules and is compatible with Node.js 0.10 and
 * with js_min.exe through node_runner.js.  It finds the demo window by WM_NAME,
 * obtains the F2 keycode from the X server, and sends core KeyPress/KeyRelease
 * events directly to that window.
 */
var fs = require("fs");
var net = require("net");

function allocate(length) {
    if (Buffer.alloc) return Buffer.alloc(length);
    var buffer = new Buffer(length);
    for (var index = 0; index < length; index++) buffer[index] = 0;
    return buffer;
}

function byteAt(buffer, offset) {
    return buffer._nodeBytes ? buffer._nodeBytes[offset] : buffer[offset];
}

function setByte(buffer, offset, value) {
    if (buffer._nodeBytes) buffer._nodeBytes[offset] = value & 255;
    else buffer[offset] = value & 255;
}

function appendBuffer(left, right) {
    if (!left.length) return right;
    var result = allocate(left.length + right.length);
    left.copy(result, 0);
    right.copy(result, left.length);
    return result;
}

function padded4(length) {
    return (length + 3) & ~3;
}

function parseDisplay(value) {
    var match = /^([^:]*):([0-9]+)(?:\.([0-9]+))?$/.exec(value || "");
    if (!match) throw new Error("unsupported DISPLAY value: " + value);
    if (match[1] && match[1] !== "unix" && match[1] !== "localhost") {
        throw new Error("demo8_x11_test requires a local Unix X11 display");
    }
    return {number: match[2],
            screen: match[3] ? parseInt(match[3], 10) : 0,
            socketPath: "/tmp/.X11-unix/X" + match[2]};
}

function readAuthorityField(data, state) {
    if (state.offset + 2 > data.length) throw new Error("truncated Xauthority file");
    var length = data.readUInt16BE(state.offset);
    state.offset += 2;
    if (state.offset + length > data.length) throw new Error("truncated Xauthority field");
    var field = data.slice(state.offset, state.offset + length);
    state.offset += length;
    return field;
}

function loadAuthority(displayNumber) {
    var path = process.env.XAUTHORITY || process.env.HOME + "/.Xauthority";
    var data;
    try { data = fs.readFileSync(path); }
    catch (error) {
        console.error("warning: could not read " + path + "; trying unauthenticated X11");
        return {name: allocate(0), data: allocate(0)};
    }
    var state = {offset: 0};
    var selected = null;
    while (state.offset < data.length) {
        if (state.offset + 2 > data.length) break;
        var family = data.readUInt16BE(state.offset);
        state.offset += 2;
        var address = readAuthorityField(data, state);
        var number = readAuthorityField(data, state).toString("ascii");
        var name = readAuthorityField(data, state);
        var cookie = readAuthorityField(data, state);
        if ((number === displayNumber || number === "") &&
            name.toString("ascii") === "MIT-MAGIC-COOKIE-1" &&
            (family === 256 || family === 65535 || !address.length)) {
            selected = {name: name, data: cookie};
        }
    }
    if (!selected) {
        console.error("warning: no Xauthority cookie found; trying unauthenticated X11");
        return {name: allocate(0), data: allocate(0)};
    }
    return selected;
}

function setupRequest(authority) {
    var request = allocate(12 + padded4(authority.name.length) +
                           padded4(authority.data.length));
    setByte(request, 0, 0x6c);
    request.writeUInt16LE(11, 2);
    request.writeUInt16LE(authority.name.length, 6);
    request.writeUInt16LE(authority.data.length, 8);
    authority.name.copy(request, 12);
    authority.data.copy(request, 12 + padded4(authority.name.length));
    return request;
}

function parseOptions(argv) {
    var options = {title: "demo8.js Welsh upland rally", count: 3,
                   delay: 1000, depth: 3};
    for (var index = 2; index < argv.length; index++) {
        var option = argv[index];
        if (option === "--title") options.title = argv[++index];
        else if (option === "--count") options.count = parseInt(argv[++index], 10);
        else if (option === "--delay") options.delay = parseInt(argv[++index], 10);
        else if (option === "--depth") options.depth = parseInt(argv[++index], 10);
        else if (option === "--help" || option === "-h") {
            console.log("usage: demo8_x11_test.js [--title TEXT] [--count N] " +
                        "[--delay MS] [--depth N]");
            process.exit(0);
        } else throw new Error("unknown option: " + option);
    }
    if (!(options.count >= 1 && options.count <= 20)) {
        throw new Error("--count must be between 1 and 20");
    }
    if (!(options.delay >= 0 && options.delay <= 60000)) {
        throw new Error("--delay must be between 0 and 60000");
    }
    return options;
}

function X11TestClient(options) {
    this.options = options;
    this.display = parseDisplay(process.env.DISPLAY || ":0");
    this.socket = null;
    this.incoming = allocate(0);
    this.setupComplete = false;
    this.sequence = 0;
    this.pending = {};
    this.root = 0;
    this.minimumKeycode = 0;
    this.maximumKeycode = 0;
}

X11TestClient.prototype.send = function (request, callback) {
    this.sequence = (this.sequence + 1) & 65535;
    if (callback) this.pending[this.sequence] = callback;
    this.socket.write(request);
    return this.sequence;
};

X11TestClient.prototype.parseSetup = function (reply) {
    if (byteAt(reply, 0) !== 1) {
        throw new Error("X11 setup failed: " +
                        reply.slice(8, 8 + byteAt(reply, 1)).toString("ascii"));
    }
    var body = 8;
    var screenCount = byteAt(reply, body + 20);
    var formatCount = byteAt(reply, body + 21);
    this.minimumKeycode = byteAt(reply, body + 26);
    this.maximumKeycode = byteAt(reply, body + 27);
    var vendorLength = reply.readUInt16LE(body + 16);
    var offset = body + 32 + padded4(vendorLength) + formatCount * 8;
    if (this.display.screen >= screenCount) throw new Error("DISPLAY screen is unavailable");
    for (var screenIndex = 0; screenIndex < screenCount; screenIndex++) {
        var screenStart = offset;
        var depthCount = byteAt(reply, screenStart + 39);
        if (screenIndex === this.display.screen) this.root = reply.readUInt32LE(screenStart);
        offset = screenStart + 40;
        for (var depthIndex = 0; depthIndex < depthCount; depthIndex++) {
            var visualCount = reply.readUInt16LE(offset + 2);
            offset += 8 + visualCount * 24;
        }
    }
};

X11TestClient.prototype.processIncoming = function () {
    if (!this.setupComplete) {
        if (this.incoming.length < 8) return;
        var setupLength = 8 + this.incoming.readUInt16LE(6) * 4;
        if (this.incoming.length < setupLength) return;
        var setup = this.incoming.slice(0, setupLength);
        this.incoming = this.incoming.slice(setupLength);
        this.parseSetup(setup);
        this.setupComplete = true;
        this.findWindow();
    }
    while (this.incoming.length >= 32) {
        var type = byteAt(this.incoming, 0) & 127;
        var length = type === 1 ? 32 + this.incoming.readUInt32LE(4) * 4 : 32;
        if (this.incoming.length < length) return;
        var message = this.incoming.slice(0, length);
        this.incoming = this.incoming.slice(length);
        var sequence = message.readUInt16LE(2);
        var callback = this.pending[sequence];
        if (callback) {
            delete this.pending[sequence];
            callback(type === 0 ? new Error("X11 error code " + byteAt(message, 1)) : null,
                     message);
        }
    }
};

X11TestClient.prototype.queryTree = function (window, callback) {
    var request = allocate(8);
    setByte(request, 0, 15);
    request.writeUInt16LE(2, 2);
    request.writeUInt32LE(window, 4);
    this.send(request, function (error, reply) {
        if (error) return callback(error);
        var count = reply.readUInt16LE(16);
        var children = [];
        for (var index = 0; index < count; index++) {
            children.push(reply.readUInt32LE(32 + index * 4));
        }
        callback(null, children);
    });
};

X11TestClient.prototype.getWindowName = function (window, callback) {
    var request = allocate(24);
    setByte(request, 0, 20);
    request.writeUInt16LE(6, 2);
    request.writeUInt32LE(window, 4);
    request.writeUInt32LE(39, 8); /* WM_NAME */
    request.writeUInt32LE(0, 12); /* AnyPropertyType */
    request.writeUInt32LE(0, 16);
    request.writeUInt32LE(256, 20);
    this.send(request, function (error, reply) {
        if (error) return callback(null, "");
        var format = byteAt(reply, 1);
        var units = reply.readUInt32LE(16);
        var byteLength = units * (format / 8);
        callback(null, format === 8 ? reply.slice(32, 32 + byteLength).toString("ascii") : "");
    });
};

X11TestClient.prototype.searchChildren = function (parent, depth, callback) {
    var client = this;
    this.queryTree(parent, function (error, children) {
        if (error) return callback(error);
        var childIndex = 0;
        function next() {
            if (childIndex >= children.length) return callback(null, 0);
            var child = children[childIndex++];
            client.getWindowName(child, function (nameError, name) {
                if (name === client.options.title) return callback(null, child);
                if (depth <= 0) return next();
                client.searchChildren(child, depth - 1, function (searchError, found) {
                    if (searchError) return callback(searchError);
                    if (found) return callback(null, found);
                    next();
                });
            });
        }
        next();
    });
};

X11TestClient.prototype.findWindow = function () {
    var client = this;
    this.searchChildren(this.root, this.options.depth, function (error, window) {
        if (error) return client.fail(error);
        if (!window) return client.fail(new Error("could not find X11 window titled " +
                                                 client.options.title));
        client.window = window;
        client.queryF2Keycode();
    });
};

X11TestClient.prototype.queryF2Keycode = function () {
    var client = this;
    var count = this.maximumKeycode - this.minimumKeycode + 1;
    var request = allocate(8);
    setByte(request, 0, 101);
    request.writeUInt16LE(2, 2);
    setByte(request, 4, this.minimumKeycode);
    setByte(request, 5, count);
    this.send(request, function (error, reply) {
        if (error) return client.fail(error);
        var perKeycode = byteAt(reply, 1);
        var offset = 32;
        var keycode = 0;
        for (var code = client.minimumKeycode;
             code <= client.maximumKeycode; code++) {
            for (var slot = 0; slot < perKeycode; slot++) {
                if (reply.readUInt32LE(offset) === 0xffbf) keycode = code;
                offset += 4;
            }
        }
        if (!keycode) return client.fail(new Error("F2 keysym is absent from X11 mapping"));
        client.keycode = keycode;
        client.runToggles(0);
    });
};

X11TestClient.prototype.sendKeyEvent = function (type, mask) {
    var request = allocate(44);
    setByte(request, 0, 25); /* SendEvent */
    request.writeUInt16LE(11, 2);
    request.writeUInt32LE(this.window, 4);
    request.writeUInt32LE(mask, 8);
    setByte(request, 12, type);
    setByte(request, 13, this.keycode);
    request.writeUInt32LE(this.root, 20);
    request.writeUInt32LE(this.window, 24);
    setByte(request, 42, 1); /* same-screen */
    this.send(request);
};

X11TestClient.prototype.runToggles = function (index) {
    var client = this;
    if (index >= this.options.count) {
        console.log("sent " + this.options.count + " F2 toggle(s) to X11 window 0x" +
                    this.window.toString(16));
        this.socket.end();
        return;
    }
    this.sendKeyEvent(2, 1); /* KeyPress / KeyPressMask */
    this.sendKeyEvent(3, 2); /* KeyRelease / KeyReleaseMask */
    console.log("sent F2 toggle " + (index + 1) + "/" + this.options.count);
    setTimeout(function () { client.runToggles(index + 1); }, this.options.delay);
};

X11TestClient.prototype.fail = function (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
    if (this.socket) this.socket.end();
};

X11TestClient.prototype.run = function () {
    var client = this;
    var authority = loadAuthority(this.display.number);
    this.socket = net.createConnection(this.display.socketPath);
    this.socket.on("connect", function () {
        client.socket.write(setupRequest(authority));
    });
    this.socket.on("data", function (data) {
        client.incoming = appendBuffer(client.incoming, data);
        try { client.processIncoming(); }
        catch (error) { client.fail(error); }
    });
    this.socket.on("error", function (error) { client.fail(error); });
};

try {
    new X11TestClient(parseOptions(process.argv)).run();
} catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
}
