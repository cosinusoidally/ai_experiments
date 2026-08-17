/*
 * Shared helpers for framebuffer demos. Requires the reusable X11 module but
 * has no side effects until createWindow is called.
 */
var x11 = require("./node_x11.js");

var FONT_SCALE = 2;
var FONT_WIDTH = 5;
var FONT_HEIGHT = 7;
var GLYPH_ADVANCE = (FONT_WIDTH + 1) * FONT_SCALE;
var LINE_ADVANCE = (FONT_HEIGHT + 1) * FONT_SCALE;

function usage(programName) {
    return "usage: node " + programName + " [--fps FRAMES] [--size WIDTHxHEIGHT]\n" +
           "  --fps FRAMES     redraw limit in frames per second (default: 20)\n" +
           "  --size WxH        framebuffer resolution (default: 256x192)\n" +
           "  --width PIXELS    framebuffer width\n" +
           "  --height PIXELS   framebuffer height\n" +
           "  --fps-counter     show the on-screen frame rate (default)\n" +
           "  --no-fps-counter  hide the on-screen frame rate\n" +
           "  --debug-events    log input events and frame rate (default)\n" +
           "  --no-debug-events disable debug event and frame-rate logging";
}

function parseOptions(argv, programName) {
    var options = {
        width: 256,
        height: 192,
        fps: 20,
        fpsCounter: true,
        debugEvents: true
    };
    programName = programName || "demo.js";
    for (var optionIndex = 2; optionIndex < argv.length; optionIndex++) {
        var option = argv[optionIndex];
        if (option === "-h" || option === "--help") {
            console.log(usage(programName));
            process.exit(0);
        } else if (option === "--fps") {
            if (++optionIndex >= argv.length) optionError(programName, "--fps requires a value");
            options.fps = parseInt(argv[optionIndex], 10);
        } else if (option.indexOf("--fps=") === 0) {
            options.fps = parseInt(option.substring(6), 10);
        } else if (option === "--size") {
            if (++optionIndex >= argv.length) optionError(programName, "--size requires a value");
            setSize(options, argv[optionIndex], programName);
        } else if (option.indexOf("--size=") === 0) {
            setSize(options, option.substring(7), programName);
        } else if (option === "--width" || option === "--height") {
            var dimension = option.substring(2);
            if (++optionIndex >= argv.length) optionError(programName, option + " requires a value");
            options[dimension] = parseInt(argv[optionIndex], 10);
        } else if (option.indexOf("--width=") === 0) {
            options.width = parseInt(option.substring(8), 10);
        } else if (option.indexOf("--height=") === 0) {
            options.height = parseInt(option.substring(9), 10);
        } else if (option === "--fps-counter") {
            options.fpsCounter = true;
        } else if (option === "--no-fps-counter") {
            options.fpsCounter = false;
        } else if (option === "--debug-events") {
            options.debugEvents = true;
        } else if (option === "--no-debug-events") {
            options.debugEvents = false;
        } else {
            optionError(programName, "unknown option: " + option);
        }
    }
    if (!(options.fps >= 1 && options.fps <= 120)) {
        optionError(programName, "--fps must be between 1 and 120");
    }
    if (!(options.width >= 64 && options.width <= 1024) ||
        !(options.height >= 64 && options.height <= 1024) ||
        Math.floor(options.width) !== options.width ||
        Math.floor(options.height) !== options.height ||
        options.width * options.height > 1048576) {
        optionError(programName,
                    "framebuffer dimensions must be integers in 64..1024 and at most 1048576 pixels");
    }
    return options;
}

function setSize(options, value, programName) {
    var parts = /^([0-9]+)x([0-9]+)$/.exec(value);
    if (!parts) optionError(programName, "--size must have the form WIDTHxHEIGHT");
    options.width = parseInt(parts[1], 10);
    options.height = parseInt(parts[2], 10);
}

function optionError(programName, message) {
    console.error(programName + ": " + message);
    process.exit(2);
}

