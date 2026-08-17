/*
 * Node.js 0.10-compatible framebuffer-window module using the core X11 wire
 * protocol and built-in modules only. Requiring this file has no side effects.
 */
var fs = require("fs");
var net = require("net");

var nodeAnimationFrameDeadline = 0;
var requestNextAnimationFrame = typeof requestAnimationFrame === "function" ?
    requestAnimationFrame : function (callback) {
        var now = new Date().getTime();
        if (!nodeAnimationFrameDeadline || nodeAnimationFrameDeadline <= now) {
            nodeAnimationFrameDeadline = now + 1000 / 60;
        }
        var deadline = nodeAnimationFrameDeadline;
        nodeAnimationFrameDeadline += 1000 / 60;
        return setTimeout(function () {
            callback(new Date().getTime());
        }, Math.max(0, deadline - now));
    };

var WIDTH;
var HEIGHT;
var FRAME_DELAY;
var framesPerSecond;
var rgb;
var framebuffers;
var drawFramebufferIndex;
var pointerX;
var pointerY;
var socket = null;
var incoming;
var setupComplete;
var frameRequested;
var animationFramePending;
var animationFrameReady;
var rendering;
var uploadInProgress;
var nextFrameDeadline;
var closing;
var connection;
var windowOptions;
var windowApi;

function allocate(length) {
    if (Buffer.alloc) return Buffer.alloc(length);
    var buffer = new Buffer(length);
    for (var i = 0; i < length; i++) writeByte(buffer, i, 0);
    return buffer;
}

function readByte(buffer, offset) {
    return buffer._nodeBytes ? buffer._nodeBytes[offset] : buffer[offset];
}

function writeByte(buffer, offset, value) {
    if (buffer._nodeBytes) buffer._nodeBytes[offset] = value & 255;
    else buffer[offset] = value & 255;
}

function bufferFromString(value) {
    if (Buffer.from) return Buffer.from(value, "ascii");
    return new Buffer(value, "ascii");
}

function appendBuffer(left, right) {
    if (left.length === 0) return right;
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
        throw new Error("node_x11 requires a local Unix-domain X11 display");
    }
    return {
        display: match[2],
        screen: match[3] ? parseInt(match[3], 10) : 0,
        socketPath: "/tmp/.X11-unix/X" + match[2]
    };
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
        var protocol = name.toString("ascii");
        /* Some display managers store a wildcard entry with an empty number. */
        if ((number === displayNumber || number === "") &&
            protocol === "MIT-MAGIC-COOKIE-1" &&
            (family === 256 || family === 65535 || address.length === 0)) {
            selected = {name: name, data: cookie};
        }
    }
    if (!selected) {
        console.error("warning: no MIT-MAGIC-COOKIE-1 entry found; trying unauthenticated X11");
        return {name: allocate(0), data: allocate(0)};
    }
    return selected;
}

function makeSetupRequest(authority) {
    var nameLength = authority.name.length;
    var dataLength = authority.data.length;
    var request = allocate(12 + padded4(nameLength) + padded4(dataLength));
    writeByte(request, 0, 0x6c); /* little-endian byte order */
    request.writeUInt16LE(11, 2);
    request.writeUInt16LE(0, 4);
    request.writeUInt16LE(nameLength, 6);
    request.writeUInt16LE(dataLength, 8);
    authority.name.copy(request, 12);
    authority.data.copy(request, 12 + padded4(nameLength));
    return request;
}

function trailingZeros(mask) {
    var count = 0;
    while (count < 32 && ((mask >>> count) & 1) === 0) count++;
    return count;
}

function maskBits(mask, shift) {
    var count = 0;
    mask = mask >>> shift;
    while ((mask & 1) !== 0) {
        count++;
        mask = mask >>> 1;
    }
    return count;
}

