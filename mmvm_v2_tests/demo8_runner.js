/*
 * Standalone MMVM demo host.
 *
 * This runner owns the old-shell, libc, event-loop, X11, and common demo
 * boundary. Applications register one entry function through DemoRunner.define.
 */

var Demo8RunnerArguments = [];
for (var Demo8ArgumentIndex = 0;
         Demo8ArgumentIndex < arguments.length;
         Demo8ArgumentIndex++) {
    Demo8RunnerArguments.push(arguments[Demo8ArgumentIndex]);
}

if (!Demo8RunnerArguments.length) {
    print("usage: js_min.exe demo8_runner.js application.js [arguments]");
    quit(2);
}

var Demo8RunnerTarget = Demo8RunnerArguments[0];
var Demo8RunnerApplication = null;
var DemoRunner = null;

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
    memset: nodeResolveSymbol("memset"),
    mmap: nodeResolveSymbol("mmap"),
    mprotect: nodeResolveSymbol("mprotect"),
    munmap: nodeResolveSymbol("munmap"),
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
    memset: function (destination, value, length) {
        return ffi_call(NodeLibcSymbols.memset, destination, value, length);
    },
    mmap: function (address, length, protection, flags, fd, offset) {
        return ffi_call(NodeLibcSymbols.mmap, address, length, protection,
                        flags, fd, offset);
    },
    mprotect: function (address, length, protection) {
        return ffi_call(NodeLibcSymbols.mprotect, address, length, protection);
    },
    munmap: function (address, length) {
        return ffi_call(NodeLibcSymbols.munmap, address, length);
    },
    call8: function (pointer, a1, a2, a3, a4, a5, a6, a7, a8) {
        return ffi_call(pointer, a1, a2, a3, a4, a5, a6, a7, a8);
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

NodeProcess.install(Demo8RunnerArguments);

function demo8RunnerMain() {
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
var FRAME_DEADLINE_TOLERANCE;
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
    /* requestAnimationFrame is a roughly 60 Hz clock.  Permit a callback just
     * ahead of the application deadline to render now rather than missing the
     * deadline and waiting another complete animation-frame interval. */
    if (nextFrameDeadline &&
        animationTime + FRAME_DEADLINE_TOLERANCE < nextFrameDeadline) {
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
    FRAME_DEADLINE_TOLERANCE = Math.min(2, FRAME_DELAY / 8);
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
        f1: 0xffbe,
        f2: 0xffbf
    }
};
}());

/* ---- Inlined from demo_common.js ---- */
var common = (function (x11) {
/*
 * Shared helpers for framebuffer demos. Requires the reusable X11 module but
 * has no side effects until createWindow is called.
 */
/* x11 is supplied by the runner. */

var FONT_SCALE = 2;
var FONT_WIDTH = 5;
var FONT_HEIGHT = 7;
var GLYPH_ADVANCE = (FONT_WIDTH + 1) * FONT_SCALE;
var LINE_ADVANCE = (FONT_HEIGHT + 1) * FONT_SCALE;

function usage(programName) {
    return "usage: js_min.exe demo8_runner.js " + programName +
           " [--fps FRAMES] [--size WIDTHxHEIGHT]\n" +
           "  --fps FRAMES     redraw limit in frames per second (default: 20)\n" +
           "  --size WxH        framebuffer resolution (default: 256x192)\n" +
           "  --width PIXELS    framebuffer width\n" +
           "  --height PIXELS   framebuffer height\n" +
           "  --fps-counter     show the on-screen frame rate (default)\n" +
           "  --no-fps-counter  hide the on-screen frame rate\n" +
           "  --debug-events    log input events and frame rate (default)\n" +
           "  --no-debug-events disable debug event and frame-rate logging\n" +
           "  --dump-native-assembly\n" +
           "                     print the first source-compiled macro program";
}

function parseOptions(argv, programName) {
    var options = {
        width: 256,
        height: 192,
        fps: 20,
        fpsCounter: true,
        debugEvents: true,
        dumpNativeAssembly: false
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
        } else if (option === "--dump-native-assembly") {
            options.dumpNativeAssembly = true;
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
        lineAdvance: LINE_ADVANCE,
        glyphRows: glyphRows
    }
};
}(x11));

function X86Assembler() {
    this.bytes = [];
    this.labels = {};
    this.fixups = [];
}

X86Assembler.registers = {
    eax: 0, ecx: 1, edx: 2, ebx: 3,
    esp: 4, ebp: 5, esi: 6, edi: 7
};

X86Assembler.prototype.register = function (name) {
    var number = X86Assembler.registers[name];
    if (typeof number !== "number") throw new Error("unknown x86 register: " + name);
    return number;
};

X86Assembler.prototype.emit = function () {
    for (var index = 0; index < arguments.length; index++) {
        this.bytes.push(arguments[index] & 255);
    }
};

X86Assembler.prototype.emit32 = function (value) {
    this.emit(value, value >>> 8, value >>> 16, value >>> 24);
};

X86Assembler.prototype.modRM = function (mode, register, operand) {
    this.emit((mode << 6) | (register << 3) | operand);
};

