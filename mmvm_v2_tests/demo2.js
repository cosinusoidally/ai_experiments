/*
 * Original textured anti-gravity racer rendered entirely in JavaScript. X11
 * only receives the completed RGB framebuffer; it is not used for geometry
 * or texture drawing. Geometry and materials are generated deterministically.
 */
var common = require("./demo_common.js");

var options = common.parseOptions(process.argv, "demo2.js");
var TEXTURE_SIZE = 32;
var TOOLBAR_HEIGHT = 18;
var textureCoordinates = [[0, 1], [0, 0], [1, 0], [1, 1]];
var textures = makeTextures();
var faces = makeVehicle();
var depthBuffer = new Array(options.width * options.height);
var DEFAULT_ROTATION_X = -0.52;
var DEFAULT_ROTATION_Y = -0.72;
var AUTO_ROTATE_RADIANS_PER_MILLISECOND = 0.00020;
var rotationX = DEFAULT_ROTATION_X;
var rotationY = DEFAULT_ROTATION_Y;
var modelScale = 1.0;
var moveX = 0;
var moveY = 12;
var mode = 0;
var modes = ["ROTATE", "MOVE", "SCALE"];
var autoRotate = true;
var lastAutoRotateTime = 0;
var dragButton = 0;
var dragX = 0;
var dragY = 0;
var pointerX = Math.floor(options.width / 2);
var pointerY = Math.floor(options.height / 2);

function makeTextures() {
    var materials = [];
    for (var material = 0; material < 5; material++) {
        var pixels = new Array(TEXTURE_SIZE * TEXTURE_SIZE);
        for (var y = 0; y < TEXTURE_SIZE; y++) {
            for (var x = 0; x < TEXTURE_SIZE; x++) {
                var red;
                var green;
                var blue;
                var panel = (((x >> 3) + (y >> 3)) & 1) !== 0;
                var border = x < 2 || y < 2 || x >= TEXTURE_SIZE - 2 ||
                             y >= TEXTURE_SIZE - 2;
                var deterministicDetail = (x * 17 + y * 29 + material * 43) % 19;
                if (material === 0) { /* Graphite-blue hull panels. */
                    red = panel ? 31 : 43;
                    green = panel ? 47 : 64;
                    blue = panel ? 67 : 89;
                    if (border || deterministicDetail === 0) {
                        red = 76; green = 105; blue = 125;
                    }
                } else if (material === 1) { /* Cold reflective canopy. */
                    red = 8 + ((x + y) >> 3);
                    green = 48 + ((31 - y) >> 1);
                    blue = 91 + x * 3;
                    if (border || Math.abs(x - y - 8) <= 1) {
                        red = 105; green = 226; blue = 255;
                    }
                } else if (material === 2) { /* Exposed machinery and pods. */
                    red = panel ? 53 : 70;
                    green = panel ? 57 : 73;
                    blue = panel ? 62 : 77;
                    if (((x + y) % 13) < 3) {
                        red = 226; green = 174; blue = 22;
                    }
                    if (border) { red = 18; green = 21; blue = 24; }
                } else if (material === 3) { /* Emissive propulsion surface. */
                    var distance = Math.abs(x - 16) + Math.abs(y - 16);
                    red = 255;
                    green = Math.max(35, 220 - distance * 9);
                    blue = Math.max(8, 95 - distance * 4);
                    if (((x + y) & 5) === 0) blue = 180;
                } else { /* Coral identification and intake markings. */
                    red = panel ? 242 : 186;
                    green = panel ? 67 : 39;
                    blue = panel ? 54 : 45;
                    if (border || Math.abs((x + y) - 31) <= 1) {
                        red = 255; green = 218; blue = 42;
                    }
                }
                pixels[y * TEXTURE_SIZE + x] =
                    (red << 16) | (green << 8) | blue;
            }
        }
        materials.push(pixels);
    }
    return materials;
}

function addFace(model, vertices, material, emissive) {
    var coordinates = [];
    for (var i = 0; i < vertices.length; i++) {
        coordinates.push(textureCoordinates[i] || textureCoordinates[3]);
    }
    model.push({vertices: vertices, textureCoordinates: coordinates,
                material: material, emissive: !!emissive});
}

