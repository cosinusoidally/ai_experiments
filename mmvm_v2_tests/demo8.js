/* MMVM-specific rally application loaded by demo8_runner.js. */
DemoRunner.define(function (runner) {
var common = runner.common;
var libc = runner.libc;
var memory = runner.memory;
var nativeCode = runner.nativeCode;
var compileNative = runner.compileNative;
/*
 * Optimized general-purpose software rasterizer running the same original
 * Welsh-inspired rally stage as demo6. This application deliberately targets
 * js_min.exe and uses its FFI and native-memory access directly.
 */
/* common is supplied by DemoRunner. */

var options = common.parseOptions(process.argv, "demo8.js");
var TRACK_POINTS = 96;
var TERRAIN_SEGMENT_STEP = 3;
var ROAD_SEGMENT_STEP = 2;
var ROAD_HALF_WIDTH = 3.7;
var WALL_OFFSET = 5.15;
var RACE_LAPS = 3;
var NEAR_PLANE = 0.35;
var WORLD_DRAW_DISTANCE = 76;
var SHOULDER_DRAG_PER_FRAME = 0.996;
var WALL_SCRAPE_DRAG_PER_FRAME = 0.990;
var WALL_CONTACT_EPSILON = 0.03;
var track;
var terrainCells;
var roadSections;
var depthBuffer;
var background;
var spanRasterizer;
var spanRasterizers = {};
var TRIANGLE_RASTERIZER_HAND_ASM = 0;
var TRIANGLE_RASTERIZER_COMPILED = 1;
var TRIANGLE_RASTERIZER_JS = 2;
var triangleRasterizerMode = TRIANGLE_RASTERIZER_HAND_ASM;
var triangleHalfRasterizerASM = null;
var compiledTriangleHalfRasterizer = null;
var DEPTH_FIXED_SCALE = 67108864;
var BOX_LOCAL = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
var BOX_FACES = [[0, 1, 2, 3, 0.48], [4, 7, 6, 5, 1.0],
                 [0, 4, 5, 1, 0.65], [1, 5, 6, 2, 0.82],
                 [2, 6, 7, 3, 0.58], [3, 7, 4, 0, 0.72]];
var controls = {left: false, right: false, throttle: false, brake: false};
var GAME_MODE_RALLY = 0;
var GAME_MODE_GARAGE = 1;
var GAME_MODE_FIELD = 2;
var gameMode = GAME_MODE_RALLY;
var menuOpen = false;
var garageOrbitPhase = 0.65;
var garageManualLift = 0;
var garageDragging = false;
var garageDragX = 0;
var garageDragY = 0;
var FIELD_HALF_WIDTH = 80;
var FIELD_HALF_LENGTH = 64;
var FIELD_TRACK_HALF_WIDTH = 4.5;
var FREE_DRIVE_CAR_HALF_WIDTH = 1.45;
var FREE_DRIVE_CAR_HALF_LENGTH = 1.68;
var playerWheelSteer = 0;
var freeDriveTravelHeading = 0;
var freeDriveCameraHeading = 0;
var player;
var competitors;
var lastFrameTime = 0;
var camera;
var raceFinished = false;
var rollingMode = true;
var projectedVertexPool = [];
var projectedVertexCount = 0;
var projectionFrame = 0;
var gameReady = false;
var loadingFrames = 0;
var initializationStarted = false;
var windowInfo = null;
var textBlitter = null;
var textCache = {};
var frameRateCounter = options.fpsCounter !== false || options.debugEvents !== false ?
                       new Demo8FrameRateCounter(options.fpsCounter !== false,
                                                 options.debugEvents !== false) : null;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function createSpanRasterizer(depthPointer, width) {
    return nativeCode.compile(function (x86) {
        /* render(pixels, y, firstX, finalX, depth, depthStep, color). */
        x86.push("ebp");
        x86.moveRegister("ebp", "esp");
        x86.push("ebx");
        x86.push("edi");
        x86.moveArgument("eax", 1);
        x86.imulImmediate("eax", width);
        x86.addMemoryToRegister("eax", "ebp", 16);
        x86.moveImmediate("ebx", depthPointer);
        x86.loadIndexedAddress("ebx", "ebx", "eax", 4);
        x86.moveArgument("edi", 0);
        x86.loadIndexedAddress("edi", "edi", "eax", 4);
        x86.moveArgument("ecx", 3);
        x86.subtractMemoryFromRegister("ecx", "ebp", 16);
        x86.testRegisters("ecx", "ecx");
        x86.jump("lessOrEqual", "done");
        x86.moveArgument("edx", 4);

        x86.label("pixel");
        x86.compareRegisterWithMemory("edx", "ebx", 0);
        x86.jump("lessOrEqual", "skipPixel");
        x86.moveRegisterToMemory("ebx", 0, "edx");
        x86.moveArgument("eax", 6);
        x86.moveRegisterToMemory("edi", 0, "eax");
        x86.label("skipPixel");
        x86.addImmediate("ebx", 4);
        x86.addImmediate("edi", 4);
        x86.addMemoryToRegister("edx", "ebp", 28);
        x86.decrement("ecx");
        x86.jump("notEqual", "pixel");

        x86.label("done");
        x86.xorRegisters("eax", "eax");
        x86.pop("edi");
        x86.pop("ebx");
        x86.pop("ebp");
        x86.returnFromFunction();
    });
}

function queueSpan(framebuffer, y, firstX, finalX, inverseZ, depthStep, packed) {
    if (firstX >= finalX) return;
    nativeCode.call8(spanRasterizer, framebuffer.pixelAddress,
                     y, firstX, finalX,
                     (inverseZ * DEPTH_FIXED_SCALE) | 0,
                     (depthStep * DEPTH_FIXED_SCALE) | 0,
                     packed, 0);
}

function createTriangleHalfRasterizer(packed) {
    return nativeCode.compile(function (x86) {
        /* Arguments: pixels, packed y range, x1, x2, packed x steps,
         * z1, z2, packed z steps. Locals are addressed by byte offsets below
         * ebp and retain 16.16 x and 2^26 fixed-point reciprocal depth. */
        var y = 16, lastY = 20, x1 = 24, x2 = 28;
        var x1Step = 32, x2Step = 36, z1 = 40, z2 = 44;
        var z1Step = 48, z2Step = 52;
        var spanStart = 64, spanDepth = 60, spanLength = 56;

        x86.push("ebp");
        x86.moveRegister("ebp", "esp");
        x86.push("ebx");
        x86.push("esi");
        x86.push("edi");
        x86.subtractImmediate("esp", 52);

        x86.moveArgument("eax", 1);
        x86.moveZeroExtended16("ecx", "eax");
        x86.moveRegisterToLocal(y, "ecx");
        x86.shift("right", "eax", 16);
        x86.moveRegisterToLocal(lastY, "eax");
        x86.moveArgument("eax", 2);
        x86.moveRegisterToLocal(x1, "eax");
        x86.moveArgument("eax", 3);
        x86.moveRegisterToLocal(x2, "eax");

        x86.moveArgument("eax", 4);
        x86.moveSignExtended16("ecx", "eax");
        x86.shift("left", "ecx", 8);
        x86.moveRegisterToLocal(x1Step, "ecx");
        x86.shift("arithmeticRight", "eax", 16);
        x86.shift("left", "eax", 8);
        x86.moveRegisterToLocal(x2Step, "eax");
        x86.moveArgument("eax", 5);
        x86.moveRegisterToLocal(z1, "eax");
        x86.moveArgument("eax", 6);
        x86.moveRegisterToLocal(z2, "eax");

        x86.moveArgument("eax", 7);
        x86.moveSignExtended16("ecx", "eax");
        x86.shift("left", "ecx", 10);
        x86.moveRegisterToLocal(z1Step, "ecx");
        x86.shift("arithmeticRight", "eax", 16);
        x86.shift("left", "eax", 10);
        x86.moveRegisterToLocal(z2Step, "eax");

        x86.label("row");
        x86.moveLocalToRegister("eax", y);
        x86.compareRegisterWithMemory("eax", "ebp", -lastY);
        x86.jump("greaterOrEqual", "done");
        x86.moveLocalToRegister("eax", x1);
        x86.moveLocalToRegister("edx", x2);
        x86.moveLocalToRegister("ebx", z1);
        x86.moveLocalToRegister("esi", z2);
        x86.compareRegisters("eax", "edx");
        x86.jump("lessOrEqual", "orderedEdges");
        x86.exchangeRegisters("eax", "edx");
        x86.exchangeRegisters("ebx", "esi");
        x86.label("orderedEdges");

        x86.moveRegister("ecx", "eax");
        x86.addImmediate("ecx", 32767);
        x86.shift("arithmeticRight", "ecx", 16);
        x86.testRegisters("ecx", "ecx");
        x86.jump("greaterOrEqual", "leftClipped");
        x86.xorRegisters("ecx", "ecx");
        x86.label("leftClipped");
        x86.moveRegisterToLocal(spanStart, "ecx");

        x86.addImmediate("edx", 32767);
        x86.shift("arithmeticRight", "edx", 16);
        x86.compareImmediate("edx", options.width);
        x86.jump("lessOrEqual", "rightClipped");
        x86.moveImmediate("edx", options.width);
        x86.label("rightClipped");
        x86.compareRegisters("ecx", "edx");
        x86.jump("greaterOrEqual", "nextRow");

        x86.subtractRegisters("edx", "ecx");
        x86.moveRegisterToLocal(spanLength, "edx");
        x86.moveRegisterToLocal(spanDepth, "ebx");
        x86.moveRegister("eax", "esi");
        x86.subtractRegisters("eax", "ebx");
        x86.moveRegister("ecx", "edx");
        x86.signExtendEax();
        x86.divideSignedBy("ecx");
        x86.moveRegister("esi", "eax");

        x86.moveLocalToRegister("eax", y);
        x86.imulImmediate("eax", options.width);
        x86.addMemoryToRegister("eax", "ebp", -spanStart);
        x86.moveArgument("edi", 0);
        x86.loadIndexedAddress("edi", "edi", "eax", 4);
        x86.moveImmediate("ebx", depthBuffer);
        x86.loadIndexedAddress("ebx", "ebx", "eax", 4);
        x86.moveLocalToRegister("ecx", spanLength);
        x86.moveLocalToRegister("edx", spanDepth);

        x86.label("pixel");
        x86.compareRegisterWithMemory("edx", "ebx", 0);
        x86.jump("lessOrEqual", "skipPixel");
        x86.moveRegisterToMemory("ebx", 0, "edx");
        x86.moveImmediate("eax", packed);
        x86.moveRegisterToMemory("edi", 0, "eax");
        x86.label("skipPixel");
        x86.addImmediate("ebx", 4);
        x86.addImmediate("edi", 4);
        x86.addRegisters("edx", "esi");
        x86.decrement("ecx");
        x86.jump("notEqual", "pixel");

        x86.label("nextRow");
        x86.moveLocalToRegister("eax", x1Step);
        x86.addMemoryToRegister("eax", "ebp", -x1);
        x86.moveRegisterToLocal(x1, "eax");
        x86.moveLocalToRegister("eax", x2Step);
        x86.addMemoryToRegister("eax", "ebp", -x2);
        x86.moveRegisterToLocal(x2, "eax");
        x86.moveLocalToRegister("eax", z1Step);
        x86.addMemoryToRegister("eax", "ebp", -z1);
        x86.moveRegisterToLocal(z1, "eax");
        x86.moveLocalToRegister("eax", z2Step);
        x86.addMemoryToRegister("eax", "ebp", -z2);
        x86.moveRegisterToLocal(z2, "eax");
        x86.incrementLocal(y);
        x86.jump("always", "row");

        x86.label("done");
        x86.xorRegisters("eax", "eax");
        x86.addImmediate("esp", 52);
        x86.pop("edi");
        x86.pop("esi");
        x86.pop("ebx");
        x86.pop("ebp");
        x86.returnFromFunction();
    });
}

function triangleHalfRasterizerCode(packed) {
    var key = String(packed >>> 0);
    var rasterizer = spanRasterizers[key];
    if (!rasterizer) {
        rasterizer = createTriangleHalfRasterizer(packed);
        spanRasterizers[key] = rasterizer;
    }
    return rasterizer;
}

function triangleHalfRasterizerHandASM(pixelAddress, packedYRange,
                                       firstX, secondX, packedXSteps,
                                       firstZ, secondZ, packedZSteps, packed) {
    nativeCode.call8(triangleHalfRasterizerCode(packed),
                     pixelAddress, packedYRange,
                     firstX, secondX, packedXSteps,
                     firstZ, secondZ, packedZSteps);
}

/*
 * Low-level reference for createTriangleHalfRasterizer above.  Its arguments,
 * signed 32-bit fixed-point state, clipping, edge stepping, division, depth
 * comparison, and memory layout intentionally follow the assembled routine.
 * Keep this restricted shape suitable for a future small-subset JS compiler;
 * it is a reference implementation, not an attempt to make interpreted pixel
 * writes fast.  JavaScript bitwise operations provide the i386 32-bit wrapping
 * used after every arithmetic update.
 */
function triangleHalfRasterizerJS(pixelAddress, packedYRange,
                                  firstX, secondX, packedXSteps,
                                  firstZ, secondZ, packedZSteps, packed) {
    var y = packedYRange & 65535;
    var lastY = packedYRange >>> 16;
    var x1 = firstX | 0;
    var x2 = secondX | 0;
    var x1Step = ((packedXSteps << 16 >> 16) << 8) | 0;
    var x2Step = ((packedXSteps >> 16) << 8) | 0;
    var z1 = firstZ | 0;
    var z2 = secondZ | 0;
    var z1Step = ((packedZSteps << 16 >> 16) << 10) | 0;
    var z2Step = ((packedZSteps >> 16) << 10) | 0;

    while (y < lastY) {
        var leftX = x1;
        var rightX = x2;
        var leftZ = z1;
        var rightZ = z2;
        if (leftX > rightX) {
            var swap = leftX;
            leftX = rightX;
            rightX = swap;
            swap = leftZ;
            leftZ = rightZ;
            rightZ = swap;
        }

        var spanStart = ((leftX + 32767) | 0) >> 16;
        if (spanStart < 0) spanStart = 0;
        var spanEnd = ((rightX + 32767) | 0) >> 16;
        if (spanEnd > options.width) spanEnd = options.width;
        if (spanStart < spanEnd) {
            var spanLength = spanEnd - spanStart;
            var spanDepth = leftZ;
            var depthStep = (((rightZ - leftZ) | 0) / spanLength) | 0;
            var pixelOffset = ((y * options.width + spanStart) * 4) | 0;
            var pixelPointer = pixelAddress + pixelOffset;
            var depthPointer = depthBuffer + pixelOffset;

            while (spanLength !== 0) {
                if (spanDepth > (peek32(depthPointer) | 0)) {
                    poke32(depthPointer, spanDepth);
                    poke32(pixelPointer, packed);
                }
                depthPointer += 4;
                pixelPointer += 4;
                spanDepth = (spanDepth + depthStep) | 0;
                spanLength--;
            }
        }

        x1 = (x1 + x1Step) | 0;
        x2 = (x2 + x2Step) | 0;
        z1 = (z1 + z1Step) | 0;
        z2 = (z2 + z2Step) | 0;
        y++;
    }
}

function verifyTriangleHalfRasterizers() {
    var rows = 8;
    var words = options.width * rows;
    var byteLength = words * 4;
    var asmPixels = memory.allocate(byteLength);
    var compiledPixels = memory.allocate(byteLength);
    var jsPixels = memory.allocate(byteLength);
    var expectedPixels = [];
    var expectedDepth = [];
    var packed = 0x008b7455;
    var packedYRange = packedSignedPair(1, 7);
    var firstX = fixedPosition(14.25);
    var secondX = fixedPosition(-2.50);
    var packedXSteps = packedSignedPair(-128, 64);
    var firstZ = (0.45 * DEPTH_FIXED_SCALE) | 0;
    var secondZ = (0.70 * DEPTH_FIXED_SCALE) | 0;
    var packedZSteps = packedSignedPair(655, -983);
    var index;
    var mismatch = "";

    libc.memset(asmPixels, 0, byteLength);
    libc.memset(depthBuffer, 0, options.width * options.height * 4);
    triangleHalfRasterizerHandASM(asmPixels, packedYRange,
                                  firstX, secondX, packedXSteps,
                                  firstZ, secondZ, packedZSteps, packed);
    for (index = 0; index < words; index++) {
        expectedPixels[index] = peek32(asmPixels + index * 4) | 0;
        expectedDepth[index] = peek32(depthBuffer + index * 4) | 0;
    }

    libc.memset(jsPixels, 0, byteLength);
    libc.memset(depthBuffer, 0, options.width * options.height * 4);
    triangleHalfRasterizerJS(jsPixels, packedYRange,
                             firstX, secondX, packedXSteps,
                             firstZ, secondZ, packedZSteps, packed);
    for (index = 0; index < words; index++) {
        if ((peek32(jsPixels + index * 4) | 0) !== expectedPixels[index] ||
            (peek32(depthBuffer + index * 4) | 0) !== expectedDepth[index]) {
            mismatch = "triangle-half ASM/JS mismatch at word " + index;
            break;
        }
    }

    if (!mismatch) {
        libc.memset(compiledPixels, 0, byteLength);
        libc.memset(depthBuffer, 0, options.width * options.height * 4);
        triangleHalfRasterizerASM(compiledPixels, packedYRange,
                                  firstX, secondX, packedXSteps,
                                  firstZ, secondZ, packedZSteps, packed);
        for (index = 0; index < words; index++) {
            if ((peek32(compiledPixels + index * 4) | 0) !==
                    expectedPixels[index] ||
                (peek32(depthBuffer + index * 4) | 0) !==
                    expectedDepth[index]) {
                mismatch = "triangle-half compiled/hand ASM mismatch at word " +
                           index;
                break;
            }
        }
    }

    memory.free(jsPixels);
    memory.free(compiledPixels);
    memory.free(asmPixels);
    libc.memset(depthBuffer, 0, options.width * options.height * 4);
    if (mismatch) throw new Error(mismatch);
}

function fixedPosition(value) {
    value = Math.max(-32767, Math.min(32767, value));
    return (value * 65536) | 0;
}

function packedSignedPair(first, second) {
    return (first & 65535) | ((second & 65535) << 16);
}

function allocatePacked(length) {
    if (typeof Buffer.allocNative === "function") return Buffer.allocNative(length);
    if (typeof Buffer.alloc === "function") return Buffer.alloc(length);
    return new Buffer(length);
}

/*
 * Packed-word adapter. MMVM buffers expose a native address and use the VM's
 * little-endian peek32/poke32 primitives. Stock Node.js uses equivalent Buffer
 * methods as the portable polyfill. The triangle hot loop specializes these
 * two cases once per triangle rather than calling this wrapper per pixel.
 */
function peekPacked32(buffer, offset) {
    if (buffer._nodePointer) return peek32(buffer._nodePointer + offset) >>> 0;
    return buffer.readUInt32LE(offset) >>> 0;
}

function pokePacked32(buffer, offset, value) {
    if (buffer._nodePointer) poke32(buffer._nodePointer + offset, value);
    else buffer.writeUInt32LE(value >>> 0, offset);
}

function makeBackground(width, height) {
    var pixels = allocatePacked(width * height * 4);
    var horizon = Math.floor(height * 0.41);
    var offset = 0;
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var red;
            var green;
            var blue;
            if (y < horizon) {
                var cloud = ((x * 13 + y * 7) & 31) < 10 ? 7 : 0;
                var skyFade = (y * 24 / horizon) | 0;
                red = 83 + skyFade + cloud;
                green = 101 + skyFade + cloud;
                blue = 115 + skyFade + cloud;
            } else {
                var groundFade = ((y - horizon) * 25 / (height - horizon)) | 0;
                var field = (((x >> 4) + (y >> 3)) & 1) ? 5 : 0;
                red = 34 + groundFade + field;
                green = 70 + groundFade + field;
                blue = 37 + (groundFade >> 1);
            }
            /* Two distant, rain-darkened hill silhouettes. */
            var hill1 = horizon - 5 + Math.sin(x * 0.035) * 9 +
                        Math.sin(x * 0.011 + 1.3) * 12;
            var hill2 = horizon + 7 + Math.sin(x * 0.052 + 2.1) * 7;
            if (y >= hill1 && y < horizon + 18) {
                red = 43; green = 66; blue = 57;
            }
            if (y >= hill2 && y < horizon + 25) {
                red = 38; green = 72; blue = 43;
            }
            pixels.writeUInt32LE((red << 16) | (green << 8) | blue, offset);
            offset += 4;
        }
    }
    return pixels;
}

