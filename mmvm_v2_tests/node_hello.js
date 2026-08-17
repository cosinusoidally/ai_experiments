/* Compatible with Node.js 0.10 and newer. Uses built-in modules only. */
var http = require("http");

var port = process.argv[2] ? parseInt(process.argv[2], 10) : 8000;
var host = process.argv[3] || "0.0.0.0";
var body = "Hello, world!\n";

if (!(port >= 0 && port <= 65535)) {
    console.error("usage: node node_hello.js [port] [bind-address]");
    process.exit(2);
}

var server = http.createServer(function (request, response) {
    response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
});

server.on("error", function (error) {
    console.error("server error: " + error.message);
    process.exit(1);
});

server.listen(port, host, function () {
    var address = server.address();
    console.log("Listening on http://" + address.address + ":" + address.port + "/");
});
