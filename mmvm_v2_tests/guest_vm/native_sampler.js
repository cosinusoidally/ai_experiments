/* Optional single-threaded libc profil(3) sampler for a standalone interpreter.
 * Samples refer to native instruction offsets, not guest instruction counts.
 * This is diagnostic only: it neither changes machine code nor installs a
 * language-level callback. No C helper or background thread is involved. */
(function (root) {
    var HostFFI = root.GuestVMHostFFI;
    var Backend = root.GuestVMKernelX86Backend;
    if (typeof module !== "undefined" && module.exports) {
        HostFFI = require("./host_ffi.js");
        Backend = require("./aot/backend_x86.js");
    }
    var headerFields = Backend.StandaloneHeaderFields;
    var PROFILE_SCALE_ONE_TO_ONE = 65536;
    var COUNTER_BYTES = 2;

    function NativeSampler(imageBase) {
        if (!imageBase) throw new Error("native sampling requires a standalone snapshot");
        this.ffi = new HostFFI();
        this.profilePointer = this.ffi.resolve("profil");
        this.freePointer = this.ffi.resolve("free");
        this.codeLength = peek32(imageBase + headerFields.codeLength) >>> 0;
        this.sourceHash = peek32(imageBase + headerFields.sourceHash) >>> 0;
        var codeBase = imageBase + (peek32(imageBase + headerFields.codeOffset) >>> 0);
        this.byteLength = this.codeLength + COUNTER_BYTES;
        this.buffer = this.ffi.call(this.ffi.resolve("calloc"), [this.byteLength, 1]);
        if (!this.buffer) throw new Error("native sample buffer allocation failed");
        if (this.ffi.call(this.profilePointer,
                [this.buffer, this.byteLength, codeBase, PROFILE_SCALE_ONE_TO_ONE]) !== 0) {
            this.ffi.call(this.freePointer, [this.buffer]);
            this.buffer = 0;
            throw new Error("could not start native sampling");
        }
    }

    NativeSampler.prototype.finish = function (symbols, sourceHash) {
        if (!this.buffer) return [];
        this.ffi.call(this.profilePointer, [0, 0, 0, 0]);
        try {
            if ((sourceHash >>> 0) !== this.sourceHash) {
                throw new Error("native sample symbols do not match the executing kernel");
            }
            var functions = [], key;
            for (key in symbols) {
                if (Object.prototype.hasOwnProperty.call(symbols, key) &&
                        key.indexOf("kernel_function_") === 0 &&
                        key.substring(key.length - 7) !== "_return") {
                    functions.push({name: key.substring("kernel_function_".length),
                        offset: symbols[key], samples: 0});
                }
            }
            functions.sort(function (a, b) { return a.offset - b.offset; });
            var offset = 0, functionIndex = 0, total = 0;
            while (offset < this.codeLength) {
                var count = (peek8(this.buffer + offset) & 255) |
                    ((peek8(this.buffer + offset + 1) & 255) << 8);
                while (functionIndex + 1 < functions.length &&
                        functions[functionIndex + 1].offset <= offset) functionIndex++;
                if (count && functions.length) {
                    functions[functionIndex].samples += count;
                    total += count;
                }
                offset += COUNTER_BYTES;
            }
            functions.sort(function (a, b) {
                return b.samples - a.samples || a.offset - b.offset;
            });
            var output = ["native samples: " + total +
                " in the executing interpreter (excludes libc and source-loading setup)"];
            var index = 0;
            while (index < functions.length && index < 20) {
                var item = functions[index++];
                if (!item.samples) break;
                output.push("  " + item.name + ": " + item.samples + " (" +
                    (100 * item.samples / total).toFixed(1) + "%)");
            }
            return output;
        } finally {
            this.ffi.call(this.freePointer, [this.buffer]);
            this.buffer = 0;
        }
    };
    root.GuestVMNativeSampler = NativeSampler;
    if (typeof module !== "undefined" && module.exports) module.exports = NativeSampler;
}(this));
