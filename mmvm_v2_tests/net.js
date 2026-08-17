/*
 * A deliberately small, synchronous HTTP server implemented through the
 * mmvm FFI. The directory to serve is selected with --directory and defaults
 * to the current working directory.
 */

var dlsymPointer = get_dlsym();

function symbol(name) {
    var pointer = ffi_call(dlsymPointer, 0, name);
    if (!pointer) {
        throw "could not resolve libc symbol: " + name;
    }
    return pointer;
}

/* Raw symbol pointers live here. The server uses only the wrappers below. */
var libcSymbols = {
    socket:     symbol("socket"),
    setsockopt: symbol("setsockopt"),
    bind:       symbol("bind"),
    listen:     symbol("listen"),
    accept:     symbol("accept"),
    read:       symbol("read"),
    write:      symbol("write"),
    close:      symbol("close"),
    calloc:     symbol("calloc"),
    free:       symbol("free"),
    fopen:      symbol("fopen"),
    fseek:      symbol("fseek"),
    ftell:      symbol("ftell"),
    fread:      symbol("fread"),
    fclose:     symbol("fclose"),
    opendir:    symbol("opendir"),
    readdir:    symbol("readdir"),
    closedir:   symbol("closedir"),
    time:       symbol("time"),
    localtime:  symbol("localtime"),
    strftime:   symbol("strftime"),
    getaddrinfo:  symbol("getaddrinfo"),
    freeaddrinfo: symbol("freeaddrinfo"),
    gai_strerror:  symbol("gai_strerror"),
    getnameinfo:  symbol("getnameinfo"),
    getsockname:  symbol("getsockname")
};

var libc = {
    socket: function(domain, type, protocol) {
        return ffi_call(libcSymbols.socket, domain, type, protocol);
    },
    setsockopt: function(fd, level, option, value, length) {
        return ffi_call(libcSymbols.setsockopt, fd, level, option, value, length);
    },
    bind: function(fd, address, length) {
        return ffi_call(libcSymbols.bind, fd, address, length);
    },
    listen: function(fd, backlog) {
        return ffi_call(libcSymbols.listen, fd, backlog);
    },
    accept: function(fd, address, length) {
        return ffi_call(libcSymbols.accept, fd, address, length);
    },
    read: function(fd, buffer, length) {
        return ffi_call(libcSymbols.read, fd, buffer, length);
    },
    write: function(fd, buffer, length) {
        return ffi_call(libcSymbols.write, fd, buffer, length);
    },
    close: function(fd) {
        return ffi_call(libcSymbols.close, fd);
    },
    calloc: function(count, size) {
        return ffi_call(libcSymbols.calloc, count, size);
    },
    free: function(pointer) {
        return ffi_call(libcSymbols.free, pointer);
    },
    fopen: function(path, mode) {
        return ffi_call(libcSymbols.fopen, path, mode);
    },
    fseek: function(file, offset, origin) {
        return ffi_call(libcSymbols.fseek, file, offset, origin);
    },
    ftell: function(file) {
        return ffi_call(libcSymbols.ftell, file);
    },
    fread: function(buffer, size, count, file) {
        return ffi_call(libcSymbols.fread, buffer, size, count, file);
    },
    fclose: function(file) {
        return ffi_call(libcSymbols.fclose, file);
    },
    opendir: function(path) {
        return ffi_call(libcSymbols.opendir, path);
    },
    readdir: function(directory) {
        return ffi_call(libcSymbols.readdir, directory);
    },
    closedir: function(directory) {
        return ffi_call(libcSymbols.closedir, directory);
    },
    time: function(storage) {
        return ffi_call(libcSymbols.time, storage);
    },
    localtime: function(timestamp) {
        return ffi_call(libcSymbols.localtime, timestamp);
    },
    strftime: function(buffer, length, format, localTime) {
        return ffi_call(libcSymbols.strftime, buffer, length, format, localTime);
    },
    getaddrinfo: function(node, service, hints, result) {
        return ffi_call(libcSymbols.getaddrinfo, node, service, hints, result);
    },
    freeaddrinfo: function(addresses) {
        return ffi_call(libcSymbols.freeaddrinfo, addresses);
    },
    gai_strerror: function(error) {
        return ffi_call(libcSymbols.gai_strerror, error);
    },
    getnameinfo: function(address, addressLength, host, hostLength,
                          service, serviceLength, flags) {
        return ffi_call(libcSymbols.getnameinfo, address, addressLength,
                        host, hostLength, service, serviceLength, flags);
    },
    getsockname: function(fd, address, length) {
        return ffi_call(libcSymbols.getsockname, fd, address, length);
    }
};

