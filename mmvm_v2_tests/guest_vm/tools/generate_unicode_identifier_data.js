/* Generate the guest tokenizer's compact BMP identifier table.
 *
 * This is intentionally an ES3-compatible js_min.exe program.  It consumes
 * the Unicode Consortium's semicolon-delimited UnicodeData file and writes a
 * JavaScript module to stdout.  See guest_vm/UNICODE_IDENTIFIERS.md.
 */
(function (shellArguments) {
    var inputPath;
    var lines;
    var flags = [];
    var startCategories = {
        "$Lu": 1, "$Ll": 1, "$Lt": 1, "$Lm": 1, "$Lo": 1, "$Nl": 1
    };
    var partCategories = {
        "$Lu": 1, "$Ll": 1, "$Lt": 1, "$Lm": 1, "$Lo": 1, "$Nl": 1,
        "$Mn": 1, "$Mc": 1, "$Nd": 1, "$Pc": 1
    };
    var rangeStart = -1;
    var rangeCategory = "";
    var blockMap = [];
    var characterBlocks = [];
    var blocksByContents = {};
    var lineIndex;

    function fail(message) {
        throw new Error("generate_unicode_identifier_data: " + message);
    }

    function categoryFlags(category) {
        var result = 0;
        if (partCategories["$" + category]) result |= 1;
        if (startCategories["$" + category]) result |= 2;
        return result;
    }

    function assignRange(first, last, category) {
        var value = categoryFlags(category);
        var code = first;
        while (code <= last && code <= 65535) {
            flags[code] = value;
            code++;
        }
    }

    function fourHex(value) {
        var digits = "0123456789ABCDEF";
        return digits.charAt((value >>> 12) & 15) +
               digits.charAt((value >>> 8) & 15) +
               digits.charAt((value >>> 4) & 15) +
               digits.charAt(value & 15);
    }

    function escapedString(values, indent) {
        var output = [];
        var offset = 0;
        while (offset < values.length) {
            var limit = offset + 64;
            var text = indent + '"';
            var index = offset;
            if (limit > values.length) limit = values.length;
            while (index < limit) {
                text += "\\u" + fourHex(values[index]);
                index++;
            }
            text += limit < values.length ? '" +' : '";';
            output.push(text);
            offset = limit;
        }
        return output.join("\n");
    }

    if (typeof read !== "function") {
        fail("run this generator with js_min.exe");
    }
    if (!shellArguments || shellArguments.length !== 1) {
        fail("usage: js_min.exe generate_unicode_identifier_data.js " +
             "UnicodeData-3.0.0.txt");
    }

    inputPath = String(shellArguments[0]);
    lines = String(read(inputPath)).split("\n");
    lineIndex = 0;
    while (lineIndex < lines.length) {
        var line = lines[lineIndex];
        if (line.length !== 0) {
            var fields = line.split(";");
            var code;
            var name;
            var category;
            if (fields.length < 3) fail("malformed input line " + (lineIndex + 1));
            code = parseInt(fields[0], 16);
            name = fields[1];
            category = fields[2];
            if (name.indexOf(", First>") >= 0) {
                if (rangeStart >= 0) fail("nested range at line " + (lineIndex + 1));
                rangeStart = code;
                rangeCategory = category;
            } else if (name.indexOf(", Last>") >= 0) {
                if (rangeStart < 0 || rangeCategory !== category) {
                    fail("unmatched range end at line " + (lineIndex + 1));
                }
                assignRange(rangeStart, code, category);
                rangeStart = -1;
                rangeCategory = "";
            } else {
                assignRange(code, code, category);
            }
        }
        lineIndex++;
    }
    if (rangeStart >= 0) fail("unterminated UnicodeData range");

    /* ES5.1 explicitly adds these Cf characters to IdentifierPart. */
    flags[0x200C] = 1;
    flags[0x200D] = 1;

    var blockStart = 0;
    while (blockStart < 65536) {
        var key = "$";
        var block = [];
        var blockOffset = 0;
        while (blockOffset < 64) {
            var flag = flags[blockStart + blockOffset] || 0;
            key += String.fromCharCode(flag);
            block.push(flag);
            blockOffset++;
        }
        var blockNumber = blocksByContents[key];
        if (blockNumber === undefined) {
            blockNumber = characterBlocks.length / 64;
            blocksByContents[key] = blockNumber;
            characterBlocks = characterBlocks.concat(block);
        }
        blockMap.push(blockNumber);
        blockStart += 64;
    }

    print("/* GENERATED FILE: do not edit by hand.");
    print(" * Source: UnicodeData-3.0.0.txt");
    print(" * Source SHA-256:");
    print(" *   f41d967bc458ee106f0c3948bfad71cd0860d96c49304e3fd02eaf2bbae4b6d9");
    print(" * Generator: guest_vm/tools/generate_unicode_identifier_data.js");
    print(" */");
    print("(function (root) {");
    print("    var blockMap =");
    print(escapedString(blockMap, "        "));
    print("    var characterFlags =");
    print(escapedString(characterBlocks, "        "));
    print("");
    print("    var data = {");
    print("        blockMap: blockMap,");
    print("        characterFlags: characterFlags,");
    print("        blockSizeShift: 6,");
    print("        blockSizeMask: 63,");
    print("        partFlag: 1,");
    print("        startFlag: 2");
    print("    };");
    print("    if (typeof module !== \"undefined\" && module.exports) {");
    print("        module.exports = data;");
    print("    } else {");
    print("        root.GuestVMUnicodeIdentifierData = data;");
    print("    }");
    print("}(this));");
}(typeof arguments === "undefined" ? null : arguments));