X86Assembler.prototype.memory = function (opcode, register, base, displacement) {
    base = this.register(base);
    displacement = displacement || 0;
    if (displacement === 0 && base !== 5) {
        this.emit(opcode);
        this.modRM(0, register, base);
        if (base === 4) this.emit(0x24);
    } else if (displacement >= -128 && displacement <= 127) {
        this.emit(opcode);
        this.modRM(1, register, base);
        if (base === 4) this.emit(0x24);
        this.emit(displacement);
    } else {
        this.emit(opcode);
        this.modRM(2, register, base);
        if (base === 4) this.emit(0x24);
        this.emit32(displacement);
    }
};

X86Assembler.prototype.push = function (register) {
    this.emit(0x50 + this.register(register));
};
X86Assembler.prototype.pop = function (register) {
    this.emit(0x58 + this.register(register));
};
X86Assembler.prototype.moveRegister = function (destination, source) {
    this.emit(0x89);
    this.modRM(3, this.register(source), this.register(destination));
};
X86Assembler.prototype.moveImmediate = function (destination, value) {
    this.emit(0xb8 + this.register(destination));
    this.emit32(value);
};
X86Assembler.prototype.moveMemoryToRegister = function (destination, base, displacement) {
    this.memory(0x8b, this.register(destination), base, displacement);
};
X86Assembler.prototype.moveRegisterToMemory = function (base, displacement, source) {
    this.memory(0x89, this.register(source), base, displacement);
};
X86Assembler.prototype.moveArgument = function (destination, argumentIndex) {
    this.moveMemoryToRegister(destination, "ebp", 8 + argumentIndex * 4);
};
X86Assembler.prototype.moveLocalToRegister = function (destination, byteOffset) {
    this.moveMemoryToRegister(destination, "ebp", -byteOffset);
};
X86Assembler.prototype.moveRegisterToLocal = function (byteOffset, source) {
    this.moveRegisterToMemory("ebp", -byteOffset, source);
};
X86Assembler.prototype.moveMemoryIndexedToRegister = function (destination, base, index,
                                                                 scale, displacement) {
    var scaleBits = scale === 1 ? 0 : scale === 2 ? 1 : scale === 4 ? 2 :
                    scale === 8 ? 3 : -1;
    if (scaleBits < 0) throw new Error("invalid x86 index scale: " + scale);
    displacement = displacement || 0;
    this.emit(0x8b);
    this.modRM(displacement ? 1 : 0, this.register(destination), 4);
    this.emit((scaleBits << 6) | (this.register(index) << 3) |
              this.register(base));
    if (displacement) this.emit(displacement);
};
X86Assembler.prototype.moveRegisterToMemoryIndexed = function (base, index, scale,
                                                                 displacement, source) {
    var scaleBits = scale === 1 ? 0 : scale === 2 ? 1 : scale === 4 ? 2 :
                    scale === 8 ? 3 : -1;
    if (scaleBits < 0) throw new Error("invalid x86 index scale: " + scale);
    displacement = displacement || 0;
    this.emit(0x89);
    this.modRM(displacement ? 1 : 0, this.register(source), 4);
    this.emit((scaleBits << 6) | (this.register(index) << 3) |
              this.register(base));
    if (displacement) this.emit(displacement);
};
X86Assembler.prototype.loadIndexedAddress = function (destination, base, index, scale) {
    var scaleBits = scale === 1 ? 0 : scale === 2 ? 1 : scale === 4 ? 2 :
                    scale === 8 ? 3 : -1;
    if (scaleBits < 0) throw new Error("invalid x86 index scale: " + scale);
    this.emit(0x8d);
    this.modRM(0, this.register(destination), 4);
    this.emit((scaleBits << 6) | (this.register(index) << 3) |
              this.register(base));
};
X86Assembler.prototype.binaryRegisters = function (opcode, destination, source) {
    this.emit(opcode);
    this.modRM(3, this.register(source), this.register(destination));
};
X86Assembler.prototype.addRegisters = function (destination, source) {
    this.binaryRegisters(0x01, destination, source);
};
X86Assembler.prototype.subtractRegisters = function (destination, source) {
    this.binaryRegisters(0x29, destination, source);
};
X86Assembler.prototype.andRegisters = function (destination, source) {
    this.binaryRegisters(0x21, destination, source);
};
X86Assembler.prototype.orRegisters = function (destination, source) {
    this.binaryRegisters(0x09, destination, source);
};
X86Assembler.prototype.xorRegisters = function (destination, source) {
    this.binaryRegisters(0x31, destination, source);
};
X86Assembler.prototype.multiplyRegisters = function (destination, source) {
    this.emit(0x0f, 0xaf);
    this.modRM(3, this.register(destination), this.register(source));
};
X86Assembler.prototype.compareRegisters = function (left, right) {
    this.binaryRegisters(0x39, left, right);
};
X86Assembler.prototype.testRegisters = function (left, right) {
    this.binaryRegisters(0x85, left, right);
};
X86Assembler.prototype.addMemoryToRegister = function (destination, base, displacement) {
    this.memory(0x03, this.register(destination), base, displacement);
};
X86Assembler.prototype.subtractMemoryFromRegister = function (destination, base,
                                                               displacement) {
    this.memory(0x2b, this.register(destination), base, displacement);
};
X86Assembler.prototype.compareRegisterWithMemory = function (left, base, displacement) {
    this.memory(0x3b, this.register(left), base, displacement);
};
X86Assembler.prototype.imulImmediate = function (register, value) {
    var number = this.register(register);
    this.emit(0x69);
    this.modRM(3, number, number);
    this.emit32(value);
};
X86Assembler.prototype.immediateOperation = function (operation, register, value) {
    this.emit(0x81);
    this.modRM(3, operation, this.register(register));
    this.emit32(value);
};
X86Assembler.prototype.addImmediate = function (register, value) {
    this.immediateOperation(0, register, value);
};
X86Assembler.prototype.subtractImmediate = function (register, value) {
    this.immediateOperation(5, register, value);
};
X86Assembler.prototype.compareImmediate = function (register, value) {
    this.immediateOperation(7, register, value);
};
X86Assembler.prototype.shift = function (operation, register, bits) {
    var groups = {left: 4, right: 5, arithmeticRight: 7};
    if (typeof groups[operation] !== "number") {
        throw new Error("unknown x86 shift: " + operation);
    }
    this.emit(0xc1);
    this.modRM(3, groups[operation], this.register(register));
    this.emit(bits);
};
X86Assembler.prototype.moveZeroExtended16 = function (destination, source) {
    this.emit(0x0f, 0xb7);
    this.modRM(3, this.register(destination), this.register(source));
};
X86Assembler.prototype.moveSignExtended16 = function (destination, source) {
    this.emit(0x0f, 0xbf);
    this.modRM(3, this.register(destination), this.register(source));
};
X86Assembler.prototype.exchangeRegisters = function (first, second) {
    this.emit(0x87);
    this.modRM(3, this.register(second), this.register(first));
};
X86Assembler.prototype.signExtendEax = function () { this.emit(0x99); };
X86Assembler.prototype.divideSignedBy = function (register) {
    this.emit(0xf7);
    this.modRM(3, 7, this.register(register));
};
X86Assembler.prototype.negate = function (register) {
    this.emit(0xf7);
    this.modRM(3, 3, this.register(register));
};
X86Assembler.prototype.bitwiseNot = function (register) {
    this.emit(0xf7);
    this.modRM(3, 2, this.register(register));
};
X86Assembler.prototype.decrement = function (register) {
    this.emit(0x48 + this.register(register));
};
X86Assembler.prototype.incrementLocal = function (byteOffset) {
    this.emit(0xff);
    this.modRM(1, 0, this.register("ebp"));
    this.emit(-byteOffset);
};
X86Assembler.prototype.label = function (name) {
    if (typeof this.labels[name] === "number") throw new Error("duplicate x86 label: " + name);
    this.labels[name] = this.bytes.length;
};
X86Assembler.prototype.jump = function (condition, label) {
    var conditions = {equal: 0x84, notEqual: 0x85, less: 0x8c,
                      greaterOrEqual: 0x8d, lessOrEqual: 0x8e,
                      greater: 0x8f};
    if (condition === "always") this.emit(0xe9);
    else {
        if (typeof conditions[condition] !== "number") {
            throw new Error("unknown x86 jump condition: " + condition);
        }
        this.emit(0x0f, conditions[condition]);
    }
    this.fixups.push({offset: this.bytes.length, label: label});
    this.emit32(0);
};
X86Assembler.prototype.returnFromFunction = function () { this.emit(0xc3); };
X86Assembler.prototype.finish = function () {
    for (var index = 0; index < this.fixups.length; index++) {
        var fixup = this.fixups[index];
        var target = this.labels[fixup.label];
        if (typeof target !== "number") throw new Error("unknown x86 label: " + fixup.label);
        var relative = target - (fixup.offset + 4);
        this.bytes[fixup.offset] = relative & 255;
        this.bytes[fixup.offset + 1] = (relative >>> 8) & 255;
        this.bytes[fixup.offset + 2] = (relative >>> 16) & 255;
        this.bytes[fixup.offset + 3] = (relative >>> 24) & 255;
    }
    return this.bytes;
};