var SOCK_STREAM = 1;
var SOL_SOCKET = 1;
var SO_REUSEADDR = 2;
var AI_PASSIVE = 1;
var NI_NUMERICHOST = 1;
var SEEK_SET = 0;
var SEEK_END = 2;
var PORT = 8000;
var BIND_ADDRESS = null;
var WWW_ROOT = ".";
var commandLineArguments = arguments;

function fail(operation, result) {
    throw operation + " failed (returned " + result + ")";
}

function writeString(fd, value) {
    if (value.length === 0) {
        return;
    }
    var data = libc.calloc(value.length, 1);
    for (var i = 0; i < value.length; i++) {
        poke8(data + i, value.charCodeAt(i));
    }
    writeMemory(fd, data, value.length);
    libc.free(data);
}

function writeMemory(fd, pointer, length) {
    var offset = 0;
    while (offset < length) {
        var written = libc.write(fd, pointer + offset, length - offset);
        if (written <= 0) {
            fail("write", written);
        }
        offset += written;
    }
}

function usage() {
    return "usage: net.js [-h] [--bind ADDRESS] [--directory DIRECTORY] [port]\n\n" +
           "positional arguments:\n" +
           "  port                  specify alternate port (default: 8000)\n\n" +
           "options:\n" +
           "  -h, --help            show this help message and exit\n" +
           "  --bind ADDRESS, -b ADDRESS\n" +
           "                        specify alternate bind address (default: all interfaces)\n" +
           "  --directory DIRECTORY, -d DIRECTORY\n" +
           "                        specify alternate directory (default: current directory)\n";
}

function optionError(message) {
    writeString(2, "net.js: error: " + message + "\n");
    writeString(2, "Try 'net.js --help' for more information.\n");
    quit(2);
}

function optionValue(option, index) {
    if (index + 1 >= commandLineArguments.length) {
        optionError("argument " + option + ": expected one value");
    }
    return commandLineArguments[index + 1];
}

var portSeen = false;
for (var argumentIndex = 0; argumentIndex < commandLineArguments.length; argumentIndex++) {
    var argument = commandLineArguments[argumentIndex];
    if (argument === "-h" || argument === "--help") {
        writeString(1, usage());
        quit(0);
    } else if (argument === "-b" || argument === "--bind") {
        BIND_ADDRESS = optionValue(argument, argumentIndex);
        argumentIndex++;
    } else if (argument.indexOf("--bind=") === 0) {
        BIND_ADDRESS = argument.substring(7);
        if (BIND_ADDRESS.length === 0) optionError("argument --bind: expected one value");
    } else if (argument === "-d" || argument === "--directory") {
        WWW_ROOT = optionValue(argument, argumentIndex);
        argumentIndex++;
    } else if (argument.indexOf("--directory=") === 0) {
        WWW_ROOT = argument.substring(12);
        if (WWW_ROOT.length === 0) optionError("argument --directory: expected one value");
    } else if (argument.charAt(0) === "-") {
        optionError("unrecognized argument: " + argument);
    } else {
        if (portSeen) optionError("unrecognized argument: " + argument);
        if (!/^[0-9]+$/.test(argument)) optionError("invalid port: " + argument);
        PORT = parseInt(argument, 10);
        if (PORT < 0 || PORT > 65535) optionError("port must be in the range 0-65535");
        portSeen = true;
    }
}

if (WWW_ROOT.length === 0) optionError("directory must not be empty");

function readRequest(fd, buffer, capacity) {
    var used = 0;
    while (used < capacity) {
        var count = libc.read(fd, buffer + used, capacity - used);
        if (count <= 0) {
            return used;
        }
        used += count;

        /* Stop once the HTTP header terminator has arrived. */
        for (var i = 3; i < used; i++) {
            if (peek8(buffer + i - 3) === 13 &&
                peek8(buffer + i - 2) === 10 &&
                peek8(buffer + i - 1) === 13 &&
                peek8(buffer + i) === 10) {
                return used;
            }
        }
    }
    return used;
}

function firstRequestLine(buffer, length) {
    var line = "";
    for (var i = 0; i < length; i++) {
        var character = peek8(buffer + i);
        if (character === 10 || character === 13) {
            break;
        }
        line += String.fromCharCode(character);
    }
    return line;
}

