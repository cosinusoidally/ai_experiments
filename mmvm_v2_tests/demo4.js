/*
 * Procedural texture and normal-mapping demo derived from demo3.js.
 * The material is generated reproducibly, normal-mapped once into a fixed
 * background, and uploaded in full each frame. Animated embossed lettering
 * is restored and repainted through small dirty rectangles.
 */
var common = require("./demo_common.js");

var options = common.parseOptions(process.argv, "demo4.js");
var TEXT = "NORMAL MAPPING";
var FONT_SCALE = 2;
var FONT_WIDTH = 5;
var FONT_HEIGHT = 7;
var GLYPH_WIDTH = 12;
var GLYPH_HEIGHT = 17;
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
    "A": "01110/10001/10001/11111/10001/10001/10001",
    "F": "11111/10000/10000/11110/10000/10000/10000",
    "G": "01111/10000/10000/10111/10001/10001/01111",
    "I": "11111/00100/00100/00100/00100/00100/11111",
    "L": "10000/10000/10000/10000/10000/10000/11111",
    "M": "10001/11011/10101/10101/10001/10001/10001",
    "N": "10001/11001/10101/10011/10001/10001/10001",
    "O": "01110/10001/10001/10001/10001/10001/01110",
    "P": "11110/10001/10001/11110/10000/10000/10000",
    "R": "11110/10001/10001/11110/10100/10010/10001",
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

function clampByte(value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return value | 0;
}

function hashByte(x, y) {
    var value = ((x * 374761393 + y * 668265263) ^
                 ((x + y) * 1274126177)) | 0;
    value ^= value >>> 13;
    value = (value * 1274126177) | 0;
    return (value ^ (value >>> 16)) & 255;
}

function makeSineTable() {
    var table = [];
    for (var i = 0; i < 256; i++) {
        table.push(Math.round(Math.sin(i * Math.PI * 2 / 256) * 24));
    }
    return table;
}

function materialSample(x, y, sineTable) {
    var tileX = x & 63;
    var tileY = y & 63;
    var alternate = (((x >> 6) + (y >> 6)) & 1) !== 0;
    var grain = hashByte(x, y) - 128;
    var wave = sineTable[(x * 3 + y * 2) & 255] +
               (sineTable[(x - y * 5) & 255] >> 1);
    var height = 126 + wave + (grain >> 4);
    var red = alternate ? 35 : 112;
    var green = alternate ? 76 : 57;
    var blue = alternate ? 104 : 34;

    /* Recessed panel joins and a raised inner border. */
    if (tileX < 3 || tileY < 3) {
        height = 52;
        red = 9; green = 18; blue = 26;
    } else if (tileX === 5 || tileY === 5 || tileX === 58 || tileY === 58) {
        height += 34;
        red += 35; green += 35; blue += 28;
    }

    /* Reproducible luminous circuit traces crossing each plate. */
    if ((((tileX + (tileY >> 1)) & 31) < 2 && tileY > 10) ||
        (((tileY - (tileX >> 1)) & 31) < 2 && tileX > 12)) {
        height += 18;
        red = 18; green = 120; blue = 130;
    }

    /* Four hammered-metal rivets per 64-pixel plate. */
    var rivetX = tileX < 32 ? tileX - 10 : tileX - 53;
    var rivetY = tileY < 32 ? tileY - 10 : tileY - 53;
    var rivetDistance = rivetX * rivetX + rivetY * rivetY;
    if (rivetDistance < 30) {
        height = 224 - rivetDistance * 2;
        red = 170 + (grain >> 3);
        green = 125 + (grain >> 4);
        blue = 62;
    }

    return {height: clampByte(height), red: clampByte(red + (grain >> 4)),
            green: clampByte(green + (grain >> 5)),
            blue: clampByte(blue + (grain >> 5))};
}

function heightAt(heightMap, width, height, x, y) {
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x >= width) x = width - 1;
    if (y >= height) y = height - 1;
    return readPacked(heightMap, (y * width + x) * 4) & 255;
}