function makeTrack() {
    var points = [];
    var i;
    for (i = 0; i < TRACK_POINTS; i++) {
        var angle = i * Math.PI * 2 / TRACK_POINTS;
        var x = Math.sin(angle) * 57 + Math.sin(angle * 2 + 0.4) * 11 +
                Math.sin(angle * 5) * 4;
        var z = Math.cos(angle) * 45 + Math.cos(angle * 3 - 0.7) * 9;
        var y = Math.sin(angle * 2 - 0.5) * 2.2 +
                Math.sin(angle * 5 + 0.8) * 0.8;
        points.push({x: x, y: y, z: z});
    }
    var total = 0;
    for (i = 0; i < TRACK_POINTS; i++) {
        var previous = points[(i + TRACK_POINTS - 1) % TRACK_POINTS];
        var next = points[(i + 1) % TRACK_POINTS];
        var tangentX = next.x - previous.x;
        var tangentZ = next.z - previous.z;
        var tangentLength = Math.sqrt(tangentX * tangentX + tangentZ * tangentZ);
        points[i].tangentX = tangentX / tangentLength;
        points[i].tangentZ = tangentZ / tangentLength;
        points[i].normalX = points[i].tangentZ;
        points[i].normalZ = -points[i].tangentX;
        points[i].distance = total;
        next = points[(i + 1) % TRACK_POINTS];
        var dx = next.x - points[i].x;
        var dy = next.y - points[i].y;
        var dz = next.z - points[i].z;
        points[i].segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
        total += points[i].segmentLength;
    }
    points.totalLength = total;
    return points;
}

function wrapDistance(distance) {
    distance %= track.totalLength;
    if (distance < 0) distance += track.totalLength;
    return distance;
}

function trackSegmentAtDistance(distance) {
    var low = 0;
    var high = TRACK_POINTS - 1;
    while (low <= high) {
        var middle = (low + high) >> 1;
        var point = track[middle];
        if (distance < point.distance) {
            high = middle - 1;
        } else if (distance >= point.distance + point.segmentLength) {
            low = middle + 1;
        } else {
            return middle;
        }
    }
    return TRACK_POINTS - 1;
}

function sampleTrack(distance, lane) {
    distance = wrapDistance(distance);
    var segment = trackSegmentAtDistance(distance);
    var first = track[segment];
    var second = track[(segment + 1) % TRACK_POINTS];
    var amount = (distance - first.distance) / first.segmentLength;
    if (segment === TRACK_POINTS - 1 && distance < first.distance) {
        amount = (distance + track.totalLength - first.distance) /
                 first.segmentLength;
    }
    lane = lane || 0;
    var normalX = first.normalX + (second.normalX - first.normalX) * amount;
    var normalZ = first.normalZ + (second.normalZ - first.normalZ) * amount;
    var normalLength = Math.sqrt(normalX * normalX + normalZ * normalZ);
    normalX /= normalLength;
    normalZ /= normalLength;
    var tangentX = first.tangentX + (second.tangentX - first.tangentX) * amount;
    var tangentZ = first.tangentZ + (second.tangentZ - first.tangentZ) * amount;
    var tangentLength = Math.sqrt(tangentX * tangentX + tangentZ * tangentZ);
    tangentX /= tangentLength;
    tangentZ /= tangentLength;
    var sampledY = first.y + (second.y - first.y) * amount;
    if (Math.abs(lane) > WALL_OFFSET) {
        sampledY += hillsideOffset(segment + amount, lane);
    }
    return {
        x: first.x + (second.x - first.x) * amount + normalX * lane,
        y: sampledY,
        z: first.z + (second.z - first.z) * amount + normalZ * lane,
        tangentX: tangentX,
        tangentZ: tangentZ,
        normalX: normalX,
        normalZ: normalZ,
        heading: Math.atan2(tangentX, tangentZ),
        segment: segment,
        distance: distance
    };
}

function nearestTrackPosition(x, z) {
    var best = null;
    var bestSquared = 1e30;
    for (var i = 0; i < TRACK_POINTS; i++) {
        var first = track[i];
        var second = track[(i + 1) % TRACK_POINTS];
        var dx = second.x - first.x;
        var dz = second.z - first.z;
        var lengthSquared = dx * dx + dz * dz;
        var amount = clamp(((x - first.x) * dx + (z - first.z) * dz) /
                           lengthSquared, 0, 1);
        var nearestX = first.x + dx * amount;
        var nearestZ = first.z + dz * amount;
        var offsetX = x - nearestX;
        var offsetZ = z - nearestZ;
        var squared = offsetX * offsetX + offsetZ * offsetZ;
        if (squared < bestSquared) {
            bestSquared = squared;
            var wrapped = first.distance + first.segmentLength * amount;
            if (wrapped >= track.totalLength) wrapped -= track.totalLength;
            best = {x: nearestX,
                    y: first.y + (second.y - first.y) * amount,
                    z: nearestZ,
                    distance: Math.sqrt(squared),
                    wrappedDistance: wrapped,
                    tangentX: dx / Math.sqrt(lengthSquared),
                    tangentZ: dz / Math.sqrt(lengthSquared)};
        }
    }
    return best;
}

function resetRace() {
    var start = sampleTrack(0, 0);
    player = {x: start.x, y: start.y + 0.15, z: start.z,
              heading: start.heading, speed: 0, wrappedDistance: 0,
              raceDistance: 0, lap: 0, position: 3};
    var colors = [0xd9342b, 0x278bd2, 0xf0b52d, 0xe8e8db, 0x40a95c];
    competitors = [];
    for (var i = 0; i < 5; i++) {
        /* Two rivals start ahead and three behind in a staggered road grid. */
        var car = {raceDistance: 8.0 - i * 4.6,
                   speed: 3.2 + i * 0.35,
                   targetSpeed: 12.0 + i * 0.58,
                   lanePhase: i * 1.73,
                   color: colors[i]};
        car.lane = Math.sin(car.raceDistance * 0.035 + car.lanePhase) * 1.45;
        car.sample = sampleTrack(car.raceDistance, car.lane);
        competitors.push(car);
    }
    raceFinished = false;
    lastFrameTime = 0;
    controls.left = false;
    controls.right = false;
    controls.throttle = false;
    controls.brake = false;
}

function clearControls() {
    controls.left = false;
    controls.right = false;
    controls.throttle = false;
    controls.brake = false;
}

function enterRallyMode() {
    gameMode = GAME_MODE_RALLY;
    resetRace();
    rollingMode = true;
    menuOpen = false;
    lastFrameTime = 0;
    console.log("game restarted; rolling mode active; push Space to play");
}