function parseSetupReply(reply, screenNumber) {
    if (readByte(reply, 0) !== 1) {
        var reasonLength = readByte(reply, 1);
        throw new Error("X11 setup failed: " + reply.slice(8, 8 + reasonLength).toString("ascii"));
    }
    var body = 8;
    connection.resourceBase = reply.readUInt32LE(body + 4);
    connection.resourceMask = reply.readUInt32LE(body + 8);
    connection.resourceCounter = 1;
    connection.maxRequestLength = reply.readUInt16LE(body + 18) * 4;
    var screenCount = readByte(reply, body + 20);
    var formatCount = readByte(reply, body + 21);
    connection.imageByteOrder = readByte(reply, body + 22);
    connection.minimumKeycode = readByte(reply, body + 26);
    connection.maximumKeycode = readByte(reply, body + 27);
    var vendorLength = reply.readUInt16LE(body + 16);
    var offset = body + 32 + padded4(vendorLength);
    var formats = [];
    var i;
    for (i = 0; i < formatCount; i++) {
        formats.push({
            depth: readByte(reply, offset),
            bitsPerPixel: readByte(reply, offset + 1),
            scanlinePad: readByte(reply, offset + 2)
        });
        offset += 8;
    }
    if (screenNumber >= screenCount) throw new Error("DISPLAY requests an unavailable screen");

    for (i = 0; i < screenCount; i++) {
        var screenStart = offset;
        var depthCount = readByte(reply, screenStart + 39);
        var screen = {
            root: reply.readUInt32LE(screenStart),
            whitePixel: reply.readUInt32LE(screenStart + 8),
            blackPixel: reply.readUInt32LE(screenStart + 12),
            rootVisual: reply.readUInt32LE(screenStart + 32),
            rootDepth: readByte(reply, screenStart + 38)
        };
        offset = screenStart + 40;
        var selectedVisual = null;
        for (var depthIndex = 0; depthIndex < depthCount; depthIndex++) {
            var visualCount = reply.readUInt16LE(offset + 2);
            var visualOffset = offset + 8;
            for (var visualIndex = 0; visualIndex < visualCount; visualIndex++) {
                var visualId = reply.readUInt32LE(visualOffset);
                if (visualId === screen.rootVisual) {
                    selectedVisual = {
                        id: visualId,
                        redMask: reply.readUInt32LE(visualOffset + 8),
                        greenMask: reply.readUInt32LE(visualOffset + 12),
                        blueMask: reply.readUInt32LE(visualOffset + 16)
                    };
                }
                visualOffset += 24;
            }
            offset = visualOffset;
        }
        if (i === screenNumber) {
            connection.screen = screen;
            connection.visual = selectedVisual;
        }
    }

    if (!connection.visual) throw new Error("could not find the root visual");
    for (i = 0; i < formats.length; i++) {
        if (formats[i].depth === connection.screen.rootDepth) connection.format = formats[i];
    }
    if (!connection.format) throw new Error("could not find a pixmap format for the root depth");

    connection.redShift = trailingZeros(connection.visual.redMask);
    connection.greenShift = trailingZeros(connection.visual.greenMask);
    connection.blueShift = trailingZeros(connection.visual.blueMask);
    connection.redBits = maskBits(connection.visual.redMask, connection.redShift);
    connection.greenBits = maskBits(connection.visual.greenMask, connection.greenShift);
    connection.blueBits = maskBits(connection.visual.blueMask, connection.blueShift);
    connection.packedFramebuffer = connection.imageByteOrder === 0 &&
                                   connection.format.bitsPerPixel === 32 &&
                                   connection.format.scanlinePad === 32;
    connection.standardBgrx = connection.visual.redMask === 0x00ff0000 &&
                              connection.visual.greenMask === 0x0000ff00 &&
                              connection.visual.blueMask === 0x000000ff;
    if (connection.packedFramebuffer) {
        connection.redLookup = [];
        connection.greenLookup = [];
        connection.blueLookup = [];
        for (var channel = 0; channel < 256; channel++) {
            connection.redLookup.push(scaleChannel(channel, connection.redBits,
                                                   connection.redShift));
            connection.greenLookup.push(scaleChannel(channel, connection.greenBits,
                                                     connection.greenShift));
            connection.blueLookup.push(scaleChannel(channel, connection.blueBits,
                                                    connection.blueShift));
        }
    }
    var framebufferLength = WIDTH * HEIGHT * (connection.packedFramebuffer ? 4 : 3);
    framebuffers = [];
    for (var framebufferIndex = 0; framebufferIndex < 2; framebufferIndex++) {
        framebuffers.push(connection.packedFramebuffer &&
                          typeof Buffer.allocNative === "function" ?
                          Buffer.allocNative(framebufferLength) :
                          allocate(framebufferLength));
    }
    drawFramebufferIndex = 0;
    selectDrawFramebuffer();

    /* These fields become valid before the ready callback and first draw. */
    windowApi.pixelStride = WIDTH * (connection.packedFramebuffer ? 4 : 3);
    windowApi.pixelFormat = connection.packedFramebuffer && connection.standardBgrx ?
                            "bgrx32le" : "rgb24";
}

