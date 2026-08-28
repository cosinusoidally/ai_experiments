/* Embedder-side Node subset for guest programs.  This file deliberately runs
 * in the js_min.exe host, not inside the guest.  The libc-backed compatibility
 * stack owns descriptors and polling; only guest values cross this boundary. */
(function (root) {
    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function GuestNodeEnvironment(vm, runnerArguments) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.context = vm.context;
        this.retained = [];
        this.servers = [];
        this.moduleCache = {};
        this.moduleContexts = [];
        this.runnerArguments = runnerArguments;
        this.nodeHost = typeof module !== "undefined" && module.exports &&
                        typeof require === "function";
        this.exitCode = 0;
        this.exiting = false;
        this.exitMarker = {guestNodeExit: true};

        if (this.nodeHost) {
            this.hostFs = require("fs");
            this.hostNet = require("net");
            this.hostHttp = require("http");
            this.HostBuffer = require("buffer").Buffer;
            this.hostProcess = process;
        } else {
            load("node_compat/libc.js");
            load("node_compat/events.js");
            load("node_compat/process.js");
            load("node_compat/net.js");
            load("node_compat/fs.js");
            load("node_compat/http.js");
            NodeProcess.install(runnerArguments);
            this.hostFs = NodeFs;
            this.hostNet = NodeNet;
            this.hostHttp = NodeHttp;
            this.HostBuffer = Buffer;
            if (this.runtime.threadedCompiler) {
                this.runtime.threadedCompiler.setNativeMemmove(
                    function (destination, source, length) {
                        return NodeLibc.memmove(destination, source, length);
                    });
            }
        }
        this.installGlobals();
    }

    GuestNodeEnvironment.prototype.environmentValue = function (name) {
        if (this.nodeHost) return this.hostProcess.env[name];
        return NodeMemory.cString(NodeLibc.getenv(name));
    };

    GuestNodeEnvironment.prototype.writeOutput = function (fd, args) {
        var parts = [];
        var index = 0;
        while (index < args.length) parts.push(String(args[index++]));
        var text = parts.join(" ") + "\n";
        if (this.nodeHost) {
            if (fd === 2) this.hostProcess.stderr.write(text);
            else this.hostProcess.stdout.write(text);
        } else NodeMemory.writeAll(fd, text);
    };

    GuestNodeEnvironment.prototype.enqueueHost = function (callback) {
        if (this.nodeHost) setTimeout(callback, 0);
        else NodeRuntime.enqueue(callback);
    };

    GuestNodeEnvironment.prototype.setHostTimeout = function (callback, delay) {
        return this.nodeHost ? setTimeout(callback, delay) :
                               NodeRuntime.setTimeout(callback, delay);
    };

    GuestNodeEnvironment.prototype.clearHostTimeout = function (id) {
        if (this.nodeHost) clearTimeout(id);
        else NodeRuntime.clearTimeout(id);
    };

    GuestNodeEnvironment.prototype.hostNow = function () {
        return this.nodeHost ? new Date().getTime() : NodeRuntime.now();
    };

    GuestNodeEnvironment.prototype.isExit = function (value) {
        return value === this.exitMarker ||
               (!this.nodeHost && NodeProcess.isExit(value));
    };

    GuestNodeEnvironment.prototype.keep = function (value) {
        this.retained.push(this.vm.retain(value));
        return value;
    };

    GuestNodeEnvironment.prototype.makeFunction = function (name, callback, intrinsic) {
        return intrinsic ? this.runtime.makeNativeFunction(name, callback) :
                           this.runtime.makeHostFunction(name, callback);
    };

    GuestNodeEnvironment.prototype.object = function (values) {
        var result = this.runtime.makeObject();
        var key;
        for (key in values) {
            if (own(values, key)) this.runtime.setProperty(result, key, values[key]);
        }
        return result;
    };

    GuestNodeEnvironment.prototype.error = function (error) {
        if (!error) return null;
        return this.object({
            message: error.message === undefined ? String(error) : String(error.message),
            code: error.code,
            errno: error.errno,
            path: error.path,
            syscall: error.syscall
        });
    };

    GuestNodeEnvironment.prototype.hostHeaders = function (headers) {
        var result = {};
        if (!headers || !headers.properties) return result;
        var key;
        for (key in headers.properties) {
            if (own(headers.properties, key) && key.charAt(0) === "$") {
                result[key.substring(1)] = String(headers.properties[key]);
            }
        }
        return result;
    };

    GuestNodeEnvironment.prototype.guestBuffer = function (hostBuffer) {
        var bytes = hostBuffer && hostBuffer._nodeBytes ? hostBuffer._nodeBytes : hostBuffer;
        if (!bytes) bytes = [];
        var result = this.runtime.bufferSupport.allocate(bytes.length);
        var index = 0;
        while (index < bytes.length) {
            this.runtime.bufferSupport.write(result, index, bytes[index]);
            index++;
        }
        return result;
    };

    GuestNodeEnvironment.prototype.hostBody = function (value) {
        if (!value || value.guestType !== "buffer") return value;
        var bytes = [];
        var index = 0;
        var length = this.runtime.bufferSupport.viewLength(value);
        while (index < length) {
            bytes.push(this.runtime.bufferSupport.read(value, index));
            index++;
        }
        return this.nodeHost ? this.HostBuffer.from(bytes) : new this.HostBuffer(bytes);
    };

    GuestNodeEnvironment.prototype.invoke = function (callable, receiver, args) {
        var callbackContext = callable && callable.homeContext ?
                              callable.homeContext : this.context;
        var execution = callbackContext.startFunction(callable, receiver, args || []);
        while (true) {
            var result = execution.resume(this.runtime.threadedCompiler ?
                                          Infinity : 1000000);
            if (result.status === "budget") continue;
            if (result.status === "hostCall") {
                execution.serviceHostCall();
                continue;
            }
            if (result.status === "completed") return result.value;
            if (result.status === "threw") throw result.exception;
            throw new Error("unknown guest callback status: " + result.status);
        }
    };

    GuestNodeEnvironment.prototype.enqueueGuest = function (callable, receiver, args) {
        var environment = this;
        var roots = [this.vm.retain(callable)];
        if (receiver && receiver.guestType) roots.push(this.vm.retain(receiver));
        var index = 0;
        args = args || [];
        while (index < args.length) {
            if (args[index] && args[index].guestType) {
                roots.push(this.vm.retain(args[index]));
            }
            index++;
        }
        this.enqueueHost(function () {
            try {
                environment.invoke(callable, receiver, args);
            } finally {
                var rootIndex = 0;
                while (rootIndex < roots.length) {
                    environment.vm.release(roots[rootIndex++]);
                }
            }
        });
    };

    GuestNodeEnvironment.prototype.makeStats = function (stats) {
        var environment = this;
        var result = this.object({size: Number(stats.size) || 0});
        this.runtime.setProperty(result, "isDirectory",
            this.makeFunction("Stats.isDirectory", function () {
                return stats.isDirectory();
            }, true));
        this.runtime.setProperty(result, "isFile",
            this.makeFunction("Stats.isFile", function () {
                return stats.isFile();
            }, true));
        return result;
    };

    GuestNodeEnvironment.prototype.makeFs = function () {
        var environment = this;
        var fs = this.object({});
        this.runtime.setProperty(fs, "stat", this.makeFunction("fs.stat",
            function (receiver, args) {
                var path = String(args[0]);
                var callback = args[1];
                var callbackRoot = environment.vm.retain(callback);
                environment.hostFs.stat(path, function (error, stats) {
                    environment.enqueueGuest(callback, undefined,
                        [environment.error(error), error ? undefined : environment.makeStats(stats)]);
                    environment.vm.release(callbackRoot);
                });
                return undefined;
            }));
        this.runtime.setProperty(fs, "readdir", this.makeFunction("fs.readdir",
            function (receiver, args) {
                var path = String(args[0]);
                var callback = args[1];
                var callbackRoot = environment.vm.retain(callback);
                environment.hostFs.readdir(path, function (error, names) {
                    environment.enqueueGuest(callback, undefined,
                        [environment.error(error), error ? undefined :
                         environment.runtime.arrayFrom(names)]);
                    environment.vm.release(callbackRoot);
                });
                return undefined;
            }));
        this.runtime.setProperty(fs, "readFile", this.makeFunction("fs.readFile",
            function (receiver, args) {
                var path = String(args[0]);
                var callback = args[1];
                var callbackRoot = environment.vm.retain(callback);
                environment.hostFs.readFile(path, function (error, data) {
                    environment.enqueueGuest(callback, undefined,
                        [environment.error(error), error ? undefined :
                         environment.guestBuffer(data)]);
                    environment.vm.release(callbackRoot);
                });
                return undefined;
            }));
        this.runtime.setProperty(fs, "readFileSync", this.makeFunction("fs.readFileSync",
            function (receiver, args) {
                return environment.guestBuffer(environment.hostFs.readFileSync(String(args[0])));
            }));
        return fs;
    };

    GuestNodeEnvironment.prototype.makeSocket = function (hostSocket) {
        var environment = this;
        var socket = this.object({});
        this.keep(socket);
        this.runtime.setProperty(socket, "on", this.makeFunction("Socket.on",
            function (receiver, args) {
                var name = String(args[0]);
                var callback = args[1];
                environment.keep(callback);
                hostSocket.on(name, function (value) {
                    var callbackArgs = [];
                    if (name === "data") callbackArgs.push(environment.guestBuffer(value));
                    else if (value !== undefined) callbackArgs.push(environment.error(value));
                    environment.enqueueGuest(callback, socket, callbackArgs);
                });
                return socket;
            }));
        this.runtime.setProperty(socket, "write", this.makeFunction("Socket.write",
            function (receiver, args) {
                var value = args[0];
                var callback = args.length > 1 ? args[1] : undefined;
                var valueRoot = value && value.guestType ? environment.vm.retain(value) : 0;
                var callbackRoot = callback ? environment.vm.retain(callback) : 0;
                var hostValue;
                if (value && value.guestType === "buffer" &&
                    environment.runtime.bufferSupport.viewBacking(value).
                        allocation.isNative) {
                    var valueBacking = environment.runtime.bufferSupport.
                        viewBacking(value);
                    hostValue = {_nodePointer: valueBacking.allocation.pointer +
                            environment.runtime.bufferSupport.viewOffset(value),
                        length: environment.runtime.bufferSupport.viewLength(value)};
                } else hostValue = environment.hostBody(value);
                return hostSocket.write(hostValue, function () {
                    if (callback) environment.enqueueGuest(callback, socket, []);
                    if (callbackRoot) environment.vm.release(callbackRoot);
                    if (valueRoot) environment.vm.release(valueRoot);
                });
            }));
        this.runtime.setProperty(socket, "end", this.makeFunction("Socket.end",
            function (receiver, args) {
                hostSocket.end(args.length ? environment.hostBody(args[0]) : undefined);
                return socket;
            }));
        this.runtime.setProperty(socket, "close", this.makeFunction("Socket.close",
            function () { hostSocket.destroy(); return socket; }));
        return socket;
    };

    GuestNodeEnvironment.prototype.makeNet = function () {
        var environment = this;
        var net = this.object({});
        this.runtime.setProperty(net, "createConnection",
            this.makeFunction("net.createConnection", function (receiver, args) {
                return environment.makeSocket(
                    environment.hostNet.createConnection(String(args[0])));
            }));
        return net;
    };

    GuestNodeEnvironment.prototype.dirname = function (path) {
        var slash = path.lastIndexOf("/");
        return slash < 0 ? "." : path.substring(0, slash) || ".";
    };

    GuestNodeEnvironment.prototype.normalizeModulePath = function (path) {
        var parts = path.split("/");
        var normalized = [];
        var index = 0;
        while (index < parts.length) {
            var part = parts[index++];
            if (!part || part === ".") continue;
            if (part === "..") {
                if (!normalized.length) throw new Error("module path escapes test directory");
                normalized.pop();
            } else normalized.push(part);
        }
        path = normalized.join("/");
        if (path.substring(path.length - 3) !== ".js") path += ".js";
        return path;
    };

    GuestNodeEnvironment.prototype.loadModule = function (request, parentFilename) {
        if (own(this.builtinModules, request)) return this.builtinModules[request];
        if (request.substring(0, 2) !== "./" && request.substring(0, 3) !== "../") {
            throw new Error("unsupported guest module: " + request);
        }
        var filename = this.normalizeModulePath(
            this.dirname(parentFilename) + "/" + request);
        if (own(this.moduleCache, filename)) return this.moduleCache[filename].exports;

        var source = this.hostFs.readFileSync(filename).toString("utf8");
        var context = this.vm.jsRuntime.createContext();
        this.moduleContexts.push(context);
        var moduleRecord = {exports: this.object({}), context: context};
        this.moduleCache[filename] = moduleRecord;
        var moduleObject = this.object({exports: moduleRecord.exports,
                                        filename: filename});
        var environment = this;
        context.installGlobal("module", moduleObject);
        context.installGlobal("exports", moduleRecord.exports);
        context.installGlobal("__filename", filename);
        context.installGlobal("__dirname", this.dirname(filename));
        context.installGlobal("require", this.makeFunction("require", function (receiver, args) {
            return environment.loadModule(String(args[0]), filename);
        }));
        try {
            context.run(source, filename);
            moduleRecord.exports = this.runtime.getProperty(moduleObject, "exports");
            return moduleRecord.exports;
        } catch (error) {
            delete this.moduleCache[filename];
            context.destroy();
            throw error;
        }
    };

    GuestNodeEnvironment.prototype.makeResponse = function (hostResponse) {
        var environment = this;
        var response = this.object({});
        this.runtime.setProperty(response, "writeHead",
            this.makeFunction("ServerResponse.writeHead", function (receiver, args) {
                hostResponse.writeHead(Number(args[0]), environment.hostHeaders(args[1]));
                return response;
            }));
        this.runtime.setProperty(response, "end",
            this.makeFunction("ServerResponse.end", function (receiver, args) {
                hostResponse.end(args.length ? environment.hostBody(args[0]) : undefined);
                return response;
            }));
        return response;
    };

    GuestNodeEnvironment.prototype.makeRequest = function (hostRequest) {
        return this.object({
            method: hostRequest.method,
            url: hostRequest.url,
            httpVersion: hostRequest.httpVersion,
            socket: this.object({
                remoteAddress: hostRequest.socket.remoteAddress,
                remotePort: hostRequest.socket.remotePort
            })
        });
    };

    GuestNodeEnvironment.prototype.makeServer = function (listener) {
        var environment = this;
        var server = this.object({});
        var listeners = {};
        var hostServer = this.hostHttp.createServer(function (request, response) {
            environment.enqueueGuest(listener, server,
                [environment.makeRequest(request), environment.makeResponse(response)]);
        });
        this.keep(listener);
        this.keep(server);
        this.servers.push(hostServer);

        this.runtime.setProperty(server, "on", this.makeFunction("Server.on",
            function (receiver, args) {
                var name = String(args[0]);
                var callback = args[1];
                listeners[name] = callback;
                environment.keep(callback);
                hostServer.on(name, function (error) {
                    environment.enqueueGuest(callback, server,
                        error ? [environment.error(error)] : []);
                });
                return server;
            }));
        this.runtime.setProperty(server, "listen", this.makeFunction("Server.listen",
            function (receiver, args) {
                var callback = args.length > 2 ? args[2] : undefined;
                var callbackRoot = callback ? environment.vm.retain(callback) : 0;
                hostServer.listen(Number(args[0]), String(args[1]), callback ? function () {
                    environment.enqueueGuest(callback, server, []);
                    environment.vm.release(callbackRoot);
                } : undefined);
                return server;
            }));
        this.runtime.setProperty(server, "address", this.makeFunction("Server.address",
            function () {
                var address = hostServer.address();
                return address ? environment.object({address: address.address,
                    family: address.family, port: address.port}) : null;
            }));
        return server;
    };

    GuestNodeEnvironment.prototype.makeHttp = function () {
        var environment = this;
        var http = this.object({});
        this.runtime.setProperty(http, "createServer",
            this.makeFunction("http.createServer", function (receiver, args) {
                return environment.makeServer(args[0]);
            }));
        return http;
    };

    GuestNodeEnvironment.prototype.installGlobals = function () {
        var environment = this;
        var fs = this.makeFs();
        var http = this.makeHttp();
        var net = this.makeNet();
        this.builtinModules = {fs: fs, http: http, net: net};

        function publish(name, value) {
            environment.runtime.setGlobal(name, value);
            environment.context.installGlobal(name, value);
        }

        publish("require", this.makeFunction("require",
            function (receiver, args) {
                var name = String(args[0]);
                return environment.loadModule(name, environment.runnerArguments[0]);
            }));

        if (!this.nodeHost) {
            publish("load", this.makeFunction("load", function (receiver, args) {
                if (!args.length) throw new TypeError("load requires a filename");
                var filename = String(args[0]);
                var sourceBuffer = environment.hostFs.readFileSync(filename);
                var source = sourceBuffer.toString("utf8");
                var loadContext = environment.vm.jsRuntime.createContext();
                /* SpiderMonkey shell load() executes against the caller's
                 * global object. Sharing this binding table preserves that
                 * observable behavior while retaining an independent active
                 * execution slot for nested guest evaluation. */
                loadContext.shareGlobalObject(environment.context);
                environment.moduleContexts.push(loadContext);
                loadContext.run(source, filename);
                return undefined;
            }));
        }

        var argv = ["artifacts/js_min.exe", this.runnerArguments[0]];
        var index = 1;
        while (index < this.runnerArguments.length) argv.push(this.runnerArguments[index++]);
        var processObject = this.object({
            argv: this.runtime.arrayFrom(argv),
            env: this.object({
                DISPLAY: this.environmentValue("DISPLAY"),
                XAUTHORITY: this.environmentValue("XAUTHORITY"),
                HOME: this.environmentValue("HOME")
            }),
            exitCode: 0
        });
        this.runtime.setProperty(processObject, "exit", this.makeFunction("process.exit",
            function (receiver, args) {
                environment.exitCode = args.length ? Number(args[0]) | 0 : 0;
                environment.exiting = true;
                if (environment.nodeHost) environment.hostProcess.exitCode = environment.exitCode;
                else {
                    NodeProcess.exitCode = environment.exitCode;
                    NodeProcess.exiting = true;
                }
                throw environment.exitMarker;
            }));
        publish("process", processObject);

        var consoleObject = this.object({});
        this.runtime.setProperty(consoleObject, "log", this.makeFunction("console.log",
            function (receiver, args) {
                environment.writeOutput(1, args);
            }));
        this.runtime.setProperty(consoleObject, "error", this.makeFunction("console.error",
            function (receiver, args) {
                environment.writeOutput(2, args);
            }));
        publish("console", consoleObject);

        var bufferConstructor = this.runtime.getGlobal(this.context, "Buffer");
        this.runtime.setProperty(bufferConstructor, "byteLength",
            this.makeFunction("Buffer.byteLength", function (receiver, args) {
                return environment.nodeHost ?
                    environment.HostBuffer.byteLength(String(args[0]), "utf8") :
                    NodeEncoding.utf8Bytes(String(args[0])).length;
            }, true));

        /* MMVM's Node compatibility layer exposes this internal helper to
         * renderers which batch native framebuffer writes.  Keep it an
         * intrinsic: like peek/poke, copying already-validated native memory
         * must not turn every raster span into a guest/host suspension.  A
         * Node-hosted guest never takes this path because its Buffer backing
         * stores have no native pointer. */
        var libcObject = this.object({});
        this.runtime.setProperty(libcObject, "memmove",
            this.makeFunction("NodeLibc.memmove", function (receiver, args) {
                if (environment.nodeHost) {
                    throw new Error("NodeLibc.memmove requires native MMVM buffers");
                }
                NodeLibc.memmove(Number(args[0]), Number(args[1]), Number(args[2]));
                return args[0];
            }, true));
        publish("NodeLibc", libcObject);

        publish("encodeURIComponent",
            this.makeFunction("encodeURIComponent", function (receiver, args) {
                return encodeURIComponent(String(args[0]));
            }, true));
        publish("decodeURIComponent",
            this.makeFunction("decodeURIComponent", function (receiver, args) {
                return decodeURIComponent(String(args[0]));
            }, true));

        var dateConstructor = this.makeFunction("Date", function () {}, true);
        dateConstructor.constructCallback = function () {
            var hostDate = new Date();
            var date = environment.object({});
            function method(name) {
                environment.runtime.setProperty(date, name,
                    environment.makeFunction("Date." + name, function () {
                        return hostDate[name]();
                    }, true));
            }
            method("getDate"); method("getMonth"); method("getFullYear");
            method("getHours"); method("getMinutes"); method("getSeconds");
            method("getTime");
            return date;
        };
        publish("Date", dateConstructor);

        var errorConstructor = this.makeFunction("Error", function (receiver, args) {
            return environment.object({name: "Error",
                message: args.length ? String(args[0]) : ""});
        }, true);
        errorConstructor.constructCallback = function (args) {
            return environment.object({name: "Error",
                message: args.length ? String(args[0]) : ""});
        };
        publish("Error", errorConstructor);

        publish("setTimeout", this.makeFunction("setTimeout", function (receiver, args) {
            var callback = args[0];
            var callbackRoot = environment.vm.retain(callback);
            return environment.setHostTimeout(function () {
                try { environment.invoke(callback, undefined, []); }
                finally { environment.vm.release(callbackRoot); }
            }, Number(args[1]) || 0);
        }));
        publish("clearTimeout", this.makeFunction("clearTimeout", function (receiver, args) {
            environment.clearHostTimeout(args[0]);
        }));
        publish("requestAnimationFrame", this.makeFunction("requestAnimationFrame",
            function (receiver, args) {
                var callback = args[0];
                var callbackRoot = environment.vm.retain(callback);
                return environment.setHostTimeout(function () {
                    try { environment.invoke(callback, undefined, [environment.hostNow()]); }
                    finally { environment.vm.release(callbackRoot); }
                }, 16);
            }));
    };

    GuestNodeEnvironment.prototype.run = function () {
        if (!this.nodeHost) {
            NodeRuntime.run();
            this.exitCode = NodeProcess.exitCode;
        }
        return this.exitCode;
    };

    GuestNodeEnvironment.prototype.destroy = function () {
        var index = 0;
        while (index < this.retained.length) {
            try { this.vm.release(this.retained[index]); } catch (ignored) {}
            index++;
        }
        this.retained = [];
    };

    root.GuestNodeEnvironment = GuestNodeEnvironment;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = GuestNodeEnvironment;
    }
}(this));
