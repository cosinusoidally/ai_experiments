/* The only file in the compatibility layer permitted to call ffi_call. */
var NodeDlsymPointer = get_dlsym();

function nodeResolveSymbol(name) {
    var pointer = ffi_call(NodeDlsymPointer, 0, name);
    if (!pointer) throw new Error("could not resolve libc symbol: " + name);
    return pointer;
}

var NodeLibcSymbols = {
    socket: nodeResolveSymbol("socket"),
    connect: nodeResolveSymbol("connect"),
    setsockopt: nodeResolveSymbol("setsockopt"),
    getsockopt: nodeResolveSymbol("getsockopt"),
    bind: nodeResolveSymbol("bind"),
    listen: nodeResolveSymbol("listen"),
    accept: nodeResolveSymbol("accept"),
    fcntl: nodeResolveSymbol("fcntl"),
    poll: nodeResolveSymbol("poll"),
    read: nodeResolveSymbol("read"),
    write: nodeResolveSymbol("write"),
    close: nodeResolveSymbol("close"),
    calloc: nodeResolveSymbol("calloc"),
    free: nodeResolveSymbol("free"),
    inet_aton: nodeResolveSymbol("inet_aton"),
    getsockname: nodeResolveSymbol("getsockname"),
    signal: nodeResolveSymbol("signal"),
    gettimeofday: nodeResolveSymbol("gettimeofday"),
    getenv: nodeResolveSymbol("getenv"),
    errno_location: nodeResolveSymbol("__errno_location"),
    fopen: nodeResolveSymbol("fopen"),
    fseek: nodeResolveSymbol("fseek"),
    ftell: nodeResolveSymbol("ftell"),
    fread: nodeResolveSymbol("fread"),
    fclose: nodeResolveSymbol("fclose"),
    opendir: nodeResolveSymbol("opendir"),
    readdir: nodeResolveSymbol("readdir"),
    closedir: nodeResolveSymbol("closedir")
};

var NodeLibc = {
    socket: function (domain, type, protocol) {
        return ffi_call(NodeLibcSymbols.socket, domain, type, protocol);
    },
    connect: function (fd, address, length) {
        return ffi_call(NodeLibcSymbols.connect, fd, address, length);
    },
    setsockopt: function (fd, level, option, value, length) {
        return ffi_call(NodeLibcSymbols.setsockopt, fd, level, option, value, length);
    },
    getsockopt: function (fd, level, option, value, length) {
        return ffi_call(NodeLibcSymbols.getsockopt, fd, level, option, value, length);
    },
    bind: function (fd, address, length) {
        return ffi_call(NodeLibcSymbols.bind, fd, address, length);
    },
    listen: function (fd, backlog) {
        return ffi_call(NodeLibcSymbols.listen, fd, backlog);
    },
    accept: function (fd, address, length) {
        return ffi_call(NodeLibcSymbols.accept, fd, address, length);
    },
    fcntl: function (fd, command, value) {
        return ffi_call(NodeLibcSymbols.fcntl, fd, command, value);
    },
    poll: function (pollDescriptors, count, timeout) {
        return ffi_call(NodeLibcSymbols.poll, pollDescriptors, count, timeout);
    },
    read: function (fd, buffer, length) {
        return ffi_call(NodeLibcSymbols.read, fd, buffer, length);
    },
    write: function (fd, buffer, length) {
        return ffi_call(NodeLibcSymbols.write, fd, buffer, length);
    },
    close: function (fd) {
        return ffi_call(NodeLibcSymbols.close, fd);
    },
    calloc: function (count, size) {
        return ffi_call(NodeLibcSymbols.calloc, count, size);
    },
    free: function (pointer) {
        return ffi_call(NodeLibcSymbols.free, pointer);
    },
    inetAton: function (text, address) {
        return ffi_call(NodeLibcSymbols.inet_aton, text, address);
    },
    getSocketName: function (fd, address, length) {
        return ffi_call(NodeLibcSymbols.getsockname, fd, address, length);
    },
    signal: function (signalNumber, handler) {
        return ffi_call(NodeLibcSymbols.signal, signalNumber, handler);
    },
    gettimeofday: function (storage) {
        return ffi_call(NodeLibcSymbols.gettimeofday, storage, 0);
    },
    getenv: function (name) {
        return ffi_call(NodeLibcSymbols.getenv, name);
    },
    errno: function () {
        return peek32(ffi_call(NodeLibcSymbols.errno_location));
    },
    fopen: function (path, mode) {
        return ffi_call(NodeLibcSymbols.fopen, path, mode);
    },
    fseek: function (file, offset, origin) {
        return ffi_call(NodeLibcSymbols.fseek, file, offset, origin);
    },
    ftell: function (file) {
        return ffi_call(NodeLibcSymbols.ftell, file);
    },
    fread: function (buffer, size, count, file) {
        return ffi_call(NodeLibcSymbols.fread, buffer, size, count, file);
    },
    fclose: function (file) {
        return ffi_call(NodeLibcSymbols.fclose, file);
    },
    opendir: function (path) {
        return ffi_call(NodeLibcSymbols.opendir, path);
    },
    readdir: function (directory) {
        return ffi_call(NodeLibcSymbols.readdir, directory);
    },
    closedir: function (directory) {
        return ffi_call(NodeLibcSymbols.closedir, directory);
    }
};

