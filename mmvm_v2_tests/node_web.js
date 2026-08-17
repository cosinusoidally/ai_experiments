/* Static HTTP server for Node.js 0.10+ and the js_min Node compatibility runner. */
var http = require("http");
var fs = require("fs");

var options = {port: 8000, bind: "0.0.0.0", directory: "."};

function usage() {
    return "usage: node_web.js [-h] [--bind ADDRESS] [--directory DIRECTORY] [port]\n\n" +
           "positional arguments:\n" +
           "  port                  specify alternate port (default: 8000)\n\n" +
           "options:\n" +
           "  -h, --help            show this help message and exit\n" +
           "  --bind ADDRESS, -b ADDRESS\n" +
           "                        specify alternate bind address (default: all interfaces)\n" +
           "  --directory DIRECTORY, -d DIRECTORY\n" +
           "                        specify alternate directory (default: current directory)";
}

function optionError(message) {
    console.error("node_web.js: error: " + message);
    console.error("Try 'node_web.js --help' for more information.");
    process.exit(2);
}

var portSeen = false;
for (var argumentIndex = 2; argumentIndex < process.argv.length; argumentIndex++) {
    var argument = process.argv[argumentIndex];
    if (argument === "-h" || argument === "--help") {
        console.log(usage());
        process.exit(0);
    } else if (argument === "-b" || argument === "--bind") {
        if (++argumentIndex >= process.argv.length) optionError(argument + " requires a value");
        options.bind = process.argv[argumentIndex];
    } else if (argument.indexOf("--bind=") === 0) {
        options.bind = argument.substring(7);
        if (!options.bind) optionError("--bind requires a value");
    } else if (argument === "-d" || argument === "--directory") {
        if (++argumentIndex >= process.argv.length) optionError(argument + " requires a value");
        options.directory = process.argv[argumentIndex];
    } else if (argument.indexOf("--directory=") === 0) {
        options.directory = argument.substring(12);
        if (!options.directory) optionError("--directory requires a value");
    } else if (argument.charAt(0) === "-") {
        optionError("unrecognized argument: " + argument);
    } else {
        if (portSeen || !/^[0-9]+$/.test(argument)) optionError("invalid port: " + argument);
        options.port = parseInt(argument, 10);
        if (options.port < 0 || options.port > 65535) {
            optionError("port must be in the range 0-65535");
        }
        portSeen = true;
    }
}

function pad2(value) {
    return value < 10 ? "0" + value : String(value);
}

function logDate() {
    var now = new Date();
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return pad2(now.getDate()) + "/" + months[now.getMonth()] + "/" +
           now.getFullYear() + " " + pad2(now.getHours()) + ":" +
           pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());
}

function safeLogText(value) {
    var safe = "";
    var digits = "0123456789ABCDEF";
    for (var i = 0; i < value.length; i++) {
        var code = value.charCodeAt(i) & 255;
        if (code >= 32 && code < 127) safe += String.fromCharCode(code);
        else safe += "\\x" + digits.charAt(code >>> 4) + digits.charAt(code & 15);
    }
    return safe;
}

function logRequest(request, status) {
    var address = request.socket && request.socket.remoteAddress ?
                  request.socket.remoteAddress : "unknown";
    var line = request.method + " " + request.url + " HTTP/" + request.httpVersion;
    console.log(address + " - - [" + logDate() + "] \"" +
                safeLogText(line) + "\" " + status + " -");
}

function htmlEscape(value) {
    return String(value).replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/\"/g, "&quot;");
}

function contentType(path) {
    path = path.toLowerCase();
    if (/\.html?$/.test(path)) return "text/html; charset=utf-8";
    if (/\.css$/.test(path)) return "text/css; charset=utf-8";
    if (/\.js$/.test(path)) return "application/javascript; charset=utf-8";
    if (/\.json$/.test(path)) return "application/json; charset=utf-8";
    if (/\.txt$/.test(path)) return "text/plain; charset=utf-8";
    if (/\.svg$/.test(path)) return "image/svg+xml";
    if (/\.png$/.test(path)) return "image/png";
    if (/\.jpe?g$/.test(path)) return "image/jpeg";
    return "application/octet-stream";
}

function send(request, response, status, headers, body) {
    headers = headers || {};
    body = body === undefined ? "" : body;
    if (headers["Content-Length"] === undefined) {
        headers["Content-Length"] = Buffer.byteLength(body);
    }
    headers.Connection = "close";
    response.writeHead(status, headers);
    response.end(body);
    logRequest(request, status);
}

function sendError(request, response, status, title, message) {
    var body = "<!doctype html><html><body><h1>" + htmlEscape(title) +
               "</h1><p>" + htmlEscape(message) + "</p></body></html>\n";
    send(request, response, status,
         {"Content-Type": "text/html; charset=utf-8"}, body);
}