var FONT_PATTERNS = {
    " ": "00000/00000/00000/00000/00000/00000/00000",
    "A": "01110/10001/10001/11111/10001/10001/10001",
    "B": "11110/10001/10001/11110/10001/10001/11110",
    "C": "01111/10000/10000/10000/10000/10000/01111",
    "D": "11110/10001/10001/10001/10001/10001/11110",
    "E": "11111/10000/10000/11110/10000/10000/11111",
    "F": "11111/10000/10000/11110/10000/10000/10000",
    "G": "01111/10000/10000/10111/10001/10001/01111",
    "H": "10001/10001/10001/11111/10001/10001/10001",
    "I": "11111/00100/00100/00100/00100/00100/11111",
    "J": "00111/00010/00010/00010/10010/10010/01100",
    "K": "10001/10010/10100/11000/10100/10010/10001",
    "L": "10000/10000/10000/10000/10000/10000/11111",
    "M": "10001/11011/10101/10101/10001/10001/10001",
    "N": "10001/11001/10101/10011/10001/10001/10001",
    "O": "01110/10001/10001/10001/10001/10001/01110",
    "P": "11110/10001/10001/11110/10000/10000/10000",
    "Q": "01110/10001/10001/10001/10101/10010/01101",
    "R": "11110/10001/10001/11110/10100/10010/10001",
    "S": "01111/10000/10000/01110/00001/00001/11110",
    "T": "11111/00100/00100/00100/00100/00100/00100",
    "U": "10001/10001/10001/10001/10001/10001/01110",
    "V": "10001/10001/10001/10001/10001/01010/00100",
    "W": "10001/10001/10001/10101/10101/10101/01010",
    "X": "10001/10001/01010/00100/01010/10001/10001",
    "Y": "10001/10001/01010/00100/00100/00100/00100",
    "Z": "11111/00001/00010/00100/01000/10000/11111",
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
    ".": "00000/00000/00000/00000/00000/00110/00110",
    ",": "00000/00000/00000/00000/00110/00110/00100",
    ":": "00000/00110/00110/00000/00110/00110/00000",
    ";": "00000/00110/00110/00000/00110/00110/00100",
    "!": "00100/00100/00100/00100/00100/00000/00100",
    "?": "01110/10001/00001/00010/00100/00000/00100",
    "-": "00000/00000/00000/11111/00000/00000/00000",
    "+": "00000/00100/00100/11111/00100/00100/00000",
    "=": "00000/00000/11111/00000/11111/00000/00000",
    "_": "00000/00000/00000/00000/00000/00000/11111",
    "/": "00001/00010/00010/00100/01000/01000/10000",
    "\\": "10000/01000/01000/00100/00010/00010/00001",
    "(": "00010/00100/01000/01000/01000/00100/00010",
    ")": "01000/00100/00010/00010/00010/00100/01000",
    "[": "01110/01000/01000/01000/01000/01000/01110",
    "]": "01110/00010/00010/00010/00010/00010/01110",
    "<": "00010/00100/01000/10000/01000/00100/00010",
    ">": "01000/00100/00010/00001/00010/00100/01000",
    "'": "00100/00100/00000/00000/00000/00000/00000",
    "\"": "01010/01010/00000/00000/00000/00000/00000",
    "@": "01110/10001/10111/10101/10111/10000/01110",
    "#": "01010/11111/01010/01010/11111/01010/01010",
    "*": "00000/10101/01110/11111/01110/10101/00000"
};

var FONT_ROWS = {};

function glyphRows(character) {
    var normalized = FONT_PATTERNS[character] ? character : character.toUpperCase();
    if (FONT_ROWS[normalized]) return FONT_ROWS[normalized];
    var pattern = FONT_PATTERNS[normalized] ||
                  "11111/10001/00110/00110/00000/00100/00100";
    var strings = pattern.split("/");
    var rows = [];
    for (var i = 0; i < strings.length; i++) rows.push(parseInt(strings[i], 2));
    FONT_ROWS[normalized] = rows;
    return rows;
}

function paintGlyph(framebuffer, character, originX, originY) {
    var rows = glyphRows(character);
    var setPixel = framebuffer.setPixel;
    for (var row = 0; row < FONT_HEIGHT; row++) {
        for (var column = 0; column < FONT_WIDTH; column++) {
            if (!(rows[row] & (1 << (FONT_WIDTH - column - 1)))) continue;
            for (var scaleY = 0; scaleY < FONT_SCALE; scaleY++) {
                for (var scaleX = 0; scaleX < FONT_SCALE; scaleX++) {
                    var pixelX = originX + column * FONT_SCALE + scaleX;
                    var pixelY = originY + row * FONT_SCALE + scaleY;
                    setPixel(pixelX + 1, pixelY + 1, 0, 0, 0);
                    setPixel(pixelX, pixelY, 255, 255, 255);
                }
            }
        }
    }
}

function BitmapText(width, height, initialText) {
    this.width = width;
    this.height = height;
    this.cells = {};
    this.caretX = 0;
    this.caretY = LINE_ADVANCE;
    this.caretLineStart = 0;
    initialText = initialText || "";
    for (var i = 0; i < initialText.length; i++) {
        this.cells[(i * GLYPH_ADVANCE) + ",0"] = initialText.charAt(i);
    }
}

BitmapText.prototype.paint = function (framebuffer) {
    var setPixel = framebuffer.setPixel;
    for (var key in this.cells) {
        if (!this.cells.hasOwnProperty(key)) continue;
        var comma = key.indexOf(",");
        var x = parseInt(key.substring(0, comma), 10);
        var y = parseInt(key.substring(comma + 1), 10);
        paintGlyph(framebuffer, this.cells[key], x, y);
    }
    for (var row = 0; row < FONT_HEIGHT * FONT_SCALE; row++) {
        setPixel(this.caretX, this.caretY + row, 0, 0, 0);
        setPixel(this.caretX + 1, this.caretY + row, 255, 255, 0);
    }
};

