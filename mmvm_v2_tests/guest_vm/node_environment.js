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
        this.runnerArguments = runnerArguments;

        load("node_compat/libc.js");
        load("node_compat/events.js");
        load("node_compat/process.js");
        load("node_compat/net.js");
        load("node_compat/fs.js");
        load("node_compat/http.js");
        NodeProcess.install(runnerArguments);
        this.installGlobals();
    }

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
        var bytes = hostBuffer && hostBuffer._nodeBytes ? hostBuffer._nodeBytes : [];
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
        while (index < value.length) {
            bytes.push(this.runtime.bufferSupport.read(value, index));
            index++;
        }
        return new Buffer(bytes);
    };

    GuestNodeEnvironment.prototype.invoke = function (callable, receiver, args) {
        var execution = this.context.startFunction(callable, receiver, args || []);
        while (true) {
            var result = execution.resume(1000000);
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
        NodeRuntime.enqueue(function () {
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
                NodeFs.stat(path, function (error, stats) {
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
                NodeFs.readdir(path, function (error, names) {
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
                NodeFs.readFile(path, function (error, data) {
                    environment.enqueueGuest(callback, undefined,
                        [environment.error(error), error ? undefined :
                         environment.guestBuffer(data)]);
                    environment.vm.release(callbackRoot);
                });
                return undefined;
            }));
        return fs;
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
        var hostServer = NodeHttp.createServer(function (request, response) {
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
        var modules = {fs: fs, http: http};

        this.vm.installGlobal("require", this.makeFunction("require",
            function (receiver, args) {
                var name = String(args[0]);
                if (!own(modules, name)) throw new Error("unsupported guest module: " + name);
                return modules[name];
            }));

        var argv = ["artifacts/js_min.exe", this.runnerArguments[0]];
        var index = 1;
        while (index < this.runnerArguments.length) argv.push(this.runnerArguments[index++]);
        var processObject = this.object({argv: this.runtime.arrayFrom(argv)});
        this.runtime.setProperty(processObject, "exit", this.makeFunction("process.exit",
            function (receiver, args) {
                NodeProcess.exitCode = args.length ? Number(args[0]) | 0 : 0;
                NodeProcess.exiting = true;
                throw NodeProcess.exitMarker;
            }));
        this.vm.installGlobal("process", processObject);

        var consoleObject = this.object({});
        this.runtime.setProperty(consoleObject, "log", this.makeFunction("console.log",
            function (receiver, args) {
                NodeMemory.writeAll(1, NodeProcess.formatArguments(args) + "\n");
            }));
        this.runtime.setProperty(consoleObject, "error", this.makeFunction("console.error",
            function (receiver, args) {
                NodeMemory.writeAll(2, NodeProcess.formatArguments(args) + "\n");
            }));
        this.vm.installGlobal("console", consoleObject);

        var bufferConstructor = this.runtime.getGlobal(this.context, "Buffer");
        this.runtime.setProperty(bufferConstructor, "byteLength",
            this.makeFunction("Buffer.byteLength", function (receiver, args) {
                return NodeEncoding.utf8Bytes(String(args[0])).length;
            }, true));

        this.vm.installGlobal("encodeURIComponent",
            this.makeFunction("encodeURIComponent", function (receiver, args) {
                return encodeURIComponent(String(args[0]));
            }, true));
        this.vm.installGlobal("decodeURIComponent",
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
            return date;
        };
        this.vm.installGlobal("Date", dateConstructor);
    };

    GuestNodeEnvironment.prototype.run = function () {
        NodeRuntime.run();
        return NodeProcess.exitCode;
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
}(this));
