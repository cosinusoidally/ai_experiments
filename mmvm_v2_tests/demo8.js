/* MMVM-specific rally application loaded by demo8_runner.js. */
DemoRunner.define(function (runner) {
var common = runner.common;
var libc = runner.libc;
var memory = runner.memory;
var nativeCode = runner.nativeCode;
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
var useJavaScriptTriangleRasterizer = false;
var DEPTH_FIXED_SCALE = 67108864;
var BOX_LOCAL = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
var BOX_FACES = [[0, 1, 2, 3, 0.48], [4, 7, 6, 5, 1.0],
                 [0, 4, 5, 1, 0.65], [1, 5, 6, 2, 0.82],
                 [2, 6, 7, 3, 0.58], [3, 7, 4, 0, 0.72]];
var controls = {left: false, right: false, throttle: false, brake: false};
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

function triangleHalfRasterizerASM(pixelAddress, packedYRange,
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
    triangleHalfRasterizerASM(asmPixels, packedYRange,
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

    memory.free(jsPixels);
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
        if (useJavaScriptTriangleRasterizer) {
            triangleHalfRasterizerJS(
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

function cachedText(framebuffer, text, originX, originY) {
    var key = framebuffer.width + "x" + framebuffer.height + ":" +
              originX + ":" + originY + ":" + text;
    var cached = textCache[key];
    if (cached) return cached;
    var commands = [];
    var scale = common.font.scale;
    for (var characterIndex = 0; characterIndex < text.length; characterIndex++) {
        var rows = common.font.glyphRows(text.charAt(characterIndex));
        var characterX = originX + characterIndex * common.font.glyphAdvance;
        for (var row = 0; row < common.font.height; row++) {
            for (var column = 0; column < common.font.width; column++) {
                if (!(rows[row] & (1 << (common.font.width - column - 1)))) continue;
                for (var scaleY = 0; scaleY < scale; scaleY++) {
                    for (var scaleX = 0; scaleX < scale; scaleX++) {
                        var pixelX = characterX + column * scale + scaleX;
                        var pixelY = originY + row * scale + scaleY;
                        var shadowX = pixelX + 1;
                        var shadowY = pixelY + 1;
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
        paintText(framebuffer, label,
                  Math.max(0, framebuffer.width -
                           label.length * common.font.glyphAdvance),
                  Math.max(0, framebuffer.height - common.font.lineAdvance));
    }
    framebuffer.requestFrame();
};

function drawHud(framebuffer) {
    var speed = Math.max(0, Math.round(player.speed * 6.2));
    var compact = framebuffer.width < 220;
    paintText(framebuffer, (compact ? "SPD " : "SPEED ") + speed, 2, 2);
    paintText(framebuffer, (compact ? "L" : "LAP ") +
              Math.min(RACE_LAPS, player.lap + 1) + "/" + RACE_LAPS, 2, 18);
    var positionLabel = (compact ? "P" : "POS ") + player.position + "/6";
    paintText(framebuffer, positionLabel,
              Math.max(2, framebuffer.width - positionLabel.length *
                       common.font.glyphAdvance - 2), 2);
    if (raceFinished) {
        var finish = "FINISH  POS " + player.position;
        paintText(framebuffer, finish,
                  Math.max(0, Math.floor((framebuffer.width - finish.length *
                                         common.font.glyphAdvance) / 2)),
                  Math.floor(framebuffer.height * 0.28));
    }
    if (rollingMode) {
        if (framebuffer.width >= 230) {
            var prompt = "PUSH SPACE TO PLAY";
            paintText(framebuffer, prompt,
                      Math.max(0, Math.floor((framebuffer.width - prompt.length *
                                             common.font.glyphAdvance) / 2)),
                      Math.floor(framebuffer.height * 0.28));
        } else {
            var firstLine = "PUSH SPACE";
            var secondLine = "TO PLAY";
            paintText(framebuffer, firstLine,
                      Math.max(0, Math.floor((framebuffer.width - firstLine.length *
                                             common.font.glyphAdvance) / 2)),
                      Math.floor(framebuffer.height * 0.36));
            paintText(framebuffer, secondLine,
                      Math.max(0, Math.floor((framebuffer.width - secondLine.length *
                                             common.font.glyphAdvance) / 2)),
                      Math.floor(framebuffer.height * 0.36) +
                      common.font.lineAdvance);
        }
    }
}

function drawLoading(framebuffer) {
    var message = framebuffer.width >= 120 ? "LOADING..." : "LOAD";
    paintText(framebuffer, message,
              Math.max(0, Math.floor((framebuffer.width - message.length *
                                      common.font.glyphAdvance) / 2)),
              Math.max(0, Math.floor((framebuffer.height -
                                      common.font.lineAdvance) / 2)));
    framebuffer.requestFrame();
}

function reportGameReady() {
    console.log("Welsh upland rally created: " + windowInfo.width + "x" +
                windowInfo.height + ", 1 player and " + competitors.length +
                " AI cars, " + RACE_LAPS + " laps, " +
                windowInfo.framesPerSecond + " FPS limit");
    console.log("Attract mode running; push Space to reset the grid and play");
    console.log("Drive with arrows or WASD; Space brakes; R restarts; Escape exits");
    console.log("F2 toggles triangle rasterization between ASM and JS reference modes");
    console.log("triangle-half rasterizer: ASM");
}

function initializeGame() {
    track = makeTrack();
    terrainCells = makeTerrainCells();
    roadSections = makeRoadSections();
    depthBuffer = memory.allocate(options.width * options.height * 4);
    spanRasterizer = createSpanRasterizer(depthBuffer, options.width);
    spanRasterizers = {};
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
    updateSimulation(elapsed);
    setCamera();
    projectedVertexCount = 0;
    projectionFrame++;
    libc.memset(depthBuffer, 0, options.width * options.height * 4);
    background.copy(framebuffer.pixels, 0, 0, background.length);
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
    drawHud(framebuffer);
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
    rollingMode = false;
    resetRace();
}

function toggleTriangleRasterizer() {
    useJavaScriptTriangleRasterizer = !useJavaScriptTriangleRasterizer;
    console.log("triangle-half rasterizer: " +
                (useJavaScriptTriangleRasterizer ? "JS reference" : "ASM"));
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
            if (event.keysym === common.keysyms.escape ||
                (!event.keysym && event.keycode === 9)) activeWindow.close();
            return;
        }
        if (event.keysym === 32 && (rollingMode || raceFinished)) {
            startHumanRace();
            return;
        }
        if (event.keysym === common.keysyms.f2) {
            toggleTriangleRasterizer();
            return;
        }
        setDrivingKey(event, true);
        if (event.keysym === common.keysyms.escape ||
            (!event.keysym && event.keycode === 9)) activeWindow.close();
        else if (event.keysym === 114 || event.keysym === 82) resetRace();
        if (options.debugEvents) {
            console.log("key press: X11 keycode " + event.keycode +
                        ", keysym 0x" + event.keysym.toString(16));
        }
    },
    keyRelease: function (event) {
        if (!gameReady) return;
        setDrivingKey(event, false);
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
        textBlitter = null;
        textCache = {};
        depthBuffer = 0;
        if (options.debugEvents) console.log("X11 connection closed");
    }
});
});