function contentType(path) {
    if (/\.html?$/.test(path)) return "text/html; charset=utf-8";
    if (/\.css$/.test(path))   return "text/css; charset=utf-8";
    if (/\.js$/.test(path))    return "application/javascript; charset=utf-8";
    if (/\.json$/.test(path))  return "application/json; charset=utf-8";
    if (/\.txt$/.test(path))   return "text/plain; charset=utf-8";
    if (/\.svg$/.test(path))   return "image/svg+xml";
    if (/\.png$/.test(path))   return "image/png";
    if (/\.jpg$/.test(path) || /\.jpeg$/.test(path)) return "image/jpeg";
    return "application/octet-stream";
}

function htmlEscape(value) {
    return value.replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\"/g, "&quot;");
}

function hexDigit(character) {
    var code = character.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 70) return code - 55;
    if (code >= 97 && code <= 102) return code - 87;
    return -1;
}

function percentDecode(value) {
    var decoded = "";
    for (var i = 0; i < value.length; i++) {
        if (value.charAt(i) === "%") {
            if (i + 2 >= value.length) return null;
            var high = hexDigit(value.charAt(i + 1));
            var low = hexDigit(value.charAt(i + 2));
            if (high < 0 || low < 0) return null;
            var code = high * 16 + low;
            if (code === 0) return null;
            decoded += String.fromCharCode(code);
            i += 2;
        } else {
            decoded += value.charAt(i);
        }
    }
    return decoded;
}

function urlEncodeComponent(value) {
    var digits = "0123456789ABCDEF";
    var encoded = "";
    for (var i = 0; i < value.length; i++) {
        var code = value.charCodeAt(i) & 255;
        if ((code >= 65 && code <= 90) ||
            (code >= 97 && code <= 122) ||
            (code >= 48 && code <= 57) ||
            code === 45 || code === 46 || code === 95 || code === 126) {
            encoded += String.fromCharCode(code);
        } else {
            encoded += "%" + digits.charAt((code >>> 4) & 15) + digits.charAt(code & 15);
        }
    }
    return encoded;
}

function cString(pointer) {
    var value = "";
    for (var i = 0; i < 4096; i++) {
        var code = peek8(pointer + i);
        if (code === 0) break;
        value += String.fromCharCode(code);
    }
    return value;
}

function safeLogText(value) {
    var digits = "0123456789ABCDEF";
    var safe = "";
    for (var i = 0; i < value.length; i++) {
        var code = value.charCodeAt(i) & 255;
        if (code >= 32 && code < 127) {
            safe += String.fromCharCode(code);
        } else {
            safe += "\\x" + digits.charAt((code >>> 4) & 15) + digits.charAt(code & 15);
        }
    }
    return safe;
}

function logRequest(clientAddress, clientAddressLength, requestLine, status) {
    var timestamp = libc.calloc(1, 4);
    var dateBuffer = libc.calloc(64, 1);
    var hostBuffer = libc.calloc(128, 1);
    libc.time(timestamp);
    var local = libc.localtime(timestamp);
    libc.strftime(dateBuffer, 64, "%d/%b/%Y %H:%M:%S", local);

    var nameResult = libc.getnameinfo(clientAddress, clientAddressLength,
                              hostBuffer, 128, 0, 0, NI_NUMERICHOST);
    var address = nameResult === 0 ? cString(hostBuffer) : "unknown";
    var line = address + " - - [" + cString(dateBuffer) + "] \"" +
               safeLogText(requestLine) + "\" " + status + " -\n";
    writeString(1, line);

    libc.free(hostBuffer);
    libc.free(dateBuffer);
    libc.free(timestamp);
}

function openDirectory(path) {
    return libc.opendir(path);
}

function isDirectory(path) {
    var directory = openDirectory(path);
    if (!directory) return false;
    libc.closedir(directory);
    return true;
}

function fileExists(path) {
    var file = libc.fopen(path, "rb");
    if (!file) return false;
    libc.fclose(file);
    return true;
}

function sendError(fd, status, message, headOnly) {
    var body = "<!doctype html><html><body><h1>" + status + "</h1><p>" +
               message + "</p></body></html>\n";
    var header = "HTTP/1.0 " + status + "\r\n" +
                 "Content-Type: text/html; charset=utf-8\r\n" +
                 "Content-Length: " + body.length + "\r\n" +
                 "Connection: close\r\n\r\n";
    writeString(fd, header);
    if (!headOnly) {
        writeString(fd, body);
    }
}