/* Record only calls made by the source compiler. Calls which an assembler
 * macro makes internally are deliberately not repeated in the listing. */
function MacroAssemblyRecorder(assembler) {
    this.assembler = assembler;
    this.lines = [];
    var recorder = this;
    var methods = [
        "push", "pop", "moveRegister", "moveImmediate",
        "moveMemoryToRegister", "moveRegisterToMemory", "moveArgument",
        "moveLocalToRegister", "moveRegisterToLocal",
        "moveMemoryIndexedToRegister", "moveRegisterToMemoryIndexed",
        "loadIndexedAddress", "addRegisters", "subtractRegisters",
        "andRegisters", "orRegisters", "xorRegisters", "multiplyRegisters",
        "compareRegisters", "testRegisters", "addMemoryToRegister",
        "subtractMemoryFromRegister", "compareRegisterWithMemory",
        "imulImmediate", "addImmediate", "subtractImmediate",
        "compareImmediate", "shift", "moveZeroExtended16",
        "moveSignExtended16", "exchangeRegisters", "signExtendEax",
        "divideSignedBy", "negate", "bitwiseNot", "decrement",
        "incrementLocal", "label", "jump", "returnFromFunction"
    ];
    function install(method) {
        recorder[method] = function () {
            recorder.record(method, arguments);
            return assembler[method].apply(assembler, arguments);
        };
    }
    for (var index = 0; index < methods.length; index++) install(methods[index]);
}

