(function (root) {
    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function Runtime() {
        this.globals = {};
        this.assertions = 0;
        this.installBuiltins();
    }

    Runtime.prototype.makeNativeFunction = function (name, callback) {
        return {guestType: "function", name: name, callback: callback,
                properties: {}};
    };

    Runtime.prototype.makeObject = function () {
        return {guestType: "object", properties: {}};
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

    root.GuestVMRuntime = Runtime;
    if (typeof module !== "undefined" && module.exports) module.exports = Runtime;
}(this));
