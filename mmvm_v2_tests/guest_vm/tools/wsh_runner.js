/* Microsoft WSH build host. No Node impersonation, FFI or native extension.
 * From mmvm_v2_tests:
 * cscript //nologo guest_vm/tools/wsh_runner.js guest_runner.js --vm-native --snapshot artifacts/a.snap
 * cscript //nologo guest_vm/tools/wsh_runner.js guest_vm/tools/snapshot_to_exe.js artifacts/a.snap artifacts/a.exe --win32
 * Implementation modules publish through their explicit global root. */
var GuestWSHGlobal = this;
var GuestWSHFSO = new ActiveXObject("Scripting.FileSystemObject");
var GuestWSHShell = new ActiveXObject("WScript.Shell");
var arguments = [];
for (var GuestWSHIndex = 0; GuestWSHIndex < WScript.Arguments.length; GuestWSHIndex++) {
    arguments.push(String(WScript.Arguments.Item(GuestWSHIndex)));
}
var GuestWSHProgram = arguments.shift();
if (!GuestWSHProgram) throw new Error("expected a script and its arguments");
function print(text) { WScript.StdOut.WriteLine(String(text)); }
function quit(code) { WScript.Quit(code | 0); }
function load(filename) {
    /* Classic JScript's indirect eval inherits its caller's arguments. Use
     * explicit shell bindings instead; module IIFEs still receive the global
     * root and publish exactly the same constructors as the other hosts. */
    Function("arguments", "print", "read", "load", read(filename)).call(
        GuestWSHGlobal, GuestWSHGlobal.arguments, print, read, load);
}