function enterGarageMode() {
    gameMode = GAME_MODE_GARAGE;
    garageDragging = false;
    clearControls();
    menuOpen = false;
    lastFrameTime = 0;
    console.log("mode: garage; drag with mouse button 1 to control the camera");
}

function resetFreeDrive() {
    var fieldStart = track[0];
    player = {x: fieldStart.x, y: 0.15, z: fieldStart.z,
              heading: Math.atan2(fieldStart.tangentX,
                                  fieldStart.tangentZ), speed: 0,
              velocityX: 0, velocityZ: 0, yawRate: 0,
              powerSliding: false, wrappedDistance: 0, raceDistance: 0,
              lap: 0, position: 1};
    clearControls();
    playerWheelSteer = 0;
    freeDriveTravelHeading = player.heading;
    freeDriveCameraHeading = player.heading;
}

function enterFreeDriveMode() {
    gameMode = GAME_MODE_FIELD;
    rollingMode = false;
    resetFreeDrive();
    menuOpen = false;
    lastFrameTime = 0;
    console.log("mode: free drive on the muddy field; brake while steering " +
                "at speed to powerslide");
}

function resolveRoadEdge(nearest, dt) {
    if (nearest.distance > ROAD_HALF_WIDTH) {
        var shoulderAmount = clamp((nearest.distance - ROAD_HALF_WIDTH) /
                                   (WALL_OFFSET - ROAD_HALF_WIDTH), 0, 1);
        player.speed *= Math.pow(1 -
                                (1 - SHOULDER_DRAG_PER_FRAME) * shoulderAmount,
                                dt * 60);
    }
    if (nearest.distance < WALL_OFFSET - WALL_CONTACT_EPSILON) return;

    var inverseDistance = 1 / nearest.distance;
    var normalX = (player.x - nearest.x) * inverseDistance;
    var normalZ = (player.z - nearest.z) * inverseDistance;
    var penetration = Math.max(0, nearest.distance - WALL_OFFSET);

    /* Resolve only the penetration and outward component of velocity.  The
     * tangential component survives, so a glancing collision becomes a wall
     * scrape instead of repeatedly multiplying the whole speed toward zero. */
    player.x -= normalX * penetration;
    player.z -= normalZ * penetration;
    var velocityX = Math.sin(player.heading) * player.speed;
    var velocityZ = Math.cos(player.heading) * player.speed;
    var outwardVelocity = velocityX * normalX + velocityZ * normalZ;
    if (outwardVelocity > 0) {
        velocityX -= normalX * outwardVelocity;
        velocityZ -= normalZ * outwardVelocity;
        var travelSpeed = Math.sqrt(velocityX * velocityX +
                                    velocityZ * velocityZ);
        var direction = player.speed < 0 ? -1 : 1;
        player.speed = travelSpeed * direction;
        if (travelSpeed > 0.001) {
            player.heading = direction > 0 ? Math.atan2(velocityX, velocityZ) :
                                             Math.atan2(-velocityX, -velocityZ);
        }
    }

    /* Sliding contact still costs energy, but continuously and in wall-clock
     * time rather than once per physics substep as a large instantaneous hit. */
    player.speed *= Math.pow(WALL_SCRAPE_DRAG_PER_FRAME, dt * 60);
}

function updatePlayerStep(dt) {
    if (rollingMode) {
        player.raceDistance += 13.4 * dt;
        var rollingLane = Math.sin(player.raceDistance * 0.028) * 0.72;
        var rollingSample = sampleTrack(player.raceDistance, rollingLane);
        player.x = rollingSample.x;
        player.y = rollingSample.y + 0.15;
        player.z = rollingSample.z;
        player.heading = rollingSample.heading;
        player.speed = 13.4;
        player.wrappedDistance = rollingSample.distance;
        player.lap = Math.floor(player.raceDistance / track.totalLength) % RACE_LAPS;
        raceFinished = false;
        return;
    }
    if (!raceFinished) {
        if (controls.throttle) {
            /* Continuous automatic-style torque: no gears or shift input. */
            player.speed += (18.0 - Math.max(0, player.speed) * 0.18) * dt;
        }
        if (controls.brake) {
            if (player.speed > 0.5) player.speed -= 20 * dt;
            else player.speed -= 7 * dt;
        }
    }
    var rollingDrag = Math.pow(0.998, dt * 60);
    player.speed *= rollingDrag;
    player.speed = clamp(player.speed, -7, 30);
    var steering = (controls.left ? 1 : 0) - (controls.right ? 1 : 0);
    var steeringGrip = clamp(Math.abs(player.speed) / 7, 0.18, 1);
    player.heading -= steering * steeringGrip * 1.65 * dt *
                      (player.speed < 0 ? -1 : 1);
    player.x += Math.sin(player.heading) * player.speed * dt;
    player.z += Math.cos(player.heading) * player.speed * dt;

    var nearest = nearestTrackPosition(player.x, player.z);
    player.y = nearest.y + 0.15;
    resolveRoadEdge(nearest, dt);

    var progressDelta = nearest.wrappedDistance - player.wrappedDistance;
    if (progressDelta > track.totalLength / 2) progressDelta -= track.totalLength;
    if (progressDelta < -track.totalLength / 2) progressDelta += track.totalLength;
    if (Math.abs(progressDelta) < 12) player.raceDistance += progressDelta;
    player.wrappedDistance = nearest.wrappedDistance;
    player.lap = Math.max(0, Math.floor(player.raceDistance / track.totalLength));
    if (player.lap >= RACE_LAPS) raceFinished = true;
}

function updateCompetitorsStep(dt) {
    for (var i = 0; i < competitors.length; i++) {
        var car = competitors[i];
        var bend = sampleTrack(car.raceDistance + 10, 0);
        var later = sampleTrack(car.raceDistance + 18, 0);
        var directionDot = bend.tangentX * later.tangentX +
                           bend.tangentZ * later.tangentZ;
        var cornerSpeed = car.targetSpeed * (0.72 + Math.max(0, directionDot) * 0.28);
        car.speed += (cornerSpeed - car.speed) * dt * 1.3;
        car.raceDistance += car.speed * dt;
        car.lane = Math.sin(car.raceDistance * 0.035 + car.lanePhase) * 1.45;
        car.sample = sampleTrack(car.raceDistance, car.lane);
    }

    for (i = 0; i < competitors.length; i++) {
        car = competitors[i];
        var dx = player.x - car.sample.x;
        var dz = player.z - car.sample.z;
        var distanceSquared = dx * dx + dz * dz;
        if (distanceSquared < 3.0 && distanceSquared > 0.001) {
            var distance = Math.sqrt(distanceSquared);
            var overlap = 1.75 - distance;
            if (overlap > 0) {
                player.x += dx / distance * overlap * 0.45;
                player.z += dz / distance * overlap * 0.45;
                player.speed *= 0.82;
            }
        }
    }
    var ahead = 0;
    for (i = 0; i < competitors.length; i++) {
        if (competitors[i].raceDistance > player.raceDistance) ahead++;
    }
    player.position = ahead + 1;
}

function updateSimulation(elapsed) {
    /* Fixed-size substeps preserve handling and wall-clock speed at low FPS. */
    elapsed = Math.min(elapsed, 0.5);
    while (elapsed > 0) {
        var step = Math.min(0.04, elapsed);
        updatePlayerStep(step);
        updateCompetitorsStep(step);
        elapsed -= step;
    }
}

function updateFreeDriveStep(dt) {
    var steering = (controls.left ? 1 : 0) - (controls.right ? 1 : 0);
    var targetWheelSteer = -steering * 0.62;
    playerWheelSteer += (targetWheelSteer - playerWheelSteer) *
                        Math.min(1, dt * 10);

    var forwardX = Math.sin(player.heading);
    var forwardZ = Math.cos(player.heading);
    var rightX = forwardZ;
    var rightZ = -forwardX;
    var longitudinalSpeed = player.velocityX * forwardX +
                            player.velocityZ * forwardZ;
    var lateralSpeed = player.velocityX * rightX +
                       player.velocityZ * rightZ;

    /* Steering produces yaw only while the tyres are rolling.  Yaw has a
     * little inertia, and reverses naturally when travelling backwards. */
    var steeringRate = longitudinalSpeed < 0 ? 0.105 : 0.070;
    var targetYawRate = -steering * longitudinalSpeed * steeringRate;
    targetYawRate = clamp(targetYawRate, -1.55, 1.55);
    var yawResponse = controls.brake && longitudinalSpeed > 6 ?
                      3.0 : 6.5;
    player.yawRate += (targetYawRate - player.yawRate) *
                      Math.min(1, dt * yawResponse);
    if (!steering || Math.abs(longitudinalSpeed) < 0.15) {
        player.yawRate *= Math.max(0, 1 - dt * 2.5);
    }
    player.heading += player.yawRate * dt;

    /* Recalculate the body axes after yaw.  Lateral tyre grip rotates the
     * velocity toward the body heading.  Braking while steering at speed
     * releases most rear grip, leaving momentum to carry the car sideways. */
    forwardX = Math.sin(player.heading);
    forwardZ = Math.cos(player.heading);
    rightX = forwardZ;
    rightZ = -forwardX;
    longitudinalSpeed = player.velocityX * forwardX +
                        player.velocityZ * forwardZ;
    lateralSpeed = player.velocityX * rightX + player.velocityZ * rightZ;
    var wasPowerSliding = player.powerSliding;
    player.powerSliding = controls.brake && steering !== 0 &&
                          longitudinalSpeed > 6;
    if (options.debugEvents && player.powerSliding !== wasPowerSliding) {
        console.log(player.powerSliding ? "power slide started" :
                    "power slide ended");
    }
    var lateralGrip = player.powerSliding ? 0.72 :
                      (Math.abs(longitudinalSpeed) > 17 && steering !== 0 ?
                       2.8 : 7.5);
    lateralSpeed *= Math.max(0, 1 - dt * lateralGrip * 0.92);

    if (controls.throttle) {
        longitudinalSpeed +=
            (18.0 - Math.max(0, longitudinalSpeed) * 0.18) * dt;
    }
    if (controls.brake) {
        if (longitudinalSpeed > 0.7) longitudinalSpeed -= 7.5 * dt;
        else longitudinalSpeed -=
            (12.0 - Math.min(12, Math.abs(longitudinalSpeed)) * 0.20) * dt;
    }
    longitudinalSpeed *= Math.pow(0.996, dt * 60);
    longitudinalSpeed = clamp(longitudinalSpeed, -14, 30);
    player.velocityX = forwardX * longitudinalSpeed + rightX * lateralSpeed;
    player.velocityZ = forwardZ * longitudinalSpeed + rightZ * lateralSpeed;
    var velocitySquared = player.velocityX * player.velocityX +
                          player.velocityZ * player.velocityZ;
    if (velocitySquared > 900) {
        var velocityScale = 30 / Math.sqrt(velocitySquared);
        player.velocityX *= velocityScale;
        player.velocityZ *= velocityScale;
        velocitySquared = 900;
    }
    player.speed = longitudinalSpeed;
    var movementX = player.velocityX * dt;
    var movementZ = player.velocityZ * dt;
    player.x += movementX;
    player.z += movementZ;

    /* Keep the complete oriented saloon inside the outer perimeter, including
     * its wheels and bumpers.  Remove only outward velocity so glancing contact
     * scrapes along the boundary and steering away remains responsive. */
    var boundaryExtentX = Math.abs(rightX) * FREE_DRIVE_CAR_HALF_WIDTH +
                          Math.abs(forwardX) * FREE_DRIVE_CAR_HALF_LENGTH;
    var boundaryExtentZ = Math.abs(rightZ) * FREE_DRIVE_CAR_HALF_WIDTH +
                          Math.abs(forwardZ) * FREE_DRIVE_CAR_HALF_LENGTH;
    var minimumX = -FIELD_HALF_WIDTH + boundaryExtentX;
    var maximumX = FIELD_HALF_WIDTH - boundaryExtentX;
    var minimumZ = -FIELD_HALF_LENGTH + boundaryExtentZ;
    var maximumZ = FIELD_HALF_LENGTH - boundaryExtentZ;
    var hitBoundaryX = false;
    var hitBoundaryZ = false;
    if (player.x < minimumX) {
        player.x = minimumX;
        if (player.velocityX < 0) player.velocityX = 0;
        hitBoundaryX = true;
    } else if (player.x > maximumX) {
        player.x = maximumX;
        if (player.velocityX > 0) player.velocityX = 0;
        hitBoundaryX = true;
    }
    if (player.z < minimumZ) {
        player.z = minimumZ;
        if (player.velocityZ < 0) player.velocityZ = 0;
        hitBoundaryZ = true;
    } else if (player.z > maximumZ) {
        player.z = maximumZ;
        if (player.velocityZ > 0) player.velocityZ = 0;
        hitBoundaryZ = true;
    }
    if (hitBoundaryX || hitBoundaryZ) {
        player.speed = player.velocityX * forwardX +
                       player.velocityZ * forwardZ;
    }
    player.y = 0.15;
}

function updateFreeDrive(elapsed) {
    elapsed = Math.min(elapsed, 0.5);
    while (elapsed > 0) {
        var step = Math.min(0.05, elapsed);
        updateFreeDriveStep(step);
        elapsed -= step;
    }
    if (player.velocityX * player.velocityX +
        player.velocityZ * player.velocityZ > 0.000625) {
        freeDriveTravelHeading = Math.atan2(player.velocityX,
                                            player.velocityZ);
    }
}

