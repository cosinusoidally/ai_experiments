/* Generic source entry embedded in a standalone guest-VM image.  The image
 * supplies only native argc/argv/image metadata; every file read, parse,
 * compile, module load, snapshot write, and application call happens here in
 * the guest runtime. */
var GuestStandaloneGlobal = this;
var GuestStandaloneModuleCache = {};
var GuestStandaloneExitPointer = 0;
var GuestStandaloneProfile = false;
/* Guest programs execute in this context and may legitimately declare the
 * same compatibility-layer globals.  Keep the embedder's service objects in
 * private bindings so loading the next file cannot silently switch to a
 * guest-provided implementation. */
var GuestStandaloneFs = NodeFs;
var GuestStandaloneDlsymPointer = NodeDlsymPointer;
var GuestStandaloneBuffer = Buffer;

function guestStandaloneReadSource(path) {
    /* NodeFs.readFileSync resolves Buffer through its global environment.
     * Application runners are allowed to install their own Buffer, but the
     * embedder must keep using the intrinsic-backed implementation captured
     * with its filesystem service. */
    var applicationBuffer = GuestStandaloneGlobal.Buffer;
    GuestStandaloneGlobal.Buffer = GuestStandaloneBuffer;
    var result = GuestStandaloneFs.readFileSync(path).toString("utf8");
    GuestStandaloneGlobal.Buffer = applicationBuffer;
    return result;
}

function guestStandaloneProfileStart() {
    return GuestStandaloneProfile ? NodeRuntime.now() : 0;
}

function guestStandaloneProfileEnd(label, started) {
    if (GuestStandaloneProfile) {
        console.log("standalone profile: " + label + "=" +
            ((NodeRuntime.now() - started) | 0) + "ms");
    }
}

function guestStandaloneQuit(status) {
    /* Exit is a direct guest FFI operation.  The C image loader supplies only
     * dlsym; no VM-specific callback or host JavaScript participates. */
    if (!GuestStandaloneExitPointer) {
        GuestStandaloneExitPointer = ffi_call(
            GuestStandaloneDlsymPointer, 0, "exit");
        if (!GuestStandaloneExitPointer) {
            throw new Error("standalone libc exit is unavailable");
        }
    }
    ffi_call(GuestStandaloneExitPointer,
             status === undefined ? 0 : Number(status) | 0);
    throw new Error("standalone libc exit returned");
}

function guestStandaloneCString(pointer) {
    var result = "";
    var code;
    while ((code = peek8(pointer++)) !== 0) {
        result += String.fromCharCode(code);
    }
    return result;
}

function guestStandaloneArguments() {
    var result = [];
    var index = 0;
    while (index < __guestVMStandaloneArgc) {
        result.push(guestStandaloneCString(
            peek32(__guestVMStandaloneArgv + index * 4)));
        index++;
    }
    return result;
}

function guestStandaloneDirname(path) {
    var slash = path.lastIndexOf("/");
    return slash < 0 ? "." : slash === 0 ? "/" : path.substring(0, slash);
}

function guestStandaloneNormalize(path) {
    var absolute = path.charAt(0) === "/";
    var source = path.split("/");
    var parts = [];
    var index = 0;
    while (index < source.length) {
        var part = source[index++];
        if (!part || part === ".") continue;
        if (part === "..") {
            if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
            else if (!absolute) parts.push(part);
        } else parts.push(part);
    }
    return (absolute ? "/" : "") + parts.join("/") || (absolute ? "/" : ".");
}

var GuestStandalonePath = {
    sep: "/",
    delimiter: ":",
    normalize: guestStandaloneNormalize,
    join: function () {
        var value = "";
        var index = 0;
        while (index < arguments.length) {
            if (arguments[index]) value += (value ? "/" : "") + arguments[index];
            index++;
        }
        return guestStandaloneNormalize(value || ".");
    },
    resolve: function () {
        var value = "";
        var index = arguments.length - 1;
        while (index >= 0) {
            var part = String(arguments[index--]);
            if (part) value = part + (value ? "/" + value : "");
            if (part.charAt(0) === "/") return guestStandaloneNormalize(value);
        }
        var cwd = NodeMemory.cString(NodeLibc.getenv("PWD")) || ".";
        return guestStandaloneNormalize(cwd + "/" + value);
    }
};

function guestStandaloneBuiltin(request) {
    if (request === "fs") return GuestStandaloneFs;
    if (request === "net") return NodeNet;
    if (request === "http") return NodeHttp;
    if (request === "path") return GuestStandalonePath;
    return null;
}

function guestStandaloneRequire(request, parentFilename) {
    var builtin = guestStandaloneBuiltin(request);
    if (builtin) return builtin;
    if (request.substring(0, 2) !== "./" &&
        request.substring(0, 3) !== "../") {
        throw new Error("unsupported guest module: " + request);
    }
    var filename = guestStandaloneNormalize(
        guestStandaloneDirname(parentFilename) + "/" + request);
    if (filename.substring(filename.length - 3) !== ".js") filename += ".js";
    if (GuestStandaloneModuleCache[filename]) {
        return GuestStandaloneModuleCache[filename].exports;
    }
    var module = {exports: {}, filename: filename};
    GuestStandaloneModuleCache[filename] = module;
    var exports = module.exports;
    var __filename = filename;
    var __dirname = guestStandaloneDirname(filename);
    var require = function (child) {
        return guestStandaloneRequire(String(child), filename);
    };
    var phaseStarted = guestStandaloneProfileStart();
    var source = guestStandaloneReadSource(filename);
    guestStandaloneProfileEnd("read " + filename, phaseStarted);
    var factoryName = "__guestVMStandaloneModuleFactory";
    var previousFactory = GuestStandaloneGlobal[factoryName];
    var factorySource = factoryName + " = function(module, exports, require, " +
        "__filename, __dirname) {\n" + source + "\n};";
    phaseStarted = guestStandaloneProfileStart();
    var factoryProgram = GuestStandaloneFrontend.compileExecutable(
        factorySource, filename, guestStandaloneExecute,
        GuestStandaloneGlobal);
    guestStandaloneProfileEnd("compile " + filename, phaseStarted);
    phaseStarted = guestStandaloneProfileStart();
    factoryProgram();
    var factory = GuestStandaloneGlobal[factoryName];
    GuestStandaloneGlobal[factoryName] = previousFactory;
    factory(module, exports, require, __filename, __dirname);
    guestStandaloneProfileEnd("execute " + filename, phaseStarted);
    return module.exports;
}

