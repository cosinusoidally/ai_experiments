/* Install after the corpus shell helpers, before the test script. */
var ecmaReportedFailures = [];
var ecmaOriginalReportFailure = reportFailure;
reportFailure = function (message) {
    ecmaReportedFailures.push(String(message));
    return ecmaOriginalReportFailure(message);
};