function setCamera() {
    var forwardX = Math.sin(player.heading);
    var forwardZ = Math.cos(player.heading);
    camera = {x: player.x - forwardX * 4.8,
              y: player.y + 2.15,
              z: player.z - forwardZ * 4.8,
              forwardX: forwardX,
              forwardZ: forwardZ,
              rightX: forwardZ,
              rightZ: -forwardX,
              pitchSin: Math.sin(0.12),
              pitchCos: Math.cos(0.12),
              focal: Math.min(options.width, options.height) * 1.05,
              horizontalSlope: options.width /
                               (2 * Math.min(options.width, options.height) * 1.05),
              centerX: options.width / 2,
              centerY: options.height * 0.46};
}

function setLookAtCamera(cameraX, cameraY, cameraZ,
                         targetX, targetY, targetZ) {
    var dx = targetX - cameraX;
    var dz = targetZ - cameraZ;
    var horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    if (horizontalDistance < 0.001) horizontalDistance = 0.001;
    var forwardX = dx / horizontalDistance;
    var forwardZ = dz / horizontalDistance;
    var pitch = Math.atan2(cameraY - targetY, horizontalDistance);
    camera = {x: cameraX,
              y: cameraY,
              z: cameraZ,
              forwardX: forwardX,
              forwardZ: forwardZ,
              rightX: forwardZ,
              rightZ: -forwardX,
              pitchSin: Math.sin(pitch),
              pitchCos: Math.cos(pitch),
              focal: Math.min(options.width, options.height) * 1.05,
              horizontalSlope: options.width /
                               (2 * Math.min(options.width, options.height) * 1.05),
              centerX: options.width / 2,
              centerY: options.height * 0.48};
}

function shortestAngleDifference(target, current) {
    var difference = target - current;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return difference;
}

function setFreeDriveCamera(elapsed) {
    /* Follow the recent trajectory rather than attaching the view rigidly to
     * the body.  The short wall-clock-based lag makes steering yaw visible,
     * while the view still settles onto the actual direction of travel. */
    var response = 1 - Math.pow(0.08, Math.min(elapsed, 0.5));
    freeDriveCameraHeading +=
        shortestAngleDifference(freeDriveTravelHeading,
                                freeDriveCameraHeading) * response;
    var forwardX = Math.sin(freeDriveCameraHeading);
    var forwardZ = Math.cos(freeDriveCameraHeading);
    setLookAtCamera(player.x - forwardX * 4.8,
                    player.y + 2.15,
                    player.z - forwardZ * 4.8,
                    player.x + forwardX,
                    player.y + 0.43,
                    player.z + forwardZ);
}

function setGarageCamera(elapsed) {
    if (!garageDragging) garageOrbitPhase += elapsed * 0.34;
    var cameraX = Math.sin(garageOrbitPhase) * 4.9;
    var cameraZ = Math.cos(garageOrbitPhase) * 3.8;
    var cameraY = 1.75 + Math.sin(garageOrbitPhase * 2) * 0.52 +
                  garageManualLift;
    cameraY = clamp(cameraY, 0.65, 3.5);
    setLookAtCamera(cameraX, cameraY, cameraZ, 0, 0.48, 0);
}

function horizontallyVisible(dx, dz, radius) {
    var forward = dx * camera.forwardX + dz * camera.forwardZ;
    var right = dx * camera.rightX + dz * camera.rightZ;
    return Math.abs(right) <= forward * camera.horizontalSlope + radius;
}

function project(world) {
    if (world._projectionFrame === projectionFrame) {
        return world._projectedValue;
    }
    var dx = world.x - camera.x;
    var dy = world.y - camera.y;
    var dz = world.z - camera.z;
    var right = dx * camera.rightX + dz * camera.rightZ;
    var forward = dx * camera.forwardX + dz * camera.forwardZ;
    var vertical = dy * camera.pitchCos + forward * camera.pitchSin;
    var depth = forward * camera.pitchCos - dy * camera.pitchSin;
    if (depth < NEAR_PLANE) {
        world._projectionFrame = projectionFrame;
        world._projectedValue = null;
        return null;
    }
    var inverseZ = 1 / depth;
    var projected = projectedVertexPool[projectedVertexCount];
    if (!projected) {
        projected = {};
        projectedVertexPool[projectedVertexCount] = projected;
    }
    projectedVertexCount++;
    projected.x = camera.centerX + right * camera.focal * inverseZ;
    projected.y = camera.centerY - vertical * camera.focal * inverseZ;
    projected.inverseZ = inverseZ;
    world._projectionFrame = projectionFrame;
    world._projectedValue = projected;
    return projected;
}

function cameraSpace(world) {
    var dx = world.x - camera.x;
    var dy = world.y - camera.y;
    var dz = world.z - camera.z;
    var forward = dx * camera.forwardX + dz * camera.forwardZ;
    return {right: dx * camera.rightX + dz * camera.rightZ,
            vertical: dy * camera.pitchCos + forward * camera.pitchSin,
            depth: forward * camera.pitchCos - dy * camera.pitchSin};
}

function projectCameraSpace(vertex) {
    var inverseZ = 1 / vertex.depth;
    return {x: camera.centerX + vertex.right * camera.focal * inverseZ,
            y: camera.centerY - vertex.vertical * camera.focal * inverseZ,
            inverseZ: inverseZ};
}

function nearIntersection(inside, outside) {
    var amount = (NEAR_PLANE - inside.depth) /
                 (outside.depth - inside.depth);
    return {right: inside.right + (outside.right - inside.right) * amount,
            vertical: inside.vertical +
                      (outside.vertical - inside.vertical) * amount,
            depth: NEAR_PLANE};
}

function drawNearClippedTriangle(framebuffer, a, b, c, color) {
    var input = [cameraSpace(a), cameraSpace(b), cameraSpace(c)];
    var output = [];
    var previous = input[input.length - 1];
    var previousInside = previous.depth >= NEAR_PLANE;
    for (var index = 0; index < input.length; index++) {
        var current = input[index];
        var currentInside = current.depth >= NEAR_PLANE;
        if (currentInside !== previousInside) {
            output.push(currentInside ? nearIntersection(current, previous) :
                                       nearIntersection(previous, current));
        }
        if (currentInside) output.push(current);
        previous = current;
        previousInside = currentInside;
    }
    if (output.length < 3) return;
    var first = projectCameraSpace(output[0]);
    var second = projectCameraSpace(output[1]);
    var third = projectCameraSpace(output[2]);
    rasterTriangle(framebuffer, first, second, third, color);
    if (output.length === 4) {
        rasterTriangle(framebuffer, first, third,
                       projectCameraSpace(output[3]), color);
    }
}

function rasterRows(framebuffer, firstY, lastY,
                    firstX, firstZ, firstXStep, firstZStep,
                    secondX, secondZ, secondXStep, secondZStep, packed) {
    var width = framebuffer.width;
    var clippedFirstY = Math.max(0, firstY);
    var clippedLastY = Math.min(framebuffer.height, lastY);
    if (clippedFirstY >= clippedLastY) return;
    var skippedRows = clippedFirstY - firstY;
    firstX += firstXStep * skippedRows;
    firstZ += firstZStep * skippedRows;
    secondX += secondXStep * skippedRows;
    secondZ += secondZStep * skippedRows;
    if (clippedLastY <= 65535 &&
        Math.abs(firstXStep) < 127.9 && Math.abs(secondXStep) < 127.9 &&
        Math.abs(firstZStep) < 0.499 && Math.abs(secondZStep) < 0.499) {
        var firstPackedXStep = Math.round(firstXStep * 256);
        var secondPackedXStep = Math.round(secondXStep * 256);
        var firstPackedZStep = Math.round(firstZStep * 65536);
        var secondPackedZStep = Math.round(secondZStep * 65536);
        if (triangleRasterizerMode === TRIANGLE_RASTERIZER_JS) {
            triangleHalfRasterizerJS(
                framebuffer.pixelAddress,
                packedSignedPair(clippedFirstY, clippedLastY),
                fixedPosition(firstX), fixedPosition(secondX),
                packedSignedPair(firstPackedXStep, secondPackedXStep),
                (firstZ * DEPTH_FIXED_SCALE) | 0,
                (secondZ * DEPTH_FIXED_SCALE) | 0,
                packedSignedPair(firstPackedZStep, secondPackedZStep), packed);
        } else if (triangleRasterizerMode === TRIANGLE_RASTERIZER_COMPILED) {
            triangleHalfRasterizerASM(
                framebuffer.pixelAddress,
                packedSignedPair(clippedFirstY, clippedLastY),
                fixedPosition(firstX), fixedPosition(secondX),
                packedSignedPair(firstPackedXStep, secondPackedXStep),
                (firstZ * DEPTH_FIXED_SCALE) | 0,
                (secondZ * DEPTH_FIXED_SCALE) | 0,
                packedSignedPair(firstPackedZStep, secondPackedZStep), packed);
        } else {
            /* Keep the established ASM hot path direct: an extra interpreted
             * wrapper call per triangle half is measurable in js_min.exe. */
            nativeCode.call8(triangleHalfRasterizerCode(packed),
                             framebuffer.pixelAddress,
                             packedSignedPair(clippedFirstY, clippedLastY),
                             fixedPosition(firstX), fixedPosition(secondX),
                             packedSignedPair(firstPackedXStep,
                                              secondPackedXStep),
                             (firstZ * DEPTH_FIXED_SCALE) | 0,
                             (secondZ * DEPTH_FIXED_SCALE) | 0,
                             packedSignedPair(firstPackedZStep,
                                              secondPackedZStep));
        }
        return;
    }
    for (var y = clippedFirstY; y < clippedLastY; y++) {
        var leftX = firstX;
        var leftZ = firstZ;
        var rightX = secondX;
        var rightZ = secondZ;
        if (leftX > rightX) {
            var swap = leftX; leftX = rightX; rightX = swap;
            swap = leftZ; leftZ = rightZ; rightZ = swap;
        }
        var spanWidth = rightX - leftX;
        var minimumX = Math.max(0, Math.ceil(leftX - 0.5));
        var maximumX = Math.min(width, Math.ceil(rightX - 0.5));
        var depthStep = spanWidth ? (rightZ - leftZ) / spanWidth : 0;
        var inverseZ = leftZ + (minimumX + 0.5 - leftX) * depthStep;
        queueSpan(framebuffer, y, minimumX, maximumX,
                  inverseZ, depthStep, packed);
        firstX += firstXStep;
        firstZ += firstZStep;
        secondX += secondXStep;
        secondZ += secondZStep;
    }
}

function rasterTriangle(framebuffer, first, second, third, packed) {
    if (!first || !second || !third) return;
    if (first.y > second.y) { var swap = first; first = second; second = swap; }
    if (second.y > third.y) { swap = second; second = third; third = swap; }
    if (first.y > second.y) { swap = first; first = second; second = swap; }
    if (third.y - first.y < 0.000001) return;

    var longXStep = (third.x - first.x) / (third.y - first.y);
    var longZStep = (third.inverseZ - first.inverseZ) / (third.y - first.y);
    if (second.y - first.y > 0.000001) {
        var topFirstY = Math.ceil(first.y - 0.5);
        var topLastY = Math.ceil(second.y - 0.5);
        var topSampleY = topFirstY + 0.5;
        var topXStep = (second.x - first.x) / (second.y - first.y);
        var topZStep = (second.inverseZ - first.inverseZ) /
                       (second.y - first.y);
        rasterRows(framebuffer, topFirstY, topLastY,
                   first.x + (topSampleY - first.y) * longXStep,
                   first.inverseZ + (topSampleY - first.y) * longZStep,
                   longXStep, longZStep,
                   first.x + (topSampleY - first.y) * topXStep,
                   first.inverseZ + (topSampleY - first.y) * topZStep,
                   topXStep, topZStep, packed);
    }
    if (third.y - second.y > 0.000001) {
        var bottomFirstY = Math.ceil(second.y - 0.5);
        var bottomLastY = Math.ceil(third.y - 0.5);
        var bottomSampleY = bottomFirstY + 0.5;
        var bottomXStep = (third.x - second.x) / (third.y - second.y);
        var bottomZStep = (third.inverseZ - second.inverseZ) /
                          (third.y - second.y);
        rasterRows(framebuffer, bottomFirstY, bottomLastY,
                   first.x + (bottomSampleY - first.y) * longXStep,
                   first.inverseZ + (bottomSampleY - first.y) * longZStep,
                   longXStep, longZStep,
                   second.x + (bottomSampleY - second.y) * bottomXStep,
                   second.inverseZ + (bottomSampleY - second.y) * bottomZStep,
                   bottomXStep, bottomZStep, packed);
    }
}

function drawQuad(framebuffer, a, b, c, d, color, cullBackFace) {
    if (cullBackFace) {
        var abX = b.x - a.x; var abY = b.y - a.y; var abZ = b.z - a.z;
        var acX = c.x - a.x; var acY = c.y - a.y; var acZ = c.z - a.z;
        var normalX = abY * acZ - abZ * acY;
        var normalY = abZ * acX - abX * acZ;
        var normalZ = abX * acY - abY * acX;
        if (normalX * (camera.x - a.x) + normalY * (camera.y - a.y) +
            normalZ * (camera.z - a.z) <= 0) return;
    }
    var pa = project(a); var pb = project(b); var pc = project(c); var pd = project(d);
    if (!pa || !pb || !pc || !pd) {
        drawNearClippedTriangle(framebuffer, a, b, c, color);
        drawNearClippedTriangle(framebuffer, a, c, d, color);
        return;
    }
    var minimumX = Math.min(pa.x, pb.x, pc.x, pd.x);
    var maximumX = Math.max(pa.x, pb.x, pc.x, pd.x);
    var minimumY = Math.min(pa.y, pb.y, pc.y, pd.y);
    var maximumY = Math.max(pa.y, pb.y, pc.y, pd.y);
    if (maximumX < 0.5 || minimumX >= framebuffer.width - 0.5 ||
        maximumY < 0.5 || minimumY >= framebuffer.height - 0.5) return;
    /* An empty pixel-centre bounding box cannot produce a covered sample. */
    if (Math.ceil(minimumX - 0.5) >= Math.ceil(maximumX - 0.5) ||
        Math.ceil(minimumY - 0.5) >= Math.ceil(maximumY - 0.5)) return;
    rasterTriangle(framebuffer, pa, pb, pc, color);
    rasterTriangle(framebuffer, pa, pc, pd, color);
}

