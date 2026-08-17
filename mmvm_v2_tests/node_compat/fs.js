/* Minimal synchronous and callback-based fs surface needed by node_web.js. */
var NodeFsConstants = {SEEK_SET: 0, SEEK_END: 2, ENOENT: 2, EACCES: 13};

function nodeFsError(operation, path, number) {
    var code = number === NodeFsConstants.ENOENT ? "ENOENT" :
               number === NodeFsConstants.EACCES ? "EACCES" : "E" + number;
    var error = new Error(code + ": " + operation + " '" + path + "'");
    error.errno = number;
    error.code = code;
    error.path = path;
    error.syscall = operation;
    return error;
}

function nodeFsCString(pointer) {
    var value = "";
    for (var i = 0; i < 4096; i++) {
        var code = peek8(pointer + i);
        if (code === 0) break;
        value += String.fromCharCode(code);
    }
    return value;
}

function NodeStats(directory, size) {
    this.size = size || 0;
    this._directory = directory;
}

NodeStats.prototype.isDirectory = function () { return this._directory; };
NodeStats.prototype.isFile = function () { return !this._directory; };

var NodeFs = {
    statSync: function (path) {
        path = String(path);
        var directory = NodeLibc.opendir(path);
        if (directory) {
            NodeLibc.closedir(directory);
            return new NodeStats(true, 0);
        }
        var file = NodeLibc.fopen(path, "rb");
        if (!file) throw nodeFsError("stat", path, NodeLibc.errno());
        var size = 0;
        if (NodeLibc.fseek(file, 0, NodeFsConstants.SEEK_END) === 0) {
            size = NodeLibc.ftell(file);
            if (size < 0) size = 0;
        }
        NodeLibc.fclose(file);
        return new NodeStats(false, size);
    },

    readdirSync: function (path) {
        path = String(path);
        var directory = NodeLibc.opendir(path);
        if (!directory) throw nodeFsError("readdir", path, NodeLibc.errno());
        var names = [];
        var entry;
        while ((entry = NodeLibc.readdir(directory)) !== 0) {
            /* Linux i386 struct dirent has d_name at byte offset 11. */
            var name = nodeFsCString(entry + 11);
            if (name !== "." && name !== "..") names.push(name);
        }
        NodeLibc.closedir(directory);
        return names;
    },

    readFileSync: function (path) {
        path = String(path);
        var file = NodeLibc.fopen(path, "rb");
        if (!file) throw nodeFsError("open", path, NodeLibc.errno());
        if (NodeLibc.fseek(file, 0, NodeFsConstants.SEEK_END) !== 0) {
            var seekError = nodeFsError("fseek", path, NodeLibc.errno());
            NodeLibc.fclose(file);
            throw seekError;
        }
        var length = NodeLibc.ftell(file);
        NodeLibc.fseek(file, 0, NodeFsConstants.SEEK_SET);
        if (length < 0) {
            var tellError = nodeFsError("ftell", path, NodeLibc.errno());
            NodeLibc.fclose(file);
            throw tellError;
        }
        var pointer = NodeMemory.allocate(length);
        var bytes = [];
        var remaining = length;
        while (remaining > 0) {
            var wanted = remaining > 65536 ? 65536 : remaining;
            var count = NodeLibc.fread(pointer, 1, wanted, file);
            if (count <= 0) break;
            for (var i = 0; i < count; i++) bytes.push(peek8(pointer + i));
            remaining -= count;
        }
        NodeMemory.free(pointer);
        NodeLibc.fclose(file);
        return new Buffer(bytes);
    },

    stat: function (path, callback) {
        NodeRuntime.enqueue(function () {
            var result;
            try { result = NodeFs.statSync(path); }
            catch (error) {
                callback(error);
                return;
            }
            callback(null, result);
        });
    },

    readdir: function (path, callback) {
        NodeRuntime.enqueue(function () {
            var result;
            try { result = NodeFs.readdirSync(path); }
            catch (error) {
                callback(error);
                return;
            }
            callback(null, result);
        });
    },

    readFile: function (path, callback) {
        NodeRuntime.enqueue(function () {
            var result;
            try { result = NodeFs.readFileSync(path); }
            catch (error) {
                callback(error);
                return;
            }
            callback(null, result);
        });
    }
};
