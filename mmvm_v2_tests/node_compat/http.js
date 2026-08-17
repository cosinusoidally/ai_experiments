var NodeHttpStatusText = {
    200: "OK",
    301: "Moved Permanently",
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    431: "Request Header Fields Too Large",
    500: "Internal Server Error"
};

function nodeHeaderHas(headers, wantedName) {
    wantedName = wantedName.toLowerCase();
    for (var name in headers) {
        if (String(name).toLowerCase() === wantedName) return true;
    }
    return false;
}

function nodeValidateHeader(name, value) {
    name = String(name);
    value = String(value);
    if (!name.length || name.indexOf("\r") >= 0 || name.indexOf("\n") >= 0 ||
        value.indexOf("\r") >= 0 || value.indexOf("\n") >= 0) {
        throw new Error("invalid HTTP header");
    }
}

function NodeServerResponse(client, request) {
    this._client = client;
    this._request = request;
    this._headers = {};
    this.statusCode = 200;
    this.headersSent = false;
    this._ended = false;
}

NodeServerResponse.prototype.writeHead = function (statusCode, headers) {
    if (this._ended) throw new Error("write after end");
    this.statusCode = Number(statusCode);
    if (!(this.statusCode >= 100 && this.statusCode <= 999)) {
        throw new RangeError("invalid HTTP status code");
    }
    headers = headers || {};
    for (var name in headers) {
        nodeValidateHeader(name, headers[name]);
        this._headers[name] = String(headers[name]);
    }
    this.headersSent = true;
    return this;
};

NodeServerResponse.prototype.end = function (body) {
    if (this._ended) throw new Error("write after end");
    this._ended = true;
    body = body === undefined || body === null ? "" : body;
    var bodyBytes = body && body._nodeBytes ? body._nodeBytes :
                    NodeEncoding.utf8Bytes(String(body));

    if (!nodeHeaderHas(this._headers, "Content-Length")) {
        this._headers["Content-Length"] = String(bodyBytes.length);
    }
    if (!nodeHeaderHas(this._headers, "Connection")) {
        this._headers["Connection"] = "close";
    }

    var reason = NodeHttpStatusText[this.statusCode] || "Unknown";
    var header = "HTTP/1.1 " + this.statusCode + " " + reason + "\r\n";
    for (var name in this._headers) {
        nodeValidateHeader(name, this._headers[name]);
        header += name + ": " + this._headers[name] + "\r\n";
    }
    header += "\r\n";

    var output = NodeEncoding.utf8Bytes(header);
    if (this._request.method !== "HEAD") {
        for (var i = 0; i < bodyBytes.length; i++) output.push(bodyBytes[i]);
    }
    this.headersSent = true;
    this._client.queueBytes(output);
    return this;
};

function nodeParseRequest(client) {
    var headerEnd = client.input.indexOf("\r\n\r\n");
    if (headerEnd < 0) return null;
    var lines = client.input.substring(0, headerEnd).split("\r\n");
    var requestParts = lines[0].split(" ");
    if (requestParts.length !== 3 ||
        requestParts[2].indexOf("HTTP/") !== 0) return null;

    var headers = {};
    for (var i = 1; i < lines.length; i++) {
        var colon = lines[i].indexOf(":");
        if (colon <= 0) return null;
        var name = lines[i].substring(0, colon).toLowerCase();
        var value = lines[i].substring(colon + 1);
        while (value.charAt(0) === " " || value.charAt(0) === "\t") {
            value = value.substring(1);
        }
        if (headers[name] === undefined) headers[name] = value;
        else headers[name] += ", " + value;
    }

    return {
        method: requestParts[0],
        url: requestParts[1],
        httpVersion: requestParts[2].substring(5),
        headers: headers,
        socket: {remoteAddress: client.remoteAddress, remotePort: client.remotePort}
    };
}

function nodeSendAutomaticError(client, statusCode, message) {
    var request = {method: "GET"};
    var response = new NodeServerResponse(client, request);
    response.writeHead(statusCode, {"Content-Type": "text/plain; charset=utf-8"});
    response.end(message + "\n");
}

var NodeHttp = {
    createServer: function (requestListener) {
        if (typeof requestListener !== "function") {
            throw new TypeError("request listener must be a function");
        }
        var server = NodeNet.createServer(function (client) {
            var request = nodeParseRequest(client);
            if (!request) {
                nodeSendAutomaticError(client, 400, "Bad Request");
                return;
            }
            var response = new NodeServerResponse(client, request);
            NodeRuntime.invoke(function () {
                requestListener.call(server, request, response);
            });
            if (NodeProcess.exiting && !client.outputPointer) client.close();
        });
        return server;
    }
};