function selectDrawFramebuffer() {
    rgb = framebuffers[drawFramebufferIndex];
    windowApi.pixels = rgb;
    windowApi.pixelAddress = rgb._nodePointer || 0;
}

function resourceId() {
    var id = (connection.resourceBase |
             (connection.resourceCounter & connection.resourceMask)) >>> 0;
    connection.resourceCounter++;
    return id;
}

function sendRequest(request, callback) {
    if (request.length > connection.maxRequestLength) {
        throw new Error("X11 request exceeds the server maximum request size");
    }
    connection.sequence = (connection.sequence + 1) & 65535;
    socket.write(request, callback);
    return connection.sequence;
}

function sendRequestParts(header, payload, callback) {
    if (header.length + payload.length > connection.maxRequestLength) {
        throw new Error("X11 request exceeds the server maximum request size");
    }
    connection.sequence = (connection.sequence + 1) & 65535;
    socket.write(header);
    socket.write(payload, callback);
    return connection.sequence;
}

function createWindow() {
    connection.window = resourceId();
    connection.gc = resourceId();
    connection.backPixmap = resourceId();
    connection.sequence = 0;
    var eventMask = 1 | 2 | 4 | 8 | 64 | 32768 | 131072;

    var create = allocate(40);
    writeByte(create, 0, 1); /* CreateWindow */
    writeByte(create, 1, connection.screen.rootDepth);
    create.writeUInt16LE(10, 2);
    create.writeUInt32LE(connection.window, 4);
    create.writeUInt32LE(connection.screen.root, 8);
    create.writeInt16LE(80, 12);
    create.writeInt16LE(80, 14);
    create.writeUInt16LE(WIDTH, 16);
    create.writeUInt16LE(HEIGHT, 18);
    create.writeUInt16LE(0, 20);
    create.writeUInt16LE(1, 22); /* InputOutput */
    create.writeUInt32LE(connection.screen.rootVisual, 24);
    create.writeUInt32LE((1 << 1) | (1 << 11), 28); /* background + event mask */
    create.writeUInt32LE(connection.screen.blackPixel, 32);
    create.writeUInt32LE(eventMask, 36);
    sendRequest(create);

    var pixmap = allocate(16);
    writeByte(pixmap, 0, 53); /* CreatePixmap */
    writeByte(pixmap, 1, connection.screen.rootDepth);
    pixmap.writeUInt16LE(4, 2);
    pixmap.writeUInt32LE(connection.backPixmap, 4);
    pixmap.writeUInt32LE(connection.screen.root, 8);
    pixmap.writeUInt16LE(WIDTH, 12);
    pixmap.writeUInt16LE(HEIGHT, 14);
    sendRequest(pixmap);

    var gc = allocate(16);
    writeByte(gc, 0, 55); /* CreateGC */
    gc.writeUInt16LE(4, 2);
    gc.writeUInt32LE(connection.gc, 4);
    gc.writeUInt32LE(connection.window, 8);
    gc.writeUInt32LE(0, 12);
    sendRequest(gc);

    changeProperty(39, 31, bufferFromString(windowOptions.title || "node_x11 RGB framebuffer")); /* WM_NAME */
    changeProperty(67, 31, bufferFromString((windowOptions.instanceName || "node_x11") + "\0" + (windowOptions.className || "NodeX11") + "\0")); /* WM_CLASS */

    var map = allocate(8);
    writeByte(map, 0, 8); /* MapWindow */
    map.writeUInt16LE(2, 2);
    map.writeUInt32LE(connection.window, 4);
    sendRequest(map);
    queryKeyboardMapping();
}

