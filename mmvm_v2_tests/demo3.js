/*
 * Full-frame X11 blit benchmark with deliberately small CPU-side dirty areas.
 * Packed glyph and background copies use peek32/poke32 under MMVM and the
 * equivalent built-in Buffer operations under Node.js.
 */
var common = require("./demo_common.js");

var options = common.parseOptions(process.argv, "demo3.js");
var TEXT = "Hello world";
var FONT_SCALE = 2;
var FONT_WIDTH = 5;
var FONT_HEIGHT = 7;
var GLYPH_WIDTH = 12;
var GLYPH_HEIGHT = 16;
var background = makeBackground(options.width, options.height);
var glyphs = {};
var bufferStates = [];
var animationStartedAt = 0;
var displaySampleStartedAt = 0;
var displaySampleFrames = 0;
var displayedFps = 0;
var logSampleStartedAt = 0;
var logSampleFrames = 0;

var FONT_PATTERNS = {
    " ": "00000/00000/00000/00000/00000/00000/00000",
    "H": "10001/10001/10001/11111/10001/10001/10001",
    "e": "00000/01110/10001/11111/10000/10001/01110",
    "l": "01100/00100/00100/00100/00100/00100/01110",
    "o": "00000/01110/10001/10001/10001/10001/01110",
    "w": "00000/10001/10001/10101/10101/10101/01010",
    "r": "00000/10110/11001/10000/10000/10000/10000",
    "d": "00001/00001/01101/10011/10001/10011/01101",
    "F": "11111/10000/10000/11110/10000/10000/10000",
    "P": "11110/10001/10001/11110/10000/10000/10000",
    "S": "01111/10000/10000/01110/00001/00001/11110",
    "0": "01110/10001/10011/10101/11001/10001/01110",
    "1": "00100/01100/00100/00100/00100/00100/01110",
    "2": "01110/10001/00001/00010/00100/01000/11111",
    "3": "11110/00001/00001/01110/00001/00001/11110",
    "4": "00010/00110/01010/10010/11111/00010/00010",
    "5": "11111/10000/10000/11110/00001/00001/11110",
    "6": "01110/10000/10000/11110/10001/10001/01110",
    "7": "11111/00001/00010/00100/01000/01000/01000",
    "8": "01110/10001/10001/01110/10001/10001/01110",
    "9": "01110/10001/10001/01111/00001/00001/01110",
    ".": "00000/00000/00000/00000/00000/00110/00110"
};

function allocatePacked(length) {
    if (typeof Buffer.allocNative === "function") return Buffer.allocNative(length);
    if (typeof Buffer.alloc === "function") return Buffer.alloc(length);
    return new Buffer(length);
}

function readPacked(buffer, offset) {
    if (buffer._nodePointer) return peek32(buffer._nodePointer + offset) >>> 0;
    return buffer.readUInt32LE(offset) >>> 0;
}

function writePacked(buffer, offset, value) {
    if (buffer._nodePointer) poke32(buffer._nodePointer + offset, value);
    else buffer.writeUInt32LE(value >>> 0, offset);
}

function makeBackground(width, height) {
    var pixels = allocatePacked(width * height * 4);
    var offset = 0;
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var checker = (((x >> 5) + (y >> 5)) & 1) !== 0;
            var red = checker ? 20 : 13;
            var green = checker ? 34 : 24;
            var blue = checker ? 54 : 40;
            if ((x & 31) === 0 || (y & 31) === 0) {
                red = 42; green = 67; blue = 91;
            }
            if ((x + y * 2) % 127 < 2) {
                red = 22; green = 105; blue = 118;
            }
            if ((x * 17 + y * 31) % 997 === 0) {
                red = 230; green = 238; blue = 210;
            }
            writePacked(pixels, offset, (red << 16) | (green << 8) | blue);
            offset += 4;
        }
    }
    return pixels;
}

