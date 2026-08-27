function installLateGlobal() {
    compiledLateGlobal = function () { return 17; };
}

function compiledOuter(value) {
    var offset = 6;
    function compiledInner(extra) {
        return value + offset + extra;
    }
    return compiledInner(4);
}

installLateGlobal();
assertEqual(compiledLateGlobal(), 17);
assertEqual(compiledOuter(2), 12);