function queryKeyboardMapping() {
    connection.keyboardMappingRequests = {};
    connection.keyboardMappings = {};
    connection.keyboardMappingReplies = 0;
    connection.keyboardMappingExpected = Math.ceil(
        (connection.maximumKeycode - connection.minimumKeycode + 1) / 100);
    for (var first = connection.minimumKeycode; first <= connection.maximumKeycode;
         first += 100) {
        var count = Math.min(100, connection.maximumKeycode - first + 1);
        queryKeyboardMappingRange(first, count);
    }
}

function queryKeyboardMappingRange(first, count) {
    var request = allocate(8);
    writeByte(request, 0, 101); /* GetKeyboardMapping */
    request.writeUInt16LE(2, 2);
    writeByte(request, 4, first);
    writeByte(request, 5, count);
    var sequence = sendRequest(request);
    connection.keyboardMappingRequests[sequence] = {first: first, count: count};
}

function parseKeyboardMapping(reply, mappingRequest) {
    var perKeycode = readByte(reply, 1);
    var offset = 32;
    for (var code = mappingRequest.first;
         code < mappingRequest.first + mappingRequest.count; code++) {
        var values = [];
        for (var slot = 0; slot < perKeycode; slot++) {
            values.push(reply.readUInt32LE(offset));
            offset += 4;
        }
        connection.keyboardMappings[code] = values;
    }
    connection.keysymsPerKeycode = perKeycode;
    connection.keyboardMappingReplies++;
    if (connection.keyboardMappingReplies === connection.keyboardMappingExpected) {
        if (typeof windowOptions.keyboardMapping === "function") {
            windowOptions.keyboardMapping({
                minimumKeycode: connection.minimumKeycode,
                maximumKeycode: connection.maximumKeycode,
                keysymsPerKeycode: perKeycode
            }, windowApi);
        }
    }
}

function changeProperty(property, type, data) {
    var request = allocate(24 + padded4(data.length));
    writeByte(request, 0, 18); /* ChangeProperty */
    writeByte(request, 1, 0);  /* Replace */
    request.writeUInt16LE(request.length / 4, 2);
    request.writeUInt32LE(connection.window, 4);
    request.writeUInt32LE(property, 8);
    request.writeUInt32LE(type, 12);
    writeByte(request, 16, 8);
    request.writeUInt32LE(data.length, 20);
    data.copy(request, 24);
    sendRequest(request);
}

function drawPixel(x, y, red, green, blue) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    if (connection.packedFramebuffer) {
        var pixel = connection.standardBgrx ? (red << 16) | (green << 8) | blue :
                    connection.redLookup[red] | connection.greenLookup[green] |
                    connection.blueLookup[blue];
        rgb.writeUInt32LE(pixel, (y * WIDTH + x) * 4);
        return;
    }
    var offset = (y * WIDTH + x) * 3;
    writeByte(rgb, offset, red);
    writeByte(rgb, offset + 1, green);
    writeByte(rgb, offset + 2, blue);
}


function renderFramebuffer(animationTime) {
    animationFramePending = false;
    if (closing || !frameRequested) return;
    if (nextFrameDeadline && animationTime < nextFrameDeadline) {
        queueAnimationFrame();
        return;
    }
    if (uploadInProgress || rendering) {
        animationFrameReady = true;
        return;
    }
    animationFrameReady = false;
    frameRequested = false;
    rendering = true;
    if (!nextFrameDeadline) nextFrameDeadline = animationTime;
    do {
        nextFrameDeadline += FRAME_DELAY;
    } while (nextFrameDeadline <= animationTime);
    selectDrawFramebuffer();
    if (typeof windowOptions.draw === "function") {
        windowOptions.draw(windowApi);
    }
    rendering = false;
    uploadInProgress = true;
    uploadFramebuffer(function () {
        uploadInProgress = false;
        drawFramebufferIndex = 1 - drawFramebufferIndex;
        if (frameRequested && animationFrameReady) {
            animationFrameReady = false;
            renderFramebuffer(new Date().getTime());
        } else if (frameRequested) {
            queueAnimationFrame();
        }
    });
}