function makeMaterial(width, height) {
    var pixelCount = width * height;
    var albedo = allocatePacked(pixelCount * 4);
    var heightMap = allocatePacked(pixelCount * 4);
    var normalMap = allocatePacked(pixelCount * 4);
    var shaded = allocatePacked(pixelCount * 4);
    var sineTable = makeSineTable();
    var x;
    var y;
    var offset = 0;

    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            var sample = materialSample(x, y, sineTable);
            writePacked(heightMap, offset, sample.height);
            writePacked(albedo, offset,
                        (sample.red << 16) | (sample.green << 8) | sample.blue);
            offset += 4;
        }
    }

    offset = 0;
    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            var gradientX = (heightAt(heightMap, width, height, x - 1, y) -
                             heightAt(heightMap, width, height, x + 1, y)) * 0.055;
            var gradientY = (heightAt(heightMap, width, height, x, y - 1) -
                             heightAt(heightMap, width, height, x, y + 1)) * 0.055;
            var inverseLength = 1 / Math.sqrt(gradientX * gradientX +
                                               gradientY * gradientY + 1);
            var normalX = gradientX * inverseLength;
            var normalY = gradientY * inverseLength;
            var normalZ = inverseLength;
            var encodedX = clampByte(normalX * 127 + 128);
            var encodedY = clampByte(normalY * 127 + 128);
            var encodedZ = clampByte(normalZ * 127 + 128);
            writePacked(normalMap, offset,
                        encodedX | (encodedY << 8) | (encodedZ << 16));
            offset += 4;
        }
    }

    offset = 0;
    var glowRadiusSquared = width * width * 0.42 + height * height * 0.42;
    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            var base = readPacked(albedo, offset);
            var encodedNormal = readPacked(normalMap, offset);
            var nx = ((encodedNormal & 255) - 128) / 127;
            var ny = (((encodedNormal >>> 8) & 255) - 128) / 127;
            var nz = (((encodedNormal >>> 16) & 255) - 128) / 127;
            var key = Math.max(0, nx * -0.38 + ny * -0.55 + nz * 0.74);
            var rim = Math.max(0, nx * 0.72 + ny * 0.08 + nz * 0.42);
            var glowX = x - width * 0.28;
            var glowY = y - height * 0.22;
            var radial = Math.max(0, 1 -
                (glowX * glowX + glowY * glowY) / glowRadiusSquared);
            var diffuse = 0.20 + key * 0.72 + radial * 0.18;
            var specular = Math.pow(key, 18) * 105;
            var red = ((base >>> 16) & 255) * diffuse + specular + rim * 12;
            var green = ((base >>> 8) & 255) * diffuse + specular + rim * 30;
            var blue = (base & 255) * diffuse + specular + rim * 43;
            writePacked(shaded, offset,
                        (clampByte(red) << 16) |
                        (clampByte(green) << 8) | clampByte(blue));
            offset += 4;
        }
    }
    return shaded;
}

var background = makeMaterial(options.width, options.height);