function guestStandaloneWriteSnapshot(path) {
    var descriptor = NodeLibc.open(String(path), 577, 384);
    if (descriptor < 0) throw new Error("could not create snapshot: " + path);
    var offset = 0;
    while (offset < __guestVMStandaloneImageLength) {
        var count = NodeLibc.write(descriptor,
            __guestVMStandaloneImageBase + offset,
            __guestVMStandaloneImageLength - offset);
        if (count <= 0) {
            NodeLibc.close(descriptor);
            throw new Error("could not write snapshot: " + path);
        }
        offset += count;
    }
    if (NodeLibc.close(descriptor) !== 0) {
        throw new Error("could not close snapshot: " + path);
    }
}

function guestStandaloneExecute(path, programArguments) {
    NodeProcess.install([path].concat(programArguments));
    GuestStandaloneGlobal.arguments = programArguments;
    GuestStandaloneGlobal.assertEqual = function (actual, expected, message) {
        if (actual !== expected) {
            throw new Error((message ? String(message) + ": " : "") +
                "expected " + expected + ", got " + actual);
        }
    };
    GuestStandaloneGlobal.require = function (request) {
        return guestStandaloneRequire(String(request), path);
    };
    GuestStandaloneGlobal.load = function (filename) {
        filename = String(filename);
        var loadedPhaseStarted = guestStandaloneProfileStart();
        var loadedSource = guestStandaloneReadSource(filename);
        guestStandaloneProfileEnd("read " + filename, loadedPhaseStarted);
        loadedPhaseStarted = guestStandaloneProfileStart();
        var loadedExecutable = GuestStandaloneFrontend.compileExecutable(
            loadedSource, filename, guestStandaloneExecute,
            GuestStandaloneGlobal);
        guestStandaloneProfileEnd("compile " + filename, loadedPhaseStarted);
        loadedPhaseStarted = guestStandaloneProfileStart();
        loadedExecutable();
        guestStandaloneProfileEnd("execute " + filename, loadedPhaseStarted);
    };
    GuestStandaloneGlobal.print = console.log;
    GuestStandaloneGlobal.quit = guestStandaloneQuit;
    var phaseStarted = guestStandaloneProfileStart();
    var source = guestStandaloneReadSource(path);
    guestStandaloneProfileEnd("read " + path, phaseStarted);
    phaseStarted = guestStandaloneProfileStart();
    var executable = GuestStandaloneFrontend.compileExecutable(
        source, path, guestStandaloneExecute, GuestStandaloneGlobal);
    guestStandaloneProfileEnd("compile " + path, phaseStarted);
    phaseStarted = guestStandaloneProfileStart();
    executable();
    guestStandaloneProfileEnd("execute " + path, phaseStarted);
}

function guestStandaloneRunGuestRunner(runnerArguments) {
    var snapshotPath = null;
    var programPath = null;
    var programArguments = [];
    var index = 0;
    while (index < runnerArguments.length) {
        var option = runnerArguments[index++];
        if (!programPath && option === "--snapshot") {
            if (index >= runnerArguments.length) {
                throw new Error("--snapshot requires a snapshot file");
            }
            snapshotPath = runnerArguments[index++];
        } else if (!programPath && option === "--vm-native") {
            /* The standalone interpreter is already native. */
        } else if (!programPath && option === "--vm-profile") {
            GuestStandaloneProfile = true;
        } else if (!programPath && option.charAt(0) === "-") {
            throw new Error("unsupported standalone guest-runner option: " + option);
        } else if (!programPath) programPath = option;
        else programArguments.push(option);
    }
    if (snapshotPath) guestStandaloneWriteSnapshot(snapshotPath);
    if (!programPath) {
        if (snapshotPath) return;
        throw new Error("guest_runner.js requires a program");
    }
    guestStandaloneExecute(programPath, programArguments);
}

__guestVMStandaloneRunGuestRunner = guestStandaloneRunGuestRunner;

var GuestStandaloneArgv = guestStandaloneArguments();
if (!GuestStandaloneArgv.length) throw new Error("standalone program is missing");
try {
    guestStandaloneExecute(
        GuestStandaloneArgv[0], GuestStandaloneArgv.slice(1));
    NodeRuntime.run();
} catch (GuestStandaloneError) {
    if (GuestStandaloneError !== NodeProcess.exitMarker) {
        if (GuestStandaloneError && GuestStandaloneError.stack) {
            console.log(String(GuestStandaloneError.stack));
        } else {
            console.log(String(GuestStandaloneError));
        }
        throw GuestStandaloneError;
    }
}
