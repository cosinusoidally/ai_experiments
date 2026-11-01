/* A completed script is not necessarily a passing legacy test. */
(function () {
    var failures = [], index;
    for (index = 0; index < gTestcases.length; index++) {
        var item = gTestcases[index];
        if (item && !item.passed) {
            failures.push(String(item.description) + ": expected " +
                String(item.expect) + ", got " + String(item.actual));
        }
    }
    for (index = 0; index < ecmaReportedFailures.length; index++) {
        failures.push(ecmaReportedFailures[index]);
    }
    if (failures.length) {
        var error = new Error(failures.length + " failed case/report(s): " +
            failures.slice(0, 4).join(" | "));
        error.name = "EcmaAssertionError";
        throw error;
    }
}());