function addTaperedPrism(model, centerX, frontZ, rearZ, frontWidth, rearWidth,
                         frontBottom, frontTop, rearBottom, rearTop, material) {
    var frontBottomLeft = [centerX - frontWidth, frontBottom, frontZ];
    var frontTopLeft = [centerX - frontWidth, frontTop, frontZ];
    var frontTopRight = [centerX + frontWidth, frontTop, frontZ];
    var frontBottomRight = [centerX + frontWidth, frontBottom, frontZ];
    var rearBottomLeft = [centerX - rearWidth, rearBottom, rearZ];
    var rearTopLeft = [centerX - rearWidth, rearTop, rearZ];
    var rearTopRight = [centerX + rearWidth, rearTop, rearZ];
    var rearBottomRight = [centerX + rearWidth, rearBottom, rearZ];
    addFace(model, [frontBottomLeft, frontTopLeft, frontTopRight, frontBottomRight], material);
    addFace(model, [rearBottomRight, rearTopRight, rearTopLeft, rearBottomLeft], material);
    addFace(model, [rearBottomLeft, rearTopLeft, frontTopLeft, frontBottomLeft], material);
    addFace(model, [frontBottomRight, frontTopRight, rearTopRight, rearBottomRight], material);
    addFace(model, [frontTopLeft, rearTopLeft, rearTopRight, frontTopRight], material);
    addFace(model, [rearBottomLeft, frontBottomLeft, frontBottomRight, rearBottomRight], material);
}

function addBox(model, minimumX, maximumX, minimumY, maximumY,
                minimumZ, maximumZ, material, emissive) {
    var start = model.length;
    addTaperedPrism(model, (minimumX + maximumX) / 2, minimumZ, maximumZ,
                    (maximumX - minimumX) / 2, (maximumX - minimumX) / 2,
                    minimumY, maximumY, minimumY, maximumY, material);
    if (emissive) {
        for (var i = start; i < model.length; i++) model[i].emissive = true;
    }
}

function addSweptPlate(model, points, bottom, top, material) {
    /* Normalize point order so the first surface faces upward. */
    var first = points[0];
    var second = points[1];
    var third = points[2];
    var normalY = (second[1] - first[1]) * (third[0] - first[0]) -
                  (second[0] - first[0]) * (third[1] - first[1]);
    if (normalY < 0) points = points.slice(0).reverse();
    var topVertices = [];
    var bottomVertices = [];
    var i;
    for (i = 0; i < points.length; i++) {
        topVertices.push([points[i][0], top, points[i][1]]);
        bottomVertices.unshift([points[i][0], bottom, points[i][1]]);
    }
    addFace(model, topVertices, material);
    addFace(model, bottomVertices, material);
    for (i = 0; i < points.length; i++) {
        var next = (i + 1) % points.length;
        addFace(model, [[points[i][0], bottom, points[i][1]],
                        [points[i][0], top, points[i][1]],
                        [points[next][0], top, points[next][1]],
                        [points[next][0], bottom, points[next][1]]], material);
    }
}