function joinRoot(path) {
    if (options.directory.charAt(options.directory.length - 1) === "/") {
        return options.directory + path.substring(1);
    }
    return options.directory + path;
}

function serveFile(request, response, filePath) {
    fs.readFile(filePath, function (error, data) {
        if (error) {
            sendError(request, response, error.code === "EACCES" ? 403 : 404,
                      error.code === "EACCES" ? "403 Forbidden" : "404 Not Found",
                      "The requested file could not be read.");
            return;
        }
        send(request, response, 200,
             {"Content-Type": contentType(filePath), "Content-Length": data.length}, data);
    });
}

function renderDirectory(request, response, filePath, urlPath) {
    fs.readdir(filePath, function (error, names) {
        if (error) {
            sendError(request, response, 403, "403 Forbidden",
                      "The requested directory could not be read.");
            return;
        }
        names.sort();
        var entries = [];
        var next = 0;

        function inspectNext() {
            if (next >= names.length) {
                var title = "Directory listing for " + urlPath;
                var body = "<!doctype html>\n<html><head><meta charset=\"utf-8\">" +
                           "<title>" + htmlEscape(title) + "</title></head>\n" +
                           "<body><h1>" + htmlEscape(title) + "</h1><hr><ul>\n";
                for (var i = 0; i < entries.length; i++) {
                    body += "<li><a href=\"" + encodeURIComponent(entries[i].name) +
                            entries[i].suffix + "\">" + htmlEscape(entries[i].name) +
                            entries[i].suffix + "</a></li>\n";
                }
                body += "</ul><hr></body></html>\n";
                send(request, response, 200,
                     {"Content-Type": "text/html; charset=utf-8"}, body);
                return;
            }

            var name = names[next++];
            var child = filePath + (filePath.charAt(filePath.length - 1) === "/" ? "" : "/") + name;
            fs.stat(child, function (statError, stats) {
                entries.push({name: name,
                              suffix: !statError && stats.isDirectory() ? "/" : ""});
                inspectNext();
            });
        }

        inspectNext();
    });
}

function serveDirectory(request, response, filePath, urlPath, rawPath) {
    if (urlPath.charAt(urlPath.length - 1) !== "/") {
        send(request, response, 301,
             {Location: rawPath + "/", "Content-Type": "text/html; charset=utf-8"},
             "<!doctype html><html><body><h1>301 Moved Permanently</h1></body></html>\n");
        return;
    }

    var indexes = ["index.html", "index.htm"];
    var index = 0;
    function tryIndex() {
        if (index >= indexes.length) {
            renderDirectory(request, response, filePath, urlPath);
            return;
        }
        var candidate = filePath + indexes[index++];
        fs.stat(candidate, function (error, stats) {
            if (!error && stats.isFile()) serveFile(request, response, candidate);
            else tryIndex();
        });
    }
    tryIndex();
}

function handleRequest(request, response) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        sendError(request, response, 405, "405 Method Not Allowed",
                  "Only GET and HEAD are supported.");
        return;
    }

    var rawPath = request.url;
    var query = rawPath.indexOf("?");
    if (query >= 0) rawPath = rawPath.substring(0, query);
    var urlPath;
    try { urlPath = decodeURIComponent(rawPath); }
    catch (error) {
        sendError(request, response, 400, "400 Bad Request", "Malformed URL encoding.");
        return;
    }

    if (urlPath.charAt(0) !== "/" || urlPath.indexOf("\\") >= 0 ||
        urlPath.indexOf("\x00") >= 0) {
        sendError(request, response, 400, "400 Bad Request", "Invalid path.");
        return;
    }
    var parts = urlPath.split("/");
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "..") {
            sendError(request, response, 400, "400 Bad Request", "Invalid path.");
            return;
        }
    }

    var filePath = joinRoot(urlPath);
    fs.stat(filePath, function (error, stats) {
        if (error) {
            sendError(request, response, error.code === "EACCES" ? 403 : 404,
                      error.code === "EACCES" ? "403 Forbidden" : "404 Not Found",
                      "The requested path was not found.");
        } else if (stats.isDirectory()) {
            serveDirectory(request, response, filePath, urlPath, rawPath);
        } else {
            serveFile(request, response, filePath);
        }
    });
}

var server = http.createServer(handleRequest);
server.on("error", function (error) {
    console.error("server error: " + error.message);
    process.exit(1);
});
server.listen(options.port, options.bind, function () {
    var address = server.address();
    var host = address.address.indexOf(":") >= 0 ? "[" + address.address + "]" : address.address;
    console.log("Serving " + options.directory + " at http://" + host + ":" + address.port + "/");
});