function glyphFor(character) {
    if (glyphs[character]) return glyphs[character];
    var spritePixels = allocatePacked(GLYPH_WIDTH * GLYPH_HEIGHT * 4);
    var spriteMask = new Array(GLYPH_WIDTH * GLYPH_HEIGHT);
    for (var maskIndex = 0; maskIndex < spriteMask.length; maskIndex++) {
        spriteMask[maskIndex] = 0;
    }
    var pattern = FONT_PATTERNS[character] || FONT_PATTERNS[" "];
    var rows = pattern.split("/");
    var row;
    var column;
    var scaleX;
    var scaleY;

    for (row = 0; row < FONT_HEIGHT; row++) {
        var bits = parseInt(rows[row], 2);
        for (column = 0; column < FONT_WIDTH; column++) {
            if (!(bits & (1 << (FONT_WIDTH - column - 1)))) continue;
            for (scaleY = 0; scaleY < FONT_SCALE; scaleY++) {
                for (scaleX = 0; scaleX < FONT_SCALE; scaleX++) {
                    var shadowX = column * FONT_SCALE + scaleX + 1;
                    var shadowY = row * FONT_SCALE + scaleY + 1;
                    var shadowIndex = shadowY * GLYPH_WIDTH + shadowX;
                    writePacked(spritePixels, shadowIndex * 4, 0x00000000);
                    spriteMask[shadowIndex] = 1;
                }
            }
        }
    }
    for (row = 0; row < FONT_HEIGHT; row++) {
        bits = parseInt(rows[row], 2);
        for (column = 0; column < FONT_WIDTH; column++) {
            if (!(bits & (1 << (FONT_WIDTH - column - 1)))) continue;
            for (scaleY = 0; scaleY < FONT_SCALE; scaleY++) {
                for (scaleX = 0; scaleX < FONT_SCALE; scaleX++) {
                    var pixelX = column * FONT_SCALE + scaleX;
                    var pixelY = row * FONT_SCALE + scaleY;
                    var pixelIndex = pixelY * GLYPH_WIDTH + pixelX;
                    writePacked(spritePixels, pixelIndex * 4, 0x00ffffff);
                    spriteMask[pixelIndex] = 1;
                }
            }
        }
    }
    glyphs[character] = {pixels: spritePixels, mask: spriteMask};
    return glyphs[character];
}

function copyBackgroundRectangle(framebuffer, x, y, width, height) {
    var minimumX = Math.max(0, x | 0);
    var minimumY = Math.max(0, y | 0);
    var maximumX = Math.min(framebuffer.width, (x + width) | 0);
    var maximumY = Math.min(framebuffer.height, (y + height) | 0);
    var sourcePointer = background._nodePointer || 0;
    var destinationPointer = framebuffer.pixelAddress;
    for (var pixelY = minimumY; pixelY < maximumY; pixelY++) {
        var offset = (pixelY * framebuffer.width + minimumX) * 4;
        for (var pixelX = minimumX; pixelX < maximumX; pixelX++) {
            if (sourcePointer && destinationPointer) {
                poke32(destinationPointer + offset, peek32(sourcePointer + offset));
            } else {
                framebuffer.pixels.writeUInt32LE(background.readUInt32LE(offset), offset);
            }
            offset += 4;
        }
    }
}

function blitGlyph(framebuffer, character, originX, originY) {
    var sprite = glyphFor(character);
    var sourcePointer = sprite.pixels._nodePointer || 0;
    var destinationPointer = framebuffer.pixelAddress;
    for (var y = 0; y < GLYPH_HEIGHT; y++) {
        var destinationY = originY + y;
        if (destinationY < 0 || destinationY >= framebuffer.height) continue;
        for (var x = 0; x < GLYPH_WIDTH; x++) {
            var destinationX = originX + x;
            if (destinationX < 0 || destinationX >= framebuffer.width) continue;
            var sourceIndex = y * GLYPH_WIDTH + x;
            if (!sprite.mask[sourceIndex]) continue;
            var sourceOffset = sourceIndex * 4;
            var packed = sourcePointer ? peek32(sourcePointer + sourceOffset) >>> 0 :
                                        sprite.pixels.readUInt32LE(sourceOffset) >>> 0;
            var destinationOffset =
                (destinationY * framebuffer.width + destinationX) * 4;
            if (destinationPointer) {
                poke32(destinationPointer + destinationOffset, packed);
            } else {
                framebuffer.pixels.writeUInt32LE(packed, destinationOffset);
            }
        }
    }
}

function bufferState(framebuffer) {
    for (var i = 0; i < bufferStates.length; i++) {
        if (bufferStates[i].pixels === framebuffer.pixels) return bufferStates[i];
    }
    var state = {pixels: framebuffer.pixels, initialized: false,
                 positions: [], fpsLabel: null, fpsX: 0};
    bufferStates.push(state);
    return state;
}