var NodeEncoding = {
    utf8Bytes: function (value) {
        value = String(value);
        var bytes = [];
        for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i);
            if (code < 128) {
                bytes.push(code);
            } else if (code < 2048) {
                bytes.push(192 | (code >>> 6));
                bytes.push(128 | (code & 63));
            } else if (code >= 55296 && code <= 56319 && i + 1 < value.length) {
                var low = value.charCodeAt(i + 1);
                if (low >= 56320 && low <= 57343) {
                    code = 65536 + ((code - 55296) << 10) + (low - 56320);
                    i++;
                    bytes.push(240 | (code >>> 18));
                    bytes.push(128 | ((code >>> 12) & 63));
                    bytes.push(128 | ((code >>> 6) & 63));
                    bytes.push(128 | (code & 63));
                } else {
                    bytes.push(239, 191, 189);
                }
            } else if (code >= 56320 && code <= 57343) {
                bytes.push(239, 191, 189);
            } else {
                bytes.push(224 | (code >>> 12));
                bytes.push(128 | ((code >>> 6) & 63));
                bytes.push(128 | (code & 63));
            }
        }
        return bytes;
    },
    byteString: function (bytes) {
        var value = "";
        for (var i = 0; i < bytes.length; i++) {
            value += String.fromCharCode(bytes[i] & 255);
        }
        return value;
    }
};

var NodeMemory = {
    allocate: function (length) {
        var pointer = NodeLibc.calloc(length || 1, 1);
        if (!pointer) throw new Error("native allocation failed");
        return pointer;
    },
    fromBytes: function (bytes) {
        var pointer = this.allocate(bytes.length);
        for (var i = 0; i < bytes.length; i++) poke8(pointer + i, bytes[i]);
        return {pointer: pointer, length: bytes.length};
    },
    fromString: function (value) {
        return this.fromBytes(NodeEncoding.utf8Bytes(value));
    },
    free: function (pointer) {
        if (pointer) NodeLibc.free(pointer);
    },
    bytesToString: function (pointer, length) {
        var value = "";
        for (var i = 0; i < length; i++) value += String.fromCharCode(peek8(pointer + i));
        return value;
    },
    cString: function (pointer) {
        if (!pointer) return undefined;
        var value = "";
        for (var i = 0; i < 1048576; i++) {
            var valueByte = peek8(pointer + i);
            if (valueByte === 0) break;
            value += String.fromCharCode(valueByte);
        }
        return value;
    },
    writeAll: function (fd, value) {
        var nativeValue = this.fromString(value);
        var offset = 0;
        while (offset < nativeValue.length) {
            var count = NodeLibc.write(fd, nativeValue.pointer + offset,
                                       nativeValue.length - offset);
            if (count <= 0) break;
            offset += count;
        }
        this.free(nativeValue.pointer);
    }
};
