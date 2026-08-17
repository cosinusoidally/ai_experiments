/*
 * Optimized general-purpose software rasterizer running the same original
 * Welsh-inspired rally stage as demo6. Pixel storage uses native packed
 * 32-bit access in MMVM and the equivalent Buffer operations in Node.js.
 */
var common = require("./demo_common.js");

var options = common.parseOptions(process.argv, "demo7.js");
var TRACK_POINTS = 96;
var ROAD_HALF_WIDTH = 3.7;
var WALL_OFFSET = 5.15;
var RACE_LAPS = 3;
var track = makeTrack();
var terrainCells = makeTerrainCells();
var roadSections = makeRoadSections();
var depthBuffer = new Array(options.width * options.height);
var background = makeBackground(options.width, options.height);
var controls = {left: false, right: false, throttle: false, brake: false};
var player;
var competitors;
var lastFrameTime = 0;
var camera;
var raceFinished = false;
var rollingMode = true;
var projectedVertexPool = [];
var projectedVertexCount = 0;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
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

function sampleTrack(distance, lane) {
    distance = wrapDistance(distance);
    var segment = TRACK_POINTS - 1;
    for (var i = 0; i < TRACK_POINTS; i++) {
        if (distance < track[i].distance + track[i].segmentLength) {
            segment = i;
            break;
        }
    }
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

resetRace();

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
    if (nearest.distance > ROAD_HALF_WIDTH) {
        player.speed *= Math.pow(0.90, dt * 60);
    }
    if (nearest.distance > WALL_OFFSET) {
        var push = Math.min(nearest.distance - WALL_OFFSET, 2.5) * 0.55;
        var inverseDistance = 1 / nearest.distance;
        player.x += (nearest.x - player.x) * inverseDistance * push;
        player.z += (nearest.z - player.z) * inverseDistance * push;
        player.speed *= 0.68;
    }

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
    var dx = world.x - camera.x;
    var dy = world.y - camera.y;
    var dz = world.z - camera.z;
    var right = dx * camera.rightX + dz * camera.rightZ;
    var forward = dx * camera.forwardX + dz * camera.forwardZ;
    var vertical = dy * camera.pitchCos + forward * camera.pitchSin;
    var depth = forward * camera.pitchCos - dy * camera.pitchSin;
    if (depth <= 0.35) return null;
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
    return projected;
}