MacroAssemblyRecorder.prototype.formatArgument = function (value) {
    if (typeof value === "string") {
        return "\"" + value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"";
    }
    return String(value);
};
MacroAssemblyRecorder.prototype.record = function (method, values) {
    var argumentsText = [];
    for (var index = 0; index < values.length; index++) {
        argumentsText.push(this.formatArgument(values[index]));
    }
    this.lines.push((method === "label" ? "" : "    ") + method + "(" +
                    argumentsText.join(", ") + ");");
};
MacroAssemblyRecorder.prototype.finish = function () {
    return this.assembler.finish();
};
MacroAssemblyRecorder.prototype.toString = function () {
    return this.lines.join("\n");
};

/* ---- Restricted JavaScript to i386 compiler ---- */
function NativeJSTokenizer(source) {
    this.source = source;
    this.offset = 0;
    this.line = 1;
    this.column = 1;
}

NativeJSTokenizer.prototype.error = function (message) {
    throw new Error("compileNative: " + message + " at line " + this.line +
                    ", column " + this.column);
};

NativeJSTokenizer.prototype.advance = function () {
    var character = this.source.charAt(this.offset++);
    if (character === "\n") {
        this.line++;
        this.column = 1;
    } else {
        this.column++;
    }
    return character;
};

NativeJSTokenizer.prototype.skipSpace = function () {
    while (this.offset < this.source.length) {
        var character = this.source.charAt(this.offset);
        var next = this.source.charAt(this.offset + 1);
        if (/\s/.test(character)) {
            this.advance();
        } else if (character === "/" && next === "/") {
            while (this.offset < this.source.length && this.advance() !== "\n") {}
        } else if (character === "/" && next === "*") {
            this.advance();
            this.advance();
            while (this.offset < this.source.length &&
                   !(this.source.charAt(this.offset) === "*" &&
                     this.source.charAt(this.offset + 1) === "/")) {
                this.advance();
            }
            if (this.offset >= this.source.length) this.error("unterminated comment");
            this.advance();
            this.advance();
        } else {
            return;
        }
    }
};

NativeJSTokenizer.prototype.next = function () {
    this.skipSpace();
    var line = this.line;
    var column = this.column;
    if (this.offset >= this.source.length) {
        return {type: "eof", value: "", line: line, column: column};
    }
    var character = this.source.charAt(this.offset);
    if (/[A-Za-z_$]/.test(character)) {
        var identifier = "";
        while (this.offset < this.source.length &&
               /[A-Za-z0-9_$]/.test(this.source.charAt(this.offset))) {
            identifier += this.advance();
        }
        return {type: "identifier", value: identifier,
                line: line, column: column};
    }
    if (/[0-9]/.test(character)) {
        var numberText = "";
        if (character === "0" &&
            (this.source.charAt(this.offset + 1) === "x" ||
             this.source.charAt(this.offset + 1) === "X")) {
            numberText += this.advance();
            numberText += this.advance();
            while (/[0-9A-Fa-f]/.test(this.source.charAt(this.offset))) {
                numberText += this.advance();
            }
            return {type: "number", value: parseInt(numberText, 16),
                    line: line, column: column};
        }
        while (/[0-9]/.test(this.source.charAt(this.offset))) {
            numberText += this.advance();
        }
        return {type: "number", value: parseInt(numberText, 10),
                line: line, column: column};
    }
    var operators = [">>>", "===", "!==", "<<", ">>", "<=", ">=",
                     "==", "!=", "+=", "-=", "++", "--"];
    for (var index = 0; index < operators.length; index++) {
        var operator = operators[index];
        if (this.source.substr(this.offset, operator.length) === operator) {
            for (var part = 0; part < operator.length; part++) this.advance();
            return {type: "operator", value: operator,
                    line: line, column: column};
        }
    }
    if ("{}();,.+-*/&|^~!<>=[]".indexOf(character) >= 0) {
        this.advance();
        return {type: "operator", value: character,
                line: line, column: column};
    }
    this.error("unsupported character " + character);
};

function NativeJSParser(source) {
    this.tokenizer = new NativeJSTokenizer(source);
    this.token = this.tokenizer.next();
}

NativeJSParser.prototype.error = function (message) {
    throw new Error("compileNative: " + message + " at line " +
                    this.token.line + ", column " + this.token.column);
};
NativeJSParser.prototype.take = function () {
    var token = this.token;
    this.token = this.tokenizer.next();
    return token;
};
NativeJSParser.prototype.accept = function (value) {
    if (this.token.value !== value) return false;
    this.take();
    return true;
};
NativeJSParser.prototype.expect = function (value) {
    if (!this.accept(value)) this.error("expected " + value + ", found " + this.token.value);
};
NativeJSParser.prototype.identifier = function () {
    if (this.token.type !== "identifier") this.error("expected identifier");
    return this.take().value;
};

NativeJSParser.prototype.parseFunction = function () {
    this.expect("function");
    var name = this.identifier();
    this.expect("(");
    var parameters = [];
    if (!this.accept(")")) {
        do { parameters.push(this.identifier()); } while (this.accept(","));
        this.expect(")");
    }
    var body = this.parseBlock();
    if (this.token.type !== "eof") this.error("unexpected source after function");
    return {type: "function", name: name, parameters: parameters, body: body};
};

NativeJSParser.prototype.parseBlock = function () {
    this.expect("{");
    var statements = [];
    while (!this.accept("}")) {
        if (this.token.type === "eof") this.error("unterminated block");
        statements.push(this.parseStatement());
    }
    return {type: "block", statements: statements};
};

