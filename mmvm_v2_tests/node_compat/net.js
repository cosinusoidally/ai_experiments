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