function serveFile(fd, path, headOnly) {
    var file = libc.fopen(path, "rb");
    if (!file) {
        sendError(fd, "404 Not Found", "The requested file was not found.", headOnly);
        return 404;
    }

    if (libc.fseek(file, 0, SEEK_END) !== 0) {
        libc.fclose(file);
        sendError(fd, "500 Internal Server Error", "Could not inspect the file.", headOnly);
        return 500;
    }

    var length = libc.ftell(file);
    libc.fseek(file, 0, SEEK_SET);

    if (length < 0) {
        libc.fclose(file);
        sendError(fd, "500 Internal Server Error", "Could not inspect the file.", headOnly);
        return 500;
    }

    var header = "HTTP/1.0 200 OK\r\n" +
                 "Content-Type: " + contentType(path) + "\r\n" +
                 "Content-Length: " + length + "\r\n" +
                 "Connection: close\r\n\r\n";
    writeString(fd, header);

    if (!headOnly && length > 0) {
        var chunkSize = 65536;
        var data = libc.calloc(chunkSize, 1);
        if (!data) {
            libc.fclose(file);
            /* The 200 response headers have already been sent. */
            return 200;
        }
        var remaining = length;
        while (remaining > 0) {
            var wanted = remaining < chunkSize ? remaining : chunkSize;
            var count = libc.fread(data, 1, wanted, file);
            if (count <= 0) break;
            writeMemory(fd, data, count);
            remaining -= count;
        }
        libc.free(data);
    }

    libc.fclose(file);
    return 200;
}

function sendRedirect(fd, location, headOnly) {
    var body = "<!doctype html><html><body><h1>301 Moved Permanently</h1>" +
               "<p>Directory paths must end with a slash.</p></body></html>\n";
    var header = "HTTP/1.0 301 Moved Permanently\r\n" +
                 "Location: " + location + "\r\n" +
                 "Content-Type: text/html; charset=utf-8\r\n" +
                 "Content-Length: " + body.length + "\r\n" +
                 "Connection: close\r\n\r\n";
    writeString(fd, header);
    if (!headOnly) writeString(fd, body);
    return 301;
}

function serveDirectory(fd, fsPath, urlPath, headOnly) {
    var directory = openDirectory(fsPath);
    if (!directory) {
        sendError(fd, "404 Not Found", "The requested directory was not found.", headOnly);
        return 404;
    }

    var names = [];
    var entry;
    while ((entry = libc.readdir(directory)) !== 0) {
        /* Linux i386 struct dirent stores d_name at byte offset 11. */
        var name = cString(entry + 11);
        if (name !== "." && name !== "..") names.push(name);
    }
    libc.closedir(directory);
    names.sort();

    var title = "Directory listing for " + urlPath;
    var body = "<!doctype html>\n<html><head><meta charset=\"utf-8\">" +
               "<title>" + htmlEscape(title) + "</title></head>\n" +
               "<body><h1>" + htmlEscape(title) + "</h1><hr><ul>\n";
    for (var i = 0; i < names.length; i++) {
        var childPath = fsPath + names[i];
        var suffix = isDirectory(childPath) ? "/" : "";
        body += "<li><a href=\"" + urlEncodeComponent(names[i]) + suffix + "\">" +
                htmlEscape(names[i]) + suffix + "</a></li>\n";
    }
    body += "</ul><hr></body></html>\n";

    var header = "HTTP/1.0 200 OK\r\n" +
                 "Content-Type: text/html; charset=utf-8\r\n" +
                 "Content-Length: " + body.length + "\r\n" +
                 "Connection: close\r\n\r\n";
    writeString(fd, header);
    if (!headOnly) writeString(fd, body);
    return 200;
}