function roadEdge(point, offset, heightOffset) {
    return {x: point.x + point.normalX * offset,
            y: point.y + (heightOffset || 0),
            z: point.z + point.normalZ * offset};
}

function hillsideOffset(trackPhase, offset) {
    var beyondWall = Math.max(0, Math.abs(offset) - WALL_OFFSET);
    var side = offset < 0 ? -1 : 1;
    var angle = trackPhase * Math.PI * 2 / TRACK_POINTS;
    var broadFold = Math.sin(angle * 5 + side * 1.65);
    var longRidge = Math.sin(angle * 2 - side * 0.85);
    var smallFold = Math.sin(angle * 11 + side * 2.4);
    return beyondWall * (0.075 + broadFold * 0.045 + longRidge * 0.025) +
           smallFold * Math.min(1.35, beyondWall * 0.045);
}

function terrainPoint(point, trackPhase, offset) {
    return {x: point.x + point.normalX * offset,
            y: point.y - 0.10 + hillsideOffset(trackPhase, offset),
            z: point.z + point.normalZ * offset};
}

function carveTerrainPoint(point) {
    var nearest = nearestTrackPosition(point.x, point.z);
    var carveRadius = WALL_OFFSET + 5.0;
    if (nearest.distance < carveRadius) {
        /* Keep every terrain cell below the complete course corridor.  This
         * includes its owning section: excluding neighbouring owner indices
         * allowed coarse cells on tight bends to bridge back over the road. */
        var fullCarveRadius = WALL_OFFSET + 3.5;
        var blend = clamp((carveRadius - nearest.distance) /
                          (carveRadius - fullCarveRadius), 0, 1);
        blend = blend * blend * (3 - 2 * blend);
        var carvedY = point.y + (nearest.y - 0.28 - point.y) * blend;
        if (carvedY < point.y) point.y = carvedY;
    }
    return point;
}

function horizontalRadius(a, b, c, d, centerX, centerZ) {
    var points = [a, b, c, d];
    var maximumSquared = 0;
    for (var i = 0; i < points.length; i++) {
        var dx = points[i].x - centerX;
        var dz = points[i].z - centerZ;
        maximumSquared = Math.max(maximumSquared, dx * dx + dz * dz);
    }
    return Math.sqrt(maximumSquared);
}

function makeTerrainCells() {
    /* Radial spacing stays below the carve radius, so a cell cannot bridge
     * across a road corridor without at least one carved edge. */
    var bands = [4.45, 8.0, 13.0, 19.0, 26.0, 34.0, 44.0, 54.0];
    var fieldColors = [0x355f31, 0x3f6c35, 0x486f38, 0x315b32];
    var cells = [];
    var grids = [[], []];
    var gridSideIndex;
    var gridPointIndex;
    var gridBand;
    for (gridSideIndex = 0; gridSideIndex < 2; gridSideIndex++) {
        var gridSide = gridSideIndex ? 1 : -1;
        for (gridPointIndex = 0; gridPointIndex < TRACK_POINTS; gridPointIndex++) {
            var gridRow = [];
            for (gridBand = 0; gridBand < bands.length; gridBand++) {
                gridRow.push(carveTerrainPoint(
                    terrainPoint(track[gridPointIndex], gridPointIndex,
                                 bands[gridBand] * gridSide)));
            }
            grids[gridSideIndex].push(gridRow);
        }
    }
    for (var i = 0; i < TRACK_POINTS; i += TERRAIN_SEGMENT_STEP) {
        for (var sideIndex = 0; sideIndex < 2; sideIndex++) {
            for (var band = 0; band < bands.length - 1; band++) {
                var colorIndex = (i >> 2) + band + sideIndex * 2;
                var color = fieldColors[colorIndex & 3];
                var nextIndex = (i + TERRAIN_SEGMENT_STEP) % TRACK_POINTS;
                var innerFirst = grids[sideIndex][i][band];
                var innerSecond = grids[sideIndex][nextIndex][band];
                var outerSecond = grids[sideIndex][nextIndex][band + 1];
                var outerFirst = grids[sideIndex][i][band + 1];
                var centerX = (innerFirst.x + innerSecond.x +
                               outerSecond.x + outerFirst.x) * 0.25;
                var centerZ = (innerFirst.z + innerSecond.z +
                               outerSecond.z + outerFirst.z) * 0.25;
                cells.push({a: innerFirst, b: innerSecond, c: outerSecond,
                            d: outerFirst, color: color,
                            centerX: centerX, centerZ: centerZ,
                            radius: horizontalRadius(innerFirst, innerSecond,
                                                     outerSecond, outerFirst,
                                                     centerX, centerZ)});
            }
        }
    }
    return cells;
}

function drawHillsides(framebuffer) {
    for (var i = 0; i < terrainCells.length; i++) {
        var cell = terrainCells[i];
        var centerX = cell.centerX - camera.x;
        var centerZ = cell.centerZ - camera.z;
        if (centerX * centerX + centerZ * centerZ >
            WORLD_DRAW_DISTANCE * WORLD_DRAW_DISTANCE) continue;
        /* The cell centre is conservative here because cells are short along
         * the track. Avoid allocating a temporary four-element point array. */
        var centerForward = centerX * camera.forwardX +
                            centerZ * camera.forwardZ;
        if (centerForward < 3.0) continue;
        if (!horizontallyVisible(centerX, centerZ, cell.radius)) continue;
        drawQuad(framebuffer, cell.a, cell.b, cell.c, cell.d, cell.color);
    }
}

function addRoadQuad(section, a, b, c, d, color, detail) {
    section.quads.push({a: a, b: b, c: c, d: d, color: color,
                        detail: detail || 0});
}

function cachedRoadEdge(section, point, pointName, offset, heightOffset) {
    var key = pointName + ":" + offset + ":" + (heightOffset || 0);
    var edge = section.edges[key];
    if (!edge) {
        edge = roadEdge(point, offset, heightOffset);
        section.edges[key] = edge;
    }
    return edge;
}

function addRoadBand(section, first, second, left, right, height, color, detail) {
    addRoadQuad(section,
                cachedRoadEdge(section, first, "a", left, height),
                cachedRoadEdge(section, second, "b", left, height),
                cachedRoadEdge(section, second, "b", right, height),
                cachedRoadEdge(section, first, "a", right, height), color, detail);
}

function addWallSection(section, first, second, offset, color) {
    var bottomFirst = cachedRoadEdge(section, first, "a", offset, 0);
    var bottomSecond = cachedRoadEdge(section, second, "b", offset, 0);
    var topFirst = cachedRoadEdge(section, first, "a", offset, 0.76);
    var topSecond = cachedRoadEdge(section, second, "b", offset, 0.76);
    addRoadQuad(section, bottomFirst, bottomSecond, topSecond, topFirst, color);
}

function makeRoadSections() {
    var sections = [];
    for (var i = 0; i < TRACK_POINTS; i += ROAD_SEGMENT_STEP) {
        var first = track[i];
        var second = track[(i + ROAD_SEGMENT_STEP) % TRACK_POINTS];
        var sectionDx = second.x - first.x;
        var sectionDz = second.z - first.z;
        var section = {centerX: (first.x + second.x) * 0.5,
                       centerZ: (first.z + second.z) * 0.5,
                       radius: Math.sqrt(sectionDx * sectionDx +
                                         sectionDz * sectionDz) * 0.5 +
                               WALL_OFFSET + 1.0,
                       quads: [], edges: {}};
        var shoulderColor = (i & 1) ? 0x72583a : 0x674d33;
        var roadColor = (i % 3) ? 0x8b7455 : 0x806949;
        addRoadBand(section, first, second, -4.45, -ROAD_HALF_WIDTH,
                    -0.05, shoulderColor, 1);
        addRoadBand(section, first, second, ROAD_HALF_WIDTH, 4.45,
                    -0.05, shoulderColor, 1);
        addRoadBand(section, first, second, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH,
                    0, roadColor);
        var rutColor = (i & 3) ? 0x5d4b37 : 0x68523a;
        addRoadBand(section, first, second, -1.38, -0.82, 0.018, rutColor, 2);
        addRoadBand(section, first, second, 0.82, 1.38, 0.018, rutColor, 2);
        if ((i % 5) === 2) {
            addRoadBand(section, first, second, -0.38, 0.42, 0.022,
                        0x765d40, 2);
        }

        var wallShade = (i % 6) ? 0x77766c : 0x99998e;
        addWallSection(section, first, second, -WALL_OFFSET, wallShade);
        addWallSection(section, first, second, WALL_OFFSET, wallShade);
        sections.push(section);
    }
    return sections;
}

function drawRoad(framebuffer) {
    for (var sectionIndex = 0; sectionIndex < roadSections.length;
         sectionIndex++) {
        var section = roadSections[sectionIndex];
        var dx = section.centerX - camera.x;
        var dz = section.centerZ - camera.z;
        if (dx * dx + dz * dz >
            WORLD_DRAW_DISTANCE * WORLD_DRAW_DISTANCE) continue;
        var distanceSquared = dx * dx + dz * dz;
        var detail = distanceSquared < 30 * 30 ? 2 :
                     distanceSquared < 55 * 55 ? 1 : 0;
        var forward = dx * camera.forwardX + dz * camera.forwardZ;
        if (forward < -4.0) continue;
        if (!horizontallyVisible(dx, dz, section.radius)) continue;
        for (var quadIndex = 0; quadIndex < section.quads.length; quadIndex++) {
            var quad = section.quads[quadIndex];
            if (quad.detail > detail) continue;
            drawQuad(framebuffer, quad.a, quad.b, quad.c, quad.d, quad.color);
        }
    }
}

function shadeColor(color, amount) {
    return (clamp(((color >>> 16) & 255) * amount, 0, 255) << 16) |
           (clamp(((color >>> 8) & 255) * amount, 0, 255) << 8) |
           clamp((color & 255) * amount, 0, 255);
}

function drawBox(framebuffer, cx, y, cz, heading, halfWidth, height, halfLength,
                 color) {
    var vertices = [];
    var sine = Math.sin(heading);
    var cosine = Math.cos(heading);
    for (var level = 0; level < 2; level++) {
        for (var i = 0; i < 4; i++) {
            var localX = BOX_LOCAL[i][0] * halfWidth;
            var localZ = BOX_LOCAL[i][1] * halfLength;
            vertices.push({x: cx + localX * cosine + localZ * sine,
                           y: y + level * height,
                           z: cz - localX * sine + localZ * cosine});
        }
    }
    for (i = 0; i < BOX_FACES.length; i++) {
        var face = BOX_FACES[i];
        drawQuad(framebuffer, vertices[face[0]], vertices[face[1]],
                 vertices[face[2]], vertices[face[3]],
                 shadeColor(color, face[4]), true);
    }
}

function drawCar(framebuffer, carX, carY, carZ, heading, color, isPlayer) {
    drawBox(framebuffer, carX, carY, carZ, heading, 0.82, 0.42, 1.35, color);
    var sine = Math.sin(heading);
    var cosine = Math.cos(heading);
    var cabin = {x: carX - sine * 0.18,
                 y: carY + 0.41,
                 z: carZ - cosine * 0.18};
    drawBox(framebuffer, cabin.x, cabin.y, cabin.z, heading,
            0.58, 0.38, 0.58, isPlayer ? 0x72cce6 : 0x9bc2cf);
    var bumper = {x: carX + sine * 1.32,
                  y: carY + 0.18,
                  z: carZ + cosine * 1.32};
    drawBox(framebuffer, bumper.x, bumper.y, bumper.z, heading,
            0.90, 0.16, 0.12, isPlayer ? 0xf1d328 : 0x25282a);
}

function carLocalPoint(carX, carY, carZ, sine, cosine, x, y, z) {
    return {x: carX + x * cosine + z * sine,
            y: carY + y,
            z: carZ - x * sine + z * cosine};
}

function drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                          first, second, third, fourth, color) {
    drawQuad(framebuffer,
             carLocalPoint(carX, carY, carZ, sine, cosine,
                           first[0], first[1], first[2]),
             carLocalPoint(carX, carY, carZ, sine, cosine,
                           second[0], second[1], second[2]),
             carLocalPoint(carX, carY, carZ, sine, cosine,
                           third[0], third[1], third[2]),
             carLocalPoint(carX, carY, carZ, sine, cosine,
                           fourth[0], fourth[1], fourth[2]), color);
}