NativeJSParser.prototype.parseStatement = function () {
    if (this.token.value === "{") return this.parseBlock();
    if (this.accept("var")) {
        var declarations = [];
        do {
            var name = this.identifier();
            var initializer = null;
            if (this.accept("=")) initializer = this.parseExpression();
            declarations.push({name: name, initializer: initializer});
        } while (this.accept(","));
        this.expect(";");
        return {type: "var", declarations: declarations};
    }
    if (this.accept("while")) {
        this.expect("(");
        var whileCondition = this.parseExpression();
        this.expect(")");
        return {type: "while", condition: whileCondition,
                body: this.parseStatement()};
    }
    if (this.accept("if")) {
        this.expect("(");
        var ifCondition = this.parseExpression();
        this.expect(")");
        var consequent = this.parseStatement();
        var alternate = null;
        if (this.accept("else")) alternate = this.parseStatement();
        return {type: "if", condition: ifCondition,
                consequent: consequent, alternate: alternate};
    }
    var expression = this.parseExpression();
    this.expect(";");
    return {type: "expression", expression: expression};
};

NativeJSParser.prototype.parseExpression = function () {
    return this.parseAssignment();
};
NativeJSParser.prototype.parseAssignment = function () {
    var left = this.parseComparison();
    if (this.token.value === "=" || this.token.value === "+=" ||
        this.token.value === "-=") {
        var operator = this.take().value;
        return {type: "assignment", operator: operator, left: left,
                right: this.parseAssignment()};
    }
    return left;
};
NativeJSParser.prototype.parseComparison = function () {
    var expression = this.parseBitwiseOr();
    while (this.token.value === "<" || this.token.value === ">" ||
           this.token.value === "<=" || this.token.value === ">=" ||
           this.token.value === "===" || this.token.value === "!==" ||
           this.token.value === "==" || this.token.value === "!=") {
        var operator = this.take().value;
        expression = {type: "binary", operator: operator, left: expression,
                      right: this.parseBitwiseOr()};
    }
    return expression;
};
NativeJSParser.prototype.parseBinaryLevel = function (nextMethod, operators) {
    var expression = this[nextMethod]();
    function contains(values, value) {
        for (var index = 0; index < values.length; index++) {
            if (values[index] === value) return true;
        }
        return false;
    }
    while (contains(operators, this.token.value)) {
        var operator = this.take().value;
        expression = {type: "binary", operator: operator, left: expression,
                      right: this[nextMethod]()};
    }
    return expression;
};
NativeJSParser.prototype.parseBitwiseOr = function () {
    return this.parseBinaryLevel("parseBitwiseXor", ["|"]);
};
NativeJSParser.prototype.parseBitwiseXor = function () {
    return this.parseBinaryLevel("parseBitwiseAnd", ["^"]);
};
NativeJSParser.prototype.parseBitwiseAnd = function () {
    return this.parseBinaryLevel("parseShift", ["&"]);
};
NativeJSParser.prototype.parseShift = function () {
    return this.parseBinaryLevel("parseAdditive", ["<<", ">>", ">>>"]);
};
NativeJSParser.prototype.parseAdditive = function () {
    return this.parseBinaryLevel("parseMultiplicative", ["+", "-"]);
};
NativeJSParser.prototype.parseMultiplicative = function () {
    return this.parseBinaryLevel("parseUnary", ["*", "/"]);
};
NativeJSParser.prototype.parseUnary = function () {
    if (this.token.value === "+" || this.token.value === "-" ||
        this.token.value === "~" || this.token.value === "!") {
        return {type: "unary", operator: this.take().value,
                argument: this.parseUnary()};
    }
    return this.parsePostfix();
};
NativeJSParser.prototype.parsePostfix = function () {
    var expression = this.parsePrimary();
    while (true) {
        if (this.accept(".")) {
            expression = {type: "member", object: expression,
                          property: this.identifier()};
        } else if (this.accept("(")) {
            var argumentsList = [];
            if (!this.accept(")")) {
                do { argumentsList.push(this.parseExpression()); }
                while (this.accept(","));
                this.expect(")");
            }
            expression = {type: "call", callee: expression,
                          arguments: argumentsList};
        } else if (this.token.value === "++" || this.token.value === "--") {
            expression = {type: "postfix", operator: this.take().value,
                          argument: expression};
        } else {
            break;
        }
    }
    return expression;
};
NativeJSParser.prototype.parsePrimary = function () {
    if (this.token.type === "number") {
        return {type: "number", value: this.take().value | 0};
    }
    if (this.token.type === "identifier") {
        return {type: "identifier", name: this.take().value};
    }
    if (this.accept("(")) {
        var expression = this.parseExpression();
        this.expect(")");
        return expression;
    }
    this.error("expected expression, found " + this.token.value);
};

function NativeJSCompiler(ast, configuration, specializedValues) {
    this.ast = ast;
    this.configuration = configuration;
    this.specializedValues = specializedValues;
    this.assembler = new MacroAssemblyRecorder(new X86Assembler());
    this.locals = {};
    this.localCount = 0;
    this.labelCounter = 0;
    this.parameters = {};
    for (var index = 0; index < ast.parameters.length; index++) {
        this.parameters[ast.parameters[index]] = index;
    }
    this.collectLocals(ast.body);
}