function updateMeasurements(now) {
    if (!displaySampleStartedAt) displaySampleStartedAt = now;
    if (!logSampleStartedAt) logSampleStartedAt = now;
    displaySampleFrames++;
    logSampleFrames++;

    var displayElapsed = now - displaySampleStartedAt;
    if (displayElapsed >= 1000) {
        displayedFps = displaySampleFrames * 1000 / displayElapsed;
        displaySampleFrames = 0;
        displaySampleStartedAt = now;
    }
    var logElapsed = now - logSampleStartedAt;
    if (options.debugEvents && logElapsed >= 5000) {
        console.log("frame rate: " + (logSampleFrames * 1000 / logElapsed).toFixed(1) +
                    " FPS (" + logSampleFrames + " full framebuffer blits in " +
                    (logElapsed / 1000).toFixed(1) + " seconds)");
        logSampleFrames = 0;
        logSampleStartedAt = now;
    }
}

function textPositions(now, framebuffer) {
    var elapsed = now - animationStartedAt;
    var phase = elapsed * 0.003;
    var amplitude = Math.min(34, Math.max(8, framebuffer.height / 7));
    var startX = Math.floor((framebuffer.width - TEXT.length * GLYPH_WIDTH) / 2);
    var centerY = Math.floor(framebuffer.height / 2 - GLYPH_HEIGHT / 2);
    var positions = [];
    for (var i = 0; i < TEXT.length; i++) {
        positions.push({x: startX + i * GLYPH_WIDTH,
                        y: centerY + Math.round(Math.sin(phase + i * 0.55) * amplitude)});
    }
    return positions;
}

function paintText(framebuffer, value, originX, originY) {
    for (var i = 0; i < value.length; i++) {
        blitGlyph(framebuffer, value.charAt(i), originX + i * GLYPH_WIDTH, originY);
    }
}

function draw(framebuffer) {
    if (framebuffer.pixelFormat !== "bgrx32le") {
        throw new Error("demo3 requires a little-endian BGRX 32-bit X11 framebuffer");
    }
    var now = new Date().getTime();
    if (!animationStartedAt) animationStartedAt = now;
    updateMeasurements(now);
    var state = bufferState(framebuffer);
    var fpsLabel = options.fpsCounter ? "FPS " + displayedFps.toFixed(1) : null;
    if (!state.initialized) {
        copyBackgroundRectangle(framebuffer, 0, 0, framebuffer.width, framebuffer.height);
        state.initialized = true;
    } else {
        for (var oldIndex = 0; oldIndex < state.positions.length; oldIndex++) {
            copyBackgroundRectangle(framebuffer,
                                    state.positions[oldIndex].x,
                                    state.positions[oldIndex].y,
                                    GLYPH_WIDTH, GLYPH_HEIGHT);
        }
        if (state.fpsLabel !== null && state.fpsLabel !== fpsLabel) {
            copyBackgroundRectangle(framebuffer, state.fpsX,
                                    framebuffer.height - GLYPH_HEIGHT,
                                    state.fpsLabel.length * GLYPH_WIDTH,
                                    GLYPH_HEIGHT);
        }
    }

    var positions = textPositions(now, framebuffer);
    for (var index = 0; index < TEXT.length; index++) {
        blitGlyph(framebuffer, TEXT.charAt(index),
                  positions[index].x, positions[index].y);
    }

    if (fpsLabel !== null && state.fpsLabel !== fpsLabel) {
        var labelX = Math.max(0, framebuffer.width - fpsLabel.length * GLYPH_WIDTH);
        paintText(framebuffer, fpsLabel, labelX, framebuffer.height - GLYPH_HEIGHT);
        state.fpsX = labelX;
    }
    state.fpsLabel = fpsLabel;
    state.positions = positions;
    framebuffer.requestFrame();
}

var window = common.createWindow({
    width: options.width,
    height: options.height,
    fps: options.fps,
    /* demo3 owns dirty-aware FPS painting and console sampling. */
    fpsCounter: false,
    debugEvents: false,
    title: "demo3.js full-frame blit benchmark",
    instanceName: "demo3",
    className: "NodeX11Demo",
    draw: draw,
    keyPress: function (event, activeWindow) {
        if (event.keysym === common.keysyms.escape ||
            (!event.keysym && event.keycode === 9)) activeWindow.close();
    },
    ready: function (info) {
        console.log("X11 blit benchmark created: " + info.width + "x" + info.height +
                    ", " + (info.width * info.height * 4) +
                    " bytes uploaded per frame, " + info.framesPerSecond +
                    " FPS limit");
    },
    error: function (error) {
        console.error(error.message || String(error));
        process.exitCode = 1;
    },
    close: function () {
        if (options.debugEvents) console.log("X11 connection closed");
    }
});