function scaleChannel(value, bits, shift) {
    var maximum = bits >= 31 ? 0x7fffffff : Math.pow(2, bits) - 1;
    return (((value * maximum / 255) | 0) << shift) >>> 0;
}

function uploadFramebuffer(completion) {
    var bitsPerPixel = connection.format.bitsPerPixel;
    var bytesPerPixel = Math.ceil(bitsPerPixel / 8);
    var padBytes = connection.format.scanlinePad / 8;
    var rowBytes = Math.ceil((WIDTH * bytesPerPixel) / padBytes) * padBytes;
    var rowsPerRequest = Math.floor((connection.maxRequestLength - 24) / rowBytes);
    while (rowsPerRequest > 0 &&
           24 + padded4(rowBytes * rowsPerRequest) > connection.maxRequestLength) {
        rowsPerRequest--;
    }
    if (rowsPerRequest < 1) throw new Error("framebuffer row exceeds the X11 request limit");

    for (var firstRow = 0; firstRow < HEIGHT; firstRow += rowsPerRequest) {
        var bandHeight = Math.min(rowsPerRequest, HEIGHT - firstRow);
        if (connection.packedFramebuffer) {
            var firstByte = firstRow * rowBytes;
            var packedImage = rgb.slice(firstByte, firstByte + rowBytes * bandHeight);
            var packedRequest = makePutImageRequest(bandHeight, firstRow, packedImage.length);
            sendRequestParts(packedRequest, packedImage);
            continue;
        }
        var image = allocate(rowBytes * bandHeight);
        for (var bandY = 0; bandY < bandHeight; bandY++) {
            var y = firstRow + bandY;
            for (var x = 0; x < WIDTH; x++) {
                var rgbOffset = (y * WIDTH + x) * 3;
                var pixel = (scaleChannel(readByte(rgb, rgbOffset), connection.redBits, connection.redShift) |
                             scaleChannel(readByte(rgb, rgbOffset + 1), connection.greenBits, connection.greenShift) |
                             scaleChannel(readByte(rgb, rgbOffset + 2), connection.blueBits, connection.blueShift)) >>> 0;
                var imageOffset = bandY * rowBytes + x * bytesPerPixel;
                for (var byteIndex = 0; byteIndex < bytesPerPixel; byteIndex++) {
                    var shift = connection.imageByteOrder === 0 ? byteIndex * 8 :
                                (bytesPerPixel - byteIndex - 1) * 8;
                    writeByte(image, imageOffset + byteIndex, (pixel >>> shift) & 255);
                }
            }
        }

        var request = makePutImageRequest(bandHeight, firstRow, image.length);
        image.copy(request, 24);
        sendRequest(request);
    }
    copyBackBufferToWindow(completion);
}

function copyBackBufferToWindow(completion) {
    var request = allocate(28);
    writeByte(request, 0, 62); /* CopyArea */
    request.writeUInt16LE(7, 2);
    request.writeUInt32LE(connection.backPixmap, 4);
    request.writeUInt32LE(connection.window, 8);
    request.writeUInt32LE(connection.gc, 12);
    request.writeInt16LE(0, 16);
    request.writeInt16LE(0, 18);
    request.writeInt16LE(0, 20);
    request.writeInt16LE(0, 22);
    request.writeUInt16LE(WIDTH, 24);
    request.writeUInt16LE(HEIGHT, 26);
    sendRequest(request, completion);
}

function makePutImageRequest(bandHeight, firstRow, imageLength) {
    var requestLength = connection.packedFramebuffer ? 24 : 24 + padded4(imageLength);
    var request = allocate(requestLength);
    writeByte(request, 0, 72); /* PutImage */
    writeByte(request, 1, 2);  /* ZPixmap */
    request.writeUInt16LE((24 + padded4(imageLength)) / 4, 2);
    request.writeUInt32LE(connection.backPixmap, 4);
    request.writeUInt32LE(connection.gc, 8);
    request.writeUInt16LE(WIDTH, 12);
    request.writeUInt16LE(bandHeight, 14);
    request.writeInt16LE(0, 16);
    request.writeInt16LE(firstRow, 18);
    writeByte(request, 20, 0);
    writeByte(request, 21, connection.screen.rootDepth);
    return request;
}