NativeJSCompiler.prototype.error = function (message) {
    throw new Error("compileNative: " + message + " in " + this.ast.name);
};
NativeJSCompiler.prototype.collectLocals = function (statement) {
    if (statement.type === "var") {
        for (var index = 0; index < statement.declarations.length; index++) {
            var name = statement.declarations[index].name;
            if (typeof this.locals[name] !== "number") {
                this.locals[name] = ++this.localCount * 4;
            }
        }
    } else if (statement.type === "block") {
        for (index = 0; index < statement.statements.length; index++) {
            this.collectLocals(statement.statements[index]);
        }
    } else if (statement.type === "while") {
        this.collectLocals(statement.body);
    } else if (statement.type === "if") {
        this.collectLocals(statement.consequent);
        if (statement.alternate) this.collectLocals(statement.alternate);
    }
};
NativeJSCompiler.prototype.newLabel = function (prefix) {
    return "nativeJS_" + prefix + "_" + (++this.labelCounter);
};
NativeJSCompiler.prototype.memberName = function (expression) {
    if (expression.type === "identifier") return expression.name;
    if (expression.type === "member") {
        return this.memberName(expression.object) + "." + expression.property;
    }
    this.error("computed member expressions are not supported");
};
NativeJSCompiler.prototype.constantValue = function (name) {
    if (this.specializedValues.hasOwnProperty(name)) return this.specializedValues[name] | 0;
    var constants = this.configuration.constants || {};
    if (constants.hasOwnProperty(name)) return constants[name] | 0;
    return null;
};
NativeJSCompiler.prototype.loadIdentifier = function (name) {
    var constant = this.constantValue(name);
    if (constant !== null) {
        this.assembler.moveImmediate("eax", constant);
    } else if (typeof this.locals[name] === "number") {
        this.assembler.moveLocalToRegister("eax", this.locals[name]);
    } else if (typeof this.parameters[name] === "number") {
        var argumentIndex = this.parameters[name];
        if (argumentIndex >= 8) this.error("parameter " + name + " must be specialized");
        this.assembler.moveArgument("eax", argumentIndex);
    } else {
        this.error("unresolved identifier " + name);
    }
};
NativeJSCompiler.prototype.storeIdentifier = function (name) {
    if (typeof this.locals[name] === "number") {
        this.assembler.moveRegisterToLocal(this.locals[name], "eax");
    } else {
        this.error("assignment target must be a local variable: " + name);
    }
};
NativeJSCompiler.prototype.compileCall = function (expression) {
    var callee = this.memberName(expression.callee);
    if (callee === "peek32" && expression.arguments.length === 1) {
        this.compileExpression(expression.arguments[0]);
        this.assembler.moveMemoryToRegister("eax", "eax", 0);
        return;
    }
    if (callee === "poke32" && expression.arguments.length === 2) {
        this.compileExpression(expression.arguments[0]);
        this.assembler.push("eax");
        this.compileExpression(expression.arguments[1]);
        this.assembler.pop("ecx");
        this.assembler.moveRegisterToMemory("ecx", 0, "eax");
        return;
    }
    this.error("unsupported call to " + callee);
};
NativeJSCompiler.prototype.compileExpression = function (expression) {
    var assembler = this.assembler;
    if (expression.type === "number") {
        assembler.moveImmediate("eax", expression.value);
    } else if (expression.type === "identifier") {
        this.loadIdentifier(expression.name);
    } else if (expression.type === "member") {
        var member = this.memberName(expression);
        var constant = this.constantValue(member);
        if (constant === null) this.error("unresolved member " + member);
        assembler.moveImmediate("eax", constant);
    } else if (expression.type === "call") {
        this.compileCall(expression);
    } else if (expression.type === "unary") {
        this.compileExpression(expression.argument);
        if (expression.operator === "-") assembler.negate("eax");
        else if (expression.operator === "~") assembler.bitwiseNot("eax");
        else if (expression.operator === "+") {}
        else this.error("unsupported unary operator " + expression.operator);
    } else if (expression.type === "binary") {
        this.compileExpression(expression.left);
        assembler.push("eax");
        this.compileExpression(expression.right);
        assembler.moveRegister("ecx", "eax");
        assembler.pop("eax");
        var operator = expression.operator;
        if (operator === "+") assembler.addRegisters("eax", "ecx");
        else if (operator === "-") assembler.subtractRegisters("eax", "ecx");
        else if (operator === "*") assembler.multiplyRegisters("eax", "ecx");
        else if (operator === "&") assembler.andRegisters("eax", "ecx");
        else if (operator === "|") assembler.orRegisters("eax", "ecx");
        else if (operator === "^") assembler.xorRegisters("eax", "ecx");
        else if (operator === "/") {
            assembler.signExtendEax();
            assembler.divideSignedBy("ecx");
        } else if (operator === "<<" || operator === ">>" || operator === ">>>") {
            if (expression.right.type !== "number") {
                this.error("shift count must be a numeric constant");
            }
            /* Discard the already evaluated right operand; x86 uses the
             * literal count encoded below and eax still holds the left side. */
            assembler.shift(operator === "<<" ? "left" :
                            operator === ">>" ? "arithmeticRight" : "right",
                            "eax", expression.right.value & 31);
        } else {
            this.error("comparison cannot be used as an integer expression: " + operator);
        }
    } else if (expression.type === "assignment") {
        if (expression.left.type !== "identifier") this.error("invalid assignment target");
        var target = expression.left.name;
        this.compileExpression(expression.right);
        if (expression.operator !== "=") {
            assembler.moveRegister("ecx", "eax");
            this.loadIdentifier(target);
            if (expression.operator === "+=") assembler.addRegisters("eax", "ecx");
            else assembler.subtractRegisters("eax", "ecx");
        }
        this.storeIdentifier(target);
    } else if (expression.type === "postfix") {
        if (expression.argument.type !== "identifier") this.error("invalid postfix target");
        this.loadIdentifier(expression.argument.name);
        if (expression.operator === "++") assembler.addImmediate("eax", 1);
        else assembler.subtractImmediate("eax", 1);
        this.storeIdentifier(expression.argument.name);
    } else {
        this.error("unsupported expression " + expression.type);
    }
};