function drawDetailedWheel(framebuffer, carX, carY, carZ, sine, cosine,
                           localX, localZ, steeringAngle) {
    var segments = 8;
    var radius = 0.32;
    var halfTread = 0.18;
    var outsideAcross = localX < 0 ? -halfTread : halfTread;
    var insideAcross = -outsideAcross;
    var centerY = 0.34;
    var steeringSine = Math.sin(steeringAngle || 0);
    var steeringCosine = Math.cos(steeringAngle || 0);
    function wheelPoint(across, y, rolling) {
        var offsetX = across * steeringCosine + rolling * steeringSine;
        var offsetZ = -across * steeringSine + rolling * steeringCosine;
        return carLocalPoint(carX, carY, carZ, sine, cosine,
                             localX + offsetX, y, localZ + offsetZ);
    }
    var outsideCenter = wheelPoint(outsideAcross, centerY, 0);
    for (var segment = 0; segment < segments; segment++) {
        var firstAngle = segment * Math.PI * 2 / segments;
        var secondAngle = (segment + 1) * Math.PI * 2 / segments;
        var firstY = centerY + Math.cos(firstAngle) * radius;
        var firstRolling = Math.sin(firstAngle) * radius;
        var secondY = centerY + Math.cos(secondAngle) * radius;
        var secondRolling = Math.sin(secondAngle) * radius;
        var outsideFirst = wheelPoint(outsideAcross, firstY, firstRolling);
        var outsideSecond = wheelPoint(outsideAcross, secondY, secondRolling);
        var insideFirst = wheelPoint(insideAcross, firstY, firstRolling);
        var insideSecond = wheelPoint(insideAcross, secondY, secondRolling);
        drawQuad(framebuffer, outsideFirst, insideFirst, insideSecond,
                 outsideSecond, (segment & 1) ? 0x17191a : 0x202223);
        drawNearClippedTriangle(framebuffer, outsideCenter,
                                outsideFirst, outsideSecond, 0x191b1c);

        var hubRadius = 0.14;
        var hubAcross = outsideAcross + (localX < 0 ? -0.006 : 0.006);
        var hubCenter = wheelPoint(hubAcross, centerY, 0);
        var hubFirst = wheelPoint(hubAcross,
                                  centerY + Math.cos(firstAngle) * hubRadius,
                                  Math.sin(firstAngle) * hubRadius);
        var hubSecond = wheelPoint(hubAcross,
                                   centerY + Math.cos(secondAngle) * hubRadius,
                                   Math.sin(secondAngle) * hubRadius);
        drawNearClippedTriangle(framebuffer, hubCenter,
                                hubFirst, hubSecond,
                                (segment & 1) ? 0xa6aaa8 : 0xc8cbc7);
    }
}

function drawDetailedCar(framebuffer, carX, carY, carZ, heading, color,
                         frontWheelSteer) {
    var sine = Math.sin(heading);
    var cosine = Math.cos(heading);
    var glass = 0x69a9bd;
    var darkGlass = 0x477b8d;
    var frame = shadeColor(color, 0.86);

    drawDetailedWheel(framebuffer, carX, carY, carZ, sine, cosine,
                      -0.91, 0.97, frontWheelSteer);
    drawDetailedWheel(framebuffer, carX, carY, carZ, sine, cosine,
                      0.91, 0.97, frontWheelSteer);
    drawDetailedWheel(framebuffer, carX, carY, carZ, sine, cosine,
                      -0.83, -0.97, 0);
    drawDetailedWheel(framebuffer, carX, carY, carZ, sine, cosine,
                      0.83, -0.97, 0);

    /* Long, boxy shell with distinct bonnet and boot: a four-seat 1970s
     * two-door saloon rather than a short two-seat coupe. */
    drawBox(framebuffer, carX, carY + 0.22, carZ, heading,
            0.84, 0.43, 1.52, color);
    var bonnet = carLocalPoint(carX, carY, carZ, sine, cosine, 0, 0, 1.08);
    drawBox(framebuffer, bonnet.x, carY + 0.61, bonnet.z, heading,
            0.76, 0.10, 0.43, shadeColor(color, 1.08));
    var boot = carLocalPoint(carX, carY, carZ, sine, cosine, 0, 0, -1.16);
    drawBox(framebuffer, boot.x, carY + 0.58, boot.z, heading,
            0.76, 0.10, 0.35, shadeColor(color, 0.94));

    /* Sloped front and rear glass. */
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [-0.54, 0.68, 0.68], [0.54, 0.68, 0.68],
                     [0.45, 1.13, 0.38], [-0.45, 1.13, 0.38], glass);
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [0.54, 0.68, -0.83], [-0.54, 0.68, -0.83],
                     [-0.45, 1.13, -0.51], [0.45, 1.13, -0.51], darkGlass);

    /* Each side has one long front door and a fixed rear quarter window.  The
     * rear glass and extended roof retain enough cabin length for four seats,
     * without suggesting a second pair of doors. */
    var side;
    for (side = -1; side <= 1; side += 2) {
        var sideX = side * 0.59;
        var glassTopX = side * 0.45;
        var frameTopX = side * 0.51;
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [sideX, 0.69, 0.65], [sideX, 0.69, -0.18],
                         [glassTopX, 1.10, -0.17],
                         [glassTopX, 1.10, 0.36], glass);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [sideX, 0.69, -0.25], [sideX, 0.69, -0.79],
                         [glassTopX, 1.10, -0.49],
                         [glassTopX, 1.10, -0.24], darkGlass);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [sideX, 0.65, -0.84], [sideX, 0.65, 0.70],
                         [sideX, 0.72, 0.65], [sideX, 0.72, -0.79], frame);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [sideX, 0.68, -0.26], [sideX, 0.68, -0.17],
                         [frameTopX, 1.15, -0.15],
                         [frameTopX, 1.15, -0.27], frame);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [sideX, 0.66, 0.70], [sideX, 0.66, 0.62],
                         [frameTopX, 1.16, 0.34],
                         [frameTopX, 1.16, 0.42], frame);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [sideX, 0.66, -0.84], [sideX, 0.66, -0.76],
                         [frameTopX, 1.16, -0.47],
                         [frameTopX, 1.16, -0.55], frame);

        /* One long door outline and one handle per side. */
        var panelX = side * 0.848;
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [panelX, 0.25, 0.68], [panelX, 0.25, 0.64],
                         [panelX, 0.67, 0.64], [panelX, 0.67, 0.68], 0x332a28);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [panelX, 0.25, -0.38], [panelX, 0.25, -0.34],
                         [panelX, 0.67, -0.34], [panelX, 0.67, -0.38], 0x332a28);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [panelX, 0.25, -0.38], [panelX, 0.25, 0.68],
                         [panelX, 0.28, 0.68], [panelX, 0.28, -0.38], 0x332a28);
        drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                         [panelX, 0.53, -0.27], [panelX, 0.53, -0.08],
                         [panelX, 0.58, -0.08], [panelX, 0.58, -0.27], 0xb5b3a8);
    }

    /* Painted windscreen/rear-window surrounds and a visible metal roof skin. */
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [-0.63, 0.64, 0.71], [-0.53, 0.69, 0.65],
                     [-0.44, 1.11, 0.39], [-0.53, 1.17, 0.34], frame);
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [0.53, 0.69, 0.65], [0.63, 0.64, 0.71],
                     [0.53, 1.17, 0.34], [0.44, 1.11, 0.39], frame);
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [-0.53, 1.17, 0.34], [-0.44, 1.11, 0.39],
                     [0.44, 1.11, 0.39], [0.53, 1.17, 0.34], frame);
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [0.63, 0.64, -0.86], [0.53, 0.69, -0.79],
                     [0.44, 1.11, -0.50], [0.53, 1.17, -0.55], frame);
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [-0.53, 0.69, -0.79], [-0.63, 0.64, -0.86],
                     [-0.53, 1.17, -0.55], [-0.44, 1.11, -0.50], frame);
    var roof = carLocalPoint(carX, carY, carZ, sine, cosine, 0, 0, -0.08);
    drawBox(framebuffer, roof.x, carY + 1.11, roof.z, heading,
            0.55, 0.11, 0.46, shadeColor(color, 1.12));

    /* Unlit lamp units: pale front lenses and red rear lenses. */
    var frontLeft = carLocalPoint(carX, carY, carZ, sine, cosine,
                                  -0.52, 0, 1.525);
    var frontRight = carLocalPoint(carX, carY, carZ, sine, cosine,
                                   0.52, 0, 1.525);
    drawBox(framebuffer, frontLeft.x, carY + 0.43, frontLeft.z, heading,
            0.22, 0.17, 0.025, 0xe8e2bd);
    drawBox(framebuffer, frontRight.x, carY + 0.43, frontRight.z, heading,
            0.22, 0.17, 0.025, 0xe8e2bd);
    var rearLeft = carLocalPoint(carX, carY, carZ, sine, cosine,
                                 -0.55, 0, -1.525);
    var rearRight = carLocalPoint(carX, carY, carZ, sine, cosine,
                                  0.55, 0, -1.525);
    drawBox(framebuffer, rearLeft.x, carY + 0.43, rearLeft.z, heading,
            0.19, 0.15, 0.025, 0xc51f22);
    drawBox(framebuffer, rearRight.x, carY + 0.43, rearRight.z, heading,
            0.19, 0.15, 0.025, 0xc51f22);

    /* Period rectangular grille and bright metal bumpers. */
    drawCarLocalQuad(framebuffer, carX, carY, carZ, sine, cosine,
                     [-0.27, 0.40, 1.553], [0.27, 0.40, 1.553],
                     [0.27, 0.55, 1.553], [-0.27, 0.55, 1.553], 0x24282a);
    var frontBumper = carLocalPoint(carX, carY, carZ, sine, cosine, 0, 0, 1.56);
    var rearBumper = carLocalPoint(carX, carY, carZ, sine, cosine, 0, 0, -1.56);
    drawBox(framebuffer, frontBumper.x, carY + 0.27, frontBumper.z, heading,
            0.78, 0.07, 0.025, 0xb7b9b4);
    drawBox(framebuffer, rearBumper.x, carY + 0.27, rearBumper.z, heading,
            0.78, 0.07, 0.025, 0xa6a8a4);
}

function drawGarage(framebuffer) {
    var x;
    var z;
    var tile = 2;
    for (z = -7; z < 7; z += tile) {
        for (x = -8; x < 8; x += tile) {
            var checker = (((x + 8) / tile + (z + 7) / tile) & 1);
            var floorColor = checker ? 0x555653 : 0x64645f;
            drawQuad(framebuffer,
                     {x: x, y: 0, z: z},
                     {x: x + tile, y: 0, z: z},
                     {x: x + tile, y: 0, z: z + tile},
                     {x: x, y: 0, z: z + tile}, floorColor);
        }
    }

    /* The orbit remains inside this simple service bay, so the walls form a
     * background behind the car rather than passing between camera and car. */
    drawQuad(framebuffer, {x: -8, y: 0, z: 7}, {x: 8, y: 0, z: 7},
             {x: 8, y: 4, z: 7}, {x: -8, y: 4, z: 7}, 0x777871);
    drawQuad(framebuffer, {x: 8, y: 0, z: -7}, {x: -8, y: 0, z: -7},
             {x: -8, y: 4, z: -7}, {x: 8, y: 4, z: -7}, 0x6b6d68);
    drawQuad(framebuffer, {x: -8, y: 0, z: -7}, {x: -8, y: 0, z: 7},
             {x: -8, y: 4, z: 7}, {x: -8, y: 4, z: -7}, 0x70716b);
    drawQuad(framebuffer, {x: 8, y: 0, z: 7}, {x: 8, y: 0, z: -7},
             {x: 8, y: 4, z: -7}, {x: 8, y: 4, z: 7}, 0x70716b);

    /* Lift rails, safety stripes, columns, and a workbench make the room read
     * as a garage while retaining the general box/triangle renderer. */
    drawBox(framebuffer, -1.05, 0.025, 0, 0, 0.12, 0.05, 2.25, 0xd6b82b);
    drawBox(framebuffer, 1.05, 0.025, 0, 0, 0.12, 0.05, 2.25, 0xd6b82b);
    drawBox(framebuffer, -5.8, 0, 5.4, 0, 0.22, 3.2, 0.22, 0x444845);
    drawBox(framebuffer, 5.8, 0, 5.4, 0, 0.22, 3.2, 0.22, 0x444845);
    drawBox(framebuffer, -5.8, 0, -5.4, 0, 0.22, 3.2, 0.22, 0x444845);
    drawBox(framebuffer, 5.8, 0, -5.4, 0, 0.22, 3.2, 0.22, 0x444845);
    drawBox(framebuffer, -4.7, 0.32, 6.35, 0, 1.4, 0.72, 0.42, 0x8b3c2f);
    drawBox(framebuffer, -4.7, 1.03, 6.58, 0, 1.35, 0.12, 0.18, 0xc2c3b9);
    drawDetailedCar(framebuffer, 0, 0.02, 0, 0.18, 0xd94a32, 0);
}