function makeVehicle() {
    var model = [];
    /* Long central hull with an original split-level wedge profile. */
    addTaperedPrism(model, 0, -2.35, -0.55, 0.09, 0.70,
                    -0.04, 0.05, -0.27, 0.18, 4);
    addTaperedPrism(model, 0, -0.55, 1.32, 0.70, 0.53,
                    -0.27, 0.18, -0.25, 0.15, 0);

    /* Swept lifting plates connect the hull to twin propulsion booms. */
    addSweptPlate(model, [[-0.42, -1.05], [-1.48, -0.18],
                          [-1.34, 1.28], [-0.46, 0.88]], -0.16, -0.04, 0);
    addSweptPlate(model, [[0.42, -1.05], [0.46, 0.88],
                          [1.34, 1.28], [1.48, -0.18]], -0.16, -0.04, 0);

    addTaperedPrism(model, -1.12, -0.42, 1.72, 0.25, 0.36,
                    -0.28, 0.06, -0.31, 0.12, 2);
    addTaperedPrism(model, 1.12, -0.42, 1.72, 0.25, 0.36,
                    -0.28, 0.06, -0.31, 0.12, 2);

    /* Raised canopy, identification spine, fins, intakes, and exhausts. */
    addTaperedPrism(model, 0, -0.92, 0.45, 0.18, 0.38,
                    0.17, 0.24, 0.15, 0.52, 1);
    addBox(model, -0.10, 0.10, 0.14, 0.31, 0.38, 1.38, 4);
    addBox(model, -0.79, -0.68, 0.02, 0.62, 0.70, 1.46, 4);
    addBox(model, 0.68, 0.79, 0.02, 0.62, 0.70, 1.46, 4);
    addBox(model, -1.37, -0.87, -0.23, 0.08, -0.47, -0.38, 4);
    addBox(model, 0.87, 1.37, -0.23, 0.08, -0.47, -0.38, 4);
    addBox(model, -1.46, -0.78, -0.27, 0.09, 1.70, 1.80, 3, true);
    addBox(model, 0.78, 1.46, -0.27, 0.09, 1.70, 1.80, 3, true);
    addBox(model, -0.57, -0.38, -0.38, -0.25, 0.18, 1.12, 2);
    addBox(model, 0.38, 0.57, -0.38, -0.25, 0.18, 1.12, 2);
    return model;
}

function transformVertex(source, cosineX, sineX, cosineY, sineY) {
    var sourceX = source[0] * modelScale;
    var sourceY = source[1] * modelScale;
    var sourceZ = source[2] * modelScale;
    /* Yaw first, then pitch around the camera's horizontal (screen X) axis. */
    var yawedX = sourceX * cosineY + sourceZ * sineY;
    var yawedZ = -sourceX * sineY + sourceZ * cosineY;
    return {
        x: yawedX,
        y: sourceY * cosineX - yawedZ * sineX,
        z: sourceY * sineX + yawedZ * cosineX + 6.5
    };
}

function projectVertex(vertex, uv, focalLength, centerX, centerY) {
    var inverseZ = 1 / vertex.z;
    return {
        x: centerX + vertex.x * focalLength * inverseZ,
        y: centerY - vertex.y * focalLength * inverseZ,
        inverseZ: inverseZ,
        uOverZ: uv[0] * inverseZ,
        vOverZ: uv[1] * inverseZ
    };
}

function crossNormal(a, b, c) {
    var abX = b.x - a.x;
    var abY = b.y - a.y;
    var abZ = b.z - a.z;
    var acX = c.x - a.x;
    var acY = c.y - a.y;
    var acZ = c.z - a.z;
    return {
        x: abY * acZ - abZ * acY,
        y: abZ * acX - abX * acZ,
        z: abX * acY - abY * acX
    };
}

