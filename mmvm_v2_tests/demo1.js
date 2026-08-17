/* The original interactive X11 framebuffer demo. */
var common = require("./demo_common.js");

var options = common.parseOptions(process.argv, "demo1.js");
var pointerX = Math.floor(options.width / 2);
var pointerY = Math.floor(options.height / 2);
var pressedButtons = 0;
var clickPulse = 0;
var palette = 0;
var text = new common.BitmapText(options.width, options.height, "CLICK AND TYPE");

function draw(framebuffer) {
    var x;
    var y;
    var setPixel = framebuffer.setPixel;
    var width = framebuffer.width;
    var height = framebuffer.height;
    var widthScale = 255 / (width - 1);
    var heightScale = 255 / (height - 1);
    var diagonalScale = 255 / (width + height - 2);
    var direct32 = framebuffer.pixelFormat === "bgrx32le";
    var pixelAddress = framebuffer.pixelAddress;
    var pixels = framebuffer.pixels;
    var pixelOffset = 0;
    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            var red = (x * widthScale) | 0;
            var green = (y * heightScale) | 0;
            var blue = ((x + y) * diagonalScale) | 0;
            var deltaX = x - pointerX;
            var deltaY = y - pointerY;
            var distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance < 52) {
                var glow = ((52 - distance) * 3) | 0;
                if (pressedButtons & 1) red = Math.min(255, red + glow);
                else if (pressedButtons & 2) green = Math.min(255, green + glow);
                else if (pressedButtons & 4) blue = Math.min(255, blue + glow);
                else {
                    red = Math.min(255, red + (glow >> 2));
                    green = Math.min(255, green + (glow >> 2));
                    blue = Math.min(255, blue + (glow >> 2));
                }
            }
            if (clickPulse > 0) {
                var ringRadius = 8 + (24 - clickPulse) * 3;
                if (Math.abs(distance - ringRadius) < 2) {
                    red = 255;
                    green = 255;
                    blue = 255;
                }
            }
            if (palette === 1) {
                var originalRed = red;
                red = blue;
                blue = green;
                green = originalRed;
            } else if (palette === 2) {
                var originalBlue = blue;
                blue = red;
                red = green;
                green = originalBlue;
            }

            if (direct32) {
                var packedPixel = (red << 16) | (green << 8) | blue;
                if (pixelAddress) poke32(pixelAddress + pixelOffset, packedPixel);
                else pixels.writeUInt32LE(packedPixel, pixelOffset);
                pixelOffset += 4;
            } else {
                setPixel(x, y, red, green, blue);
            }
        }
    }

    text.paint(framebuffer);
    common.paintPointer(framebuffer, pointerX, pointerY);
    if (clickPulse > 0) {
        clickPulse--;
        framebuffer.requestFrame();
    }
}

function keyPress(event, window) {
    var keysym = event.keysym;
    if (options.debugEvents) {
        console.log("key press: X11 keycode " + event.keycode + ", keysym 0x" +
                    keysym.toString(16));
    }
    if (keysym === common.keysyms.escape || (!keysym && event.keycode === 9)) {
        window.close();
    } else if (keysym === common.keysyms.backspace) {
        text.backspace();
    } else if (keysym === common.keysyms.returnKey) {
        text.newLine();
    } else if (keysym === common.keysyms.left) text.move(-1, 0);
    else if (keysym === common.keysyms.right) text.move(1, 0);
    else if (keysym === common.keysyms.up) text.move(0, -1);
    else if (keysym === common.keysyms.down) text.move(0, 1);
    else if (keysym === common.keysyms.f1) palette = (palette + 1) % 3;
    else if (keysym >= 32 && keysym <= 126) {
        text.typeCharacter(String.fromCharCode(keysym));
    }
}

function updatePointer(event) {
    pointerX = event.x;
    pointerY = event.y;
}

var window = common.createWindow({
    width: options.width,
    height: options.height,
    fps: options.fps,
    fpsCounter: options.fpsCounter,
    debugEvents: options.debugEvents,
    title: "demo1.js RGB framebuffer",
    instanceName: "demo1",
    className: "NodeX11Demo",
    draw: draw,
    pointerMove: updatePointer,
    buttonPress: function (event) {
        updatePointer(event);
        if (event.button >= 1 && event.button <= 8) {
            pressedButtons |= 1 << (event.button - 1);
        }
        if (event.button === 1) text.setCursor(pointerX, pointerY);
        clickPulse = 24;
        if (options.debugEvents) {
            console.log("mouse button " + event.button + " pressed at " +
                        pointerX + "," + pointerY);
        }
    },
    buttonRelease: function (event) {
        updatePointer(event);
        if (event.button >= 1 && event.button <= 8) {
            pressedButtons &= ~(1 << (event.button - 1));
        }
        if (options.debugEvents) {
            console.log("mouse button " + event.button + " released at " +
                        pointerX + "," + pointerY);
        }
    },
    keyPress: keyPress,
    ready: function (info) {
        console.log("X11 window created: " + info.width + "x" + info.height +
                    " RGB framebuffer, depth " + info.depth + ", " +
                    info.bitsPerPixel + " bits per server pixel, " +
                    info.framesPerSecond + " FPS limit");
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