function drawMuddyField(framebuffer) {
    var tile = 16;
    var row = 0;
    for (var z = -FIELD_HALF_LENGTH; z < FIELD_HALF_LENGTH; z += tile) {
        var finalZ = Math.min(FIELD_HALF_LENGTH, z + tile);
        var column = 0;
        for (var x = -FIELD_HALF_WIDTH; x < FIELD_HALF_WIDTH; x += tile) {
            var finalX = Math.min(FIELD_HALF_WIDTH, x + tile);
            var checkerColumn = column++;
            var tileDx = (x + finalX) * 0.5 - camera.x;
            var tileDz = (z + finalZ) * 0.5 - camera.z;
            if (!horizontallyVisible(tileDx, tileDz, 12)) continue;
            var fieldColor = ((row + checkerColumn) & 1) ?
                             0x704b2d : 0x50331f;
            drawQuad(framebuffer,
                     {x: x, y: 0, z: z}, {x: finalX, y: 0, z: z},
                     {x: finalX, y: 0, z: finalZ}, {x: x, y: 0, z: finalZ},
                     fieldColor);
        }
        row++;
    }
    var puddles = [[-18, -9, 5, 2], [13, 11, 7, 2.5],
                   [-4, 23, 4, 1.8], [25, -19, 5, 2.1]];
    for (var puddleIndex = 0; puddleIndex < puddles.length; puddleIndex++) {
        var puddle = puddles[puddleIndex];
        drawQuad(framebuffer,
                 {x: puddle[0] - puddle[2], y: 0.018, z: puddle[1] - puddle[3]},
                 {x: puddle[0] + puddle[2], y: 0.018, z: puddle[1] - puddle[3]},
                 {x: puddle[0] + puddle[2], y: 0.018, z: puddle[1] + puddle[3]},
                 {x: puddle[0] - puddle[2], y: 0.018, z: puddle[1] + puddle[3]},
                 0x343b38);
    }

    /* Two purely painted lines reuse the reproducible rally centreline.  They
     * have no collision or grip effect: this is a driving guide, not a road. */
    for (var trackIndex = 0; trackIndex < TRACK_POINTS; trackIndex += 6) {
        var nextTrackIndex = (trackIndex + 6) % TRACK_POINTS;
        var first = track[trackIndex];
        var second = track[nextTrackIndex];
        var lineMiddleX = (first.x + second.x) * 0.5;
        var lineMiddleZ = (first.z + second.z) * 0.5;
        var lineDx = lineMiddleX - camera.x;
        var lineDz = lineMiddleZ - camera.z;
        if (lineDx * lineDx + lineDz * lineDz > 70 * 70 ||
            !horizontallyVisible(lineDx, lineDz, 8)) continue;
        for (var side = -1; side <= 1; side += 2) {
            var lineOffset = side * FIELD_TRACK_HALF_WIDTH;
            var innerOffset = lineOffset - 0.18;
            var outerOffset = lineOffset + 0.18;
            drawQuad(framebuffer,
                     {x: first.x + first.normalX * innerOffset,
                      y: 0.032,
                      z: first.z + first.normalZ * innerOffset},
                     {x: second.x + second.normalX * innerOffset,
                      y: 0.032,
                      z: second.z + second.normalZ * innerOffset},
                     {x: second.x + second.normalX * outerOffset,
                      y: 0.032,
                      z: second.z + second.normalZ * outerOffset},
                     {x: first.x + first.normalX * outerOffset,
                      y: 0.032,
                      z: first.z + first.normalZ * outerOffset},
                     0xe0c98b);
        }
    }
    var start = track[0];
    var startHalfDepth = 0.32;
    drawQuad(framebuffer,
             {x: start.x - start.tangentX * startHalfDepth -
                 start.normalX * FIELD_TRACK_HALF_WIDTH,
              y: 0.038,
              z: start.z - start.tangentZ * startHalfDepth -
                 start.normalZ * FIELD_TRACK_HALF_WIDTH},
             {x: start.x + start.tangentX * startHalfDepth -
                 start.normalX * FIELD_TRACK_HALF_WIDTH,
              y: 0.038,
              z: start.z + start.tangentZ * startHalfDepth -
                 start.normalZ * FIELD_TRACK_HALF_WIDTH},
             {x: start.x + start.tangentX * startHalfDepth +
                 start.normalX * FIELD_TRACK_HALF_WIDTH,
              y: 0.038,
              z: start.z + start.tangentZ * startHalfDepth +
                 start.normalZ * FIELD_TRACK_HALF_WIDTH},
             {x: start.x - start.tangentX * startHalfDepth +
                 start.normalX * FIELD_TRACK_HALF_WIDTH,
              y: 0.038,
              z: start.z - start.tangentZ * startHalfDepth +
                 start.normalZ * FIELD_TRACK_HALF_WIDTH},
             0xf0e5bd);

    for (x = -FIELD_HALF_WIDTH; x <= FIELD_HALF_WIDTH; x += 16) {
        drawBox(framebuffer, x, 0, -FIELD_HALF_LENGTH, 0, 0.09, 1.0, 0.09,
                0x66513a);
        drawBox(framebuffer, x, 0, FIELD_HALF_LENGTH, 0, 0.09, 1.0, 0.09,
                0x66513a);
    }
    for (z = -FIELD_HALF_LENGTH; z <= FIELD_HALF_LENGTH; z += 16) {
        drawBox(framebuffer, -FIELD_HALF_WIDTH, 0, z, 0, 0.09, 1.0, 0.09,
                0x66513a);
        drawBox(framebuffer, FIELD_HALF_WIDTH, 0, z, 0, 0.09, 1.0, 0.09,
                0x66513a);
    }
    drawDetailedCar(framebuffer, player.x, player.y - 0.13, player.z,
                    player.heading, 0xd94a32, playerWheelSteer);
}

function drawBillboard(framebuffer, x, bottomY, z, width, height, color) {
    var left = {x: x - camera.rightX * width / 2, y: bottomY,
                z: z - camera.rightZ * width / 2};
    var right = {x: x + camera.rightX * width / 2, y: bottomY,
                 z: z + camera.rightZ * width / 2};
    drawQuad(framebuffer, left, right,
             {x: right.x, y: bottomY + height, z: right.z},
             {x: left.x, y: bottomY + height, z: left.z}, color);
}

function drawScenery(framebuffer) {
    for (var i = 0; i < TRACK_POINTS; i += 6) {
        var side = (i & 12) ? 1 : -1;
        var sample = sampleTrack(track[i].distance, side * (10 + (i % 5)));
        var dx = sample.x - camera.x;
        var dz = sample.z - camera.z;
        if (dx * dx + dz * dz > 75 * 75) continue;
        if (i % 18 === 0) {
            drawBillboard(framebuffer, sample.x, sample.y, sample.z,
                          1.0, 2.2, 0x554331);
            drawBillboard(framebuffer, sample.x, sample.y + 1.2, sample.z,
                          4.2, 4.5, (i & 1) ? 0x355e32 : 0x2a512c);
        } else {
            /* Small white sheep in the fields beyond the walls. */
            drawBillboard(framebuffer, sample.x, sample.y + 0.2, sample.z,
                          1.45, 0.75, 0xd7d7c8);
            drawBillboard(framebuffer, sample.x + camera.rightX * 0.66,
                          sample.y + 0.31, sample.z + camera.rightZ * 0.66,
                          0.48, 0.43, 0x292b28);
        }
    }
    for (i = 3; i < TRACK_POINTS; i += 12) {
        var marker = sampleTrack(track[i].distance, (i & 8) ? -4.55 : 4.55);
        drawBillboard(framebuffer, marker.x, marker.y, marker.z,
                      0.34, 1.25, 0xe4e1d3);
        drawBillboard(framebuffer, marker.x, marker.y + 0.78, marker.z,
                      0.38, 0.28, 0xc62f25);
    }
    /* A pair of slate-roof farm buildings overlooking the back section. */
    var farm = sampleTrack(track[58].distance, 15);
    drawBox(framebuffer, farm.x, farm.y, farm.z, farm.heading + 0.4,
            3.0, 2.1, 2.2, 0x77756b);
    drawBox(framebuffer, farm.x, farm.y + 2.0, farm.z, farm.heading + 0.4,
            3.25, 0.35, 2.45, 0x343b42);
}

function createTextBlitter() {
    return nativeCode.compile(function (x86) {
        /* blit(pixels, offsetAndColorPairs, pairCount). */
        x86.push("ebp");
        x86.moveRegister("ebp", "esp");
        x86.push("esi");
        x86.push("edi");
        x86.moveArgument("edi", 0);
        x86.moveArgument("esi", 1);
        x86.moveArgument("ecx", 2);
        x86.testRegisters("ecx", "ecx");
        x86.jump("lessOrEqual", "done");
        x86.label("pair");
        x86.moveMemoryToRegister("eax", "esi", 0);
        x86.moveMemoryToRegister("edx", "esi", 4);
        x86.moveRegisterToMemoryIndexed("edi", "eax", 1, 0, "edx");
        x86.addImmediate("esi", 8);
        x86.decrement("ecx");
        x86.jump("notEqual", "pair");
        x86.label("done");
        x86.xorRegisters("eax", "eax");
        x86.pop("edi");
        x86.pop("esi");
        x86.pop("ebp");
        x86.returnFromFunction();
    });
}

/* The source glyph is 5x7.  A 320x240 viewport is the 2x visual baseline;
 * nearby viewport sizes round to the closest integral bitmap scale, with 1x
 * as the smallest readable representation. */
function textScale(framebuffer) {
    return Math.max(1, Math.round(Math.min(framebuffer.width / 160,
                                           framebuffer.height / 120)));
}

function textGlyphAdvance(framebuffer) {
    return (common.font.width + 1) * textScale(framebuffer);
}

function textLineAdvance(framebuffer) {
    return (common.font.height + 1) * textScale(framebuffer);
}

function cachedText(framebuffer, text, originX, originY) {
    var scale = textScale(framebuffer);
    var key = framebuffer.width + "x" + framebuffer.height + ":" +
              scale + ":" + originX + ":" + originY + ":" + text;
    var cached = textCache[key];
    if (cached) return cached;
    var commands = [];
    var glyphAdvance = textGlyphAdvance(framebuffer);
    var shadowOffset = Math.max(1, Math.floor(scale / 2));
    for (var characterIndex = 0; characterIndex < text.length; characterIndex++) {
        var rows = common.font.glyphRows(text.charAt(characterIndex));
        var characterX = originX + characterIndex * glyphAdvance;
        for (var row = 0; row < common.font.height; row++) {
            for (var column = 0; column < common.font.width; column++) {
                if (!(rows[row] & (1 << (common.font.width - column - 1)))) continue;
                for (var scaleY = 0; scaleY < scale; scaleY++) {
                    for (var scaleX = 0; scaleX < scale; scaleX++) {
                        var pixelX = characterX + column * scale + scaleX;
                        var pixelY = originY + row * scale + scaleY;
                        var shadowX = pixelX + shadowOffset;
                        var shadowY = pixelY + shadowOffset;
                        if (shadowX >= 0 && shadowY >= 0 &&
                            shadowX < framebuffer.width && shadowY < framebuffer.height) {
                            commands.push((shadowY * framebuffer.width + shadowX) * 4, 0);
                        }
                        if (pixelX >= 0 && pixelY >= 0 &&
                            pixelX < framebuffer.width && pixelY < framebuffer.height) {
                            commands.push((pixelY * framebuffer.width + pixelX) * 4,
                                          0x00ffffff);
                        }
                    }
                }
            }
        }
    }
    var pointer = memory.allocate(commands.length * 4);
    for (var commandIndex = 0; commandIndex < commands.length; commandIndex++) {
        poke32(pointer + commandIndex * 4, commands[commandIndex]);
    }
    cached = {pointer: pointer, count: commands.length / 2};
    textCache[key] = cached;
    return cached;
}

function paintText(framebuffer, text, x, y) {
    if (!textBlitter) textBlitter = createTextBlitter();
    var cached = cachedText(framebuffer, text, x, y);
    if (cached.count) {
        nativeCode.call8(textBlitter, framebuffer.pixelAddress,
                         cached.pointer, cached.count, 0, 0, 0, 0, 0);
    }
}

function Demo8FrameRateCounter(showOnScreen, logToConsole) {
    this.showOnScreen = showOnScreen;
    this.logToConsole = logToConsole;
    this.displayStartedAt = 0;
    this.displayFrames = 0;
    this.displayValue = 0;
    this.logStartedAt = 0;
    this.logFrames = 0;
}

Demo8FrameRateCounter.prototype.draw = function (framebuffer) {
    var now = new Date().getTime();
    if (!this.displayStartedAt) this.displayStartedAt = now;
    if (!this.logStartedAt) this.logStartedAt = now;
    this.displayFrames++;
    this.logFrames++;
    var displayElapsed = now - this.displayStartedAt;
    if (displayElapsed >= 1000) {
        this.displayValue = Math.round(this.displayFrames * 1000 / displayElapsed);
        this.displayFrames = 0;
        this.displayStartedAt = now;
    }
    var logElapsed = now - this.logStartedAt;
    if (this.logToConsole && logElapsed >= 5000) {
        var measured = this.logFrames * 1000 / logElapsed;
        console.log("frame rate: " + measured.toFixed(1) + " FPS (" +
                    this.logFrames + " frames in " +
                    (logElapsed / 1000).toFixed(1) + " seconds)");
        this.logFrames = 0;
        this.logStartedAt = now;
    }
    if (this.showOnScreen) {
        var label = "FPS " + this.displayValue;
        var glyphAdvance = textGlyphAdvance(framebuffer);
        var lineAdvance = textLineAdvance(framebuffer);
        paintText(framebuffer, label,
                  Math.max(0, framebuffer.width -
                           label.length * glyphAdvance),
                  Math.max(0, framebuffer.height - lineAdvance));
    }
    framebuffer.requestFrame();
};