NativeJSCompiler.prototype.compileConditionFalse = function (expression, label) {
    var comparisonJumps = {
        "<": "greaterOrEqual", ">": "lessOrEqual",
        "<=": "greater", ">=": "less",
        "===": "notEqual", "==": "notEqual",
        "!==": "equal", "!=": "equal"
    };
    if (expression.type === "binary" && comparisonJumps[expression.operator]) {
        this.compileExpression(expression.left);
        this.assembler.push("eax");
        this.compileExpression(expression.right);
        this.assembler.moveRegister("ecx", "eax");
        this.assembler.pop("eax");
        this.assembler.compareRegisters("eax", "ecx");
        this.assembler.jump(comparisonJumps[expression.operator], label);
    } else {
        this.compileExpression(expression);
        this.assembler.testRegisters("eax", "eax");
        this.assembler.jump("equal", label);
    }
};

NativeJSCompiler.prototype.compileStatement = function (statement) {
    if (statement.type === "block") {
        for (var index = 0; index < statement.statements.length; index++) {
            this.compileStatement(statement.statements[index]);
        }
    } else if (statement.type === "var") {
        for (index = 0; index < statement.declarations.length; index++) {
            var declaration = statement.declarations[index];
            if (declaration.initializer) {
                this.compileExpression(declaration.initializer);
                this.storeIdentifier(declaration.name);
            }
        }
    } else if (statement.type === "expression") {
        this.compileExpression(statement.expression);
    } else if (statement.type === "while") {
        var whileStart = this.newLabel("while");
        var whileEnd = this.newLabel("whileEnd");
        this.assembler.label(whileStart);
        this.compileConditionFalse(statement.condition, whileEnd);
        this.compileStatement(statement.body);
        this.assembler.jump("always", whileStart);
        this.assembler.label(whileEnd);
    } else if (statement.type === "if") {
        var elseLabel = this.newLabel("else");
        var ifEnd = this.newLabel("ifEnd");
        this.compileConditionFalse(statement.condition,
                                   statement.alternate ? elseLabel : ifEnd);
        this.compileStatement(statement.consequent);
        if (statement.alternate) {
            this.assembler.jump("always", ifEnd);
            this.assembler.label(elseLabel);
            this.compileStatement(statement.alternate);
        }
        this.assembler.label(ifEnd);
    } else {
        this.error("unsupported statement " + statement.type);
    }
};

NativeJSCompiler.prototype.compile = function () {
    var assembler = this.assembler;
    assembler.push("ebp");
    assembler.moveRegister("ebp", "esp");
    if (this.localCount) assembler.subtractImmediate("esp", this.localCount * 4);
    this.compileStatement(this.ast.body);
    assembler.xorRegisters("eax", "eax");
    assembler.moveRegister("esp", "ebp");
    assembler.pop("ebp");
    assembler.returnFromFunction();
    return assembler.finish();
};

var nativeCode = {
    pageSize: 4096,
    PROT_READ: 1,
    PROT_WRITE: 2,
    PROT_EXEC: 4,
    MAP_PRIVATE: 2,
    MAP_ANONYMOUS: 32,

    create: function (bytes) {
        var mappedLength = Math.ceil(bytes.length / this.pageSize) * this.pageSize;
        var pointer = NodeLibc.mmap(0, mappedLength,
                                   this.PROT_READ | this.PROT_WRITE,
                                   this.MAP_PRIVATE | this.MAP_ANONYMOUS,
                                   -1, 0);
        if (pointer === -1 || pointer === 0) {
            throw new Error("mmap for generated code failed (errno " +
                            NodeLibc.errno() + ")");
        }
        for (var index = 0; index < bytes.length; index++) {
            poke8(pointer + index, bytes[index]);
        }
        if (NodeLibc.mprotect(pointer, mappedLength,
                              this.PROT_READ | this.PROT_EXEC) !== 0) {
            var number = NodeLibc.errno();
            NodeLibc.munmap(pointer, mappedLength);
            throw new Error("mprotect for generated code failed (errno " +
                            number + ")");
        }
        return {pointer: pointer, length: mappedLength};
    },

    compile: function (builder) {
        var assembler = new X86Assembler();
        builder(assembler);
        return this.create(assembler.finish());
    },

    destroy: function (code) {
        if (code && code.pointer) {
            NodeLibc.munmap(code.pointer, code.length);
            code.pointer = 0;
            code.length = 0;
        }
    },

    call: function (code, values) {
        return NodeLibc.call8(code.pointer,
                              values[0] || 0, values[1] || 0,
                              values[2] || 0, values[3] || 0,
                              values[4] || 0, values[5] || 0,
                              values[6] || 0, values[7] || 0);
    },

    call8: function (code, a1, a2, a3, a4, a5, a6, a7, a8) {
        return NodeLibc.call8(code.pointer, a1, a2, a3, a4,
                              a5, a6, a7, a8);
    }
};