function rasterTriangle(framebuffer, first, second, third, shade, texturePixels) {
    var area = (third.x - first.x) * (second.y - first.y) -
               (third.y - first.y) * (second.x - first.x);
    if (area === 0) return;
    if (area < 0) {
        var swap = second;
        second = third;
        third = swap;
        area = -area;
    }

    var minimumX = Math.max(0, Math.floor(Math.min(first.x, second.x, third.x)));
    var maximumX = Math.min(framebuffer.width - 1,
                            Math.ceil(Math.max(first.x, second.x, third.x)));
    var minimumY = Math.max(TOOLBAR_HEIGHT,
                            Math.floor(Math.min(first.y, second.y, third.y)));
    var maximumY = Math.min(framebuffer.height - 1,
                            Math.ceil(Math.max(first.y, second.y, third.y)));
    var direct32 = framebuffer.pixelFormat === "bgrx32le";
    var pixelAddress = framebuffer.pixelAddress;
    var pixels = framebuffer.pixels;
    var width = framebuffer.width;
    var depths = depthBuffer;
    var inverseArea = 1 / area;

    /* Edge values advance by constants, avoiding three edge-function calls. */
    var startX = minimumX + 0.5;
    var startY = minimumY + 0.5;
    var edge0XStep = third.y - second.y;
    var edge0YStep = -(third.x - second.x);
    var edge1XStep = first.y - third.y;
    var edge1YStep = -(first.x - third.x);
    var edge2XStep = second.y - first.y;
    var edge2YStep = -(second.x - first.x);
    var rowWeight0 = (startX - second.x) * (third.y - second.y) -
                     (startY - second.y) * (third.x - second.x);
    var rowWeight1 = (startX - third.x) * (first.y - third.y) -
                     (startY - third.y) * (first.x - third.x);
    var rowWeight2 = (startX - first.x) * (second.y - first.y) -
                     (startY - first.y) * (second.x - first.x);

    for (var y = minimumY; y <= maximumY; y++) {
        var weight0 = rowWeight0;
        var weight1 = rowWeight1;
        var weight2 = rowWeight2;
        for (var x = minimumX; x <= maximumX; x++) {
            if (weight0 >= 0 && weight1 >= 0 && weight2 >= 0) {
                var perspectiveDivisor = weight0 * first.inverseZ +
                                         weight1 * second.inverseZ +
                                         weight2 * third.inverseZ;
                var inverseZ = perspectiveDivisor * inverseArea;
                var depthIndex = y * width + x;
                if (inverseZ > depths[depthIndex]) {
                    var u = (weight0 * first.uOverZ + weight1 * second.uOverZ +
                             weight2 * third.uOverZ) / perspectiveDivisor;
                    var v = (weight0 * first.vOverZ + weight1 * second.vOverZ +
                             weight2 * third.vOverZ) / perspectiveDivisor;
                    var textureX = (u * (TEXTURE_SIZE - 1)) | 0;
                    var textureY = (v * (TEXTURE_SIZE - 1)) | 0;
                    if (textureX < 0) textureX = 0;
                    else if (textureX >= TEXTURE_SIZE) textureX = TEXTURE_SIZE - 1;
                    if (textureY < 0) textureY = 0;
                    else if (textureY >= TEXTURE_SIZE) textureY = TEXTURE_SIZE - 1;
                    var source = texturePixels[textureY * TEXTURE_SIZE + textureX];
                    var red = (((source >>> 16) & 255) * shade) | 0;
                    var green = (((source >>> 8) & 255) * shade) | 0;
                    var blue = ((source & 255) * shade) | 0;
                    var packed = (red << 16) | (green << 8) | blue;
                    if (direct32) {
                        if (pixelAddress) poke32(pixelAddress + depthIndex * 4, packed);
                        else pixels.writeUInt32LE(packed, depthIndex * 4);
                    } else {
                        framebuffer.setPixel(x, y, red, green, blue);
                    }
                    depths[depthIndex] = inverseZ;
                }
            }
            weight0 += edge0XStep;
            weight1 += edge1XStep;
            weight2 += edge2XStep;
        }
        rowWeight0 += edge0YStep;
        rowWeight1 += edge1YStep;
        rowWeight2 += edge2YStep;
    }
}

function clearFramebuffer(framebuffer) {
    var direct32 = framebuffer.pixelFormat === "bgrx32le";
    var pixelAddress = framebuffer.pixelAddress;
    var pixels = framebuffer.pixels;
    var offset = 0;
    var index = 0;
    for (var y = 0; y < framebuffer.height; y++) {
        var fade = (y * 24 / framebuffer.height) | 0;
        var packed = ((12 + fade) << 16) | ((17 + fade) << 8) | (28 + fade);
        for (var x = 0; x < framebuffer.width; x++) {
            depthBuffer[index] = 0;
            if (direct32) {
                if (pixelAddress) poke32(pixelAddress + offset, packed);
                else pixels.writeUInt32LE(packed, offset);
            } else {
                framebuffer.setPixel(x, y, (packed >>> 16) & 255,
                                     (packed >>> 8) & 255, packed & 255);
            }
            index++;
            offset += 4;
        }
    }
}