BitmapText.prototype.setCursor = function (x, y) {
    this.caretX = Math.floor(x / GLYPH_ADVANCE) * GLYPH_ADVANCE;
    this.caretY = Math.floor(y / LINE_ADVANCE) * LINE_ADVANCE;
    if (this.caretX > this.width - GLYPH_ADVANCE) this.caretX = this.width - GLYPH_ADVANCE;
    if (this.caretY > this.height - LINE_ADVANCE) this.caretY = this.height - LINE_ADVANCE;
    if (this.caretX < 0) this.caretX = 0;
    if (this.caretY < 0) this.caretY = 0;
    this.caretLineStart = this.caretX;
};

BitmapText.prototype.move = function (dx, dy) {
    this.caretX += dx * GLYPH_ADVANCE;
    this.caretY += dy * LINE_ADVANCE;
    if (this.caretX < 0) this.caretX = 0;
    if (this.caretY < 0) this.caretY = 0;
    if (this.caretX > this.width - GLYPH_ADVANCE) this.caretX = this.width - GLYPH_ADVANCE;
    if (this.caretY > this.height - LINE_ADVANCE) this.caretY = this.height - LINE_ADVANCE;
};

BitmapText.prototype.typeCharacter = function (character) {
    this.cells[this.caretX + "," + this.caretY] = character;
    this.caretX += GLYPH_ADVANCE;
    if (this.caretX > this.width - GLYPH_ADVANCE) {
        this.caretX = this.caretLineStart;
        this.caretY += LINE_ADVANCE;
        if (this.caretY > this.height - LINE_ADVANCE) this.caretY = 0;
    }
};

BitmapText.prototype.backspace = function () {
    this.move(-1, 0);
    delete this.cells[this.caretX + "," + this.caretY];
};

BitmapText.prototype.newLine = function () {
    this.caretX = this.caretLineStart;
    this.caretY += LINE_ADVANCE;
    if (this.caretY > this.height - LINE_ADVANCE) this.caretY = 0;
};

function paintPointer(framebuffer, pointerX, pointerY) {
    var setPixel = framebuffer.setPixel;
    for (var y = 0; y < 18; y++) {
        var edge = Math.floor(y / 2);
        for (var x = 0; x <= edge; x++) {
            var boundary = x === 0 || x === edge || y === 17;
            setPixel(pointerX + x + 1, pointerY + y + 1, 0, 0, 0);
            setPixel(pointerX + x, pointerY + y,
                     boundary ? 0 : 255,
                     boundary ? 0 : 255,
                     boundary ? 0 : 255);
        }
    }
}

function FrameRateCounter(showOnScreen, logToConsole) {
    this.showOnScreen = showOnScreen;
    this.logToConsole = logToConsole;
    this.displayStartedAt = 0;
    this.displayFrames = 0;
    this.displayValue = 0;
    this.logStartedAt = 0;
    this.logFrames = 0;
}

FrameRateCounter.prototype.draw = function (framebuffer) {
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
        var originX = framebuffer.width - label.length * GLYPH_ADVANCE;
        var originY = framebuffer.height - LINE_ADVANCE;
        if (originX < 0) originX = 0;
        if (originY < 0) originY = 0;
        for (var index = 0; index < label.length; index++) {
            paintGlyph(framebuffer, label.charAt(index),
                       originX + index * GLYPH_ADVANCE, originY);
        }
    }

    /* Keep sampling even when the application scene itself is idle. */
    framebuffer.requestFrame();
};

function createWindow(options) {
    options = options || {};
    var windowOptions = {};
    var property;
    for (property in options) {
        if (options.hasOwnProperty(property)) windowOptions[property] = options[property];
    }

    var showOnScreen = options.fpsCounter !== false;
    var logToConsole = options.debugEvents !== false;
    if (showOnScreen || logToConsole) {
        var applicationDraw = options.draw;
        var counter = new FrameRateCounter(showOnScreen, logToConsole);
        windowOptions.draw = function (framebuffer) {
            if (typeof applicationDraw === "function") applicationDraw(framebuffer);
            counter.draw(framebuffer);
        };
    }
    return x11.createFramebufferWindow(windowOptions);
}

module.exports = {
    createWindow: createWindow,
    keysyms: x11.keysyms,
    parseOptions: parseOptions,
    usage: usage,
    BitmapText: BitmapText,
    FrameRateCounter: FrameRateCounter,
    paintGlyph: paintGlyph,
    paintPointer: paintPointer,
    font: {
        scale: FONT_SCALE,
        width: FONT_WIDTH,
        height: FONT_HEIGHT,
        glyphAdvance: GLYPH_ADVANCE,
        lineAdvance: LINE_ADVANCE
    }
};
