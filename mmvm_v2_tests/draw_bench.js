/* Reproducible js_min framebuffer drawing benchmark. */
var dlsymPointer = get_dlsym();

function resolveSymbol(name) {
    var pointer = ffi_call(dlsymPointer, 0, name);
    if (!pointer) throw new Error("could not resolve libc symbol: " + name);
    return pointer;
}

var libcSymbols = {
    calloc: resolveSymbol("calloc"),
    free: resolveSymbol("free"),
    gettimeofday: resolveSymbol("gettimeofday")
};

var libc = {
    calloc: function (count, size) {
        return ffi_call(libcSymbols.calloc, count, size);
    },
    free: function (pointer) {
        return ffi_call(libcSymbols.free, pointer);
    },
    milliseconds: function () {
        var result = ffi_call(libcSymbols.gettimeofday, this.clockStorage, 0);
        if (result !== 0) throw new Error("gettimeofday failed");
        return (peek32(this.clockStorage) >>> 0) * 1000 +
               (peek32(this.clockStorage + 4) >>> 0) / 1000;
    },
    clockStorage: 0
};

function parsePositive(value, fallback, name) {
    if (value === undefined) return fallback;
    var number = parseInt(value, 10);
    if (!(number > 0)) throw new Error(name + " must be positive");
    return number;
}

var width = parsePositive(arguments[0], 256, "width");
var height = parsePositive(arguments[1], 192, "height");
var frames = parsePositive(arguments[2], 5, "frames");
var storageKind = arguments[3] || "array";
if (storageKind !== "array" && storageKind !== "native" && storageKind !== "native32") {
    throw new Error("storage must be array, native, or native32");
}

var bytesPerPixel = storageKind === "native32" ? 4 : 3;
var byteLength = width * height * bytesPerPixel;
var pixels = storageKind === "array" ? new Array(byteLength) : libc.calloc(byteLength, 1);
if (!pixels) throw new Error("framebuffer allocation failed");
libc.clockStorage = libc.calloc(1, 8);
if (!libc.clockStorage) throw new Error("clock allocation failed");

function storeByte(offset, value) {
    if (storageKind === "native") poke8(pixels + offset, value);
    else pixels[offset] = value;
}

function drawPixel(x, y, red, green, blue) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    var offset = (y * width + x) * bytesPerPixel;
    if (storageKind === "native32") {
        /* Common little-endian X11 depth-24 layout: B, G, R, unused. */
        poke32(pixels + offset, (red << 16) | (green << 8) | blue);
    } else {
        storeByte(offset, red);
        storeByte(offset + 1, green);
        storeByte(offset + 2, blue);
    }
}

function renderFramebuffer(frameNumber) {
    var pointerX = (width / 2 + frameNumber) | 0;
    var pointerY = (height / 2) | 0;
    var x;
    var y;
    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            var red = (x * 255 / (width - 1)) | 0;
            var green = (y * 255 / (height - 1)) | 0;
            var blue = (((x + y) * 255) / (width + height - 2)) | 0;
            var deltaX = x - pointerX;
            var deltaY = y - pointerY;
            var distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance < 52) {
                var glow = ((52 - distance) * 3) | 0;
                red = Math.min(255, red + (glow >> 2));
                green = Math.min(255, green + (glow >> 2));
                blue = Math.min(255, blue + (glow >> 2));
            }
            drawPixel(x, y, red, green, blue);
        }
    }

    /* Representative caret, glyph strokes, and framebuffer pointer. */
    for (y = 0; y < 14; y++) drawPixel(12, 16 + y, 255, 255, 0);
    for (x = 0; x < 140; x += 3) drawPixel(x, 7, 255, 255, 255);
    for (y = 0; y < 18; y++) {
        var edge = Math.floor(y / 2);
        for (x = 0; x <= edge; x++) {
            var boundary = x === 0 || x === edge || y === 17;
            drawPixel(pointerX + x + 1, pointerY + y + 1, 0, 0, 0);
            drawPixel(pointerX + x, pointerY + y,
                      boundary ? 0 : 255, boundary ? 0 : 255, boundary ? 0 : 255);
        }
    }
}

/* Untimed warmup catches setup/allocation effects. */
renderFramebuffer(0);
gc();
var start = libc.milliseconds();
for (var frame = 0; frame < frames; frame++) renderFramebuffer(frame);
var elapsed = libc.milliseconds() - start;
var totalPixels = width * height * frames;

print("storage=" + storageKind +
      " size=" + width + "x" + height +
      " frames=" + frames +
      " elapsed_ms=" + elapsed.toFixed(3) +
      " ms_per_frame=" + (elapsed / frames).toFixed(3) +
      " fps=" + (frames * 1000 / elapsed).toFixed(3) +
      " mpixels_per_second=" + (totalPixels / elapsed / 1000).toFixed(3));

if (storageKind !== "array") libc.free(pixels);
libc.free(libc.clockStorage);
