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

NodeEventEmitter.prototype.removeListener = function (name, callback) {
    var listeners = this._events[name];
    if (!listeners) return this;
    for (var i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i] === callback || listeners[i].listener === callback) {
            listeners.splice(i, 1);
            break;
        }
    }
    return this;
};

NodeEventEmitter.prototype.once = function (name, callback) {
    if (typeof callback !== "function") throw new TypeError("listener must be a function");
    var emitter = this;
    function listener() {
        emitter.removeListener(name, listener);
        return callback.apply(this, arguments);
    }
    listener.listener = callback;
    return this.on(name, listener);
};
