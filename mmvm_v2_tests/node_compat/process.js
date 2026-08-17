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
