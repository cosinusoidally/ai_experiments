(function (root) {
    var BufferSupport = root.GuestVMBufferSupport;
    if (typeof module !== "undefined" && module.exports) {
        BufferSupport = require("./buffer.js");
    }

    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function Runtime() {
        this.globals = {};
        this.assertions = 0;
        this.heapObjects = [];
        this.hostRoots = [];
        this.gcGeneration = 0;
        this.activeRegisters = null;
        this.installBuiltins();
        this.bufferSupport = new BufferSupport(this);
    }

    Runtime.prototype.makeNativeFunction = function (name, callback) {
        return {guestType: "function", name: name, callback: callback,
                properties: {}};
    };

    Runtime.prototype.makeObject = function () {
        var object = {guestType: "object", properties: {}, gcMark: 0};
        this.trackObject(object);
        return object;
    };

    Runtime.prototype.trackObject = function (object) {
        this.heapObjects.push(object);
        return object;
    };

    Runtime.prototype.retain = function (value) {
        var index = 0;
        while (index < this.hostRoots.length) {
            if (this.hostRoots[index] === null) {
                this.hostRoots[index] = value;
                return index + 1;
            }
            index++;
        }
        this.hostRoots.push(value);
        return this.hostRoots.length;
    };

    Runtime.prototype.retained = function (handle) {
        var index = integerHandle(handle, this.hostRoots.length);
        var value = this.hostRoots[index];
        if (value === null) throw new Error("guest host root has been released");
        return value;
    };

    Runtime.prototype.release = function (handle) {
        var index = integerHandle(handle, this.hostRoots.length);
        if (this.hostRoots[index] === null) {
            throw new Error("guest host root has already been released");
        }
        this.hostRoots[index] = null;
    };

    Runtime.prototype.installBuiltins = function () {
        var runtime = this;
        this.globals.undefined = undefined;
        this.globals.assertEqual = this.makeNativeFunction("assertEqual",
            function (receiver, args) {
                if (args[0] !== args[1]) {
                    throw new Error((args.length > 2 ? args[2] + ": " : "") +
                                    "expected " + args[1] + ", got " + args[0]);
                }
                runtime.assertions++;
                return undefined;
            });
        this.globals.print = this.makeNativeFunction("print",
            function (receiver, args) {
                var text = args.length ? String(args[0]) : "";
                if (typeof print === "function") print(text);
                else console.log(text);
                return undefined;
            });
        this.globals.guestCollect = this.makeNativeFunction("guestCollect",
            function () {
                return runtime.collect();
            });
        this.globals.guestBackingStoreCount = this.makeNativeFunction(
            "guestBackingStoreCount", function () {
                return runtime.bufferSupport ?
                       runtime.bufferSupport.liveBackingCount() : 0;
            });
    };

    Runtime.prototype.getGlobal = function (name) {
        if (!own(this.globals, name)) throw new ReferenceError(name + " is not defined");
        return this.globals[name];
    };

    Runtime.prototype.setGlobal = function (name, value) {
        this.globals[name] = value;
        return value;
    };

    Runtime.prototype.propertyKey = function (value) {
        return String(value);
    };

    Runtime.prototype.getProperty = function (object, key) {
        key = this.propertyKey(key);
        if (object === null || object === undefined) {
            throw new TypeError("cannot read property '" + key + "'");
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.getProperty(object, key);
        }
        if (object.guestType === "object" || object.guestType === "function") {
            return own(object.properties, "$" + key) ?
                   object.properties["$" + key] : undefined;
        }
        if (typeof object === "string" && key === "length") return object.length;
        return undefined;
    };

    Runtime.prototype.setProperty = function (object, key, value) {
        key = this.propertyKey(key);
        if (object === null || object === undefined) {
            throw new TypeError("cannot set property '" + key + "'");
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.setProperty(object, key, value);
        }
        if (object.guestType === "object" || object.guestType === "function") {
            object.properties["$" + key] = value;
            return value;
        }
        throw new TypeError("property target is not an object");
    };

    Runtime.prototype.add = function (left, right) {
        if (typeof left === "string" || typeof right === "string") {
            return String(left) + String(right);
        }
        return Number(left) + Number(right);
    };

    Runtime.prototype.equal = function (left, right) {
        if (left === right) return true;
        if (left === null && right === undefined) return true;
        if (left === undefined && right === null) return true;
        if (typeof left === "number" && typeof right === "string") {
            return left === Number(right);
        }
        if (typeof left === "string" && typeof right === "number") {
            return Number(left) === right;
        }
        if (typeof left === "boolean") return Number(left) == right;
        if (typeof right === "boolean") return left == Number(right);
        return false;
    };

    Runtime.prototype.call = function (callable, receiver, args) {
        if (!callable || callable.guestType !== "function") {
            throw new TypeError("value is not callable");
        }
        return callable.callback(receiver, args);
    };

    Runtime.prototype.truthy = function (value) {
        return !!value;
    };

    Runtime.prototype.markValue = function (value, generation) {
        if (!value || (value.guestType !== "object" &&
                       value.guestType !== "function" &&
                       value.guestType !== "buffer")) return;
        if (value.gcMark === generation) return;
        value.gcMark = generation;
        if (value.guestType === "buffer") {
            this.bufferSupport.markView(value, generation);
            this.markValue(value.prototype, generation);
        }
        var properties = value.properties;
        var key;
        for (key in properties) {
            if (own(properties, key)) this.markValue(properties[key], generation);
        }
    };

    Runtime.prototype.collect = function () {
        this.gcGeneration++;
        var generation = this.gcGeneration;
        var key;
        for (key in this.globals) {
            if (own(this.globals, key)) this.markValue(this.globals[key], generation);
        }
        this.markValue(this.bufferSupport.prototype, generation);
        var hostRootIndex = 0;
        while (hostRootIndex < this.hostRoots.length) {
            if (this.hostRoots[hostRootIndex] !== null) {
                this.markValue(this.hostRoots[hostRootIndex], generation);
            }
            hostRootIndex++;
        }
        if (this.activeRegisters) {
            var registerIndex = 0;
            while (registerIndex < this.activeRegisters.length) {
                this.markValue(this.activeRegisters[registerIndex], generation);
                registerIndex++;
            }
        }
        var survivors = [];
        var index = 0;
        while (index < this.heapObjects.length) {
            if (this.heapObjects[index].gcMark === generation) {
                survivors.push(this.heapObjects[index]);
            }
            index++;
        }
        this.heapObjects = survivors;
        this.bufferSupport.sweep(generation);
        return survivors.length;
    };

    Runtime.prototype.destroy = function () {
        this.bufferSupport.destroy();
        this.heapObjects = [];
        this.hostRoots = [];
        this.activeRegisters = null;
    };

    function integerHandle(handle, length) {
        handle = Number(handle);
        if (handle !== Math.floor(handle) || handle < 1 || handle > length) {
            throw new Error("invalid guest host root handle");
        }
        return handle - 1;
    }

    root.GuestVMRuntime = Runtime;
    if (typeof module !== "undefined" && module.exports) module.exports = Runtime;
}(this));