function drawToolbar(framebuffer) {
    var zoneWidth = framebuffer.width / 4;
    var labels;
    if (framebuffer.width >= 360) labels = ["ROTATE", "MOVE", "SCALE", "AUTO"];
    else if (framebuffer.width >= 220) labels = ["ROT", "MOVE", "SCALE", "AUTO"];
    else labels = ["R", "M", "S", "A"];
    for (var item = 0; item < 4; item++) {
        var labelWidth = labels[item].length * common.font.glyphAdvance;
        var labelX = Math.floor(item * zoneWidth + (zoneWidth - labelWidth) / 2);
        for (var character = 0; character < labels[item].length; character++) {
            common.paintGlyph(framebuffer, labels[item].charAt(character),
                              labelX + character * common.font.glyphAdvance, 1);
        }
        if ((item < 3 && item === mode) || (item === 3 && autoRotate)) {
            var start = Math.max(0, Math.floor(item * zoneWidth + 3));
            var end = Math.min(framebuffer.width - 1,
                               Math.floor((item + 1) * zoneWidth - 4));
            for (var x = start; x <= end; x++) {
                framebuffer.setPixel(x, TOOLBAR_HEIGHT - 2,
                                     item === 3 ? 80 : 255,
                                     item === 3 ? 235 : 210,
                                     item === 3 ? 255 : 30);
                framebuffer.setPixel(x, TOOLBAR_HEIGHT - 1,
                                     item === 3 ? 80 : 255,
                                     item === 3 ? 235 : 210,
                                     item === 3 ? 255 : 30);
            }
        }
    }
}

function draw(framebuffer) {
    var now = new Date().getTime();
    if (autoRotate) {
        if (lastAutoRotateTime && !dragButton) {
            var animationElapsed = now - lastAutoRotateTime;
            if (animationElapsed > 0) {
                rotationY += animationElapsed * AUTO_ROTATE_RADIANS_PER_MILLISECOND;
            }
        }
        lastAutoRotateTime = now;
    } else {
        lastAutoRotateTime = 0;
    }
    clearFramebuffer(framebuffer);
    var cosineX = Math.cos(rotationX);
    var sineX = Math.sin(rotationX);
    var cosineY = Math.cos(rotationY);
    var sineY = Math.sin(rotationY);
    var focalLength = Math.min(framebuffer.width, framebuffer.height) * 1.55;
    var centerX = framebuffer.width / 2 + moveX;
    var centerY = framebuffer.height / 2 + moveY;

    for (var faceIndex = 0; faceIndex < faces.length; faceIndex++) {
        var face = faces[faceIndex];
        var transformed = [];
        for (var vertexIndex = 0; vertexIndex < face.vertices.length; vertexIndex++) {
            transformed.push(transformVertex(face.vertices[vertexIndex],
                                             cosineX, sineX, cosineY, sineY));
        }
        var normal = crossNormal(transformed[0], transformed[1], transformed[2]);
        var center = {x: 0, y: 0, z: 0};
        for (vertexIndex = 0; vertexIndex < transformed.length; vertexIndex++) {
            center.x += transformed[vertexIndex].x;
            center.y += transformed[vertexIndex].y;
            center.z += transformed[vertexIndex].z;
        }
        center.x /= transformed.length;
        center.y /= transformed.length;
        center.z /= transformed.length;
        if (normal.x * -center.x + normal.y * -center.y + normal.z * -center.z <= 0) {
            continue;
        }

        var normalLength = Math.sqrt(normal.x * normal.x + normal.y * normal.y +
                                     normal.z * normal.z);
        var light = (-normal.x * 0.35 + normal.y * 0.55 - normal.z * 0.76) /
                    normalLength;
        var shade = face.emissive ? 1.0 :
                    Math.max(0.28, Math.min(1.0, 0.42 + light * 0.58));
        var projected = [];
        for (vertexIndex = 0; vertexIndex < transformed.length; vertexIndex++) {
            projected.push(projectVertex(transformed[vertexIndex],
                                         face.textureCoordinates[vertexIndex],
                                         focalLength, centerX, centerY));
        }
        for (var triangle = 1; triangle < projected.length - 1; triangle++) {
            rasterTriangle(framebuffer, projected[0], projected[triangle],
                           projected[triangle + 1], shade, textures[face.material]);
        }
    }

    drawToolbar(framebuffer);
    common.paintPointer(framebuffer, pointerX, pointerY);
    if (autoRotate) framebuffer.requestFrame();
}

