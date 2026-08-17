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