function drawHud(framebuffer) {
    var speed = Math.max(0, Math.round(player.speed * 6.2));
    var scale = textScale(framebuffer);
    var glyphAdvance = textGlyphAdvance(framebuffer);
    var lineAdvance = textLineAdvance(framebuffer);
    var margin = scale;
    var compact = framebuffer.width / glyphAdvance < 19;
    paintText(framebuffer, (compact ? "SPD " : "SPEED ") + speed,
              margin, margin);
    paintText(framebuffer, (compact ? "L" : "LAP ") +
              Math.min(RACE_LAPS, player.lap + 1) + "/" + RACE_LAPS,
              margin, margin + lineAdvance);
    var positionLabel = (compact ? "P" : "POS ") + player.position + "/6";
    paintText(framebuffer, positionLabel,
              Math.max(margin, framebuffer.width - positionLabel.length *
                       glyphAdvance - margin), margin);
    if (raceFinished) {
        var finish = "FINISH  POS " + player.position;
        paintText(framebuffer, finish,
                  Math.max(0, Math.floor((framebuffer.width - finish.length *
                                         glyphAdvance) / 2)),
                  Math.floor(framebuffer.height * 0.28));
    }
    if (rollingMode) {
        if (framebuffer.width / glyphAdvance >= 20) {
            var prompt = "PUSH SPACE TO PLAY";
            paintText(framebuffer, prompt,
                      Math.max(0, Math.floor((framebuffer.width - prompt.length *
                                             glyphAdvance) / 2)),
                      Math.floor(framebuffer.height * 0.28));
        } else {
            var firstLine = "PUSH SPACE";
            var secondLine = "TO PLAY";
            paintText(framebuffer, firstLine,
                      Math.max(0, Math.floor((framebuffer.width - firstLine.length *
                                             glyphAdvance) / 2)),
                      Math.floor(framebuffer.height * 0.36));
            paintText(framebuffer, secondLine,
                      Math.max(0, Math.floor((framebuffer.width - secondLine.length *
                                             glyphAdvance) / 2)),
                      Math.floor(framebuffer.height * 0.36) +
                      lineAdvance);
        }
    }
}

function centeredText(framebuffer, text, y) {
    paintText(framebuffer, text,
              Math.max(0, Math.floor((framebuffer.width - text.length *
                                      textGlyphAdvance(framebuffer)) / 2)), y);
}

function drawModeHud(framebuffer) {
    if (gameMode === GAME_MODE_RALLY) {
        drawHud(framebuffer);
    } else if (gameMode === GAME_MODE_GARAGE) {
        var scale = textScale(framebuffer);
        var glyphAdvance = textGlyphAdvance(framebuffer);
        var lineAdvance = textLineAdvance(framebuffer);
        paintText(framebuffer, "GARAGE", scale, scale);
        if (framebuffer.width / glyphAdvance >= 24) {
            centeredText(framebuffer, "DRAG MOUSE TO MOVE CAMERA",
                         framebuffer.height - lineAdvance);
        }
    } else {
        var speed = Math.round(Math.sqrt(player.velocityX * player.velocityX +
                                         player.velocityZ * player.velocityZ) * 6.2);
        scale = textScale(framebuffer);
        lineAdvance = textLineAdvance(framebuffer);
        paintText(framebuffer, "FREE DRIVE", scale, scale);
        paintText(framebuffer, "SPEED " + speed, scale, scale + lineAdvance);
        if (player.powerSliding) {
            paintText(framebuffer, "POWER SLIDE", scale,
                      scale + lineAdvance * 2);
        }
    }
}

function drawMenu(framebuffer) {
    var scale = textScale(framebuffer);
    var glyphAdvance = textGlyphAdvance(framebuffer);
    var lineAdvance = textLineAdvance(framebuffer);
    var fullWidth = 16 * glyphAdvance + scale * 4;
    var fullHeight = 6 * lineAdvance + scale * 4;
    var tiny = framebuffer.width / glyphAdvance < 8;
    var compact = tiny || framebuffer.width < fullWidth ||
                  framebuffer.height < fullHeight;
    var lines = tiny ? ["MENU", "R G F", "Q ESC"] :
                compact ? ["MENU", "R G F Q", "ESC"] :
                          ["PAUSED MENU", "ESC  RESUME", "R  RESTART GAME",
                           "G  GARAGE", "F  FREE DRIVE", "Q  QUIT"];
    var maximumCharacters = 0;
    for (var measureIndex = 0; measureIndex < lines.length; measureIndex++) {
        maximumCharacters = Math.max(maximumCharacters, lines[measureIndex].length);
    }
    var padding = scale * 2;
    var panelWidth = Math.min(framebuffer.width - scale * 2,
                              maximumCharacters * glyphAdvance + padding * 2);
    var panelHeight = lines.length * lineAdvance + padding * 2;
    var left = Math.floor((framebuffer.width - panelWidth) / 2);
    var top = Math.max(2, Math.floor((framebuffer.height - panelHeight) / 2));
    var right = left + panelWidth;
    var bottom = Math.min(framebuffer.height - 2, top + panelHeight);
    for (var y = top; y < bottom; y++) {
        libc.memset(framebuffer.pixelAddress +
                    (y * framebuffer.width + left) * 4,
                    0, (right - left) * 4);
    }
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        centeredText(framebuffer, lines[lineIndex], top + padding +
                     lineIndex * lineAdvance);
    }
}

function drawLoading(framebuffer) {
    var message = framebuffer.width >= 120 ? "LOADING..." : "LOAD";
    var glyphAdvance = textGlyphAdvance(framebuffer);
    var lineAdvance = textLineAdvance(framebuffer);
    paintText(framebuffer, message,
              Math.max(0, Math.floor((framebuffer.width - message.length *
                                      glyphAdvance) / 2)),
              Math.max(0, Math.floor((framebuffer.height -
                                      lineAdvance) / 2)));
    framebuffer.requestFrame();
}

function reportGameReady() {
    console.log("Welsh upland rally created: " + windowInfo.width + "x" +
                windowInfo.height + ", 1 player and " + competitors.length +
                " AI cars, " + RACE_LAPS + " laps, " +
                windowInfo.framesPerSecond + " FPS limit");
    console.log("Attract mode running; push Space to reset the grid and play");
    console.log("Drive with arrows or WASD; Space brakes; Escape opens the menu");
    console.log("Menu: Escape resumes, R restarts game, G garage, F free drive, Q quits");
    console.log("F2 cycles triangle rasterization: hand ASM, compiled native, reference JS");
    console.log("triangle-half rasterizer: hand ASM");
}

function initializeGame() {
    track = makeTrack();
    terrainCells = makeTerrainCells();
    roadSections = makeRoadSections();
    depthBuffer = memory.allocate(options.width * options.height * 4);
    spanRasterizer = createSpanRasterizer(depthBuffer, options.width);
    spanRasterizers = {};
    triangleHalfRasterizerJS.nativeCompile = {
        constants: {"options.width": options.width,
                    depthBuffer: depthBuffer},
        specialize: ["packed"],
        dumpMacroAssembly: options.dumpNativeAssembly
    };
    triangleHalfRasterizerASM = compileNative(triangleHalfRasterizerJS).fn;
    compiledTriangleHalfRasterizer = triangleHalfRasterizerASM.compiledObject;
    verifyTriangleHalfRasterizers();
    background = makeBackground(options.width, options.height);
    resetRace();
    gameReady = true;
    reportGameReady();
}

function draw(framebuffer) {
    if (framebuffer.pixelFormat !== "bgrx32le") {
        throw new Error("demo8 requires a little-endian BGRX 32-bit X11 framebuffer");
    }
    if (!framebuffer.pixelAddress) {
        throw new Error("demo8 requires an MMVM native framebuffer");
    }
    if (!gameReady) {
        if (loadingFrames === 0) {
            loadingFrames++;
            drawLoading(framebuffer);
            return;
        }
        if (!initializationStarted) {
            initializationStarted = true;
            initializeGame();
        }
        if (!gameReady) return;
    }
    var now = new Date().getTime();
    if (!lastFrameTime) lastFrameTime = now;
    var elapsed = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    if (menuOpen) elapsed = 0;
    if (gameMode === GAME_MODE_RALLY) {
        if (!menuOpen) updateSimulation(elapsed);
        setCamera();
    } else if (gameMode === GAME_MODE_GARAGE) {
        setGarageCamera(menuOpen ? 0 : elapsed);
    } else {
        if (!menuOpen) updateFreeDrive(elapsed);
        setFreeDriveCamera(menuOpen ? 0 : elapsed);
    }
    projectedVertexCount = 0;
    projectionFrame++;
    libc.memset(depthBuffer, 0, options.width * options.height * 4);
    background.copy(framebuffer.pixels, 0, 0, background.length);
    if (gameMode === GAME_MODE_RALLY) {
        drawCar(framebuffer, player.x, player.y, player.z, player.heading,
                0xd94a32, true);
        drawRoad(framebuffer);
        drawHillsides(framebuffer);
        drawScenery(framebuffer);
        for (var i = 0; i < competitors.length; i++) {
            var ai = competitors[i];
            drawCar(framebuffer, ai.sample.x, ai.sample.y + 0.10, ai.sample.z,
                    ai.sample.heading, ai.color, false);
        }
    } else if (gameMode === GAME_MODE_GARAGE) {
        drawGarage(framebuffer);
    } else {
        drawMuddyField(framebuffer);
    }
    drawModeHud(framebuffer);
    if (menuOpen) drawMenu(framebuffer);
    if (frameRateCounter) frameRateCounter.draw(framebuffer);
    else framebuffer.requestFrame();
}

function setDrivingKey(event, pressed) {
    var key = event.keysym;
    if (key === common.keysyms.left || key === 97 || key === 65) {
        controls.left = pressed;
    } else if (key === common.keysyms.right || key === 100 || key === 68) {
        controls.right = pressed;
    } else if (key === common.keysyms.up || key === 119 || key === 87) {
        controls.throttle = pressed;
    } else if (key === common.keysyms.down || key === 115 || key === 83 || key === 32) {
        controls.brake = pressed;
    }
}

function startHumanRace() {
    gameMode = GAME_MODE_RALLY;
    rollingMode = false;
    resetRace();
}

function isEscape(event) {
    return event.keysym === common.keysyms.escape ||
           (!event.keysym && event.keycode === 9);
}

function openMenu() {
    menuOpen = true;
    garageDragging = false;
    clearControls();
    console.log("menu opened");
}

function closeMenu() {
    menuOpen = false;
    lastFrameTime = 0;
    console.log("menu closed; resuming");
}

function handleMenuKey(event, activeWindow) {
    var key = event.keysym;
    if (isEscape(event)) closeMenu();
    else if (key === 113 || key === 81) activeWindow.close();
    else if (key === 114 || key === 82) enterRallyMode();
    else if (key === 103 || key === 71) enterGarageMode();
    else if (key === 102 || key === 70) enterFreeDriveMode();
}

function toggleTriangleRasterizer() {
    triangleRasterizerMode = (triangleRasterizerMode + 1) % 3;
    var names = ["hand ASM", "compiled native", "JS reference"];
    console.log("triangle-half rasterizer: " + names[triangleRasterizerMode]);
}

var window = common.createWindow({
    width: options.width,
    height: options.height,
    fps: options.fps,
    fpsCounter: false,
    debugEvents: false,
    title: "demo8.js Welsh upland rally",
    instanceName: "demo8",
    className: "NodeX11Demo",
    draw: draw,
    keyPress: function (event, activeWindow) {
        if (!gameReady) {
            if (isEscape(event)) activeWindow.close();
            return;
        }
        if (menuOpen) {
            handleMenuKey(event, activeWindow);
            return;
        }
        if (isEscape(event)) {
            openMenu();
            return;
        }
        if (gameMode === GAME_MODE_RALLY && event.keysym === 32 &&
            (rollingMode || raceFinished)) {
            startHumanRace();
            return;
        }
        if (event.keysym === common.keysyms.f2) {
            toggleTriangleRasterizer();
            return;
        }
        if (gameMode !== GAME_MODE_GARAGE) setDrivingKey(event, true);
        if (options.debugEvents) {
            console.log("key press: X11 keycode " + event.keycode +
                        ", keysym 0x" + event.keysym.toString(16));
        }
    },
    keyRelease: function (event) {
        if (!gameReady) return;
        if (!menuOpen && gameMode !== GAME_MODE_GARAGE) setDrivingKey(event, false);
    },
    buttonPress: function (event) {
        if (!gameReady || menuOpen || gameMode !== GAME_MODE_GARAGE ||
            event.button !== 1) return;
        garageDragging = true;
        garageDragX = event.x;
        garageDragY = event.y;
    },
    buttonRelease: function (event) {
        if (event.button === 1) garageDragging = false;
    },
    pointerMove: function (event) {
        if (!garageDragging || menuOpen || gameMode !== GAME_MODE_GARAGE) return;
        var deltaX = event.x - garageDragX;
        var deltaY = event.y - garageDragY;
        garageOrbitPhase -= deltaX * 0.012;
        garageManualLift = clamp(garageManualLift - deltaY * 0.012, -0.9, 1.35);
        garageDragX = event.x;
        garageDragY = event.y;
    },
    ready: function (info) {
        windowInfo = info;
        console.log("Rally window created; loading course and terrain...");
    },
    keyboardMapping: function (mapping) {
        if (options.debugEvents) {
            console.log("keyboard mapping loaded: keycodes " +
                        mapping.minimumKeycode + ".." + mapping.maximumKeycode +
                        ", " + mapping.keysymsPerKeycode + " keysyms per keycode");
        }
    },
    error: function (error) {
        console.error(error.message || String(error));
        process.exitCode = 1;
    },
    close: function () {
        if (spanRasterizer) nativeCode.destroy(spanRasterizer);
        if (textBlitter) nativeCode.destroy(textBlitter);
        if (compiledTriangleHalfRasterizer) {
            compiledTriangleHalfRasterizer.destroy();
        }
        for (var rasterizerKey in spanRasterizers) {
            if (spanRasterizers.hasOwnProperty(rasterizerKey)) {
                nativeCode.destroy(spanRasterizers[rasterizerKey]);
            }
        }
        for (var textKey in textCache) {
            if (textCache.hasOwnProperty(textKey)) memory.free(textCache[textKey].pointer);
        }
        if (depthBuffer) memory.free(depthBuffer);
        spanRasterizer = null;
        spanRasterizers = {};
        triangleHalfRasterizerASM = null;
        compiledTriangleHalfRasterizer = null;
        textBlitter = null;
        textCache = {};
        depthBuffer = 0;
        if (options.debugEvents) console.log("X11 connection closed");
    }
});
});
