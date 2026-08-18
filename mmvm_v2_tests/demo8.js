/*
 * Standalone MMVM baseline for demo8.
 *
 * This file mechanically incorporates the MMVM host compatibility pieces,
 * X11 framebuffer module, shared demo helpers, and demo7 rally implementation.
 * It intentionally preserves their structure before MMVM-specific optimization.
 */

var Demo8RunnerArguments = ["demo8.js"];
for (var Demo8ArgumentIndex = 0;
         Demo8ArgumentIndex < arguments.length;
         Demo8ArgumentIndex++) {
    Demo8RunnerArguments.push(arguments[Demo8ArgumentIndex]);
}

/* ---- Inlined from node_compat/libc.js ---- */
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
    memmove: nodeResolveSymbol("memmove"),
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
    memmove: function (destination, source, length) {
        return ffi_call(NodeLibcSymbols.memmove, destination, source, length);
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

/* ---- Inlined from node_compat/events.js ---- */
function NodeEventEmitter() {
    this._events = {};
}

NodeEventEmitter.prototype.on = function (name, callback) {
    if (typeof callback !== "function") throw new TypeError("listener must be a function");
    if (!this._events[name]) this._events[name] = [];
    this._events[name].push(callback);
    return this;
};

NodeEventEmitter.prototype.emit = function (name) {
    var listeners = this._events[name];
    if (!listeners || listeners.length === 0) {
        if (name === "error") throw arguments[1] || new Error("unhandled error event");
        return false;
    }
    var callArguments = [];
    for (var i = 1; i < arguments.length; i++) callArguments.push(arguments[i]);
    listeners = listeners.slice(0);
    for (var j = 0; j < listeners.length; j++) listeners[j].apply(this, callArguments);
    return true;
};

/* ---- Inlined from node_compat/process.js ---- */
var NodeAnimationFrameDeadline = 0;

var NodeProcess = {
    exitCode: 0,
    exiting: false,
    exitMarker: {nodeProcessExit: true},

    install: function (runnerArguments) {
        NodeAnimationFrameDeadline = 0;
        var target = runnerArguments[0];
        var nodeArguments = ["artifacts/js_min.exe", target];
        for (var i = 1; i < runnerArguments.length; i++) nodeArguments.push(runnerArguments[i]);

        process = {
            argv: nodeArguments,
            env: {
                DISPLAY: NodeMemory.cString(NodeLibc.getenv("DISPLAY")),
                XAUTHORITY: NodeMemory.cString(NodeLibc.getenv("XAUTHORITY")),
                HOME: NodeMemory.cString(NodeLibc.getenv("HOME"))
            },
            exit: function (status) {
                NodeProcess.exitCode = status === undefined ? 0 : status | 0;
                NodeProcess.exiting = true;
                throw NodeProcess.exitMarker;
            }
        };

        console = {
            log: function () {
                NodeMemory.writeAll(1, NodeProcess.formatArguments(arguments) + "\n");
            },
            error: function () {
                NodeMemory.writeAll(2, NodeProcess.formatArguments(arguments) + "\n");
            }
        };

        setTimeout = function (callback, delay) {
            return NodeRuntime.setTimeout(callback, delay);
        };
        clearTimeout = function (id) {
            NodeRuntime.clearTimeout(id);
        };
        requestAnimationFrame = function (callback) {
            var now = NodeRuntime.now();
            if (!NodeAnimationFrameDeadline || NodeAnimationFrameDeadline <= now) {
                NodeAnimationFrameDeadline = now + 1000 / 60;
            }
            var deadline = NodeAnimationFrameDeadline;
            NodeAnimationFrameDeadline += 1000 / 60;
            return NodeRuntime.setTimeout(function () {
                callback(NodeRuntime.now());
            }, Math.max(0, deadline - now));
        };
        cancelAnimationFrame = function (id) {
            NodeRuntime.clearTimeout(id);
        };

        function NodeBuffer(value, encoding) {
            var bytes = [];
            var i;
            if (typeof value === "number") {
                for (i = 0; i < value; i++) bytes.push(0);
            } else if (typeof value === "string") {
                if (encoding && encoding !== "ascii" && encoding !== "binary" &&
                    encoding !== "utf8" && encoding !== "utf-8") {
                    throw new Error("unsupported Buffer encoding: " + encoding);
                }
                bytes = encoding === "ascii" || encoding === "binary" ? [] :
                        NodeEncoding.utf8Bytes(value);
                if (encoding === "ascii" || encoding === "binary") {
                    for (i = 0; i < value.length; i++) bytes.push(value.charCodeAt(i) & 255);
                }
            } else if (value && value._nodeBytes) {
                bytes = value._nodeBytes.slice(0);
            } else if (value) {
                for (i = 0; i < value.length; i++) bytes.push(value[i] & 255);
            }
            this._nodeBytes = bytes;
            this.length = bytes.length;
        }
        NodeBuffer.alloc = function (length) { return new NodeBuffer(length); };
        NodeBuffer.from = function (value, encoding) { return new NodeBuffer(value, encoding); };
        function NodeNativeBuffer(length, pointer) {
            this.length = length;
            this._nodePointer = pointer === undefined ? NodeMemory.allocate(length) : pointer;
        }
        NodeNativeBuffer.prototype.writeUInt32LE = function (value, offset) {
            poke32(this._nodePointer + offset, value);
            return offset + 4;
        };
        NodeNativeBuffer.prototype.slice = function (start, end) {
            start = start || 0;
            end = end === undefined ? this.length : end;
            return new NodeNativeBuffer(end - start, this._nodePointer + start);
        };
        NodeNativeBuffer.prototype.copy = function (target, targetStart, sourceStart,
                                                    sourceEnd) {
            targetStart = targetStart || 0;
            sourceStart = sourceStart || 0;
            sourceEnd = sourceEnd === undefined ? this.length : sourceEnd;
            var count = Math.min(sourceEnd - sourceStart,
                                 target.length - targetStart,
                                 this.length - sourceStart);
            if (count <= 0) return 0;
            if (target._nodePointer) {
                NodeLibc.memmove(target._nodePointer + targetStart,
                                 this._nodePointer + sourceStart, count);
            } else {
                for (var i = 0; i < count; i++) {
                    target._nodeBytes[targetStart + i] =
                        peek8(this._nodePointer + sourceStart + i);
                }
            }
            return count;
        };
        NodeBuffer.allocNative = function (length) { return new NodeNativeBuffer(length); };
        NodeBuffer.byteLength = function (value, encoding) {
            if (encoding && String(encoding).toLowerCase() !== "utf8" &&
                String(encoding).toLowerCase() !== "utf-8") {
                throw new Error("unsupported encoding: " + encoding);
            }
            return NodeEncoding.utf8Bytes(value).length;
        };
        NodeBuffer.prototype.copy = function (target, targetStart, sourceStart, sourceEnd) {
            targetStart = targetStart || 0;
            sourceStart = sourceStart || 0;
            sourceEnd = sourceEnd === undefined ? this.length : sourceEnd;
            var count = 0;
            while (sourceStart < sourceEnd && sourceStart < this.length &&
                   targetStart < target.length) {
                target._nodeBytes[targetStart++] = this._nodeBytes[sourceStart++];
                count++;
            }
            return count;
        };
        NodeBuffer.prototype.slice = function (start, end) {
            start = start || 0;
            end = end === undefined ? this.length : end;
            return new NodeBuffer(this._nodeBytes.slice(start, end));
        };
        NodeBuffer.prototype.toString = function (encoding, start, end) {
            encoding = encoding || "utf8";
            start = start || 0;
            end = end === undefined ? this.length : end;
            if (encoding !== "ascii" && encoding !== "binary" &&
                encoding !== "utf8" && encoding !== "utf-8") {
                throw new Error("unsupported Buffer encoding: " + encoding);
            }
            var result = "";
            for (var i = start; i < end; i++) {
                result += String.fromCharCode(this._nodeBytes[i]);
            }
            return result;
        };
        NodeBuffer.prototype.readUInt16LE = function (offset) {
            return this._nodeBytes[offset] | (this._nodeBytes[offset + 1] << 8);
        };
        NodeBuffer.prototype.readUInt16BE = function (offset) {
            return (this._nodeBytes[offset] << 8) | this._nodeBytes[offset + 1];
        };
        NodeBuffer.prototype.readUInt32LE = function (offset) {
            return (this._nodeBytes[offset] |
                    (this._nodeBytes[offset + 1] << 8) |
                    (this._nodeBytes[offset + 2] << 16) |
                    (this._nodeBytes[offset + 3] << 24)) >>> 0;
        };
        NodeBuffer.prototype.readInt16LE = function (offset) {
            var value = this.readUInt16LE(offset);
            return value & 32768 ? value - 65536 : value;
        };
        NodeBuffer.prototype.writeUInt16LE = function (value, offset) {
            this._nodeBytes[offset] = value & 255;
            this._nodeBytes[offset + 1] = (value >>> 8) & 255;
            return offset + 2;
        };
        NodeBuffer.prototype.writeUInt32LE = function (value, offset) {
            this._nodeBytes[offset] = value & 255;
            this._nodeBytes[offset + 1] = (value >>> 8) & 255;
            this._nodeBytes[offset + 2] = (value >>> 16) & 255;
            this._nodeBytes[offset + 3] = (value >>> 24) & 255;
            return offset + 4;
        };
        NodeBuffer.prototype.writeInt16LE = function (value, offset) {
            return this.writeUInt16LE(value & 65535, offset);
        };
        Buffer = NodeBuffer;
    },

    formatArguments: function (values) {
        var parts = [];
        for (var i = 0; i < values.length; i++) parts.push(String(values[i]));
        return parts.join(" ");
    },

    isExit: function (value) {
        return value === this.exitMarker;
    },

    reportException: function (error) {
        var message = error && error.stack ? error.stack : String(error);
        NodeMemory.writeAll(2, message + "\n");
    }
};

/* ---- Inlined from node_compat/net.js ---- */
/* Linux i386 constants and structure layouts used by the poll-based loop. */
var NodeNetConstants = {
    AF_UNIX: 1,
    AF_INET: 2,
    SOCK_STREAM: 1,
    SOL_SOCKET: 1,
    SO_REUSEADDR: 2,
    SO_ERROR: 4,
    F_GETFL: 3,
    F_SETFL: 4,
    O_NONBLOCK: 2048,
    POLLIN: 1,
    POLLOUT: 4,
    POLLERR: 8,
    POLLHUP: 16,
    POLLNVAL: 32,
    EINTR: 4,
    EAGAIN: 11,
    EWOULDBLOCK: 11,
    EINPROGRESS: 115,
    SIGPIPE: 13,
    SIG_IGN: 1
};

function nodeBufferBytes(value) {
    if (typeof value === "string") return NodeEncoding.utf8Bytes(value);
    if (value && value._nodeBytes) return value._nodeBytes.slice(0);
    var bytes = [];
    for (var i = 0; value && i < value.length; i++) bytes.push(value[i] & 255);
    return bytes;
}

function nodeWriteShort(pointer, value) {
    poke8(pointer, value & 255);
    poke8(pointer + 1, (value >>> 8) & 255);
}

function nodeReadShort(pointer) {
    return peek8(pointer) | (peek8(pointer + 1) << 8);
}

function nodeSocketError(operation, number) {
    var error = new Error(operation + " failed (errno " + number + ")");
    error.errno = number;
    error.code = "E" + number;
    error.syscall = operation;
    return error;
}

function nodeSetNonBlocking(fd) {
    var flags = NodeLibc.fcntl(fd, NodeNetConstants.F_GETFL, 0);
    if (flags < 0) throw nodeSocketError("fcntl(F_GETFL)", NodeLibc.errno());
    if (NodeLibc.fcntl(fd, NodeNetConstants.F_SETFL,
                       flags | NodeNetConstants.O_NONBLOCK) < 0) {
        throw nodeSocketError("fcntl(F_SETFL)", NodeLibc.errno());
    }
}

function NodeClient(fd, server, remoteAddress, remotePort) {
    this.fd = fd;
    this.server = server;
    this.closed = false;
    this.input = "";
    this.requestDispatched = false;
    this.outputPointer = 0;
    this.outputLength = 0;
    this.outputOffset = 0;
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
}

NodeClient.prototype.queueBytes = function (bytes) {
    if (this.closed) return;
    if (this.outputPointer) throw new Error("response output is already queued");
    var nativeOutput = NodeMemory.fromBytes(bytes);
    this.outputPointer = nativeOutput.pointer;
    this.outputLength = nativeOutput.length;
    this.outputOffset = 0;
};

NodeClient.prototype.close = function () {
    if (this.closed) return;
    this.closed = true;
    NodeLibc.close(this.fd);
    if (this.outputPointer) NodeMemory.free(this.outputPointer);
    this.outputPointer = 0;
    this.outputLength = 0;
    this.outputOffset = 0;
};

function NodeNetServer(connectionHandler) {
    NodeEventEmitter.call(this);
    this._connectionHandler = connectionHandler;
    this._fd = -1;
    this._listening = false;
    this._address = null;
}

NodeNetServer.prototype.on = NodeEventEmitter.prototype.on;
NodeNetServer.prototype.emit = NodeEventEmitter.prototype.emit;

NodeNetServer.prototype.listen = function (port, host, callback) {
    if (typeof host === "function") {
        callback = host;
        host = undefined;
    }
    port = Number(port);
    host = host || "0.0.0.0";
    if (!(port >= 0 && port <= 65535) || Math.floor(port) !== port) {
        throw new RangeError("port must be in the range 0-65535");
    }
    if (this._listening || this._fd >= 0) throw new Error("server is already listening");

    var fd = -1;
    var address = 0;
    var reuse = 0;
    try {
        fd = NodeLibc.socket(NodeNetConstants.AF_INET, NodeNetConstants.SOCK_STREAM, 0);
        if (fd < 0) throw nodeSocketError("socket", NodeLibc.errno());
        nodeSetNonBlocking(fd);

        reuse = NodeMemory.allocate(4);
        poke32(reuse, 1);
        if (NodeLibc.setsockopt(fd, NodeNetConstants.SOL_SOCKET,
                               NodeNetConstants.SO_REUSEADDR, reuse, 4) < 0) {
            throw nodeSocketError("setsockopt", NodeLibc.errno());
        }

        /* Linux i386 sockaddr_in: family, network-order port, address, padding. */
        address = NodeMemory.allocate(16);
        poke8(address, NodeNetConstants.AF_INET);
        poke8(address + 1, 0);
        poke8(address + 2, (port >>> 8) & 255);
        poke8(address + 3, port & 255);
        if (NodeLibc.inetAton(host, address + 4) === 0) {
            throw new Error("bind address must be a numeric IPv4 address: " + host);
        }
        if (NodeLibc.bind(fd, address, 16) < 0) {
            throw nodeSocketError("bind", NodeLibc.errno());
        }
        if (NodeLibc.listen(fd, 128) < 0) {
            throw nodeSocketError("listen", NodeLibc.errno());
        }

        var addressLength = NodeMemory.allocate(4);
        poke32(addressLength, 16);
        if (NodeLibc.getSocketName(fd, address, addressLength) < 0) {
            NodeMemory.free(addressLength);
            throw nodeSocketError("getsockname", NodeLibc.errno());
        }
        port = peek8(address + 2) * 256 + peek8(address + 3);
        NodeMemory.free(addressLength);

        this._fd = fd;
        this._listening = true;
        this._address = {address: host, family: "IPv4", port: port};
        NodeRuntime.servers.push(this);
        if (typeof callback === "function") {
            var listeningServer = this;
            NodeRuntime.enqueue(function () { callback.call(listeningServer); });
        }
    } catch (error) {
        if (fd >= 0) NodeLibc.close(fd);
        var failedServer = this;
        var listenError = error;
        NodeRuntime.enqueue(function () { failedServer.emit("error", listenError); });
    }
    NodeMemory.free(reuse);
    NodeMemory.free(address);
    return this;
};

NodeNetServer.prototype.address = function () {
    return this._address;
};

NodeNetServer.prototype.close = function (callback) {
    if (this._fd >= 0) NodeLibc.close(this._fd);
    this._fd = -1;
    this._listening = false;
    this._address = null;
    if (typeof callback === "function") NodeRuntime.enqueue(callback);
    return this;
};

function NodeSocket(fd) {
    NodeEventEmitter.call(this);
    this.fd = fd;
    this.closed = false;
    this.connecting = true;
    this._ending = false;
    this._output = [];
}

NodeSocket.prototype.on = NodeEventEmitter.prototype.on;
NodeSocket.prototype.emit = NodeEventEmitter.prototype.emit;

NodeSocket.prototype.write = function (value, callback) {
    if (this.closed || this._ending) return false;
    if (value && value._nodePointer !== undefined) {
        this._output.push({pointer: value._nodePointer, length: value.length,
                           offset: 0, owned: false, callback: callback});
        return true;
    }
    var output = NodeMemory.fromBytes(nodeBufferBytes(value));
    this._output.push({pointer: output.pointer, length: output.length,
                       offset: 0, owned: true, callback: callback});
    return true;
};

NodeSocket.prototype.end = function (value) {
    if (value !== undefined) this.write(value);
    this._ending = true;
    if (!this.connecting && this._output.length === 0) this.destroy();
    return this;
};

NodeSocket.prototype.destroy = function (error) {
    if (this.closed) return this;
    this.closed = true;
    NodeLibc.close(this.fd);
    while (this._output.length) {
        var output = this._output.shift();
        if (output.owned) NodeMemory.free(output.pointer);
    }
    if (error) this.emit("error", error);
    this.emit("close");
    return this;
};

function nodeCreateUnixConnection(path) {
    path = String(path);
    var pathBytes = NodeEncoding.utf8Bytes(path);
    if (pathBytes.length > 107) throw new Error("Unix socket path is too long: " + path);
    var fd = NodeLibc.socket(NodeNetConstants.AF_UNIX, NodeNetConstants.SOCK_STREAM, 0);
    if (fd < 0) throw nodeSocketError("socket", NodeLibc.errno());
    var socket = new NodeSocket(fd);
    var address = 0;
    try {
        nodeSetNonBlocking(fd);
        /* Linux sockaddr_un: sa_family_t followed by a NUL-terminated path. */
        address = NodeMemory.allocate(110);
        nodeWriteShort(address, NodeNetConstants.AF_UNIX);
        for (var i = 0; i < pathBytes.length; i++) poke8(address + 2 + i, pathBytes[i]);
        var result = NodeLibc.connect(fd, address, pathBytes.length + 3);
        if (result === 0) socket.connecting = false;
        else {
            var number = NodeLibc.errno();
            if (number !== NodeNetConstants.EINPROGRESS) {
                throw nodeSocketError("connect", number);
            }
        }
        NodeRuntime.sockets.push(socket);
        if (!socket.connecting) NodeRuntime.enqueue(function () { socket.emit("connect"); });
    } catch (error) {
        NodeLibc.close(fd);
        socket.closed = true;
        NodeRuntime.enqueue(function () { socket.emit("error", error); socket.emit("close"); });
    }
    NodeMemory.free(address);
    return socket;
}

var NodeRuntime = {
    callbacks: [],
    servers: [],
    clients: [],
    sockets: [],
    timers: [],
    nextTimerId: 1,
    clockStorage: 0,

    enqueue: function (callback) {
        this.callbacks.push(callback);
    },

    invoke: function (callback) {
        try {
            callback();
        } catch (error) {
            if (NodeProcess.isExit(error)) return;
            NodeProcess.reportException(error);
            NodeProcess.exitCode = 1;
            NodeProcess.exiting = true;
        }
    },

    drainCallbacks: function () {
        while (this.callbacks.length && !NodeProcess.exiting) {
            this.invoke(this.callbacks.shift());
        }
    },

    now: function () {
        if (!this.clockStorage) this.clockStorage = NodeMemory.allocate(8);
        if (NodeLibc.gettimeofday(this.clockStorage) !== 0) {
            throw nodeSocketError("gettimeofday", NodeLibc.errno());
        }
        return (peek32(this.clockStorage) >>> 0) * 1000 +
               (peek32(this.clockStorage + 4) >>> 0) / 1000;
    },

    setTimeout: function (callback, delay) {
        var timer = {
            id: this.nextTimerId++,
            callback: callback,
            due: this.now() + Math.max(0, Number(delay) || 0),
            cancelled: false
        };
        this.timers.push(timer);
        return timer.id;
    },

    clearTimeout: function (id) {
        for (var i = 0; i < this.timers.length; i++) {
            if (this.timers[i].id === id) this.timers[i].cancelled = true;
        }
    },

    runDueTimers: function () {
        var now = this.now();
        var timers = this.timers;
        var pending = [];
        this.timers = [];
        for (var i = 0; i < timers.length; i++) {
            var timer = timers[i];
            if (timer.cancelled) continue;
            if (timer.due <= now) this.invoke(timer.callback);
            else pending.push(timer);
        }
        this.timers = pending.concat(this.timers);
    },

    nextTimerDelay: function () {
        var earliest = -1;
        for (var i = 0; i < this.timers.length; i++) {
            if (!this.timers[i].cancelled &&
                (earliest < 0 || this.timers[i].due < earliest)) earliest = this.timers[i].due;
        }
        if (earliest < 0) return -1;
        return Math.max(0, Math.ceil(earliest - this.now()));
    },

    activeServers: function () {
        var active = [];
        for (var i = 0; i < this.servers.length; i++) {
            if (this.servers[i]._listening && this.servers[i]._fd >= 0) {
                active.push(this.servers[i]);
            }
        }
        return active;
    },

    activeClients: function () {
        var active = [];
        for (var i = 0; i < this.clients.length; i++) {
            if (!this.clients[i].closed) active.push(this.clients[i]);
        }
        return active;
    },

    activeSockets: function () {
        var active = [];
        for (var i = 0; i < this.sockets.length; i++) {
            if (!this.sockets[i].closed) active.push(this.sockets[i]);
        }
        return active;
    },

    finishSocketConnect: function (socket) {
        var errorStorage = NodeMemory.allocate(4);
        var lengthStorage = NodeMemory.allocate(4);
        poke32(lengthStorage, 4);
        var result = NodeLibc.getsockopt(socket.fd, NodeNetConstants.SOL_SOCKET,
                                         NodeNetConstants.SO_ERROR,
                                         errorStorage, lengthStorage);
        var number = result < 0 ? NodeLibc.errno() : peek32(errorStorage);
        NodeMemory.free(lengthStorage);
        NodeMemory.free(errorStorage);
        if (result < 0 || number !== 0) {
            socket.destroy(nodeSocketError("connect", number));
            return;
        }
        socket.connecting = false;
        socket.emit("connect");
    },

    readSocket: function (socket) {
        var size = 65536;
        var storage = NodeMemory.allocate(size);
        while (!socket.closed) {
            var count = NodeLibc.read(socket.fd, storage, size);
            if (count > 0) {
                var bytes = [];
                for (var i = 0; i < count; i++) bytes.push(peek8(storage + i));
                socket.emit("data", new Buffer(bytes));
            } else if (count === 0) {
                socket.destroy();
                break;
            } else {
                var number = NodeLibc.errno();
                if (number === NodeNetConstants.EINTR) continue;
                if (number !== NodeNetConstants.EAGAIN &&
                    number !== NodeNetConstants.EWOULDBLOCK) {
                    socket.destroy(nodeSocketError("read", number));
                }
                break;
            }
        }
        NodeMemory.free(storage);
    },

    writeSocket: function (socket) {
        while (!socket.closed && socket._output.length) {
            var output = socket._output[0];
            var count = NodeLibc.write(socket.fd, output.pointer + output.offset,
                                       output.length - output.offset);
            if (count > 0) output.offset += count;
            else {
                var number = NodeLibc.errno();
                if (count < 0 && number === NodeNetConstants.EINTR) continue;
                if (count < 0 && (number === NodeNetConstants.EAGAIN ||
                                  number === NodeNetConstants.EWOULDBLOCK)) return;
                socket.destroy(nodeSocketError("write", number));
                return;
            }
            if (output.offset >= output.length) {
                if (output.owned) NodeMemory.free(output.pointer);
                socket._output.shift();
                if (typeof output.callback === "function") {
                    NodeRuntime.enqueue(output.callback);
                }
            }
        }
        if (!socket.closed && socket._ending && socket._output.length === 0) socket.destroy();
    },

    acceptClients: function (server) {
        while (!NodeProcess.exiting) {
            var address = NodeMemory.allocate(128);
            var length = NodeMemory.allocate(4);
            poke32(length, 128);
            var fd = NodeLibc.accept(server._fd, address, length);
            var errorNumber = fd < 0 ? NodeLibc.errno() : 0;
            var remoteAddress = peek8(address + 4) + "." + peek8(address + 5) + "." +
                                peek8(address + 6) + "." + peek8(address + 7);
            var remotePort = peek8(address + 2) * 256 + peek8(address + 3);
            NodeMemory.free(length);
            NodeMemory.free(address);
            if (fd < 0) {
                if (errorNumber === NodeNetConstants.EINTR) continue;
                if (errorNumber === NodeNetConstants.EAGAIN ||
                    errorNumber === NodeNetConstants.EWOULDBLOCK) return;
                server.emit("error", nodeSocketError("accept", errorNumber));
                return;
            }
            try {
                nodeSetNonBlocking(fd);
                this.clients.push(new NodeClient(fd, server, remoteAddress, remotePort));
            } catch (error) {
                NodeLibc.close(fd);
                server.emit("error", error);
            }
        }
    },

    readClient: function (client) {
        var bufferSize = 4096;
        var buffer = NodeMemory.allocate(bufferSize);
        while (!client.closed && !client.requestDispatched) {
            var count = NodeLibc.read(client.fd, buffer, bufferSize);
            if (count > 0) {
                client.input += NodeMemory.bytesToString(buffer, count);
                if (client.input.length > 16384) {
                    client.close();
                    break;
                }
                if (client.input.indexOf("\r\n\r\n") >= 0) {
                    client.requestDispatched = true;
                    client.server._connectionHandler(client);
                    break;
                }
            } else if (count === 0) {
                client.close();
            } else {
                var errorNumber = NodeLibc.errno();
                if (errorNumber === NodeNetConstants.EINTR) continue;
                if (errorNumber !== NodeNetConstants.EAGAIN &&
                    errorNumber !== NodeNetConstants.EWOULDBLOCK) client.close();
                break;
            }
        }
        NodeMemory.free(buffer);
    },

    writeClient: function (client) {
        while (!client.closed && client.outputPointer &&
               client.outputOffset < client.outputLength) {
            var count = NodeLibc.write(client.fd,
                client.outputPointer + client.outputOffset,
                client.outputLength - client.outputOffset);
            if (count > 0) {
                client.outputOffset += count;
            } else {
                var errorNumber = NodeLibc.errno();
                if (count < 0 && errorNumber === NodeNetConstants.EINTR) continue;
                if (count < 0 && (errorNumber === NodeNetConstants.EAGAIN ||
                                  errorNumber === NodeNetConstants.EWOULDBLOCK)) return;
                client.close();
                return;
            }
        }
        if (!client.closed && client.outputPointer &&
            client.outputOffset >= client.outputLength) client.close();
    },

    closeAll: function () {
        var i;
        for (i = 0; i < this.clients.length; i++) this.clients[i].close();
        for (i = 0; i < this.sockets.length; i++) this.sockets[i].destroy();
        for (i = 0; i < this.servers.length; i++) this.servers[i].close();
    },

    run: function () {
        /* Linux 2.4-compatible protection against writes to disconnected peers. */
        NodeLibc.signal(NodeNetConstants.SIGPIPE, NodeNetConstants.SIG_IGN);

        while (!NodeProcess.exiting) {
            this.drainCallbacks();
            this.runDueTimers();
            if (NodeProcess.exiting) break;

            var servers = this.activeServers();
            var clients = this.activeClients();
            var sockets = this.activeSockets();
            var count = servers.length + clients.length + sockets.length;
            var timeout = this.nextTimerDelay();
            if (count === 0 && timeout < 0) break;

            /* Linux i386 struct pollfd is fd:int, events:short, revents:short. */
            var pollDescriptors = NodeMemory.allocate(count * 8);
            var handles = [];
            var index = 0;
            var i;
            for (i = 0; i < servers.length; i++, index++) {
                poke32(pollDescriptors + index * 8, servers[i]._fd);
                nodeWriteShort(pollDescriptors + index * 8 + 4, NodeNetConstants.POLLIN);
                handles.push({type: "server", value: servers[i]});
            }
            for (i = 0; i < clients.length; i++, index++) {
                var events = clients[i].requestDispatched ? 0 : NodeNetConstants.POLLIN;
                if (clients[i].outputPointer) events |= NodeNetConstants.POLLOUT;
                poke32(pollDescriptors + index * 8, clients[i].fd);
                nodeWriteShort(pollDescriptors + index * 8 + 4, events);
                handles.push({type: "client", value: clients[i]});
            }
            for (i = 0; i < sockets.length; i++, index++) {
                var socketEvents = sockets[i].connecting ? NodeNetConstants.POLLOUT :
                                   NodeNetConstants.POLLIN;
                if (!sockets[i].connecting && sockets[i]._output.length) {
                    socketEvents |= NodeNetConstants.POLLOUT;
                }
                poke32(pollDescriptors + index * 8, sockets[i].fd);
                nodeWriteShort(pollDescriptors + index * 8 + 4, socketEvents);
                handles.push({type: "socket", value: sockets[i]});
            }

            var ready = NodeLibc.poll(count ? pollDescriptors : 0, count, timeout);
            var pollError = ready < 0 ? NodeLibc.errno() : 0;
            if (ready > 0) {
                for (i = 0; i < handles.length && !NodeProcess.exiting; i++) {
                    var returned = nodeReadShort(pollDescriptors + i * 8 + 6);
                    var handle = handles[i].value;
                    if (handles[i].type === "server") {
                        if (returned & NodeNetConstants.POLLIN) this.acceptClients(handle);
                        if (returned & (NodeNetConstants.POLLERR | NodeNetConstants.POLLNVAL)) {
                            handle.emit("error", nodeSocketError("poll", 0));
                        }
                    } else if (handles[i].type === "client" && !handle.closed) {
                        if (returned & NodeNetConstants.POLLIN) this.readClient(handle);
                        if (!handle.closed && returned & NodeNetConstants.POLLOUT) {
                            this.writeClient(handle);
                        }
                        if (!handle.closed && returned &
                            (NodeNetConstants.POLLERR | NodeNetConstants.POLLHUP |
                             NodeNetConstants.POLLNVAL)) handle.close();
                    } else if (!handle.closed) {
                        if (handle.connecting && returned & NodeNetConstants.POLLOUT) {
                            this.finishSocketConnect(handle);
                        }
                        if (!handle.closed && !handle.connecting &&
                            returned & NodeNetConstants.POLLIN) this.readSocket(handle);
                        if (!handle.closed && !handle.connecting &&
                            returned & NodeNetConstants.POLLOUT) this.writeSocket(handle);
                        if (!handle.closed && returned &
                            (NodeNetConstants.POLLERR | NodeNetConstants.POLLHUP |
                             NodeNetConstants.POLLNVAL)) {
                            this.readSocket(handle);
                            if (!handle.closed) handle.destroy();
                        }
                    }
                }
            }
            NodeMemory.free(pollDescriptors);
            if (ready < 0 && pollError !== NodeNetConstants.EINTR) {
                NodeProcess.reportException(nodeSocketError("poll", pollError));
                NodeProcess.exitCode = 1;
                break;
            }
        }
        this.closeAll();
    }
};

var NodeNet = {
    createServer: function (connectionHandler) {
        return new NodeNetServer(connectionHandler);
    },
    createConnection: function (path) {
        return nodeCreateUnixConnection(path);
    }
};

/* ---- Inlined from node_compat/fs.js ---- */
/* Minimal synchronous and callback-based fs surface needed by node_web.js. */
var NodeFsConstants = {SEEK_SET: 0, SEEK_END: 2, ENOENT: 2, EACCES: 13};

function nodeFsError(operation, path, number) {
    var code = number === NodeFsConstants.ENOENT ? "ENOENT" :
               number === NodeFsConstants.EACCES ? "EACCES" : "E" + number;
    var error = new Error(code + ": " + operation + " '" + path + "'");
    error.errno = number;
    error.code = code;
    error.path = path;
    error.syscall = operation;
    return error;
}

function nodeFsCString(pointer) {
    var value = "";
    for (var i = 0; i < 4096; i++) {
        var code = peek8(pointer + i);
        if (code === 0) break;
        value += String.fromCharCode(code);
    }
    return value;
}

function NodeStats(directory, size) {
    this.size = size || 0;
    this._directory = directory;
}

NodeStats.prototype.isDirectory = function () { return this._directory; };
NodeStats.prototype.isFile = function () { return !this._directory; };

var NodeFs = {
    statSync: function (path) {
        path = String(path);
        var directory = NodeLibc.opendir(path);
        if (directory) {
            NodeLibc.closedir(directory);
            return new NodeStats(true, 0);
        }
        var file = NodeLibc.fopen(path, "rb");
        if (!file) throw nodeFsError("stat", path, NodeLibc.errno());
        var size = 0;
        if (NodeLibc.fseek(file, 0, NodeFsConstants.SEEK_END) === 0) {
            size = NodeLibc.ftell(file);
            if (size < 0) size = 0;
        }
        NodeLibc.fclose(file);
        return new NodeStats(false, size);
    },

    readdirSync: function (path) {
        path = String(path);
        var directory = NodeLibc.opendir(path);
        if (!directory) throw nodeFsError("readdir", path, NodeLibc.errno());
        var names = [];
        var entry;
        while ((entry = NodeLibc.readdir(directory)) !== 0) {
            /* Linux i386 struct dirent has d_name at byte offset 11. */
            var name = nodeFsCString(entry + 11);
            if (name !== "." && name !== "..") names.push(name);
        }
        NodeLibc.closedir(directory);
        return names;
    },

    readFileSync: function (path) {
        path = String(path);
        var file = NodeLibc.fopen(path, "rb");
        if (!file) throw nodeFsError("open", path, NodeLibc.errno());
        if (NodeLibc.fseek(file, 0, NodeFsConstants.SEEK_END) !== 0) {
            var seekError = nodeFsError("fseek", path, NodeLibc.errno());
            NodeLibc.fclose(file);
            throw seekError;
        }
        var length = NodeLibc.ftell(file);
        NodeLibc.fseek(file, 0, NodeFsConstants.SEEK_SET);
        if (length < 0) {
            var tellError = nodeFsError("ftell", path, NodeLibc.errno());
            NodeLibc.fclose(file);
            throw tellError;
        }
        var pointer = NodeMemory.allocate(length);
        var bytes = [];
        var remaining = length;
        while (remaining > 0) {
            var wanted = remaining > 65536 ? 65536 : remaining;
            var count = NodeLibc.fread(pointer, 1, wanted, file);
            if (count <= 0) break;
            for (var i = 0; i < count; i++) bytes.push(peek8(pointer + i));
            remaining -= count;
        }
        NodeMemory.free(pointer);
        NodeLibc.fclose(file);
        return new Buffer(bytes);
    },

    stat: function (path, callback) {
        NodeRuntime.enqueue(function () {
            var result;
            try { result = NodeFs.statSync(path); }
            catch (error) {
                callback(error);
                return;
            }
            callback(null, result);
        });
    },

    readdir: function (path, callback) {
        NodeRuntime.enqueue(function () {
            var result;
            try { result = NodeFs.readdirSync(path); }
            catch (error) {
                callback(error);
                return;
            }
            callback(null, result);
        });
    },

    readFile: function (path, callback) {
        NodeRuntime.enqueue(function () {
            var result;
            try { result = NodeFs.readFileSync(path); }
            catch (error) {
                callback(error);
                return;
            }
            callback(null, result);
        });
    }
};

/* ---- Inlined node_runner.js bootstrap ---- */
NodeProcess.install(Demo8RunnerArguments);

function demo8Main() {
/* ---- Inlined from node_x11.js ---- */
var x11 = (function () {
/*
 * Node.js 0.10-compatible framebuffer-window module using the core X11 wire
 * protocol and built-in modules only. Requiring this file has no side effects.
 */
var fs = NodeFs;
var net = NodeNet;

var nodeAnimationFrameDeadline = 0;
var requestNextAnimationFrame = typeof requestAnimationFrame === "function" ?
    requestAnimationFrame : function (callback) {
        var now = new Date().getTime();
        if (!nodeAnimationFrameDeadline || nodeAnimationFrameDeadline <= now) {
            nodeAnimationFrameDeadline = now + 1000 / 60;
        }
        var deadline = nodeAnimationFrameDeadline;
        nodeAnimationFrameDeadline += 1000 / 60;
        return setTimeout(function () {
            callback(new Date().getTime());
        }, Math.max(0, deadline - now));
    };

var WIDTH;
var HEIGHT;
var FRAME_DELAY;
var framesPerSecond;
var rgb;
var framebuffers;
var drawFramebufferIndex;
var pointerX;
var pointerY;
var socket = null;
var incoming;
var setupComplete;
var frameRequested;
var animationFramePending;
var animationFrameReady;
var rendering;
var uploadInProgress;
var nextFrameDeadline;
var closing;
var connection;
var windowOptions;
var windowApi;

function allocate(length) {
    if (Buffer.alloc) return Buffer.alloc(length);
    var buffer = new Buffer(length);
    for (var i = 0; i < length; i++) writeByte(buffer, i, 0);
    return buffer;
}

function readByte(buffer, offset) {
    return buffer._nodeBytes ? buffer._nodeBytes[offset] : buffer[offset];
}

function writeByte(buffer, offset, value) {
    if (buffer._nodeBytes) buffer._nodeBytes[offset] = value & 255;
    else buffer[offset] = value & 255;
}

function bufferFromString(value) {
    if (Buffer.from) return Buffer.from(value, "ascii");
    return new Buffer(value, "ascii");
}

function appendBuffer(left, right) {
    if (left.length === 0) return right;
    var result = allocate(left.length + right.length);
    left.copy(result, 0);
    right.copy(result, left.length);
    return result;
}

function padded4(length) {
    return (length + 3) & ~3;
}

function parseDisplay(value) {
    var match = /^([^:]*):([0-9]+)(?:\.([0-9]+))?$/.exec(value || "");
    if (!match) throw new Error("unsupported DISPLAY value: " + value);
    if (match[1] && match[1] !== "unix" && match[1] !== "localhost") {
        throw new Error("node_x11 requires a local Unix-domain X11 display");
    }
    return {
        display: match[2],
        screen: match[3] ? parseInt(match[3], 10) : 0,
        socketPath: "/tmp/.X11-unix/X" + match[2]
    };
}

function readAuthorityField(data, state) {
    if (state.offset + 2 > data.length) throw new Error("truncated Xauthority file");
    var length = data.readUInt16BE(state.offset);
    state.offset += 2;
    if (state.offset + length > data.length) throw new Error("truncated Xauthority field");
    var field = data.slice(state.offset, state.offset + length);
    state.offset += length;
    return field;
}

function loadAuthority(displayNumber) {
    var path = process.env.XAUTHORITY || process.env.HOME + "/.Xauthority";
    var data;
    try { data = fs.readFileSync(path); }
    catch (error) {
        console.error("warning: could not read " + path + "; trying unauthenticated X11");
        return {name: allocate(0), data: allocate(0)};
    }

    var state = {offset: 0};
    var selected = null;
    while (state.offset < data.length) {
        if (state.offset + 2 > data.length) break;
        var family = data.readUInt16BE(state.offset);
        state.offset += 2;
        var address = readAuthorityField(data, state);
        var number = readAuthorityField(data, state).toString("ascii");
        var name = readAuthorityField(data, state);
        var cookie = readAuthorityField(data, state);
        var protocol = name.toString("ascii");
        /* Some display managers store a wildcard entry with an empty number. */
        if ((number === displayNumber || number === "") &&
            protocol === "MIT-MAGIC-COOKIE-1" &&
            (family === 256 || family === 65535 || address.length === 0)) {
            selected = {name: name, data: cookie};
        }
    }
    if (!selected) {
        console.error("warning: no MIT-MAGIC-COOKIE-1 entry found; trying unauthenticated X11");
        return {name: allocate(0), data: allocate(0)};
    }
    return selected;
}

function makeSetupRequest(authority) {
    var nameLength = authority.name.length;
    var dataLength = authority.data.length;
    var request = allocate(12 + padded4(nameLength) + padded4(dataLength));
    writeByte(request, 0, 0x6c); /* little-endian byte order */
    request.writeUInt16LE(11, 2);
    request.writeUInt16LE(0, 4);
    request.writeUInt16LE(nameLength, 6);
    request.writeUInt16LE(dataLength, 8);
    authority.name.copy(request, 12);
    authority.data.copy(request, 12 + padded4(nameLength));
    return request;
}

function trailingZeros(mask) {
    var count = 0;
    while (count < 32 && ((mask >>> count) & 1) === 0) count++;
    return count;
}

function maskBits(mask, shift) {
    var count = 0;
    mask = mask >>> shift;
    while ((mask & 1) !== 0) {
        count++;
        mask = mask >>> 1;
    }
    return count;
}

function parseSetupReply(reply, screenNumber) {
    if (readByte(reply, 0) !== 1) {
        var reasonLength = readByte(reply, 1);
        throw new Error("X11 setup failed: " + reply.slice(8, 8 + reasonLength).toString("ascii"));
    }
    var body = 8;
    connection.resourceBase = reply.readUInt32LE(body + 4);
    connection.resourceMask = reply.readUInt32LE(body + 8);
    connection.resourceCounter = 1;
    connection.maxRequestLength = reply.readUInt16LE(body + 18) * 4;
    var screenCount = readByte(reply, body + 20);
    var formatCount = readByte(reply, body + 21);
    connection.imageByteOrder = readByte(reply, body + 22);
    connection.minimumKeycode = readByte(reply, body + 26);
    connection.maximumKeycode = readByte(reply, body + 27);
    var vendorLength = reply.readUInt16LE(body + 16);
    var offset = body + 32 + padded4(vendorLength);
    var formats = [];
    var i;
    for (i = 0; i < formatCount; i++) {
        formats.push({
            depth: readByte(reply, offset),
            bitsPerPixel: readByte(reply, offset + 1),
            scanlinePad: readByte(reply, offset + 2)
        });
        offset += 8;
    }
    if (screenNumber >= screenCount) throw new Error("DISPLAY requests an unavailable screen");

    for (i = 0; i < screenCount; i++) {
        var screenStart = offset;
        var depthCount = readByte(reply, screenStart + 39);
        var screen = {
            root: reply.readUInt32LE(screenStart),
            whitePixel: reply.readUInt32LE(screenStart + 8),
            blackPixel: reply.readUInt32LE(screenStart + 12),
            rootVisual: reply.readUInt32LE(screenStart + 32),
            rootDepth: readByte(reply, screenStart + 38)
        };
        offset = screenStart + 40;
        var selectedVisual = null;
        for (var depthIndex = 0; depthIndex < depthCount; depthIndex++) {
            var visualCount = reply.readUInt16LE(offset + 2);
            var visualOffset = offset + 8;
            for (var visualIndex = 0; visualIndex < visualCount; visualIndex++) {
                var visualId = reply.readUInt32LE(visualOffset);
                if (visualId === screen.rootVisual) {
                    selectedVisual = {
                        id: visualId,
                        redMask: reply.readUInt32LE(visualOffset + 8),
                        greenMask: reply.readUInt32LE(visualOffset + 12),
                        blueMask: reply.readUInt32LE(visualOffset + 16)
                    };
                }
                visualOffset += 24;
            }
            offset = visualOffset;
        }
        if (i === screenNumber) {
            connection.screen = screen;
            connection.visual = selectedVisual;
        }
    }

    if (!connection.visual) throw new Error("could not find the root visual");
    for (i = 0; i < formats.length; i++) {
        if (formats[i].depth === connection.screen.rootDepth) connection.format = formats[i];
    }
    if (!connection.format) throw new Error("could not find a pixmap format for the root depth");

    connection.redShift = trailingZeros(connection.visual.redMask);
    connection.greenShift = trailingZeros(connection.visual.greenMask);
    connection.blueShift = trailingZeros(connection.visual.blueMask);
    connection.redBits = maskBits(connection.visual.redMask, connection.redShift);
    connection.greenBits = maskBits(connection.visual.greenMask, connection.greenShift);
    connection.blueBits = maskBits(connection.visual.blueMask, connection.blueShift);
    connection.packedFramebuffer = connection.imageByteOrder === 0 &&
                                   connection.format.bitsPerPixel === 32 &&
                                   connection.format.scanlinePad === 32;
    connection.standardBgrx = connection.visual.redMask === 0x00ff0000 &&
                              connection.visual.greenMask === 0x0000ff00 &&
                              connection.visual.blueMask === 0x000000ff;
    if (connection.packedFramebuffer) {
        connection.redLookup = [];
        connection.greenLookup = [];
        connection.blueLookup = [];
        for (var channel = 0; channel < 256; channel++) {
            connection.redLookup.push(scaleChannel(channel, connection.redBits,
                                                   connection.redShift));
            connection.greenLookup.push(scaleChannel(channel, connection.greenBits,
                                                     connection.greenShift));
            connection.blueLookup.push(scaleChannel(channel, connection.blueBits,
                                                    connection.blueShift));
        }
    }
    var framebufferLength = WIDTH * HEIGHT * (connection.packedFramebuffer ? 4 : 3);
    framebuffers = [];
    for (var framebufferIndex = 0; framebufferIndex < 2; framebufferIndex++) {
        framebuffers.push(connection.packedFramebuffer &&
                          typeof Buffer.allocNative === "function" ?
                          Buffer.allocNative(framebufferLength) :
                          allocate(framebufferLength));
    }
    drawFramebufferIndex = 0;
    selectDrawFramebuffer();

    /* These fields become valid before the ready callback and first draw. */
    windowApi.pixelStride = WIDTH * (connection.packedFramebuffer ? 4 : 3);
    windowApi.pixelFormat = connection.packedFramebuffer && connection.standardBgrx ?
                            "bgrx32le" : "rgb24";
}

function selectDrawFramebuffer() {
    rgb = framebuffers[drawFramebufferIndex];
    windowApi.pixels = rgb;
    windowApi.pixelAddress = rgb._nodePointer || 0;
}

function resourceId() {
    var id = (connection.resourceBase |
             (connection.resourceCounter & connection.resourceMask)) >>> 0;
    connection.resourceCounter++;
    return id;
}

function sendRequest(request, callback) {
    if (request.length > connection.maxRequestLength) {
        throw new Error("X11 request exceeds the server maximum request size");
    }
    connection.sequence = (connection.sequence + 1) & 65535;
    socket.write(request, callback);
    return connection.sequence;
}

function sendRequestParts(header, payload, callback) {
    if (header.length + payload.length > connection.maxRequestLength) {
        throw new Error("X11 request exceeds the server maximum request size");
    }
    connection.sequence = (connection.sequence + 1) & 65535;
    socket.write(header);
    socket.write(payload, callback);
    return connection.sequence;
}

function createWindow() {
    connection.window = resourceId();
    connection.gc = resourceId();
    connection.backPixmap = resourceId();
    connection.sequence = 0;
    var eventMask = 1 | 2 | 4 | 8 | 64 | 32768 | 131072;

    var create = allocate(40);
    writeByte(create, 0, 1); /* CreateWindow */
    writeByte(create, 1, connection.screen.rootDepth);
    create.writeUInt16LE(10, 2);
    create.writeUInt32LE(connection.window, 4);
    create.writeUInt32LE(connection.screen.root, 8);
    create.writeInt16LE(80, 12);
    create.writeInt16LE(80, 14);
    create.writeUInt16LE(WIDTH, 16);
    create.writeUInt16LE(HEIGHT, 18);
    create.writeUInt16LE(0, 20);
    create.writeUInt16LE(1, 22); /* InputOutput */
    create.writeUInt32LE(connection.screen.rootVisual, 24);
    create.writeUInt32LE((1 << 1) | (1 << 11), 28); /* background + event mask */
    create.writeUInt32LE(connection.screen.blackPixel, 32);
    create.writeUInt32LE(eventMask, 36);
    sendRequest(create);

    var pixmap = allocate(16);
    writeByte(pixmap, 0, 53); /* CreatePixmap */
    writeByte(pixmap, 1, connection.screen.rootDepth);
    pixmap.writeUInt16LE(4, 2);
    pixmap.writeUInt32LE(connection.backPixmap, 4);
    pixmap.writeUInt32LE(connection.screen.root, 8);
    pixmap.writeUInt16LE(WIDTH, 12);
    pixmap.writeUInt16LE(HEIGHT, 14);
    sendRequest(pixmap);

    var gc = allocate(16);
    writeByte(gc, 0, 55); /* CreateGC */
    gc.writeUInt16LE(4, 2);
    gc.writeUInt32LE(connection.gc, 4);
    gc.writeUInt32LE(connection.window, 8);
    gc.writeUInt32LE(0, 12);
    sendRequest(gc);

    changeProperty(39, 31, bufferFromString(windowOptions.title || "node_x11 RGB framebuffer")); /* WM_NAME */
    changeProperty(67, 31, bufferFromString((windowOptions.instanceName || "node_x11") + "\0" + (windowOptions.className || "NodeX11") + "\0")); /* WM_CLASS */

    var map = allocate(8);
    writeByte(map, 0, 8); /* MapWindow */
    map.writeUInt16LE(2, 2);
    map.writeUInt32LE(connection.window, 4);
    sendRequest(map);
    queryKeyboardMapping();
}

function queryKeyboardMapping() {
    connection.keyboardMappingRequests = {};
    connection.keyboardMappings = {};
    connection.keyboardMappingReplies = 0;
    connection.keyboardMappingExpected = Math.ceil(
        (connection.maximumKeycode - connection.minimumKeycode + 1) / 100);
    for (var first = connection.minimumKeycode; first <= connection.maximumKeycode;
         first += 100) {
        var count = Math.min(100, connection.maximumKeycode - first + 1);
        queryKeyboardMappingRange(first, count);
    }
}

function queryKeyboardMappingRange(first, count) {
    var request = allocate(8);
    writeByte(request, 0, 101); /* GetKeyboardMapping */
    request.writeUInt16LE(2, 2);
    writeByte(request, 4, first);
    writeByte(request, 5, count);
    var sequence = sendRequest(request);
    connection.keyboardMappingRequests[sequence] = {first: first, count: count};
}

function parseKeyboardMapping(reply, mappingRequest) {
    var perKeycode = readByte(reply, 1);
    var offset = 32;
    for (var code = mappingRequest.first;
         code < mappingRequest.first + mappingRequest.count; code++) {
        var values = [];
        for (var slot = 0; slot < perKeycode; slot++) {
            values.push(reply.readUInt32LE(offset));
            offset += 4;
        }
        connection.keyboardMappings[code] = values;
    }
    connection.keysymsPerKeycode = perKeycode;
    connection.keyboardMappingReplies++;
    if (connection.keyboardMappingReplies === connection.keyboardMappingExpected) {
        if (typeof windowOptions.keyboardMapping === "function") {
            windowOptions.keyboardMapping({
                minimumKeycode: connection.minimumKeycode,
                maximumKeycode: connection.maximumKeycode,
                keysymsPerKeycode: perKeycode
            }, windowApi);
        }
    }
}

function changeProperty(property, type, data) {
    var request = allocate(24 + padded4(data.length));
    writeByte(request, 0, 18); /* ChangeProperty */
    writeByte(request, 1, 0);  /* Replace */
    request.writeUInt16LE(request.length / 4, 2);
    request.writeUInt32LE(connection.window, 4);
    request.writeUInt32LE(property, 8);
    request.writeUInt32LE(type, 12);
    writeByte(request, 16, 8);
    request.writeUInt32LE(data.length, 20);
    data.copy(request, 24);
    sendRequest(request);
}

function drawPixel(x, y, red, green, blue) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    if (connection.packedFramebuffer) {
        var pixel = connection.standardBgrx ? (red << 16) | (green << 8) | blue :
                    connection.redLookup[red] | connection.greenLookup[green] |
                    connection.blueLookup[blue];
        rgb.writeUInt32LE(pixel, (y * WIDTH + x) * 4);
        return;
    }
    var offset = (y * WIDTH + x) * 3;
    writeByte(rgb, offset, red);
    writeByte(rgb, offset + 1, green);
    writeByte(rgb, offset + 2, blue);
}


function renderFramebuffer(animationTime) {
    animationFramePending = false;
    if (closing || !frameRequested) return;
    if (nextFrameDeadline && animationTime < nextFrameDeadline) {
        queueAnimationFrame();
        return;
    }
    if (uploadInProgress || rendering) {
        animationFrameReady = true;
        return;
    }
    animationFrameReady = false;
    frameRequested = false;
    rendering = true;
    if (!nextFrameDeadline) nextFrameDeadline = animationTime;
    do {
        nextFrameDeadline += FRAME_DELAY;
    } while (nextFrameDeadline <= animationTime);
    selectDrawFramebuffer();
    if (typeof windowOptions.draw === "function") {
        windowOptions.draw(windowApi);
    }
    rendering = false;
    uploadInProgress = true;
    uploadFramebuffer(function () {
        uploadInProgress = false;
        drawFramebufferIndex = 1 - drawFramebufferIndex;
        if (frameRequested && animationFrameReady) {
            animationFrameReady = false;
            renderFramebuffer(new Date().getTime());
        } else if (frameRequested) {
            queueAnimationFrame();
        }
    });
}

function scaleChannel(value, bits, shift) {
    var maximum = bits >= 31 ? 0x7fffffff : Math.pow(2, bits) - 1;
    return (((value * maximum / 255) | 0) << shift) >>> 0;
}

function uploadFramebuffer(completion) {
    var bitsPerPixel = connection.format.bitsPerPixel;
    var bytesPerPixel = Math.ceil(bitsPerPixel / 8);
    var padBytes = connection.format.scanlinePad / 8;
    var rowBytes = Math.ceil((WIDTH * bytesPerPixel) / padBytes) * padBytes;
    var rowsPerRequest = Math.floor((connection.maxRequestLength - 24) / rowBytes);
    while (rowsPerRequest > 0 &&
           24 + padded4(rowBytes * rowsPerRequest) > connection.maxRequestLength) {
        rowsPerRequest--;
    }
    if (rowsPerRequest < 1) throw new Error("framebuffer row exceeds the X11 request limit");

    for (var firstRow = 0; firstRow < HEIGHT; firstRow += rowsPerRequest) {
        var bandHeight = Math.min(rowsPerRequest, HEIGHT - firstRow);
        if (connection.packedFramebuffer) {
            var firstByte = firstRow * rowBytes;
            var packedImage = rgb.slice(firstByte, firstByte + rowBytes * bandHeight);
            var packedRequest = makePutImageRequest(bandHeight, firstRow, packedImage.length);
            sendRequestParts(packedRequest, packedImage);
            continue;
        }
        var image = allocate(rowBytes * bandHeight);
        for (var bandY = 0; bandY < bandHeight; bandY++) {
            var y = firstRow + bandY;
            for (var x = 0; x < WIDTH; x++) {
                var rgbOffset = (y * WIDTH + x) * 3;
                var pixel = (scaleChannel(readByte(rgb, rgbOffset), connection.redBits, connection.redShift) |
                             scaleChannel(readByte(rgb, rgbOffset + 1), connection.greenBits, connection.greenShift) |
                             scaleChannel(readByte(rgb, rgbOffset + 2), connection.blueBits, connection.blueShift)) >>> 0;
                var imageOffset = bandY * rowBytes + x * bytesPerPixel;
                for (var byteIndex = 0; byteIndex < bytesPerPixel; byteIndex++) {
                    var shift = connection.imageByteOrder === 0 ? byteIndex * 8 :
                                (bytesPerPixel - byteIndex - 1) * 8;
                    writeByte(image, imageOffset + byteIndex, (pixel >>> shift) & 255);
                }
            }
        }

        var request = makePutImageRequest(bandHeight, firstRow, image.length);
        image.copy(request, 24);
        sendRequest(request);
    }
    copyBackBufferToWindow(completion);
}

function copyBackBufferToWindow(completion) {
    var request = allocate(28);
    writeByte(request, 0, 62); /* CopyArea */
    request.writeUInt16LE(7, 2);
    request.writeUInt32LE(connection.backPixmap, 4);
    request.writeUInt32LE(connection.window, 8);
    request.writeUInt32LE(connection.gc, 12);
    request.writeInt16LE(0, 16);
    request.writeInt16LE(0, 18);
    request.writeInt16LE(0, 20);
    request.writeInt16LE(0, 22);
    request.writeUInt16LE(WIDTH, 24);
    request.writeUInt16LE(HEIGHT, 26);
    sendRequest(request, completion);
}

function makePutImageRequest(bandHeight, firstRow, imageLength) {
    var requestLength = connection.packedFramebuffer ? 24 : 24 + padded4(imageLength);
    var request = allocate(requestLength);
    writeByte(request, 0, 72); /* PutImage */
    writeByte(request, 1, 2);  /* ZPixmap */
    request.writeUInt16LE((24 + padded4(imageLength)) / 4, 2);
    request.writeUInt32LE(connection.backPixmap, 4);
    request.writeUInt32LE(connection.gc, 8);
    request.writeUInt16LE(WIDTH, 12);
    request.writeUInt16LE(bandHeight, 14);
    request.writeInt16LE(0, 16);
    request.writeInt16LE(firstRow, 18);
    writeByte(request, 20, 0);
    writeByte(request, 21, connection.screen.rootDepth);
    return request;
}

function queueAnimationFrame() {
    if (animationFramePending || animationFrameReady || closing || !frameRequested) return;
    animationFramePending = true;
    requestNextAnimationFrame(renderFramebuffer);
}

function scheduleRedraw() {
    if (closing) return;
    frameRequested = true;
    queueAnimationFrame();
}

function updatePointerFromEvent(event) {
    pointerX = event.readInt16LE(24);
    pointerY = event.readInt16LE(26);
    if (pointerX < 0) pointerX = 0;
    if (pointerY < 0) pointerY = 0;
    if (pointerX >= WIDTH) pointerX = WIDTH - 1;
    if (pointerY >= HEIGHT) pointerY = HEIGHT - 1;
}

function keysymForEvent(event) {
    if (!connection.keyboardMappings || !connection.keysymsPerKeycode) return 0;
    var keycode = readByte(event, 1);
    var state = event.readUInt16LE(28);
    var mappings = connection.keyboardMappings[keycode];
    if (!mappings) return 0;
    var shifted = (state & 1) !== 0;
    var keysym = mappings[shifted ? 1 : 0] || mappings[0];
    if ((state & 2) !== 0 && keysym >= 65 && keysym <= 90) keysym += 32;
    else if ((state & 2) !== 0 && keysym >= 97 && keysym <= 122) keysym -= 32;
    return keysym;
}


function eventPosition(event) {
    updatePointerFromEvent(event);
    return {x: pointerX, y: pointerY};
}

function reportError(error) {
    if (typeof windowOptions.error === "function") windowOptions.error(error);
    else console.error(error.message || String(error));
}

function handleEvent(event) {
    var type = readByte(event, 0) & 127;
    if (type === 0) {
        var protocolError = new Error("X11 protocol error code " + readByte(event, 1) +
                                      " on request opcode " + readByte(event, 10));
        protocolError.code = readByte(event, 1);
        protocolError.opcode = readByte(event, 10);
        reportError(protocolError);
    } else if (type === 2 || type === 3) { /* KeyPress / KeyRelease */
        var keyEvent = {
            keycode: readByte(event, 1),
            keysym: keysymForEvent(event),
            state: event.readUInt16LE(28)
        };
        var keyHandler = type === 2 ? windowOptions.keyPress :
                                     windowOptions.keyRelease;
        if (typeof keyHandler === "function") {
            keyHandler(keyEvent, windowApi);
        }
        scheduleRedraw();
    } else if (type === 4 || type === 5) { /* ButtonPress / ButtonRelease */
        var position = eventPosition(event);
        var buttonEvent = {
            button: readByte(event, 1),
            state: event.readUInt16LE(28),
            x: position.x,
            y: position.y
        };
        var buttonHandler = type === 4 ? windowOptions.buttonPress :
                                             windowOptions.buttonRelease;
        if (typeof buttonHandler === "function") buttonHandler(buttonEvent, windowApi);
        scheduleRedraw();
    } else if (type === 6) { /* MotionNotify */
        var motionPosition = eventPosition(event);
        if (typeof windowOptions.pointerMove === "function") {
            windowOptions.pointerMove({
                state: event.readUInt16LE(28),
                x: motionPosition.x,
                y: motionPosition.y
            }, windowApi);
        }
        scheduleRedraw();
    } else if (type === 12) { /* Expose */
        if (typeof windowOptions.expose === "function") windowOptions.expose(windowApi);
        scheduleRedraw();
    } else if (type === 17) { /* DestroyNotify */
        closing = true;
        socket.end();
    }
}

function processIncoming() {
    if (!setupComplete) {
        if (incoming.length < 8) return;
        var setupLength = 8 + incoming.readUInt16LE(6) * 4;
        if (incoming.length < setupLength) return;
        var setup = incoming.slice(0, setupLength);
        incoming = incoming.slice(setupLength);
        parseSetupReply(setup, connection.display.screen);
        setupComplete = true;
        createWindow();
        var info = {
            width: WIDTH,
            height: HEIGHT,
            depth: connection.screen.rootDepth,
            bitsPerPixel: connection.format.bitsPerPixel,
            framesPerSecond: framesPerSecond,
            packedFramebuffer: connection.packedFramebuffer,
            windowId: connection.window
        };
        if (typeof windowOptions.ready === "function") {
            windowOptions.ready(info, windowApi);
        }
        scheduleRedraw();
    }

    while (incoming.length >= 32) {
        var type = readByte(incoming, 0) & 127;
        var eventLength = 32;
        if (type === 1 || type === 35) eventLength += incoming.readUInt32LE(4) * 4;
        if (incoming.length < eventLength) return;
        var event = incoming.slice(0, eventLength);
        incoming = incoming.slice(eventLength);
        var replySequence = event.readUInt16LE(2);
        var mappingRequest = connection.keyboardMappingRequests &&
                             connection.keyboardMappingRequests[replySequence];
        if (type === 1 && mappingRequest) {
            parseKeyboardMapping(event, mappingRequest);
            delete connection.keyboardMappingRequests[replySequence];
        } else {
            handleEvent(event);
        }
    }
}

function createFramebufferWindow(options) {
    options = options || {};
    if (socket) throw new Error("node_x11 currently supports one window per process");

    WIDTH = options.width === undefined ? 256 : Number(options.width);
    HEIGHT = options.height === undefined ? 192 : Number(options.height);
    framesPerSecond = options.fps === undefined ? 20 : Number(options.fps);
    if (!(framesPerSecond >= 1 && framesPerSecond <= 120)) {
        throw new Error("fps must be between 1 and 120");
    }
    if (!(WIDTH >= 64 && WIDTH <= 1024) || !(HEIGHT >= 64 && HEIGHT <= 1024) ||
        Math.floor(WIDTH) !== WIDTH || Math.floor(HEIGHT) !== HEIGHT ||
        WIDTH * HEIGHT > 1048576) {
        throw new Error("framebuffer dimensions must be integers in 64..1024 and at most 1048576 pixels");
    }

    FRAME_DELAY = 1000 / framesPerSecond;
    rgb = null;
    pointerX = Math.floor(WIDTH / 2);
    pointerY = Math.floor(HEIGHT / 2);
    incoming = allocate(0);
    setupComplete = false;
    frameRequested = false;
    animationFramePending = false;
    animationFrameReady = false;
    rendering = false;
    uploadInProgress = false;
    nextFrameDeadline = 0;
    closing = false;
    connection = {};
    windowOptions = options;
    connection.display = parseDisplay(options.display || process.env.DISPLAY || ":0");

    windowApi = {
        width: WIDTH,
        height: HEIGHT,
        fps: framesPerSecond,
        pixels: null,
        pixelAddress: 0,
        pixelStride: 0,
        pixelFormat: null,
        setPixel: drawPixel,
        requestFrame: scheduleRedraw,
        close: function () {
            closing = true;
            if (socket) socket.end();
        },
        pointer: function () {
            return {x: pointerX, y: pointerY};
        }
    };

    var authority = loadAuthority(connection.display.display);
    socket = net.createConnection(connection.display.socketPath);
    socket.on("connect", function () {
        socket.write(makeSetupRequest(authority));
    });
    socket.on("data", function (data) {
        incoming = appendBuffer(incoming, data);
        processIncoming();
    });
    socket.on("error", function (error) {
        reportError(new Error("X11 connection error: " + error.message));
    });
    socket.on("close", function () {
        if (typeof windowOptions.close === "function") windowOptions.close(windowApi);
        socket = null;
    });
    return windowApi;
}

return {
    createFramebufferWindow: createFramebufferWindow,
    keysyms: {
        escape: 0xff1b,
        backspace: 0xff08,
        returnKey: 0xff0d,
        left: 0xff51,
        up: 0xff52,
        right: 0xff53,
        down: 0xff54,
        f1: 0xffbe
    }
};
}());

/* ---- Inlined from demo_common.js ---- */
var common = (function (x11) {
/*
 * Shared helpers for framebuffer demos. Requires the reusable X11 module but
 * has no side effects until createWindow is called.
 */
/* x11 is the inlined module above. */

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

return {
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
}(x11));

/* ---- Inlined from demo7.js ---- */
(function (common) {
/*
 * Optimized general-purpose software rasterizer running the same original
 * Welsh-inspired rally stage as demo6. Pixel storage uses native packed
 * 32-bit access in MMVM and the equivalent Buffer operations in Node.js.
 */
/* common is the inlined module above. */

var options = common.parseOptions(process.argv, "demo8.js");
var TRACK_POINTS = 96;
var ROAD_HALF_WIDTH = 3.7;
var WALL_OFFSET = 5.15;
var RACE_LAPS = 3;
var track;
var terrainCells;
var roadSections;
var depthBuffer;
var solidColorRows = {};
var lastSolidColor = -1;
var lastSolidRow = null;
var background;
var controls = {left: false, right: false, throttle: false, brake: false};
var player;
var competitors;
var lastFrameTime = 0;
var camera;
var raceFinished = false;
var rollingMode = true;
var projectedVertexPool = [];
var projectedVertexCount = 0;
var gameReady = false;
var loadingFrames = 0;
var initializationStarted = false;
var windowInfo = null;
var frameRateCounter = options.fpsCounter !== false || options.debugEvents !== false ?
                       new common.FrameRateCounter(options.fpsCounter !== false,
                                                   options.debugEvents !== false) : null;

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

function solidColorRow(packed) {
    packed = packed >>> 0;
    if (packed === lastSolidColor) return lastSolidRow;
    var key = String(packed);
    var row = solidColorRows[key];
    if (!row) {
        row = allocatePacked(options.width * 4);
        for (var offset = 0; offset < row.length; offset += 4) {
            pokePacked32(row, offset, packed);
        }
        solidColorRows[key] = row;
    }
    lastSolidColor = packed;
    lastSolidRow = row;
    return row;
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
    if (pixelAddress) {
        return rasterRowsNative(framebuffer, firstY, lastY,
                                firstX, firstZ, firstXStep, firstZStep,
                                secondX, secondZ, secondXStep, secondZStep,
                                packed);
    }
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
                pixels.writeUInt32LE(packed >>> 0, pixelOffset);
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

function rasterRowsNative(framebuffer, firstY, lastY,
                          firstX, firstZ, firstXStep, firstZStep,
                          secondX, secondZ, secondXStep, secondZStep, packed) {
    var pixelAddress = framebuffer.pixelAddress;
    var colorRow = solidColorRow(packed);
    var memmove = NodeLibc.memmove;
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
        var runStartOffset = -1;
        for (var nativeX = minimumX; nativeX < maximumX; nativeX++) {
            if (inverseZ > depthBuffer[pixelIndex]) {
                if (runStartOffset < 0) runStartOffset = pixelOffset;
                depthBuffer[pixelIndex] = inverseZ;
            } else if (runStartOffset >= 0) {
                memmove(pixelAddress + runStartOffset, colorRow._nodePointer,
                        pixelOffset - runStartOffset);
                runStartOffset = -1;
            }
            inverseZ += depthStep;
            pixelIndex++;
            pixelOffset += 4;
        }
        if (runStartOffset >= 0) {
            memmove(pixelAddress + runStartOffset, colorRow._nodePointer,
                    pixelOffset - runStartOffset);
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

function addRoadBand(section, first, second, left, right, height, color) {
    addRoadQuad(section, roadEdge(first, left, height),
                roadEdge(second, left, height),
                roadEdge(second, right, height),
                roadEdge(first, right, height), color);
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
        addRoadBand(section, first, second, -4.45, -ROAD_HALF_WIDTH,
                    -0.05, shoulderColor);
        addRoadBand(section, first, second, ROAD_HALF_WIDTH, 4.45,
                    -0.05, shoulderColor);
        addRoadBand(section, first, second, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH,
                    0, roadColor);
        var rutColor = (i & 3) ? 0x5d4b37 : 0x68523a;
        addRoadBand(section, first, second, -1.38, -0.82, 0.018, rutColor);
        addRoadBand(section, first, second, 0.82, 1.38, 0.018, rutColor);
        if ((i % 5) === 2) {
            addRoadBand(section, first, second, -0.38, 0.42, 0.022,
                        0x765d40);
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
}

function initializeGame() {
    track = makeTrack();
    terrainCells = makeTerrainCells();
    roadSections = makeRoadSections();
    depthBuffer = new Array(options.width * options.height);
    solidColorRows = {};
    lastSolidColor = -1;
    lastSolidRow = null;
    background = makeBackground(options.width, options.height);
    resetRace();
    gameReady = true;
    reportGameReady();
}

function draw(framebuffer) {
    if (framebuffer.pixelFormat !== "bgrx32le") {
        throw new Error("demo7 requires a little-endian BGRX 32-bit X11 framebuffer");
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
    for (var depthIndex = 0; depthIndex < depthBuffer.length; depthIndex++) {
        depthBuffer[depthIndex] = 0;
    }
    background.copy(framebuffer.pixels, 0, 0, background.length);
    if (framebuffer.pixelAddress) {
        /* Native writes are relatively expensive, so prime depth with the
         * player and foreground road; hidden surfaces then fail without a
         * poke32. */
        drawCar(framebuffer, player.x, player.y, player.z, player.heading,
                0xd94a32, true);
        drawRoad(framebuffer);
        drawHillsides(framebuffer);
    } else {
        /* V8's Buffer writes favor the original coherent background-to-front
         * traversal; depth still makes the two orders visually identical. */
        drawHillsides(framebuffer);
        drawRoad(framebuffer);
    }
    drawScenery(framebuffer);
    for (var i = 0; i < competitors.length; i++) {
        var ai = competitors[i];
        drawCar(framebuffer, ai.sample.x, ai.sample.y + 0.10, ai.sample.z,
                ai.sample.heading, ai.color, false);
    }
    if (!framebuffer.pixelAddress) {
        drawCar(framebuffer, player.x, player.y, player.z, player.heading,
                0xd94a32, true);
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
        if (options.debugEvents) console.log("X11 connection closed");
    }
});
}(common));
}

try {
    demo8Main();
} catch (Demo8TopLevelError) {
    if (!NodeProcess.isExit(Demo8TopLevelError)) {
        NodeProcess.reportException(Demo8TopLevelError);
        NodeProcess.exitCode = 1;
    }
}

if (!NodeProcess.exiting) {
    NodeRuntime.run();
}
quit(NodeProcess.exitCode);