function setScale(value) {
    modelScale = Math.max(0.30, Math.min(2.15, value));
}

function selectToolbarItem(x) {
    var item = Math.floor(x * 4 / options.width);
    if (item < 0) item = 0;
    if (item > 3) item = 3;
    if (item === 3) {
        autoRotate = !autoRotate;
        lastAutoRotateTime = 0;
    } else {
        mode = item;
    }
}

function updatePointer(event) {
    var deltaX = event.x - dragX;
    var deltaY = event.y - dragY;
    pointerX = event.x;
    pointerY = event.y;
    if (dragButton) {
        var action = dragButton === 2 ? 2 : (dragButton === 3 ? 1 : mode);
        if (action === 0) {
            rotationY -= deltaX * 0.015;
            rotationX -= deltaY * 0.015;
        } else if (action === 1) {
            moveX += deltaX;
            moveY += deltaY;
        } else {
            setScale(modelScale * Math.exp(-deltaY * 0.018 + deltaX * 0.003));
        }
    }
    dragX = event.x;
    dragY = event.y;
}

function resetModel() {
    rotationX = DEFAULT_ROTATION_X;
    rotationY = DEFAULT_ROTATION_Y;
    modelScale = 1.0;
    moveX = 0;
    moveY = 12;
    lastAutoRotateTime = 0;
}

var window = common.createWindow({
    width: options.width,
    height: options.height,
    fps: options.fps,
    fpsCounter: options.fpsCounter,
    debugEvents: options.debugEvents,
    title: "demo2.js procedural anti-gravity racer",
    instanceName: "demo2",
    className: "NodeX11Demo",
    draw: draw,
    pointerMove: updatePointer,
    buttonPress: function (event) {
        pointerX = event.x;
        pointerY = event.y;
        dragX = event.x;
        dragY = event.y;
        if (event.button === 4) {
            setScale(modelScale * 1.12);
        } else if (event.button === 5) {
            setScale(modelScale / 1.12);
        } else if (event.button === 1 && event.y < TOOLBAR_HEIGHT) {
            selectToolbarItem(event.x);
        } else if (event.button >= 1 && event.button <= 3) {
            dragButton = event.button;
        }
        if (options.debugEvents) {
            console.log("mouse button " + event.button + " pressed at " +
                        event.x + "," + event.y + "; mode " + modes[mode] +
                        "; autorotate " + (autoRotate ? "on" : "off"));
        }
    },
    buttonRelease: function (event) {
        pointerX = event.x;
        pointerY = event.y;
        if (event.button === dragButton) dragButton = 0;
        if (options.debugEvents && event.button <= 3) {
            console.log("mouse button " + event.button + " released at " +
                        event.x + "," + event.y);
        }
    },
    keyPress: function (event, activeWindow) {
        if (options.debugEvents) {
            console.log("key press: X11 keycode " + event.keycode + ", keysym 0x" +
                        event.keysym.toString(16));
        }
        if (event.keysym === common.keysyms.escape ||
            (!event.keysym && event.keycode === 9)) activeWindow.close();
        else if (event.keysym === 49) mode = 0;
        else if (event.keysym === 50) mode = 1;
        else if (event.keysym === 51) mode = 2;
        else if (event.keysym === 97 || event.keysym === 65) {
            autoRotate = !autoRotate;
            lastAutoRotateTime = 0;
        }
        else if (event.keysym === 114 || event.keysym === 82) resetModel();
    },
    ready: function (info) {
        console.log("X11 software renderer created: " + info.width + "x" +
                    info.height + ", deterministic procedural racer, " +
                    info.framesPerSecond + " FPS limit, autorotate on");
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
