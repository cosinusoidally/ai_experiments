/* Bounded-memory, no-clobber file adapter for Node and MMVM hosts. */
(function (root) {
    var CHUNK_BYTES = 65536, OWNER_READ_WRITE = 384, EXECUTABLE_MODE = 493;
    var OPEN_READ_ONLY = 0, OPEN_EXCLUSIVE_WRITE = 193;
    var SEEK_SET = 0, SEEK_END = 2, INTERRUPTED = 4;

    function nodeAdapter(fs) {
        var scratch = Buffer.alloc ? Buffer.alloc(CHUNK_BYTES) : new Buffer(CHUNK_BYTES);
        return {
            openInput: function (path) { return fs.openSync(path, "r"); },
            createOutput: function (path) { return fs.openSync(path, "wx", OWNER_READ_WRITE); },
            length: function (fd) { return fs.fstatSync(fd).size; },
            read: function (fd, count) { return fs.readSync(fd, scratch, 0, count, null); },
            write: function (fd, count) {
                var done = 0, n;
                while (done < count) {
                    n = fs.writeSync(fd, scratch, done, count - done, null);
                    if (n <= 0) throw new Error("short output write");
                    done += n;
                }
            },
            get: function (index) { return scratch[index]; },
            set: function (index, value) { scratch[index] = value; },
            close: function (fd) { fs.closeSync(fd); },
            chmod: function (path) { fs.chmodSync(path, EXECUTABLE_MODE); },
            publish: function (temporary, destination) { fs.linkSync(temporary, destination); },
            remove: function (path) { fs.unlinkSync(path); },
            pid: function () { return process.pid; },
            dispose: function () {}
        };
    }

    function nativeAdapter(HostFFI) {
        var ffi = new HostFFI(), functions = {}, i;
        var names = ["open", "close", "read", "write", "lseek", "calloc", "free",
            "chmod", "link", "unlink", "getpid", "__errno_location"];
        for (i = 0; i < names.length; i++) functions[names[i]] = ffi.resolve(names[i]);
        function call(name, args) { return ffi.call(functions[name], args); }
        function checked(name, args) {
            var result = call(name, args);
            if (result < 0) throw new Error(name + " failed (errno " + errno() + ")");
            return result;
        }
        function errno() { return ffi.peek32(call("__errno_location", [])); }
        var scratch = call("calloc", [CHUNK_BYTES, 1]);
        if (!scratch) throw new Error("could not allocate file copy buffer");
        return {
            openInput: function (path) { return checked("open", [path, OPEN_READ_ONLY, 0]); },
            createOutput: function (path) { return checked("open", [path, OPEN_EXCLUSIVE_WRITE, OWNER_READ_WRITE]); },
            length: function (fd) {
                var length = checked("lseek", [fd, 0, SEEK_END]);
                checked("lseek", [fd, 0, SEEK_SET]); return length;
            },
            read: function (fd, count) {
                var n;
                do { n = call("read", [fd, scratch, count]); }
                while (n < 0 && errno() === INTERRUPTED);
                if (n < 0) throw new Error("input read failed (errno " + errno() + ")");
                return n;
            },
            write: function (fd, count) {
                var done = 0, n;
                while (done < count) {
                    n = call("write", [fd, scratch + done, count - done]);
                    if (n < 0 && errno() === INTERRUPTED) continue;
                    if (n <= 0) throw new Error("output write failed");
                    done += n;
                }
            },
            get: function (index) { return ffi.peek8(scratch + index); },
            set: function (index, value) { ffi.poke8(scratch + index, value); },
            close: function (fd) { checked("close", [fd]); },
            chmod: function (path) { checked("chmod", [path, EXECUTABLE_MODE]); },
            publish: function (temporary, destination) { checked("link", [temporary, destination]); },
            remove: function (path) { checked("unlink", [path]); },
            pid: function () { return call("getpid", []); },
            dispose: function () { call("free", [scratch]); }
        };
    }

    function convert(io, input, output, elf, Assembler, format) {
        var source = -1, destination = -1, owned = false, temporary;
        var length, header = [], layout, n, i, remaining;
        function writeArray(bytes) {
            var offset = 0, count, j;
            while (offset < bytes.length) {
                count = Math.min(CHUNK_BYTES, bytes.length - offset);
                for (j = 0; j < count; j++) io.set(j, bytes[offset + j]);
                io.write(destination, count); offset += count;
            }
        }
        try {
            source = io.openInput(input); length = io.length(source);
            remaining = format.headerBytes;
            while (remaining) {
                n = io.read(source, remaining);
                if (!n) throw new Error("truncated snapshot header");
                for (i = 0; i < n; i++) header.push(io.get(i));
                remaining -= n;
            }
            layout = elf.build(header, length, Assembler, format);
            temporary = output + ".tmp." + io.pid();
            destination = io.createOutput(temporary); owned = true;
            writeArray(layout.prefix); writeArray(header);
            remaining = length - header.length;
            while (remaining) {
                n = io.read(source, Math.min(CHUNK_BYTES, remaining));
                if (!n) throw new Error("snapshot was truncated during copy");
                io.write(destination, n); remaining -= n;
            }
            if (io.read(source, 1)) throw new Error("snapshot grew during copy");
            writeArray(layout.suffix);
            io.close(destination); destination = -1;
            io.close(source); source = -1;
            io.chmod(temporary);
            /* link is atomic and refuses an existing target, unlike rename.
             * Temporary and final path share a directory/filesystem. */
            io.publish(temporary, output);
            io.remove(temporary); owned = false;
            return layout;
        } finally {
            if (source >= 0) io.close(source);
            if (destination >= 0) io.close(destination);
            if (owned) io.remove(temporary);
            io.dispose();
        }
    }
    var api = {nodeAdapter: nodeAdapter, nativeAdapter: nativeAdapter, convert: convert};
    root.GuestVMSnapshotExeIO = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