function NativeCompiledFunction(functionObject) {
    if (typeof functionObject !== "function") {
        throw new Error("compileNative requires a function");
    }
    /* Function.prototype.toString is deliberately the compiler's only source
     * input.  No function-name substitution or handwritten-code fallback is
     * permitted here. */
    this.source = functionObject.toString();
    this.ast = new NativeJSParser(this.source).parseFunction();
    this.configuration = functionObject.nativeCompile || {};
    this.specializedNames = this.configuration.specialize || [];
    this.specializedIndexes = [];
    this.variants = {};
    this.destroyed = false;
    this.dumpedMacroAssembly = false;

    for (var parameterIndex = 8;
         parameterIndex < this.ast.parameters.length; parameterIndex++) {
        var parameterName = this.ast.parameters[parameterIndex];
        var specialized = false;
        for (var specializeIndex = 0;
             specializeIndex < this.specializedNames.length; specializeIndex++) {
            if (this.specializedNames[specializeIndex] === parameterName) specialized = true;
        }
        if (!specialized) {
            throw new Error("compileNative: parameter " + parameterName +
                            " exceeds the eight-argument native bridge and " +
                            "must be listed in nativeCompile.specialize");
        }
    }
    for (specializeIndex = 0;
         specializeIndex < this.specializedNames.length; specializeIndex++) {
        var foundIndex = -1;
        for (parameterIndex = 0;
             parameterIndex < this.ast.parameters.length; parameterIndex++) {
            if (this.ast.parameters[parameterIndex] ===
                this.specializedNames[specializeIndex]) foundIndex = parameterIndex;
        }
        if (foundIndex < 0) {
            throw new Error("compileNative: unknown specialized parameter " +
                            this.specializedNames[specializeIndex]);
        }
        if (foundIndex < 8) {
            throw new Error("compileNative: specialization of native argument " +
                            this.specializedNames[specializeIndex] +
                            " is not supported");
        }
        this.specializedIndexes.push(foundIndex);
    }

    var compiledObject = this;
    this.fn = function (a1, a2, a3, a4, a5, a6, a7, a8, a9) {
        return compiledObject.invoke(arguments);
    };
    this.fn.compiledObject = this;
}

NativeCompiledFunction.prototype.variantFor = function (callArguments) {
    if (this.destroyed) throw new Error("compiled native function has been destroyed");
    var keyParts = [];
    var specializedValues = {};
    for (var index = 0; index < this.specializedNames.length; index++) {
        var name = this.specializedNames[index];
        var argumentIndex = this.specializedIndexes[index];
        var value = callArguments[argumentIndex] | 0;
        specializedValues[name] = value;
        keyParts.push(String(value >>> 0));
    }
    var key = keyParts.length ? keyParts.join(":") : "default";
    var variant = this.variants[key];
    if (!variant) {
        var compiler = new NativeJSCompiler(this.ast, this.configuration,
                                            specializedValues);
        var bytes = compiler.compile();
        variant = nativeCode.create(bytes);
        variant.byteLength = bytes.length;
        variant.specializedValues = specializedValues;
        variant.macroAssembly = compiler.assembler.toString();
        this.variants[key] = variant;
        if (this.configuration.dumpMacroAssembly && !this.dumpedMacroAssembly) {
            console.log("--- compiled native macro assembly: " + this.ast.name +
                        " [variant " + key + ", " + bytes.length + " bytes] ---");
            console.log(variant.macroAssembly);
            console.log("--- end compiled native macro assembly ---");
            this.dumpedMacroAssembly = true;
        }
    }
    return variant;
};

NativeCompiledFunction.prototype.invoke = function (callArguments) {
    var variant = this.variantFor(callArguments);
    return NodeLibc.call8(variant.pointer,
                          callArguments[0] || 0, callArguments[1] || 0,
                          callArguments[2] || 0, callArguments[3] || 0,
                          callArguments[4] || 0, callArguments[5] || 0,
                          callArguments[6] || 0, callArguments[7] || 0);
};

NativeCompiledFunction.prototype.destroy = function () {
    if (this.destroyed) return;
    for (var key in this.variants) {
        if (this.variants.hasOwnProperty(key)) nativeCode.destroy(this.variants[key]);
    }
    this.variants = {};
    this.destroyed = true;
};

function compileNative(functionObject) {
    return new NativeCompiledFunction(functionObject);
}

DemoRunner = {
    common: common,
    x11: x11,
    Buffer: Buffer,
    process: process,
    console: console,
    libc: NodeLibc,
    memory: NodeMemory,
    nativeCode: nativeCode,
    compileNative: compileNative,
    define: function (application) {
        if (typeof application !== "function") {
            throw new Error("DemoRunner.define requires a function");
        }
        if (Demo8RunnerApplication) {
            throw new Error("only one demo application may be defined");
        }
        Demo8RunnerApplication = application;
    }
};

load(Demo8RunnerTarget);
if (!Demo8RunnerApplication) {
    throw new Error(Demo8RunnerTarget + " did not call DemoRunner.define");
}
Demo8RunnerApplication(DemoRunner);
}

try {
    demo8RunnerMain();
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
