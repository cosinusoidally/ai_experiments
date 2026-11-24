/* Bounded bootstrap-shaped diagnostic, ES3 syntax, no dependencies.
 * Run from mmvm_v2_tests using node, js_min, Microsoft cscript or guest exe.
 * Default: two 200k-node batches (~400k objects, 800k arrays, >=1.2m strings),
 * real parser inputs and 8 MiB emulated memory. No FFI calls or file output.
 * Optional --small divides synthetic volumes by four (not parser inputs).
 * This is a host comparison, not a prediction of complete build time. */
(function (root) {
    var node = typeof process !== "undefined" && process.versions && process.versions.node &&
        typeof get_dlsym !== "function";
    var wsh = typeof WScript !== "undefined";
    var output = node ? function (s) { console.log(s); } :
        wsh ? function (s) { WScript.Echo(s); } : print;
    var args = node ? process.argv.slice(2) : wsh ? [] : root.arguments;
    var fs = node ? require("fs") : wsh ? new ActiveXObject("Scripting.FileSystemObject") : null;
    if (wsh) for (var a = 0; a < WScript.Arguments.length; a++) args.push(WScript.Arguments.Item(a));
    var small = false;
    for (a = 0; a < args.length; a++) {
        if (args[a] !== "--small") throw new Error("unknown option " + args[a]);
        small = true;
    }
    function readSource(path) {
        var text;
        if (node) text = fs.readFileSync(path, "utf8");
        else if (wsh) {
            var file = fs.OpenTextFile(path, 1, false); text = file.ReadAll(); file.Close();
        } else text = read(path);
        /* The selected checked-in inputs are ASCII. Do not silently compare
         * ANSI-decoded WSH inputs with UTF-8-decoded inputs on other hosts. */
        for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) {
            throw new Error("benchmark input is no longer ASCII: " + path);
        }
        return text;
    }
    var started = new Date().getTime(), total = 0;
    var count = small ? 50000 : 200000, rounds = 2, byteLength = small ? 2097152 : 8388608;
    var nodes, names, sources = [], parser;
    var files = ["guest_vm/aot/native_interpreter.js", "guest_vm/aot/kernel_compiler.js", "guest_vm/compiler.js"];
    var host = node ? "Node " + process.version : wsh ? "JScript " + ScriptEngineMajorVersion() + "." +
        ScriptEngineMinorVersion() + "." + ScriptEngineBuildVersion() :
        typeof __guestVMStandaloneImageBase !== "undefined" ? "native guest VM" : "js_min";
    output("bootstrap-host benchmark; host=" + host + "; nodes_per_batch=" + count +
        "; batches=" + rounds + "; emulated_bytes=" + byteLength);
    function measure(name, fn) {
        var before = new Date().getTime(), result = fn() | 0;
        var elapsed = new Date().getTime() - before;
        total = (total * 65599 + result) | 0;
        output("phase=" + name + "; ms=" + elapsed + "; checksum=" + result);
    }
    function allocate() {
        nodes = []; names = {};
        for (var i = 0; i < count; i++) {
            var name = "temporary_" + i;
            var text = "return temporary_" + i + " | 0;";
            var nodeValue = {type: "BinaryExpression", name: name, source: text,
                start: i, end: i + text.length, flags: i & 7,
                values: [i, i & 255, i >>> 1, 0, 0, 0, 0, 0], previous: i ? nodes[i - 1] : null};
            nodes.push(nodeValue); names["$" + name] = nodeValue;
        }
        return nodes.length + nodes[count - 1].end;
    }
    function lookupAndCopy() {
        var sum = 0;
        for (var i = 0; i < count; i++) {
            var item = nodes[i], found = names["$" + item.name];
            var copy = item.values.slice(0);
            copy[3] = (found.start + found.end) | 0;
            copy[4] = (copy[0] ^ copy[1]) | 0;
            found.flags = (found.flags + copy[4]) & 255;
            sum = (sum + copy[3] + copy[4] + found.flags) | 0;
        }
        return sum;
    }
    function enumerate() {
        var sum = 0, own = Object.prototype.hasOwnProperty;
        for (var i = 0; i < count; i++) {
            var item = nodes[i];
            for (var key in item) if (own.call(item, key)) sum = (sum + key.length) | 0;
        }
        return sum;
    }
    for (var round = 0; round < rounds; round++) {
        measure("allocate-" + round, allocate);
        measure("lookup-slice-update-" + round, lookupAndCopy);
        measure("own-field-enumeration-" + round, enumerate);
        nodes = null; names = null;
    }
    measure("source-and-parser-setup", function () {
        var library = {}, paths = ["guest_vm/unicode_identifier_data.js", "guest_vm/tokenizer.js", "guest_vm/parser.js"];
        for (var p = 0; p < paths.length; p++) {
            /* Explicit root and absent CommonJS parameters load the same
             * constructors on every host without replacing VM internals. */
            Function("module", "exports", "require", readSource(paths[p])).call(library, void 0, void 0, void 0);
        }
        parser = library.GuestVMParser;
        var size = 0;
        for (p = 0; p < files.length; p++) { sources.push(readSource(files[p])); size += sources[p].length; }
        return size;
    });
    measure("source-character-hash", function () {
        var hash = 0;
        for (var pass = 0; pass < 4; pass++) for (var p = 0; p < sources.length; p++) {
            var source = sources[p];
            for (var i = 0; i < source.length; i++) hash = (hash * 65599 + source.charCodeAt(i)) | 0;
        }
        return hash;
    });
    measure("real-parse-and-field-walk", function () {
        var checksum = 0, objects = 0, arrays = 0, strings = 0, own = Object.prototype.hasOwnProperty;
        for (var p = 0; p < sources.length; p++) {
            var tree = new parser(sources[p], files[p]).parseProgram(), stack = [tree];
            while (stack.length) {
                var value = stack.pop();
                if (value && typeof value === "object") {
                    if (value instanceof Array) arrays++; else objects++;
                    for (var key in value) if (own.call(value, key)) stack.push(value[key]);
                } else if (typeof value === "string") {
                    strings++; checksum = (checksum + value.length) | 0;
                } else if (typeof value === "number") checksum = (checksum + (value | 0)) | 0;
            }
            tree = null;
        }
        output("parsed_field_visits; objects=" + objects + "; arrays=" + arrays + "; strings=" + strings);
        return (checksum + objects + arrays + strings) | 0;
    });
    function memory(packed) {
        var pages = [], bytePageSize = 65536, pageSlots = packed ? bytePageSize / 4 : bytePageSize;
        var pageCount = byteLength / bytePageSize;
        for (var p = 0; p < pageCount; p++) {
            var page = [];
            for (var i = 0; i < pageSlots; i++) page[i] = 0;
            pages.push(page);
        }
        var operations = small ? 250000 : 1000000, sum = 0;
        for (i = 0; i < operations; i++) {
            var address = (i * 4) & (byteLength - 1), offset = address & (bytePageSize - 1);
            page = pages[address >>> 16];
            var word = (i * 65599) | 0, readWord;
            if (packed) { page[offset >>> 2] = word; readWord = page[offset >>> 2] | 0; }
            else {
                page[offset] = word & 255; page[offset + 1] = (word >>> 8) & 255;
                page[offset + 2] = (word >>> 16) & 255; page[offset + 3] = word >>> 24;
                readWord = page[offset] | (page[offset + 1] << 8) | (page[offset + 2] << 16) | (page[offset + 3] << 24);
            }
            sum = (sum + readWord) | 0;
        }
        return sum;
    }
    measure("plain-array-byte-pages", function () { return memory(false); });
    measure("plain-array-word-pages", function () { return memory(true); });
    output("RESULT checksum=" + total + "; elapsed_ms=" + (new Date().getTime() - started));
}(this));
