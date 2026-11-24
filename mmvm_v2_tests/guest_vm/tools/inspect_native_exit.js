/* Stop at the first unsupported native instruction, before semantic fallback.
 * Diagnostic only: run with Node or js_min, followed by guest_runner options.
 * Prints heap record types and bounded string previews without guest coercion.
 * Example: node guest_vm/tools/inspect_native_exit.js --opcode ADD --vm-native octane_runner.js CodeLoad
 * Standalone: artifacts/js_runner.exe artifacts/snap guest_vm/tools/inspect_native_exit.js --opcode CALL program.js
 * The standalone image is already native: supply the program and its arguments,
 * not guest_runner's --vm-native option, after the diagnostic filters.
 */
var inspectExitNode = typeof module !== "undefined" && module.exports;
var inspectExitStandalone = typeof guestStandaloneExecute === "function" &&
    typeof GuestVMNativeInterpreter === "function";
var inspectExitNative, inspectExitBytecode, inspectExitHeap, inspectExitCells;
if (inspectExitStandalone) {
    inspectExitNative = GuestVMNativeInterpreter;
    inspectExitBytecode = GuestVMBytecode;
    inspectExitHeap = GuestVMHeap;
    inspectExitCells = GuestVMValueCells;
} else if (inspectExitNode) {
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
    if (type === inspectExitHeap.Types.BUFFER_VIEW) {
        var backing = records.bufferViewBacking(reference);
        result += " kind=" + records.bufferViewKind(reference) +
            " length=" + records.bufferViewLength(reference) +
            " offset=" + records.bufferViewOffset(reference) +
            " backing=" + backing + " pointer=" + records.bufferBackingPointer(backing);
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
function inspectExitWrapRun(originalRun) {
  return function () {
    var result = originalRun.apply(this, arguments);
    if (result.reason !== inspectExitNative.Exit.UNSUPPORTED) return result;
    if (inspectExitOpcode !== null && result.opcode !== inspectExitOpcode) return result;
    if (inspectExitPC !== null && result.pc !== inspectExitPC) return result;
    var records = this.runtime.heapRecords;
    var program = this.runtime.adoptHeapProgram(records.frameProgram(result.frame));
    if (inspectExitFilename !== null && (!program || program.filename !== inspectExitFilename)) return result;
    var location = inspectExitNative.sourceLocation(program, result.pc);
    inspectExitPrint("native exit: " + inspectExitBytecode.NAMES[result.opcode] +
        " pc=" + result.pc + " function=" + (program && program.name || "<anonymous>") +
        " file=" + location.filename + ":" + location.line + ":" + location.column +
        " detail=" + inspectExitNative.describeCallRejectReason(
            records.engineCallRejectReason(this.stateAddress)));
    if (program && (result.opcode === inspectExitBytecode.GET_NAME ||
                    result.opcode === inspectExitBytecode.TYPEOF_NAME)) {
        inspectExitPrint("binding: " + program.constants[program.code[result.pc + 2]]);
        var environment = records.frameEnvironment(result.frame), environmentDepth = 0;
        var maximumEnvironments = 8, maximumBindings = 16;
        while (environment && environmentDepth++ < maximumEnvironments) {
            var environmentProgram = records.environmentProgram(environment);
            var bindingNames = environmentProgram ? records.programBindingNames(environmentProgram) : 0;
            inspectExitPrint("environment " + environment + " program=" + environmentProgram +
                " parent=" + records.environmentParent(environment) +
                " count=" + records.environmentSlotCount(environment));
            for (var bindingIndex = 0; bindingIndex < records.environmentSlotCount(environment) &&
                    bindingIndex < maximumBindings; bindingIndex++) {
                var bindingName = bindingNames ? this.runtime.readHeapValue(
                    records.vectorCellWithinLength(bindingNames, bindingIndex)) : "<scope binding>";
                inspectExitPrint("  " + bindingName + ": " + inspectExitCell(this.runtime,
                    records.environmentCell(environment, bindingIndex), 1));
            }
            environment = records.environmentParent(environment);
        }
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
}
inspectExitNative.prototype.run = inspectExitWrapRun(inspectExitOriginalRun);
if (inspectExitStandalone) {
    /* CommonJS loading can create another implementation class inside the
     * snapshot. Attach to the actual engine, not just a global constructor
     * whose prototype that runtime may never use. Context creation is the
     * first public boundary after an engine has been constructed. */
    var inspectExitCreateContext = GuestVM.JSRuntime.prototype.createContext;
    GuestVM.JSRuntime.prototype.createContext = function () {
        var engine = this.runtime.nativeInterpreter;
        if (engine && !engine.inspectExitAttached) {
            if (engine.run !== inspectExitNative.prototype.run) {
                engine.run = inspectExitWrapRun(engine.run);
            }
            engine.inspectExitAttached = true;
        }
        return inspectExitCreateContext.apply(this, arguments);
    };
}
if (inspectExitStandalone) guestStandaloneExecute(inspectExitArguments[0], inspectExitArguments.slice(1));
else if (inspectExitNode) require("../../guest_runner.js");
else load("guest_runner.js");