function rasterRows(framebuffer, firstY, lastY,
                    firstX, firstZ, firstXStep, firstZStep,
                    secondX, secondZ, secondXStep, secondZStep, packed) {
    var pixelAddress = framebuffer.pixelAddress;
    var pixels = framebuffer.pixels;
    var width = framebuffer.width;
    var clippedFirstY = Math.max(0, firstY);
    var clippedLastY = Math.min(framebuffer.height, lastY);
    var skippedRows = clippedFirstY - firstY;
    firstX += firstXStep * skippedRows;
    firstZ += firstZStep * skippedRows;
    secondX += secondXStep * skippedRows;
    secondZ += secondZStep * skippedRows;
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
        var pixelIndex = y * width + minimumX;
        var pixelOffset = pixelIndex * 4;
        for (var x = minimumX; x < maximumX; x++) {
            if (inverseZ > depthBuffer[pixelIndex]) {
                if (pixelAddress) poke32(pixelAddress + pixelOffset, packed);
                else pixels.writeUInt32LE(packed >>> 0, pixelOffset);
                depthBuffer[pixelIndex] = inverseZ;
            }
            inverseZ += depthStep;
            pixelIndex++;
            pixelOffset += 4;
        }
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
    if (!pa || !pb || !pc || !pd) return;
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

function nearestOtherTrack(x, z, ownerSegment) {
    var bestSquared = 1e30;
    var bestY = 0;
    for (var i = 0; i < TRACK_POINTS; i++) {
        var separation = Math.abs(i - ownerSegment);
        separation = Math.min(separation, TRACK_POINTS - separation);
        if (separation <= 3) continue;
        var first = track[i];
        var second = track[(i + 1) % TRACK_POINTS];
        var dx = second.x - first.x;
        var dz = second.z - first.z;
        var lengthSquared = dx * dx + dz * dz;
        var amount = clamp(((x - first.x) * dx + (z - first.z) * dz) /
                           lengthSquared, 0, 1);
        var offsetX = x - (first.x + dx * amount);
        var offsetZ = z - (first.z + dz * amount);
        var squared = offsetX * offsetX + offsetZ * offsetZ;
        if (squared < bestSquared) {
            bestSquared = squared;
            bestY = first.y + (second.y - first.y) * amount;
        }
    }
    return {distance: Math.sqrt(bestSquared), y: bestY};
}

function carveTerrainPoint(ownerSegment, point) {
    var nearest = nearestOtherTrack(point.x, point.z, ownerSegment);
    var carveRadius = WALL_OFFSET + 5.0;
    if (nearest.distance < carveRadius) {
        var blend = 1 - nearest.distance / carveRadius;
        blend = blend * blend;
        var carvedY = point.y + (nearest.y - 0.24 - point.y) * blend;
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
    /* Fine static cells bend beneath any other portion of the closed course. */
    var bands = [4.45, 7.0, 10.0, 14.0, 18.0, 23.0,
                 29.0, 36.0, 44.0, 54.0];
    var fieldColors = [0x355f31, 0x3f6c35, 0x486f38, 0x315b32];
    var cells = [];
    for (var i = 0; i < TRACK_POINTS; i++) {
        var first = track[i];
        var second = track[(i + 1) % TRACK_POINTS];
        for (var sideIndex = 0; sideIndex < 2; sideIndex++) {
            var side = sideIndex ? 1 : -1;
            for (var band = 0; band < bands.length - 1; band++) {
                var inner = bands[band] * side;
                var outer = bands[band + 1] * side;
                var colorIndex = (i >> 2) + band + sideIndex * 2;
                var color = fieldColors[colorIndex & 3];
                var innerFirst = carveTerrainPoint(
                    i, terrainPoint(first, i, inner));
                var innerSecond = carveTerrainPoint(
                    i, terrainPoint(second, i + 1, inner));
                var outerSecond = carveTerrainPoint(
                    i, terrainPoint(second, i + 1, outer));
                var outerFirst = carveTerrainPoint(
                    i, terrainPoint(first, i, outer));
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
        if (centerX * centerX + centerZ * centerZ > 76 * 76) continue;
        /* The cell centre is conservative here because cells are short along
         * the track. Avoid allocating a temporary four-element point array. */
        var centerForward = centerX * camera.forwardX +
                            centerZ * camera.forwardZ;
        if (centerForward < 3.0) continue;
        if (!horizontallyVisible(centerX, centerZ, cell.radius)) continue;
        drawQuad(framebuffer, cell.a, cell.b, cell.c, cell.d, cell.color);
    }
}

function addRoadQuad(section, a, b, c, d, color) {
    section.quads.push({a: a, b: b, c: c, d: d, color: color});
}

function addWallSection(section, first, second, offset, color) {
    var bottomFirst = roadEdge(first, offset, 0);
    var bottomSecond = roadEdge(second, offset, 0);
    var middleFirst = {x: bottomFirst.x, y: bottomFirst.y + 0.43,
                       z: bottomFirst.z};
    var middleSecond = {x: bottomSecond.x, y: bottomSecond.y + 0.43,
                        z: bottomSecond.z};
    var topFirst = {x: bottomFirst.x, y: bottomFirst.y + 0.76,
                    z: bottomFirst.z};
    var topSecond = {x: bottomSecond.x, y: bottomSecond.y + 0.76,
                     z: bottomSecond.z};
    addRoadQuad(section, bottomFirst, bottomSecond, middleSecond, middleFirst,
                shadeColor(color, 0.73));
    addRoadQuad(section, middleFirst, middleSecond, topSecond, topFirst, color);
}

function makeRoadSections() {
    var sections = [];
    for (var i = 0; i < TRACK_POINTS; i++) {
        var first = track[i];
        var second = track[(i + 1) % TRACK_POINTS];
        var section = {centerX: (first.x + second.x) * 0.5,
                       centerZ: (first.z + second.z) * 0.5,
                       radius: first.segmentLength * 0.5 + WALL_OFFSET + 1.0,
                       quads: []};
        var shoulderColor = (i & 1) ? 0x72583a : 0x674d33;
        var roadColor = (i % 3) ? 0x8b7455 : 0x806949;
        addRoadQuad(section, roadEdge(first, -4.45, -0.05),
                    roadEdge(second, -4.45, -0.05),
                    roadEdge(second, 4.45, -0.05),
                    roadEdge(first, 4.45, -0.05), shoulderColor);
        addRoadQuad(section, roadEdge(first, -ROAD_HALF_WIDTH, 0),
                    roadEdge(second, -ROAD_HALF_WIDTH, 0),
                    roadEdge(second, ROAD_HALF_WIDTH, 0),
                    roadEdge(first, ROAD_HALF_WIDTH, 0), roadColor);
        var rutColor = (i & 3) ? 0x5d4b37 : 0x68523a;
        addRoadQuad(section, roadEdge(first, -1.38, 0.018),
                    roadEdge(second, -1.38, 0.018),
                    roadEdge(second, -0.82, 0.018),
                    roadEdge(first, -0.82, 0.018), rutColor);
        addRoadQuad(section, roadEdge(first, 0.82, 0.018),
                    roadEdge(second, 0.82, 0.018),
                    roadEdge(second, 1.38, 0.018),
                    roadEdge(first, 1.38, 0.018), rutColor);
        if ((i % 5) === 2) {
            addRoadQuad(section, roadEdge(first, -0.38, 0.022),
                        roadEdge(second, -0.38, 0.022),
                        roadEdge(second, 0.42, 0.022),
                        roadEdge(first, 0.42, 0.022), 0x765d40);
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
        if (dx * dx + dz * dz > 90 * 90) continue;
        var forward = dx * camera.forwardX + dz * camera.forwardZ;
        if (forward < -4.0) continue;
        if (!horizontallyVisible(dx, dz, section.radius)) continue;
        for (var quadIndex = 0; quadIndex < section.quads.length; quadIndex++) {
            var quad = section.quads[quadIndex];
            drawQuad(framebuffer, quad.a, quad.b, quad.c, quad.d, quad.color);
        }
    }
}

function shadeColor(color, amount) {
    return (clamp(((color >>> 16) & 255) * amount, 0, 255) << 16) |
           (clamp(((color >>> 8) & 255) * amount, 0, 255) << 8) |
           clamp((color & 255) * amount, 0, 255);
}

function orientedPoint(cx, y, cz, heading, localX, localZ) {
    var sine = Math.sin(heading);
    var cosine = Math.cos(heading);
    return {x: cx + localX * cosine + localZ * sine,
            y: y,
            z: cz - localX * sine + localZ * cosine};
}

function drawBox(framebuffer, cx, y, cz, heading, halfWidth, height, halfLength,
                 color) {
    var vertices = [];
    var local = [[-halfWidth, -halfLength], [halfWidth, -halfLength],
                 [halfWidth, halfLength], [-halfWidth, halfLength]];
    for (var level = 0; level < 2; level++) {
        for (var i = 0; i < 4; i++) {
            vertices.push(orientedPoint(cx, y + level * height, cz, heading,
                                        local[i][0], local[i][1]));
        }
    }
    var faces = [[0, 1, 2, 3, 0.48], [4, 7, 6, 5, 1.0],
                 [0, 4, 5, 1, 0.65], [1, 5, 6, 2, 0.82],
                 [2, 6, 7, 3, 0.58], [3, 7, 4, 0, 0.72]];
    for (i = 0; i < faces.length; i++) {
        var face = faces[i];
        drawQuad(framebuffer, vertices[face[0]], vertices[face[1]],
                 vertices[face[2]], vertices[face[3]],
                 shadeColor(color, face[4]), true);
    }
}

function drawCar(framebuffer, carX, carY, carZ, heading, color, isPlayer) {
    drawBox(framebuffer, carX, carY, carZ, heading, 0.82, 0.42, 1.35, color);
    var cabin = orientedPoint(carX, carY + 0.41, carZ, heading, 0, -0.18);
    drawBox(framebuffer, cabin.x, cabin.y, cabin.z, heading,
            0.58, 0.38, 0.58, isPlayer ? 0x72cce6 : 0x9bc2cf);
    var bumper = orientedPoint(carX, carY + 0.18, carZ, heading, 0, 1.32);
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

function paintText(framebuffer, text, x, y) {
    for (var i = 0; i < text.length; i++) {
        common.paintGlyph(framebuffer, text.charAt(i),
                          x + i * common.font.glyphAdvance, y);
    }
}

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

function draw(framebuffer) {
    if (framebuffer.pixelFormat !== "bgrx32le") {
        throw new Error("demo7 requires a little-endian BGRX 32-bit X11 framebuffer");
    }
    var now = new Date().getTime();
    if (!lastFrameTime) lastFrameTime = now;
    var elapsed = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    updateSimulation(elapsed);
    setCamera();
    projectedVertexCount = 0;
    for (var depthIndex = 0; depthIndex < depthBuffer.length; depthIndex++) {
        depthBuffer[depthIndex] = 0;
    }
    background.copy(framebuffer.pixels, 0, 0, background.length);
    drawHillsides(framebuffer);
    drawRoad(framebuffer);
    drawScenery(framebuffer);
    for (var i = 0; i < competitors.length; i++) {
        var ai = competitors[i];
        drawCar(framebuffer, ai.sample.x, ai.sample.y + 0.10, ai.sample.z,
                ai.sample.heading, ai.color, false);
    }
    drawCar(framebuffer, player.x, player.y, player.z, player.heading,
            0xd94a32, true);
    drawHud(framebuffer);
    framebuffer.requestFrame();
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

var window = common.createWindow({
    width: options.width,
    height: options.height,
    fps: options.fps,
    fpsCounter: options.fpsCounter,
    debugEvents: options.debugEvents,
    title: "demo7.js Welsh upland rally",
    instanceName: "demo7",
    className: "NodeX11Demo",
    draw: draw,
    keyPress: function (event, activeWindow) {
        if (event.keysym === 32 && (rollingMode || raceFinished)) {
            startHumanRace();
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
        setDrivingKey(event, false);
    },
    ready: function (info) {
        console.log("Welsh upland rally created: " + info.width + "x" +
                    info.height + ", 1 player and " + competitors.length +
                    " AI cars, " + RACE_LAPS + " laps, " +
                    info.framesPerSecond + " FPS limit");
        console.log("Attract mode running; push Space to reset the grid and play");
        console.log("Drive with arrows or WASD; Space brakes; R restarts; Escape exits");
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
        if (options.debugEvents) console.log("X11 connection closed");
    }
});
