/* Output adapter for the shared standalone image layout. No target code is
 * executed here. Native hosts retain bulk copies; Node writes dense buffers. */
(function (root) {
    var OWNER_READ_WRITE_MODE = 384; /* POSIX 0600 */
    var OPEN_WRITE_CREATE_TRUNCATE = 577; /* Linux O_WRONLY|O_CREAT|O_TRUNC */
    function SnapshotOutput(memory, length) {
        this.host = memory.host;
        this.ffi = this.host.ffi;
        this.allocation = this.host.allocate(length, false);
        this.length = length;
    }

    SnapshotOutput.prototype.write32 = function (offset, value) {
        this.host.write32LE(this.allocation, offset, value);
    };

    SnapshotOutput.prototype.copyBytes = function (offset, bytes) {
        var index = 0;
        while (index + 4 <= bytes.length) {
            this.write32(offset + index, bytes[index] |
                (bytes[index + 1] << 8) | (bytes[index + 2] << 16) |
                (bytes[index + 3] << 24));
            index += 4;
        }
        while (index < bytes.length) {
            this.host.write8(this.allocation, offset + index, bytes[index]);
            index++;
        }
    };

    SnapshotOutput.prototype.copyCode = function (offset, result) {
        if (this.allocation.isNative && result.pointer) {
            this.ffi.call(this.ffi.resolve("memcpy"),
                [this.allocation.pointer + offset, result.pointer, result.length]);
        } else {
            if (!result.bytes || result.bytes.length !== result.length) {
                throw new Error("snapshot requires target code bytes");
            }
            this.copyBytes(offset, result.bytes);
        }
    };

    SnapshotOutput.prototype.writeNative = function (path, image, imageLength) {
        var ffi = this.ffi;
        var temporary = path + ".tmp." + ffi.call(ffi.resolve("getpid"), []);
        var descriptor = ffi.call(ffi.resolve("open"),
            [temporary, OPEN_WRITE_CREATE_TRUNCATE, OWNER_READ_WRITE_MODE]);
        if (descriptor < 0) return false;
        var complete = false;
        function writeAllocation(allocation, length) {
            var offset = 0, writePointer = ffi.resolve("write");
            while (offset < length) {
                var count = ffi.call(writePointer,
                    [descriptor, allocation.pointer + offset, length - offset]);
                if (count <= 0) return false;
                offset += count;
            }
            return true;
        }
        try {
            complete = writeAllocation(this.allocation, this.length) &&
                writeAllocation(image, imageLength);
        } finally {
            ffi.call(ffi.resolve("close"), [descriptor]);
            if (!complete) ffi.call(ffi.resolve("unlink"), [temporary]);
        }
        if (!complete) return false;
        if (ffi.call(ffi.resolve("rename"), [temporary, path]) === 0) {
            return true;
        }
        ffi.call(ffi.resolve("unlink"), [temporary]);
        return false;
    };

    SnapshotOutput.prototype.writeNode = function (path, image, imageLength) {
        var fs = require("fs");
        var temporary = path + ".tmp." + process.pid;
        var descriptor = fs.openSync(temporary, "w", OWNER_READ_WRITE_MODE);
        var host = this.host;
        var chunkLength = 65536;
        var chunk = Buffer.alloc ? Buffer.alloc(chunkLength) : new Buffer(chunkLength);
        var complete = false;
        function writeAllocation(allocation, length) {
            var offset = 0;
            while (offset < length) {
                var count = Math.min(chunkLength, length - offset);
                for (var index = 0; index < count; index++) {
                    chunk[index] = host.read8(allocation, offset + index);
                }
                var written = 0;
                while (written < count) {
                    var size = fs.writeSync(descriptor, chunk, written, count - written, null);
                    if (size <= 0) throw new Error("snapshot write made no progress");
                    written += size;
                }
                offset += count;
            }
        }
        try {
            writeAllocation(this.allocation, this.length);
            writeAllocation(image, imageLength);
            complete = true;
        } finally {
            fs.closeSync(descriptor);
            if (!complete) fs.unlinkSync(temporary);
        }
        try { fs.renameSync(temporary, path); }
        catch (error) { fs.unlinkSync(temporary); throw error; }
        return true;
    };

    SnapshotOutput.prototype.write = function (path, image, imageLength) {
        return this.allocation.isNative ? this.writeNative(path, image, imageLength) :
            this.writeNode(path, image, imageLength);
    };

    SnapshotOutput.prototype.destroy = function () {
        this.host.free(this.allocation);
    };

    root.GuestVMSnapshotOutput = SnapshotOutput;
    if (typeof module !== "undefined" && module.exports) module.exports = SnapshotOutput;
}(this));
