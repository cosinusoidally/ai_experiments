/* XP-compatible Winsock boundary for the shared poll-based Node layer.
 * All functions below are compiled as kernel JS, not executed by a host VM.
 * SOCKETs are unsigned native handles, never CRT file descriptors. */
(function (root) {
    var N = {firstDescriptor: 1073741824, socketError: -1, invalidSocket: -1,
        afInet: 2, sockStream: 1, tcp: 6, winsockVersion: 514, wsaDataBytes: 400,
        solSocket: 1, reuseAddress: 2, socketErrorOption: 4,
        winSolSocket: 65535, winReuseAddress: 4, winSocketError: 4103,
        getFlags: 3, setFlags: 4, nonblocking: 2048, fionbio: -2147195266,
        pollIn: 1, pollOut: 4, pollError: 8, pollInvalid: 32,
        wordBytes: 4, pollBytes: 8, pollEvents: 4, pollReturned: 6,
        timevalBytes: 8, millisPerSecond: 1000, microsPerMilli: 1000,
        maxPollEntries: 65536, asciiZero: 48, asciiNine: 57, asciiDot: 46,
        ipv4Bytes: 4, maxOctet: 255, decimalBase: 10};
    var S = {next: 0, descriptor: 4, handle: 8, flags: 12, bytes: 16};
    var E = {interrupted: 4, badDescriptor: 9, again: 11, noMemory: 12,
        access: 13, fault: 14, invalid: 22, tooManyFiles: 24, notSocket: 88,
        destination: 89, messageSize: 90, protocolType: 91, protocolOption: 92,
        protocol: 93, socketType: 94, unsupported: 95, family: 97,
        addressInUse: 98, addressUnavailable: 99, networkDown: 100,
        networkUnreachable: 101, networkReset: 102, aborted: 103, reset: 104,
        noBuffers: 105, connected: 106, notConnected: 107, shutdown: 108,
        timeout: 110, refused: 111, hostDown: 112, hostUnreachable: 113,
        already: 114, inProgress: 115, io: 5};
    var WE = {interrupted: 10004, badDescriptor: 10009, access: 10013,
        fault: 10014, invalid: 10022, tooManyFiles: 10024, again: 10035,
        inProgress: 10036, already: 10037, notSocket: 10038,
        destination: 10039, messageSize: 10040, protocolType: 10041,
        protocolOption: 10042, protocol: 10043, socketType: 10044,
        unsupported: 10045, family: 10047, addressInUse: 10048,
        addressUnavailable: 10049, networkDown: 10050, networkUnreachable: 10051,
        networkReset: 10052, aborted: 10053, reset: 10054, noBuffers: 10055,
        connected: 10056, notConnected: 10057, shutdown: 10058, timeout: 10060,
        refused: 10061, hostDown: 10064, hostUnreachable: 10065};

    function socketHead(s) { return load32(s + L.sockets); }
    function setSocketHead(s, p) { store32(s + L.sockets, p); }
    function socketNext(p) { return load32(p + S.next); }
    function setSocketNext(p, next) { store32(p + S.next, next); }
    function socketDescriptor(p) { return load32(p + S.descriptor); }
    function socketHandle(p) { return load32(p + S.handle); }
    function socketFlags(p) { return load32(p + S.flags); }
    function setSocketFlags(p, flags) { store32(p + S.flags, flags); }
    function findSocket(s, fd) {
        var p = socketHead(s);
        while (p !== 0) {
            if (socketDescriptor(p) === fd) return p;
            p = socketNext(p);
        }
        return 0;
    }
    function networkErrno(s, error) {
        store32(callNativeI32(load32(apiTable(s) + A._errno)), error);
        return -1;
    }
    function translateSocketError(error) {
        if (error === 0) return 0;
        if (error === WE.interrupted) return E.interrupted;
        if (error === WE.badDescriptor) return E.badDescriptor;
        if (error === WE.access) return E.access;
        if (error === WE.fault) return E.fault;
        if (error === WE.invalid) return E.invalid;
        if (error === WE.tooManyFiles) return E.tooManyFiles;
        if (error === WE.again) return E.again;
        if (error === WE.inProgress) return E.inProgress;
        if (error === WE.already) return E.already;
        if (error === WE.notSocket) return E.notSocket;
        if (error === WE.destination) return E.destination;
        if (error === WE.messageSize) return E.messageSize;
        if (error === WE.protocolType) return E.protocolType;
        if (error === WE.protocolOption) return E.protocolOption;
        if (error === WE.protocol) return E.protocol;
        if (error === WE.socketType) return E.socketType;
        if (error === WE.unsupported) return E.unsupported;
        if (error === WE.family) return E.family;
        if (error === WE.addressInUse) return E.addressInUse;
        if (error === WE.addressUnavailable) return E.addressUnavailable;
        if (error === WE.networkDown) return E.networkDown;
        if (error === WE.networkUnreachable) return E.networkUnreachable;
        if (error === WE.networkReset) return E.networkReset;
        if (error === WE.aborted) return E.aborted;
        if (error === WE.reset) return E.reset;
        if (error === WE.noBuffers) return E.noBuffers;
        if (error === WE.connected) return E.connected;
        if (error === WE.notConnected) return E.notConnected;
        if (error === WE.shutdown) return E.shutdown;
        if (error === WE.timeout) return E.timeout;
        if (error === WE.refused) return E.refused;
        if (error === WE.hostDown) return E.hostDown;
        if (error === WE.hostUnreachable) return E.hostUnreachable;
        return E.io;
    }
    function socketFailure(s) {
        return networkErrno(s, translateSocketError(
            callNativeI32(load32(apiTable(s) + A.WSAGetLastError))));
    }
    function socketResult(s, result) {
        if (result === N.socketError) return socketFailure(s);
        return result;
    }
    function initializeSockets(s) {
        if (load32(s + L.winsockReady) !== 0) return 0;
        var data = nativeAllocate(s, N.wsaDataBytes);
        if (data === 0) return networkErrno(s, E.noMemory);
        var result = callNativeI32(load32(apiTable(s) + A.WSAStartup), N.winsockVersion, data);
        nativeFree(s, data);
        if (result !== 0) return networkErrno(s, translateSocketError(result));
        store32(s + L.winsockReady, 1);
        store32(s + L.nextSocketDescriptor, N.firstDescriptor);
        return 0;
    }
    function registerSocket(s, handle, flags) {
        var fd = load32(s + L.nextSocketDescriptor);
        var p = nativeAllocate(s, S.bytes);
        if (p === 0 || fd < N.firstDescriptor) {
            if (p !== 0) nativeFree(s, p);
            callNativeI32(load32(apiTable(s) + A.closesocket), handle);
            return networkErrno(s, E.noMemory);
        }
        store32(s + L.nextSocketDescriptor, fd + 1);
        store32(p + S.descriptor, fd); store32(p + S.handle, handle);
        setSocketFlags(p, flags); setSocketNext(p, socketHead(s)); setSocketHead(s, p);
        return fd;
    }
    function networkClose(s, fd) {
        var p = socketHead(s), previous = 0;
        while (p !== 0) {
            if (socketDescriptor(p) === fd) {
                var result = callNativeI32(load32(apiTable(s) + A.closesocket), socketHandle(p));
                if (result === N.socketError) return socketFailure(s);
                if (previous === 0) setSocketHead(s, socketNext(p));
                else setSocketNext(previous, socketNext(p));
                nativeFree(s, p); return 0;
            }
            previous = p; p = socketNext(p);
        }
        if (fd >= N.firstDescriptor) return networkErrno(s, E.badDescriptor);
        return callNativeI32(load32(apiTable(s) + A._close), fd);
    }
    function networkIO(s, writing, fd, buffer, length) {
        var p = findSocket(s, fd);
        if (p === 0) {
            if (fd >= N.firstDescriptor) return networkErrno(s, E.badDescriptor);
            return nativeIO(s, 0, writing, fd, buffer, length, 0);
        }
        if (commitNativeRange(s, buffer, length) === 0) return networkErrno(s, E.fault);
        var fn = load32(apiTable(s) + A.recv);
        if (writing !== 0) fn = load32(apiTable(s) + A.send);
        return socketResult(s, callNativeI32(fn, socketHandle(p), buffer, length, 0));
    }
    function networkFlags(s, p, command, flags) {
        if (command === N.getFlags) return socketFlags(p);
        if (command !== N.setFlags || (flags & ~N.nonblocking) !== 0) return networkErrno(s, E.invalid);
        var value = nativeAllocate(s, N.wordBytes);
        if (value === 0) return networkErrno(s, E.noMemory);
        store32(value, 0);
        if ((flags & N.nonblocking) !== 0) store32(value, 1);
        var result = callNativeI32(load32(apiTable(s) + A.ioctlsocket), socketHandle(p), N.fionbio, value);
        if (result === N.socketError) result = socketFailure(s);
        else setSocketFlags(p, flags);
        nativeFree(s, value); return result;
    }
    function networkOption(s, p, getting, level, option, value, length) {
        if (level !== N.solSocket) return networkErrno(s, E.protocolOption);
        var translated = 0;
        if (option === N.reuseAddress) translated = N.winReuseAddress;
        if (option === N.socketErrorOption && getting !== 0) translated = N.winSocketError;
        if (translated === 0) return networkErrno(s, E.protocolOption);
        var result = 0;
        if (getting !== 0) {
            if (commitNativeRange(s, length, N.wordBytes) === 0) return networkErrno(s, E.fault);
            if (commitNativeRange(s, value, load32(length)) === 0) return networkErrno(s, E.fault);
            result = callNativeI32(load32(apiTable(s) + A.getsockopt), socketHandle(p), N.winSolSocket,
                translated, value, length);
            if (result === 0 && option === N.socketErrorOption && load32(length) >= N.wordBytes) {
                store32(value, translateSocketError(load32(value)));
            }
        } else {
            if (commitNativeRange(s, value, length) === 0) return networkErrno(s, E.fault);
            result = callNativeI32(load32(apiTable(s) + A.setsockopt), socketHandle(p), N.winSolSocket,
                translated, value, length);
        }
        return socketResult(s, result);
    }
    function networkInetAton(text, output) {
        var part = 0, cursor = text, value = 0, digits = 0;
        while (part < N.ipv4Bytes) {
            value = 0; digits = 0;
            var ch = loadRaw8(cursor);
            while (ch >= N.asciiZero && ch <= N.asciiNine) {
                value = value * N.decimalBase + ch - N.asciiZero;
                if (value > N.maxOctet) return 0;
                digits = digits + 1; cursor = cursor + 1; ch = loadRaw8(cursor);
            }
            if (digits === 0) return 0;
            if (part < N.ipv4Bytes - 1) { if (ch !== N.asciiDot) return 0; }
            else if (ch !== 0) return 0;
            storeRaw8(output + part, value);
            part = part + 1; cursor = cursor + 1;
        }
        return 1;
    }
    /* Winsock fd_set is a count followed by SOCKET handles, not a bitset.
     * Storage is sized per call, so the C header's default FD_SETSIZE is not
     * an accidental 64-client limit. Duplicate poll entries share set slots. */
    function socketSetContains(set, handle) {
        var count = load32(set), i = 0;
        while (i < count) {
            if (load32(set + N.wordBytes + i * N.wordBytes) === handle) return 1;
            i = i + 1;
        }
        return 0;
    }
    function socketSetAdd(set, handle) {
        if (socketSetContains(set, handle) !== 0) return 0;
        var count = load32(set);
        store32(set + N.wordBytes + count * N.wordBytes, handle); store32(set, count + 1);
        return 0;
    }
    function pollEvents(p) { return loadRaw8(p + N.pollEvents) | (loadRaw8(p + N.pollEvents + 1) << 8); }
    function setPollReturned(p, value) {
        storeRaw8(p + N.pollReturned, value & 255); storeRaw8(p + N.pollReturned + 1, (value >>> 8) & 255);
    }
    function networkPoll(s, entries, count, timeout) {
        if (count < 0 || count > N.maxPollEntries) return networkErrno(s, E.invalid);
        if (count === 0) { callNativeI32(load32(apiTable(s) + A.Sleep), timeout); return 0; }
        if (commitNativeRange(s, entries, count * N.pollBytes) === 0) return networkErrno(s, E.fault);
        var setBytes = (count + 1) * N.wordBytes;
        var memory = nativeAllocate(s, setBytes * 3 + N.timevalBytes);
        if (memory === 0) return networkErrno(s, E.noMemory);
        var reads = memory, writes = memory + setBytes, errors = memory + setBytes * 2;
        var tv = memory + setBytes * 3, i = 0, ready = 0, valid = 0;
        store32(reads, 0); store32(writes, 0); store32(errors, 0);
        while (i < count) {
            var entry = entries + i * N.pollBytes, fd = load32(entry);
            setPollReturned(entry, 0);
            if (fd >= 0) {
                var p = findSocket(s, fd);
                if (p === 0) { setPollReturned(entry, N.pollInvalid); ready = ready + 1; }
                else {
                    var handle = socketHandle(p), events = pollEvents(entry);
                    if ((events & N.pollIn) !== 0) socketSetAdd(reads, handle);
                    if ((events & N.pollOut) !== 0) socketSetAdd(writes, handle);
                    socketSetAdd(errors, handle); valid = valid + 1;
                }
            }
            i = i + 1;
        }
        if (ready !== 0) timeout = 0;
        if (valid === 0) {
            if (ready === 0) callNativeI32(load32(apiTable(s) + A.Sleep), timeout);
            nativeFree(s, memory); return ready;
        }
        var timePointer = 0;
        if (timeout >= 0) {
            var seconds = divideI32(timeout, N.millisPerSecond);
            store32(tv, seconds); store32(tv + N.wordBytes, (timeout - seconds * N.millisPerSecond) * N.microsPerMilli);
            timePointer = tv;
        }
        var result = callNativeI32(load32(apiTable(s) + A.select), 0, reads, writes, errors, timePointer);
        if (result === N.socketError) { result = socketFailure(s); nativeFree(s, memory); return result; }
        i = 0;
        while (i < count) {
            entry = entries + i * N.pollBytes; fd = load32(entry); p = findSocket(s, fd);
            if (p !== 0) {
                handle = socketHandle(p); events = pollEvents(entry);
                var returned = 0;
                if ((events & N.pollIn) !== 0 && socketSetContains(reads, handle) !== 0) returned = returned | N.pollIn;
                if ((events & N.pollOut) !== 0 && socketSetContains(writes, handle) !== 0) returned = returned | N.pollOut;
                if (socketSetContains(errors, handle) !== 0) {
                    /* Failed nonblocking connects are exceptional on Winsock;
                     * expose requested writability so shared SO_ERROR handling
                     * gets the actual translated connection error. */
                    returned = returned | N.pollError | (events & N.pollOut);
                }
                setPollReturned(entry, returned);
                if (returned !== 0) ready = ready + 1;
            }
            i = i + 1;
        }
        nativeFree(s, memory); return ready;
    }
    function networkDispatch(s, operation, a, b, c, d, e) {
        if (operation === O.socket) {
            if (a !== N.afInet) return networkErrno(s, E.family);
            if (b !== N.sockStream || (c !== 0 && c !== N.tcp)) return networkErrno(s, E.protocol);
            if (initializeSockets(s) !== 0) return -1;
            var handle = callNativeI32(load32(apiTable(s) + A.socket), a, b, c);
            if (handle === N.invalidSocket) return socketFailure(s);
            return registerSocket(s, handle, 0);
        }
        if (operation === O.inetAton) {
            if (commitNativeRange(s, b, N.ipv4Bytes) === 0) return networkErrno(s, E.fault);
            return networkInetAton(a, b);
        }
        var p = findSocket(s, a);
        if (p === 0) return networkErrno(s, E.badDescriptor);
        handle = socketHandle(p);
        if (operation === O.fcntl) return networkFlags(s, p, b, c);
        if (operation === O.setSocketOption) return networkOption(s, p, 0, b, c, d, e);
        if (operation === O.getSocketOption) return networkOption(s, p, 1, b, c, d, e);
        if (operation === O.bind || operation === O.connect) {
            if (c < N.wordBytes || commitNativeRange(s, b, c) === 0) return networkErrno(s, E.fault);
            if (loadRaw8(b) !== N.afInet || loadRaw8(b + 1) !== 0) return networkErrno(s, E.family);
            var fn = load32(apiTable(s) + A.bind);
            if (operation === O.connect) fn = load32(apiTable(s) + A.connect);
            var result = callNativeI32(fn, handle, b, c);
            if (operation === O.connect && result === N.socketError) {
                var error = translateSocketError(callNativeI32(load32(apiTable(s) + A.WSAGetLastError)));
                if (error === E.again) error = E.inProgress;
                return networkErrno(s, error);
            }
            return socketResult(s, result);
        }
        if (operation === O.listen) return socketResult(s, callNativeI32(load32(apiTable(s) + A.listen), handle, b));
        if (operation === O.accept || operation === O.getSocketName) {
            if (b !== 0) {
                if (c === 0 || commitNativeRange(s, c, N.wordBytes) === 0) return networkErrno(s, E.fault);
                if (commitNativeRange(s, b, load32(c)) === 0) return networkErrno(s, E.fault);
            }
            fn = load32(apiTable(s) + A.getsockname);
            if (operation === O.accept) fn = load32(apiTable(s) + A.accept);
            result = callNativeI32(fn, handle, b, c);
            if (result === N.socketError) return socketFailure(s);
            if (operation === O.accept) return registerSocket(s, result, socketFlags(p));
            return result;
        }
        return networkErrno(s, E.unsupported);
    }
    function install(platform) {
        var L = platform.state, A = platform.constants.A, O = platform.operations;
        L.sockets = L.bytes; L.winsockReady = L.bytes + 4;
        L.nextSocketDescriptor = L.bytes + 8; L.bytes += 12;
        var imports = [["WSAStartup", 2], ["WSAGetLastError", 0], ["socket", 3],
            ["bind", 3], ["listen", 2], ["accept", 3], ["connect", 3],
            ["setsockopt", 5], ["getsockopt", 5], ["getsockname", 3],
            ["ioctlsocket", 3], ["recv", 4], ["send", 4], ["closesocket", 1], ["select", 5]];
        for (var i = 0; i < imports.length; i++) {
            A[imports[i][0]] = platform.imports.length * N.wordBytes;
            platform.imports.push([imports[i][0], imports[i][1], "ws2_32.dll"]);
        }
        var operations = ["socket", "connect", "setSocketOption", "getSocketOption",
            "bind", "listen", "accept", "getSocketName", "inetAton", "fcntl", "close"];
        for (i = 0; i < operations.length; i++) O[operations[i]] = O.fwrite + 1 + i;
        delete platform.aliases.close;
        platform.constants.N = N; platform.constants.S = S;
        platform.constants.E = E; platform.constants.WE = WE;
        var functions = {socketHead: socketHead, setSocketHead: setSocketHead,
            socketNext: socketNext, setSocketNext: setSocketNext, socketDescriptor: socketDescriptor,
            socketHandle: socketHandle, socketFlags: socketFlags, setSocketFlags: setSocketFlags,
            findSocket: findSocket, networkErrno: networkErrno, translateSocketError: translateSocketError,
            socketFailure: socketFailure, socketResult: socketResult, initializeSockets: initializeSockets,
            registerSocket: registerSocket, networkClose: networkClose, networkIO: networkIO,
            networkFlags: networkFlags, networkOption: networkOption, networkInetAton: networkInetAton,
            socketSetContains: socketSetContains, socketSetAdd: socketSetAdd,
            pollEvents: pollEvents, setPollReturned: setPollReturned,
            networkPoll: networkPoll, networkDispatch: networkDispatch};
        for (var name in functions) if (Object.prototype.hasOwnProperty.call(functions, name)) {
            platform.functions[name] = functions[name];
        }
    }
    root.GuestVMWindowsNetwork = {install: install};
    if (typeof module !== "undefined" && module.exports) module.exports = root.GuestVMWindowsNetwork;
}(this));
