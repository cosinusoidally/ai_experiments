/* Stop at the first unsupported native instruction, before semantic fallback.
 * Diagnostic only: run with Node or js_min, followed by guest_runner options.
 * Prints heap record types and bounded string previews without guest coercion.
 * Example: node guest_vm/tools/inspect_native_exit.js --opcode ADD --vm-native octane_runner.js CodeLoad
 */
var inspectExitNode = typeof module !== "undefined" && module.exports;
var inspectExitNative, inspectExitBytecode, inspectExitHeap, inspectExitCells;
if (inspectExitNode) {
    inspectExitNative = require("../aot/native_interpreter.js");
    inspectExitBytecode = require("../bytecode.js");
    inspectExitHeap = require("../heap.js");
    inspectExitCells = require("../value_cell.js");
} else {
    load("guest_vm/guest_vm.js");
    inspectExitNative = GuestVMNativeInterpreter;
    inspectExitBytecode = GuestVMBytecode;
    inspectExitHeap = GuestVMHeap;
    inspectExitCells = GuestVMValueCells;
}
var inspectExitOriginalRun = inspectExitNative.prototype.run;
var inspectExitArguments = inspectExitNode ? process.argv.slice(2) : arguments;
var inspectExitOpcode = null;
var inspectExitFilename = null, inspectExitPC = null, inspectExitOptionIndex = 0;
while (inspectExitArguments[inspectExitOptionIndex] === "--opcode" ||
       inspectExitArguments[inspectExitOptionIndex] === "--file" ||
       inspectExitArguments[inspectExitOptionIndex] === "--pc") {
    var inspectExitOption = inspectExitArguments[inspectExitOptionIndex++];
    var inspectExitValue = inspectExitArguments[inspectExitOptionIndex++];
    if (inspectExitOption === "--opcode") {
        inspectExitOpcode = inspectExitBytecode[inspectExitValue];
        if (!inspectExitOpcode) throw new Error("unknown --opcode name");
    } else if (inspectExitOption === "--file") inspectExitFilename = inspectExitValue;
    else inspectExitPC = Number(inspectExitValue);
}
if (inspectExitNode) process.argv.splice(2, inspectExitOptionIndex);
else arguments.splice(0, inspectExitOptionIndex);
function inspectExitPrint(message) {
    if (inspectExitNode) console.log(message);
    else print(message);
}
function inspectExitCell(runtime, cell, depth) {
    var cells = runtime.valueCells, records = runtime.heapRecords;
    var tag = cells.tagAt(cell);
    if (tag !== inspectExitCells.Tags.REFERENCE) {
        return "tag=" + tag + " value=" + String(cells.readPrimitiveAt(cell));
    }
    var reference = cells.referenceAddressAt(cell);
    var type = runtime.linearHeap.recordType(reference), name = String(type);
    for (var key in inspectExitHeap.Types) {
        if (inspectExitHeap.Types[key] === type) name = key;
    }
    var result = "reference=" + reference + " type=" + name;
    if (type === inspectExitHeap.Types.NATIVE_FUNCTION) {
        result += " intrinsic=" + records.functionMetadata(reference);
    }
    if (type === inspectExitHeap.Types.ARRAY && !depth) {
        var elements = records.arrayElements(reference);
        result += " length=" + records.vectorLength(elements);
        var element = 0;
        while (element < Math.min(records.vectorLength(elements), 4)) {
            result += "\n  [" + element + "]: " + inspectExitCell(runtime,
                records.vectorCellWithinLength(elements, element++), 1);
        }
    }
    if (type === inspectExitHeap.Types.STRING) {
        result += " length=" + records.stringLength(reference) + " preview=";
        var length = Math.min(records.stringLength(reference), 1536), index = 0;
        while (index < length) result += String.fromCharCode(
            records.stringCharacterCodeUnit(reference, index++));
    } else if (type === inspectExitHeap.Types.OBJECT && !depth) {
        var entry = records.lastOwnPropertyEntry(reference), count = 0;
        while (entry && count++ < 8) {
            var attributes = records.ownPropertyEntryAttributes(reference, entry);
            result += "\n  " + records.readString(records.ownPropertyEntryKey(reference, entry)) + ": ";
            if (attributes & records.constructor.Attributes.ACCESSOR) result += "<accessor>";
            else result += inspectExitCell(runtime,
                records.ownPropertyEntryValueCell(reference, entry), 1);
            entry = records.previousOwnPropertyEntry(reference, entry);
        }
    }
    return result;
}
inspectExitNative.prototype.run = function () {
    var result = inspectExitOriginalRun.apply(this, arguments);
    if (result.reason !== inspectExitNative.Exit.UNSUPPORTED) return result;
    if (inspectExitOpcode !== null && result.opcode !== inspectExitOpcode) return result;
    if (inspectExitPC !== null && result.pc !== inspectExitPC) return result;
    var records = this.runtime.heapRecords;
    var program = this.runtime.programMetadata["$" + records.frameProgram(result.frame)];
    if (inspectExitFilename !== null && (!program || program.filename !== inspectExitFilename)) return result;
    inspectExitPrint("native exit: " + inspectExitBytecode.NAMES[result.opcode] +
        " pc=" + result.pc + " function=" + (program && program.name || "<anonymous>") +
        " file=" + (program && program.filename || "<unknown>"));
    if (program && (result.opcode === inspectExitBytecode.GET_NAME ||
                    result.opcode === inspectExitBytecode.TYPEOF_NAME)) {
        inspectExitPrint("binding: " + program.constants[program.code[result.pc + 2]]);
    }
    if (program && (result.opcode === inspectExitBytecode.ADD ||
                    result.opcode === inspectExitBytecode.GET_PROPERTY ||
                    result.opcode === inspectExitBytecode.SET_PROPERTY)) {
        var leftOffset = result.opcode === inspectExitBytecode.SET_PROPERTY ? 1 : 2;
        var rightOffset = result.opcode === inspectExitBytecode.SET_PROPERTY ? 2 : 3;
        inspectExitPrint("left: " + inspectExitCell(this.runtime,
            records.frameRegisterCell(result.frame, program.code[result.pc + leftOffset])));
        inspectExitPrint("right: " + inspectExitCell(this.runtime,
            records.frameRegisterCell(result.frame, program.code[result.pc + rightOffset])));
    }
    if (program && (result.opcode === inspectExitBytecode.CALL ||
                    result.opcode === inspectExitBytecode.CONSTRUCT)) {
        inspectExitPrint("callable: " + inspectExitCell(this.runtime,
            records.frameRegisterCell(result.frame, program.code[result.pc + 2])));
        var receiverRegister = result.opcode === inspectExitBytecode.CALL ?
            program.code[result.pc + 3] : -1;
        if (receiverRegister >= 0) inspectExitPrint("receiver: " + inspectExitCell(this.runtime,
            records.frameRegisterCell(result.frame, receiverRegister)));
        var argumentOffset = result.opcode === inspectExitBytecode.CALL ? 4 : 3;
        var argumentRegisters = program.constants[program.code[result.pc + argumentOffset]];
        var argumentIndex = 0;
        while (argumentRegisters && argumentIndex < argumentRegisters.length) {
            var argumentRegister = argumentRegisters[argumentIndex];
            inspectExitPrint("argument " + argumentIndex++ + ": " + inspectExitCell(this.runtime,
                records.frameRegisterCell(result.frame, argumentRegister)));
        }
    }
    /* Do not throw through an execution whose engine-owned frame has not
     * yet been reconciled with its portable wrapper. This is a stop tool. */
    if (inspectExitNode) process.exit(70);
    else quit(70);
};
if (inspectExitNode) require("../../guest_runner.js");
else load("guest_runner.js");
