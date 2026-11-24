/* Socket-boundary integration check, runnable directly by js_min or a guest
 * executable. Uses the same libc wrappers as the Node compatibility layer.
 * No host Node, test server, threads or external connections are required. */
load("node_compat/libc.js");
(function () {
    var C = {AF_INET: 2, SOCK_STREAM: 1, SOL_SOCKET: 1, SO_ERROR: 4,
        F_GETFL: 3, F_SETFL: 4, NONBLOCK: 2048, AGAIN: 11, INPROGRESS: 115,
        REFUSED: 111, BADFD: 9, POLLIN: 1, POLLOUT: 4, POLLNVAL: 32,
        pollBytes: 8, events: 4, returned: 6, addressBytes: 16,
        payloadBytes: 4096, backpressureBound: 16 * 1024 * 1024, waitMillis: 5000};
    var checks = 0, buffers = [], descriptors = [];
    function check(condition, message) {
        if (!condition) throw new Error("network acceptance: " + message + " (errno " + NodeLibc.errno() + ")");
        checks++;
    }
    function allocate(bytes) {
        var p = NodeLibc.calloc(bytes, 1); check(p !== 0, "allocate"); buffers.push(p); return p;
    }
    function socket() {
        var fd = NodeLibc.socket(C.AF_INET, C.SOCK_STREAM, 0);
        check(fd >= 0, "socket"); descriptors.push(fd);
        check(NodeLibc.fcntl(fd, C.F_SETFL, C.NONBLOCK) === 0, "nonblocking mode");
        check((NodeLibc.fcntl(fd, C.F_GETFL, 0) & C.NONBLOCK) !== 0, "get flags");
        return fd;
    }
    function close(fd) {
        check(NodeLibc.close(fd) === 0, "close socket");
        for (var i = 0; i < descriptors.length; i++) if (descriptors[i] === fd) descriptors[i] = -1;
    }
    function short(p, n) { poke8(p, n & 255); poke8(p + 1, n >>> 8); }
    function returned(p) { return peek8(p + C.returned) | (peek8(p + C.returned + 1) << 8); }
    function entry(p, fd, events) { poke32(p, fd); short(p + C.events, events); short(p + C.returned, 0); }
    var address, length, polls, source, target, error;
    function wait(fd, events) {
        entry(polls, fd, events);
        check(NodeLibc.poll(polls, 1, C.waitMillis) === 1, "readiness wait");
        check((returned(polls) & events) !== 0, "requested readiness");
    }
    function connectionError(fd) {
        poke32(length, 4); poke32(error, -1);
        check(NodeLibc.getsockopt(fd, C.SOL_SOCKET, C.SO_ERROR, error, length) === 0, "SO_ERROR");
        return peek32(error);
    }
    try {
        address = allocate(C.addressBytes); length = allocate(4); polls = allocate(C.pollBytes * 3);
        source = allocate(C.payloadBytes); target = allocate(C.payloadBytes); error = allocate(4);
        poke8(address, C.AF_INET); check(NodeLibc.inetAton("127.0.0.1", address + 4) === 1, "IPv4 conversion");
        check(NodeLibc.inetAton("256.1.2.3", target) === 0, "invalid IPv4 rejection");
        var server = socket();
        check(NodeLibc.bind(server, address, C.addressBytes) === 0, "bind ephemeral port");
        check(NodeLibc.listen(server, 8) === 0, "listen");
        poke32(length, C.addressBytes);
        check(NodeLibc.getSocketName(server, address, length) === 0, "get bound address");
        check(peek8(address + 2) !== 0 || peek8(address + 3) !== 0, "assigned port");
        check(NodeLibc.accept(server, 0, 0) === -1 && NodeLibc.errno() === C.AGAIN, "empty nonblocking accept");
        entry(polls, server, C.POLLIN);
        check(NodeLibc.poll(polls, 1, 25) === 0 && returned(polls) === 0, "readiness timeout");
        var client = socket(), result = NodeLibc.connect(client, address, C.addressBytes);
        check(result === 0 || (result === -1 && NodeLibc.errno() === C.INPROGRESS), "nonblocking connect");
        wait(client, C.POLLOUT); check(connectionError(client) === 0, "successful connect completion");
        wait(server, C.POLLIN); poke32(length, C.addressBytes);
        var accepted = NodeLibc.accept(server, target, length);
        check(accepted >= 0, "accept client"); descriptors.push(accepted);
        check(NodeLibc.fcntl(accepted, C.F_SETFL, C.NONBLOCK) === 0, "accepted nonblocking mode");
        check(NodeLibc.read(accepted, target, C.payloadBytes) === -1 && NodeLibc.errno() === C.AGAIN,
            "empty nonblocking read");
        for (var i = 0; i < C.payloadBytes; i++) poke8(source + i, i & 255);
        var sent = 0, received = 0;
        while (sent < C.payloadBytes) {
            wait(client, C.POLLOUT);
            result = NodeLibc.write(client, source + sent, C.payloadBytes - sent);
            check(result > 0, "binary send"); sent += result;
        }
        while (received < C.payloadBytes) {
            wait(accepted, C.POLLIN);
            result = NodeLibc.read(accepted, target + received, C.payloadBytes - received);
            check(result > 0, "binary receive"); received += result;
        }
        for (i = 0; i < C.payloadBytes; i++) check(peek8(target + i) === (i & 255), "binary payload " + i);
        entry(polls, client, C.POLLOUT); entry(polls + C.pollBytes, client, C.POLLOUT);
        entry(polls + C.pollBytes * 2, -1, C.POLLIN);
        check(NodeLibc.poll(polls, 3, 0) === 2, "duplicate descriptors count separately; negative ignored");
        check(returned(polls) === C.POLLOUT && returned(polls + C.pollBytes) === C.POLLOUT &&
            returned(polls + C.pollBytes * 2) === 0, "poll results");
        /* Fill a connection whose peer deliberately does not read. This is
         * bounded kernel buffering, not a large guest allocation. Then close
         * the writer and drain: queued bytes must arrive before EOF. */
        var queued = 0, blocked = false;
        while (queued < C.backpressureBound) {
            result = NodeLibc.write(client, source, C.payloadBytes);
            if (result === -1 && NodeLibc.errno() === C.AGAIN) { blocked = true; break; }
            check(result > 0, "backpressure write progress"); queued += result;
        }
        check(blocked, "nonblocking backpressure reached within bounded transfer");
        close(client); received = 0;
        while (true) {
            wait(accepted, C.POLLIN);
            result = NodeLibc.read(accepted, target, C.payloadBytes);
            if (result === 0) break;
            check(result > 0, "draining queued bytes before EOF"); received += result;
        }
        check(received === queued, "all queued bytes precede EOF");
        close(accepted); close(server);
        check(NodeLibc.close(server) === -1 && NodeLibc.errno() === C.BADFD, "double close is a normal error");
        entry(polls, server, C.POLLIN);
        check(NodeLibc.poll(polls, 1, C.waitMillis) === 1 && returned(polls) === C.POLLNVAL, "closed descriptor poll");
        client = socket(); result = NodeLibc.connect(client, address, C.addressBytes);
        if (result === -1 && NodeLibc.errno() === C.INPROGRESS) {
            wait(client, C.POLLOUT); check(connectionError(client) === C.REFUSED, "refused completion errno");
        } else check(result === -1 && NodeLibc.errno() === C.REFUSED, "refused immediate errno");
        close(client);
        for (i = 0; i < 32; i++) close(socket());
        if (NodeLibc.platformName() === "win32") {
            check(NodeLibc.socket(1, C.SOCK_STREAM, 0) === -1, "Unix sockets rejected without terminating VM");
        }
        print("native networking passed: " + checks + " checks (" + NodeLibc.platformName() + ")");
    } finally {
        for (var d = 0; d < descriptors.length; d++) if (descriptors[d] >= 0) NodeLibc.close(descriptors[d]);
        while (buffers.length) NodeLibc.free(buffers.pop());
    }
}());