function glyphFor(character) {
    if (glyphs[character]) return glyphs[character];
    var mask = [];
    var index;
    for (index = 0; index < GLYPH_WIDTH * GLYPH_HEIGHT; index++) mask[index] = 0;
    var rows = (FONT_PATTERNS[character] || FONT_PATTERNS[" "]).split("/");
    for (var row = 0; row < FONT_HEIGHT; row++) {
        var bits = parseInt(rows[row], 2);
        for (var column = 0; column < FONT_WIDTH; column++) {
            if (!(bits & (1 << (FONT_WIDTH - column - 1)))) continue;
            for (var scaleY = 0; scaleY < FONT_SCALE; scaleY++) {
                for (var scaleX = 0; scaleX < FONT_SCALE; scaleX++) {
                    var x = column * FONT_SCALE + scaleX;
                    var y = row * FONT_SCALE + scaleY;
                    mask[y * GLYPH_WIDTH + x] = 1;
                }
            }
        }
    }
    glyphs[character] = {mask: mask};
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

function writeFramebufferPixel(framebuffer, x, y, packed) {
    if (x < 0 || y < 0 || x >= framebuffer.width || y >= framebuffer.height) return;
    var offset = (y * framebuffer.width + x) * 4;
    if (framebuffer.pixelAddress) poke32(framebuffer.pixelAddress + offset, packed);
    else framebuffer.pixels.writeUInt32LE(packed >>> 0, offset);
}

function blitGlyph(framebuffer, character, originX, originY, lightAngle) {
    var glyph = glyphFor(character);
    var mask = glyph.mask;
    var x;
    var y;

    /* First paint a displaced, translucent-looking contact shadow. */
    for (y = 0; y < GLYPH_HEIGHT; y++) {
        for (x = 0; x < GLYPH_WIDTH; x++) {
            if (mask[y * GLYPH_WIDTH + x]) {
                writeFramebufferPixel(framebuffer, originX + x + 2, originY + y + 2,
                                      0x0005090d);
            }
        }
    }

    var lightX = Math.cos(lightAngle) * 0.6;
    var lightY = Math.sin(lightAngle) * 0.6;
    var lightZ = 0.8;
    var warm = (character.charCodeAt(0) & 1) !== 0;
    for (y = 0; y < GLYPH_HEIGHT; y++) {
        for (x = 0; x < GLYPH_WIDTH; x++) {
            var maskIndex = y * GLYPH_WIDTH + x;
            if (!mask[maskIndex]) continue;
            var leftMissing = x === 0 || !mask[maskIndex - 1];
            var rightMissing = x === GLYPH_WIDTH - 1 || !mask[maskIndex + 1];
            var upMissing = y === 0 || !mask[maskIndex - GLYPH_WIDTH];
            var downMissing = y === GLYPH_HEIGHT - 1 ||
                              !mask[maskIndex + GLYPH_WIDTH];
            var normalX = ((rightMissing ? 1 : 0) - (leftMissing ? 1 : 0)) * 0.52;
            var normalY = ((downMissing ? 1 : 0) - (upMissing ? 1 : 0)) * 0.52;
            var normalZ = 0.82;
            var inverseLength = 1 / Math.sqrt(normalX * normalX +
                                               normalY * normalY +
                                               normalZ * normalZ);
            normalX *= inverseLength;
            normalY *= inverseLength;
            normalZ *= inverseLength;
            var diffuse = Math.max(0, normalX * lightX + normalY * lightY +
                                      normalZ * lightZ);
            var brightness = 0.22 + diffuse * 0.78;
            var specular = Math.pow(diffuse, 12) * 120;
            var baseRed = warm ? 242 : 72;
            var baseGreen = warm ? 125 : 188;
            var baseBlue = warm ? 38 : 224;
            var red = clampByte(baseRed * brightness + specular);
            var green = clampByte(baseGreen * brightness + specular);
            var blue = clampByte(baseBlue * brightness + specular);
            writeFramebufferPixel(framebuffer, originX + x, originY + y,
                                  (red << 16) | (green << 8) | blue);
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
    var phase = elapsed * 0.0024;
    var amplitude = Math.min(36, Math.max(8, framebuffer.height / 7));
    var startX = Math.floor((framebuffer.width - TEXT.length * GLYPH_WIDTH) / 2);
    var centerY = Math.floor(framebuffer.height / 2 - GLYPH_HEIGHT / 2);
    var positions = [];
    for (var i = 0; i < TEXT.length; i++) {
        positions.push({x: startX + i * GLYPH_WIDTH,
                        y: centerY + Math.round(Math.sin(phase + i * 0.48) * amplitude)});
    }
    return positions;
}

function paintText(framebuffer, value, originX, originY, lightAngle) {
    for (var i = 0; i < value.length; i++) {
        blitGlyph(framebuffer, value.charAt(i), originX + i * GLYPH_WIDTH,
                  originY, lightAngle);
    }
}

function draw(framebuffer) {
    if (framebuffer.pixelFormat !== "bgrx32le") {
        throw new Error("demo4 requires a little-endian BGRX 32-bit X11 framebuffer");
    }
    var now = new Date().getTime();
    if (!animationStartedAt) animationStartedAt = now;
    updateMeasurements(now);
    var state = bufferState(framebuffer);
    var fpsLabel = options.fpsCounter ? "FPS " + displayedFps.toFixed(1) : null;
    var lightAngle = (now - animationStartedAt) * 0.0011;

    if (!state.initialized) {
        copyBackgroundRectangle(framebuffer, 0, 0, framebuffer.width, framebuffer.height);
        state.initialized = true;
    } else {
        for (var oldIndex = 0; oldIndex < state.positions.length; oldIndex++) {
            copyBackgroundRectangle(framebuffer, state.positions[oldIndex].x,
                                    state.positions[oldIndex].y,
                                    GLYPH_WIDTH + 2, GLYPH_HEIGHT + 2);
        }
        if (state.fpsLabel !== null) {
            copyBackgroundRectangle(framebuffer, state.fpsX,
                                    framebuffer.height - GLYPH_HEIGHT - 2,
                                    state.fpsLabel.length * GLYPH_WIDTH + 2,
                                    GLYPH_HEIGHT + 2);
        }
    }

    var positions = textPositions(now, framebuffer);
    for (var index = 0; index < TEXT.length; index++) {
        blitGlyph(framebuffer, TEXT.charAt(index),
                  positions[index].x, positions[index].y, lightAngle);
    }

    if (fpsLabel !== null) {
        var labelX = Math.max(0, framebuffer.width - fpsLabel.length * GLYPH_WIDTH - 2);
        paintText(framebuffer, fpsLabel, labelX,
                  framebuffer.height - GLYPH_HEIGHT - 2, lightAngle);
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
    /* demo4 owns dirty-aware FPS painting and console sampling. */
    fpsCounter: false,
    debugEvents: false,
    title: "demo4.js procedural normal mapping",
    instanceName: "demo4",
    className: "NodeX11Demo",
    draw: draw,
    keyPress: function (event, activeWindow) {
        if (event.keysym === common.keysyms.escape ||
            (!event.keysym && event.keycode === 9)) activeWindow.close();
    },
    ready: function (info) {
        console.log("X11 normal-map blit demo created: " + info.width + "x" +
                    info.height + ", " + (info.width * info.height * 4) +
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