function queueAnimationFrame() {
    if (animationFramePending || animationFrameReady || closing || !frameRequested) return;
    animationFramePending = true;
    requestNextAnimationFrame(renderFramebuffer);
}

function scheduleRedraw() {
    if (closing) return;
    frameRequested = true;
    queueAnimationFrame();
}

function updatePointerFromEvent(event) {
    pointerX = event.readInt16LE(24);
    pointerY = event.readInt16LE(26);
    if (pointerX < 0) pointerX = 0;
    if (pointerY < 0) pointerY = 0;
    if (pointerX >= WIDTH) pointerX = WIDTH - 1;
    if (pointerY >= HEIGHT) pointerY = HEIGHT - 1;
}

function keysymForEvent(event) {
    if (!connection.keyboardMappings || !connection.keysymsPerKeycode) return 0;
    var keycode = readByte(event, 1);
    var state = event.readUInt16LE(28);
    var mappings = connection.keyboardMappings[keycode];
    if (!mappings) return 0;
    var shifted = (state & 1) !== 0;
    var keysym = mappings[shifted ? 1 : 0] || mappings[0];
    if ((state & 2) !== 0 && keysym >= 65 && keysym <= 90) keysym += 32;
    else if ((state & 2) !== 0 && keysym >= 97 && keysym <= 122) keysym -= 32;
    return keysym;
}


function eventPosition(event) {
    updatePointerFromEvent(event);
    return {x: pointerX, y: pointerY};
}

function reportError(error) {
    if (typeof windowOptions.error === "function") windowOptions.error(error);
    else console.error(error.message || String(error));
}

function handleEvent(event) {
    var type = readByte(event, 0) & 127;
    if (type === 0) {
        var protocolError = new Error("X11 protocol error code " + readByte(event, 1) +
                                      " on request opcode " + readByte(event, 10));
        protocolError.code = readByte(event, 1);
        protocolError.opcode = readByte(event, 10);
        reportError(protocolError);
    } else if (type === 2 || type === 3) { /* KeyPress / KeyRelease */
        var keyEvent = {
            keycode: readByte(event, 1),
            keysym: keysymForEvent(event),
            state: event.readUInt16LE(28)
        };
        var keyHandler = type === 2 ? windowOptions.keyPress :
                                     windowOptions.keyRelease;
        if (typeof keyHandler === "function") {
            keyHandler(keyEvent, windowApi);
        }
        scheduleRedraw();
    } else if (type === 4 || type === 5) { /* ButtonPress / ButtonRelease */
        var position = eventPosition(event);
        var buttonEvent = {
            button: readByte(event, 1),
            state: event.readUInt16LE(28),
            x: position.x,
            y: position.y
        };
        var buttonHandler = type === 4 ? windowOptions.buttonPress :
                                             windowOptions.buttonRelease;
        if (typeof buttonHandler === "function") buttonHandler(buttonEvent, windowApi);
        scheduleRedraw();
    } else if (type === 6) { /* MotionNotify */
        var motionPosition = eventPosition(event);
        if (typeof windowOptions.pointerMove === "function") {
            windowOptions.pointerMove({
                state: event.readUInt16LE(28),
                x: motionPosition.x,
                y: motionPosition.y
            }, windowApi);
        }
        scheduleRedraw();
    } else if (type === 12) { /* Expose */
        if (typeof windowOptions.expose === "function") windowOptions.expose(windowApi);
        scheduleRedraw();
    } else if (type === 17) { /* DestroyNotify */
        closing = true;
        socket.end();
    }
}

