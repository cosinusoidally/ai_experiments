/* Minimal CommonJS loader: built-ins and relative .js files only. */
var NodeModule = {
    cache: {},

    builtins: function (name) {
        if (name === "http") return NodeHttp;
        if (name === "fs") return NodeFs;
        if (name === "net") return NodeNet;
        return null;
    },

    dirname: function (path) {
        var slash = path.lastIndexOf("/");
        return slash < 0 ? "." : path.substring(0, slash) || ".";
    },

    normalize: function (path) {
        var parts = path.split("/");
        var normalized = [];
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (!part || part === ".") continue;
            if (part === "..") {
                if (normalized.length === 0) {
                    throw new Error("module path escapes the test directory: " + path);
                }
                normalized.pop();
            } else {
                normalized.push(part);
            }
        }
        return normalized.join("/");
    },

    resolve: function (request, parentFilename) {
        if (request.substring(0, 2) !== "./" && request.substring(0, 3) !== "../") {
            throw new Error("unsupported module: " + request);
        }
        var filename = this.normalize(this.dirname(parentFilename) + "/" + request);
        if (filename.length < 3 || filename.substring(filename.length - 3) !== ".js") {
            filename += ".js";
        }
        return filename;
    },

    load: function (request, parentFilename) {
        var builtin = this.builtins(request);
        if (builtin) return builtin;

        var filename = this.resolve(request, parentFilename);
        if (this.cache[filename]) return this.cache[filename].exports;

        var module = {exports: {}, filename: filename};
        this.cache[filename] = module;
        try {
            var source = NodeFs.readFileSync(filename).toString("utf8");
            var loader = new Function("require", "module", "exports", "__filename", "__dirname",
                                      source + "\n");
            var parent = this;
            var localRequire = function (name) { return parent.load(name, filename); };
            loader(localRequire, module, module.exports, filename, this.dirname(filename));
        } catch (error) {
            delete this.cache[filename];
            throw error;
        }
        return module.exports;
    },

    runMain: function (filename) {
        filename = this.normalize(filename);
        if (filename.length < 3 || filename.substring(filename.length - 3) !== ".js") {
            filename += ".js";
        }
        var module = {exports: {}, filename: filename};
        this.cache[filename] = module;
        var source = NodeFs.readFileSync(filename).toString("utf8");
        var loader = new Function("require", "module", "exports", "__filename", "__dirname",
                                  source + "\n");
        var parent = this;
        var localRequire = function (name) { return parent.load(name, filename); };
        loader(localRequire, module, module.exports, filename, this.dirname(filename));
        return module.exports;
    }
};