(function (root) {
    var fs = GuestWSHFSO, shell = GuestWSHShell, hexDigits = "0123456789abcdef", pairs = [];
    for (var i = 0; i < 256; i++) pairs[i] = hexDigits.charAt(i >>> 4) + hexDigits.charAt(i & 15);
    function temporary() { return fs.BuildPath(fs.GetSpecialFolder(2), fs.GetTempName()); }
    function remove(path) { if (fs.FileExists(path)) fs.DeleteFile(path, true); }
    function quote(path) {
        path = fs.GetAbsolutePathName(path);
        if (path.indexOf('"') >= 0 || path.indexOf("\n") >= 0) throw new Error("invalid WSH path");
        return '"' + path + '"';
    }
    function convert(mode, source, target) {
        var command = quote(WScript.FullName) + " //nologo " + quote("guest_vm/tools/wsh_binary.vbs") +
            " " + mode + " " + quote(source) + " " + quote(target);
        if (shell.Run(command, 0, true) !== 0) throw new Error("WSH binary conversion failed: " + mode);
    }
    function readHex(path) {
        var name = temporary();
        try {
            convert("bin2hex", path, name);
            var input = fs.OpenTextFile(name, 1, false, 0), text = input.ReadAll(); input.Close();
            return text;
        } finally { remove(name); }
    }
    function bytesFromHex(text) {
        if (text.length & 1) throw new Error("odd binary hex length");
        var bytes = [];
        for (var n = 0; n < text.length; n += 2) bytes.push(parseInt(text.substring(n, n + 2), 16));
        return bytes;
    }
    function utf8(bytes) {
        var chars = [], n = 0;
        while (n < bytes.length) {
            var code = bytes[n++], needed = 0, minimum = 0;
            if (code >= 194 && code < 224) { code &= 31; needed = 1; minimum = 128; }
            else if (code >= 224 && code < 240) { code &= 15; needed = 2; minimum = 2048; }
            else if (code >= 240 && code < 245) { code &= 7; needed = 3; minimum = 65536; }
            else if (code >= 128) { chars.push("\ufffd"); continue; }
            var valid = n + needed <= bytes.length;
            while (valid && needed > 0) {
                var next = bytes[n];
                if ((next & 192) !== 128) { valid = false; break; }
                n++; code = code * 64 + (next & 63); needed--;
            }
            if (!valid || code < minimum || code > 1114111 || code >= 55296 && code <= 57343) chars.push("\ufffd");
            else if (code < 65536) chars.push(String.fromCharCode(code));
            else { code -= 65536; chars.push(String.fromCharCode(55296 + (code >>> 10), 56320 + (code & 1023))); }
        }
        return chars.join("");
    }
    function readText(path) {
        var input = fs.OpenTextFile(path, 1, false, 0), text = input.ReadAll(); input.Close();
        /* ASCII sources avoid a subprocess and per-byte arrays. Wide/UTF-8
         * input uses the byte transport; never decode source using ACP. */
        for (var n = 0; n < text.length; n++) if (text.charCodeAt(n) > 127) return utf8(bytesFromHex(readHex(path)));
        return text;
    }
    function FileBuffer(path, text) { this.path = path; this.text = text; this.length = fs.GetFile(path).Size; }
    FileBuffer.prototype.toString = function (encoding) {
        if (encoding && encoding !== "utf8" && encoding !== "utf-8") throw new Error("unsupported WSH text encoding");
        if (this.text === null) this.text = readText(this.path);
        return this.text;
    };
    function fileBytes(buffer) {
        if (buffer instanceof Array) return buffer;
        return bytesFromHex(readHex(buffer.path));
    }
    function stats(path) {
        var directory = fs.FolderExists(path);
        if (!directory && !fs.FileExists(path)) { var error = new Error("file not found: " + path); error.code = "ENOENT"; throw error; }
        return {size: directory ? 0 : fs.GetFile(path).Size,
            isDirectory: function () { return directory; }, isFile: function () { return !directory; }};
    }
    var callbacks = [];
    function unsupported() { throw new Error("operation unavailable on the WSH build host"); }
    var services = {
        fs: {readFileSync: function (path, encoding) { return encoding ? readText(path) : new FileBuffer(path, null); },
            statSync: stats, readdirSync: function (path) {
                var result = [], folder = fs.GetFolder(path), e = new Enumerator(folder.SubFolders);
                for (; !e.atEnd(); e.moveNext()) result.push(String(e.item().Name));
                e = new Enumerator(folder.Files);
                for (; !e.atEnd(); e.moveNext()) result.push(String(e.item().Name));
                return result.sort();
            }},
        net: {createConnection: unsupported}, http: {createServer: unsupported},
        process: {env: {}, cwd: function () { return String(shell.CurrentDirectory).replace(/\\/g, "/"); },
            stdout: {write: function (text) { WScript.StdOut.Write(String(text)); }},
            stderr: {write: function (text) { WScript.StdErr.Write(String(text)); }}, exitCode: 0},
        buffer: {from: function (bytes) { return bytes; }}, bytes: fileBytes,
        enqueue: function (fn) { callbacks.push(fn); },
        setTimeout: unsupported, clearTimeout: unsupported,
        run: function () { while (callbacks.length) callbacks.shift()(); },
        readText: readText,
        collectBuildGarbage: function () { CollectGarbage(); },
        writeSnapshot: function (output, path, image, imageLength) {
            var hexPath = temporary(), binaryPath = path + ".tmp." + fs.GetTempName();
            var target = fs.CreateTextFile(hexPath, false, false);
            function allocation(a, length) {
                var offset = 0;
                while (offset < length) {
                    var limit = Math.min(offset + 16384, length), chunk = [];
                    /* Serialize complete little-endian words through the
                     * existing memory API. No per-byte COM calls or dependence
                     * on the provider's private page representation. */
                    while (offset + 4 <= limit) {
                        var word = output.host.read32LETrusted(a, offset);
                        chunk.push(pairs[word & 255], pairs[(word >>> 8) & 255],
                            pairs[(word >>> 16) & 255], pairs[word >>> 24]);
                        offset += 4;
                    }
                    while (offset < limit) chunk.push(pairs[output.host.read8Trusted(a, offset++)]);
                    target.Write(chunk.join(""));
                }
            }
            try {
                allocation(output.allocation, output.length);
                if (imageLength) allocation(image, imageLength);
                target.Close(); target = null;
                convert("hex2bin", hexPath, binaryPath);
                /* Never remove a valid old image before its replacement is
                 * complete. FSO move is no-clobber; builds use fresh outputs. */
                if (fs.FileExists(path)) throw new Error("WSH snapshot output already exists: " + path);
                fs.MoveFile(binaryPath, path); return true;
            } finally { if (target) target.Close(); remove(hexPath); remove(binaryPath); }
        }
    };
    services.fs.readFile = function (path, callback) { services.enqueue(function () {
        try { var result = services.fs.readFileSync(path); } catch (error) { callback(error); return; }
        callback(null, result);
    }); };
    services.fs.stat = function (path, callback) { services.enqueue(function () {
        try { var result = stats(path); } catch (error) { callback(error); return; } callback(null, result);
    }); };
    services.fs.readdir = function (path, callback) { services.enqueue(function () {
        try { var result = services.fs.readdirSync(path); } catch (error) { callback(error); return; } callback(null, result);
    }); };
    services.packagerIO = function () {
        var scratch = [], scratchHex = null, files = [];
        function register(file) { var fd = files.length; files.push(file); return fd; }
        return {
            openInput: function (path) {
                var name = temporary();
                try { convert("bin2hex", path, name); }
                catch (error) { remove(name); throw error; }
                try { return register({stream: fs.OpenTextFile(name, 1, false, 0), hex: name,
                    length: fs.GetFile(path).Size, position: 0, output: false}); }
                catch (error) { remove(name); throw error; }
            },
            createOutput: function (path) {
                if (fs.FileExists(path)) throw new Error("output already exists: " + path);
                var name = temporary();
                return register({stream: fs.CreateTextFile(name, false, false), hex: name,
                    path: path, output: true});
            },
            length: function (fd) { return files[fd].length; },
            read: function (descriptor, count) {
                var fd = files[descriptor];
                count = Math.min(count, fd.length - fd.position);
                scratchHex = count ? fd.stream.Read(count * 2) : "";
                if (scratchHex.length !== count * 2) throw new Error("truncated WSH binary input");
                fd.position += count; return count;
            },
            get: function (index) { return scratchHex === null ? scratch[index] :
                parseInt(scratchHex.substring(index * 2, index * 2 + 2), 16); },
            set: function (index, value) {
                if (scratchHex !== null) { scratchHex = null; scratch = []; }
                scratch[index] = value & 255;
            },
            write: function (descriptor, count) {
                var fd = files[descriptor];
                if (scratchHex !== null) fd.stream.Write(scratchHex.substring(0, count * 2));
                else {
                    var parts = [];
                    for (var n = 0; n < count; n++) parts.push(pairs[scratch[n]]);
                    fd.stream.Write(parts.join(""));
                }
            },
            close: function (descriptor) {
                var fd = files[descriptor];
                if (!fd) return;
                files[descriptor] = null; fd.stream.Close();
                try { if (fd.output) convert("hex2bin", fd.hex, fd.path); }
                finally { remove(fd.hex); }
            },
            chmod: function () {},
            publish: function (temporaryPath, destination) { fs.MoveFile(temporaryPath, destination); },
            remove: remove, pid: function () { return fs.GetTempName(); }, dispose: function () {
                for (var n = 0; n < files.length; n++) if (files[n]) {
                    try { files[n].stream.Close(); } finally { remove(files[n].hex); files[n] = null; }
                }
            }
        };
    };
    root.GuestVMWSHHost = services;
    root.read = readText;
}(GuestWSHGlobal));

load("guest_vm/tools/wsh_memory.js");
try { load(GuestWSHProgram); }
catch (GuestWSHError) {
    WScript.StdErr.WriteLine("WSH build: " + (GuestWSHError.description || GuestWSHError.message || String(GuestWSHError)));
    if (GuestWSHError.stack) WScript.StdErr.WriteLine(GuestWSHError.stack);
    quit(1);
}