function handleClient(fd, requestBuffer, requestCapacity) {
    var length = readRequest(fd, requestBuffer, requestCapacity);
    if (length === 0) {
        return null;
    }

    var line = firstRequestLine(requestBuffer, length);
    var firstSpace = line.indexOf(" ");
    var secondSpace = line.indexOf(" ", firstSpace + 1);
    if (firstSpace < 1 || secondSpace < 0) {
        sendError(fd, "400 Bad Request", "Malformed HTTP request.", false);
        return {line: line, status: 400};
    }

    var method = line.substring(0, firstSpace);
    var rawUrlPath = line.substring(firstSpace + 1, secondSpace);
    var headOnly = method === "HEAD";
    if (method !== "GET" && !headOnly) {
        sendError(fd, "405 Method Not Allowed", "Only GET and HEAD are supported.", false);
        return {line: line, status: 405};
    }

    var query = rawUrlPath.indexOf("?");
    if (query >= 0) {
        rawUrlPath = rawUrlPath.substring(0, query);
    }

    var urlPath = percentDecode(rawUrlPath);

    /* Reject traversal, backslashes, NULs, and malformed URL escapes. */
    if (urlPath === null || urlPath.charAt(0) !== "/" ||
        urlPath.indexOf("\\") >= 0) {
        sendError(fd, "400 Bad Request", "Invalid path.", headOnly);
        return {line: line, status: 400};
    }

    var parts = urlPath.split("/");
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "..") {
            sendError(fd, "400 Bad Request", "Invalid path.", headOnly);
            return {line: line, status: 400};
        }
    }

    var fsPath = WWW_ROOT + urlPath;
    if (isDirectory(fsPath)) {
        if (urlPath.charAt(urlPath.length - 1) !== "/") {
            return {line: line, status: sendRedirect(fd, rawUrlPath + "/", headOnly)};
        }
        var directoryStatus;
        if (fileExists(fsPath + "index.html")) {
            directoryStatus = serveFile(fd, fsPath + "index.html", headOnly);
        } else if (fileExists(fsPath + "index.htm")) {
            directoryStatus = serveFile(fd, fsPath + "index.htm", headOnly);
        } else {
            directoryStatus = serveDirectory(fd, fsPath, urlPath, headOnly);
        }
        return {line: line, status: directoryStatus};
    }

    return {line: line, status: serveFile(fd, fsPath, headOnly)};
}

/* Resolve the bind target. A null node plus AI_PASSIVE means all interfaces. */
var hints = libc.calloc(32, 1);
poke32(hints + 0, BIND_ADDRESS === null ? AI_PASSIVE : 0);
poke32(hints + 8, SOCK_STREAM);
var addressListPointer = libc.calloc(1, 4);
var resolveResult = libc.getaddrinfo(
    BIND_ADDRESS === null ? 0 : BIND_ADDRESS,
    String(PORT), hints, addressListPointer);
libc.free(hints);
if (resolveResult !== 0) {
    var resolveMessage = cString(libc.gai_strerror(resolveResult));
    throw "could not resolve bind address: " + resolveMessage;
}

var addressList = peek32(addressListPointer);
libc.free(addressListPointer);
var addressInfo = addressList;
var server = -1;
var bound = false;
var reuse = libc.calloc(1, 4);
poke32(reuse, 1);
while (addressInfo !== 0) {
    var addressFamily = peek32(addressInfo + 4);
    var socketType = peek32(addressInfo + 8);
    var protocol = peek32(addressInfo + 12);
    var addressLength = peek32(addressInfo + 16);
    var address = peek32(addressInfo + 20);

    server = libc.socket(addressFamily, socketType, protocol);
    if (server >= 0) {
        libc.setsockopt(server, SOL_SOCKET, SO_REUSEADDR, reuse, 4);
        if (libc.bind(server, address, addressLength) === 0) {
            bound = true;
            break;
        }
        libc.close(server);
        server = -1;
    }
    addressInfo = peek32(addressInfo + 28);
}
libc.free(reuse);
libc.freeaddrinfo(addressList);
if (!bound) fail("bind", -1);
if (libc.listen(server, 16) < 0) {
    fail("listen", -1);
}

/* Ask the socket for its numeric address and actual port (important for port 0). */
var localAddress = libc.calloc(128, 1);
var localAddressLength = libc.calloc(1, 4);
var localHost = libc.calloc(128, 1);
poke32(localAddressLength, 128);
libc.getsockname(server, localAddress, localAddressLength);
libc.getnameinfo(localAddress, peek32(localAddressLength),
         localHost, 128, 0, 0, NI_NUMERICHOST);
PORT = peek8(localAddress + 2) * 256 + peek8(localAddress + 3);
var displayedHost = cString(localHost);
if (displayedHost.indexOf(":") >= 0) displayedHost = "[" + displayedHost + "]";
libc.free(localHost);
libc.free(localAddressLength);
libc.free(localAddress);

var requestCapacity = 8192;
var requestBuffer = libc.calloc(requestCapacity, 1);
var clientAddress = libc.calloc(128, 1);
var clientAddressLength = libc.calloc(1, 4);
print("Serving " + WWW_ROOT + " at http://" + displayedHost + ":" + PORT + "/");

while (true) {
    poke32(clientAddressLength, 128);
    var client = libc.accept(server, clientAddress, clientAddressLength);
    if (client >= 0) {
        var requestResult = handleClient(client, requestBuffer, requestCapacity);
        libc.close(client);
        if (requestResult !== null) {
            logRequest(clientAddress, peek32(clientAddressLength),
                       requestResult.line, requestResult.status);
        }
    }
}