function processIncoming() {
    if (!setupComplete) {
        if (incoming.length < 8) return;
        var setupLength = 8 + incoming.readUInt16LE(6) * 4;
        if (incoming.length < setupLength) return;
        var setup = incoming.slice(0, setupLength);
        incoming = incoming.slice(setupLength);
        parseSetupReply(setup, connection.display.screen);
        setupComplete = true;
        createWindow();
        var info = {
            width: WIDTH,
            height: HEIGHT,
            depth: connection.screen.rootDepth,
            bitsPerPixel: connection.format.bitsPerPixel,
            framesPerSecond: framesPerSecond,
            packedFramebuffer: connection.packedFramebuffer,
            windowId: connection.window
        };
        if (typeof windowOptions.ready === "function") {
            windowOptions.ready(info, windowApi);
        }
        scheduleRedraw();
    }

    while (incoming.length >= 32) {
        var type = readByte(incoming, 0) & 127;
        var eventLength = 32;
        if (type === 1 || type === 35) eventLength += incoming.readUInt32LE(4) * 4;
        if (incoming.length < eventLength) return;
        var event = incoming.slice(0, eventLength);
        incoming = incoming.slice(eventLength);
        var replySequence = event.readUInt16LE(2);
        var mappingRequest = connection.keyboardMappingRequests &&
                             connection.keyboardMappingRequests[replySequence];
        if (type === 1 && mappingRequest) {
            parseKeyboardMapping(event, mappingRequest);
            delete connection.keyboardMappingRequests[replySequence];
        } else {
            handleEvent(event);
        }
    }
}

function createFramebufferWindow(options) {
    options = options || {};
    if (socket) throw new Error("node_x11 currently supports one window per process");

    WIDTH = options.width === undefined ? 256 : Number(options.width);
    HEIGHT = options.height === undefined ? 192 : Number(options.height);
    framesPerSecond = options.fps === undefined ? 20 : Number(options.fps);
    if (!(framesPerSecond >= 1 && framesPerSecond <= 120)) {
        throw new Error("fps must be between 1 and 120");
    }
    if (!(WIDTH >= 64 && WIDTH <= 1024) || !(HEIGHT >= 64 && HEIGHT <= 1024) ||
        Math.floor(WIDTH) !== WIDTH || Math.floor(HEIGHT) !== HEIGHT ||
        WIDTH * HEIGHT > 1048576) {
        throw new Error("framebuffer dimensions must be integers in 64..1024 and at most 1048576 pixels");
    }

    FRAME_DELAY = 1000 / framesPerSecond;
    rgb = null;
    pointerX = Math.floor(WIDTH / 2);
    pointerY = Math.floor(HEIGHT / 2);
    incoming = allocate(0);
    setupComplete = false;
    frameRequested = false;
    animationFramePending = false;
    animationFrameReady = false;
    rendering = false;
    uploadInProgress = false;
    nextFrameDeadline = 0;
    closing = false;
    connection = {};
    windowOptions = options;
    connection.display = parseDisplay(options.display || process.env.DISPLAY || ":0");

    windowApi = {
        width: WIDTH,
        height: HEIGHT,
        fps: framesPerSecond,
        pixels: null,
        pixelAddress: 0,
        pixelStride: 0,
        pixelFormat: null,
        setPixel: drawPixel,
        requestFrame: scheduleRedraw,
        close: function () {
            closing = true;
            if (socket) socket.end();
        },
        pointer: function () {
            return {x: pointerX, y: pointerY};
        }
    };

    var authority = loadAuthority(connection.display.display);
    socket = net.createConnection(connection.display.socketPath);
    socket.on("connect", function () {
        socket.write(makeSetupRequest(authority));
    });
    socket.on("data", function (data) {
        incoming = appendBuffer(incoming, data);
        processIncoming();
    });
    socket.on("error", function (error) {
        reportError(new Error("X11 connection error: " + error.message));
    });
    socket.on("close", function () {
        if (typeof windowOptions.close === "function") windowOptions.close(windowApi);
        socket = null;
    });
    return windowApi;
}

module.exports = {
    createFramebufferWindow: createFramebufferWindow,
    keysyms: {
        escape: 0xff1b,
        backspace: 0xff08,
        returnKey: 0xff0d,
        left: 0xff51,
        up: 0xff52,
        right: 0xff53,
        down: 0xff54,
        f1: 0xffbe
    }
};
