(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");

    function makeFrame(program, runtime, context, receiver, args, closure, callable,
                       returnRegister) {
        return {program: program, code: program.code, constants: program.constants,
                registers: [], pc: 0,
                context: context,
                environment: runtime.makeCallEnvironment(
                    program, receiver, args || [], closure, callable),
                returnRegister: returnRegister, handlers: []};
    }

    function Execution(program, runtime, context) {
        this.runtime = runtime;
        this.context = context;
        this.frames = [makeFrame(program, runtime, context,
                                 undefined, [], null, null, -1)];
        this.pendingHostCall = null;
        this.status = "ready";
        this.value = undefined;
        this.exception = undefined;
        this.injectedHostException = undefined;
        this.hasInjectedHostException = false;
        this.totalInstructions = 0;
    }

    Execution.fromFunction = function (callable, runtime, context, receiver, args) {
        if (!callable || callable.guestType !== "bytecodeFunction") {
            throw new TypeError("entry value is not a guest bytecode function");
        }
        runtime.assertOwned(callable);
        var execution = new Execution(callable.program, runtime, context);
        execution.frames = [makeFrame(callable.program, runtime,
            callable.homeContext || context, receiver, args || [], callable.closure,
            callable, -1)];
        return execution;
    };

    Execution.prototype.result = function (status, used) {
        var result = {status: status, instructions: used,
                      totalInstructions: this.totalInstructions};
        if (status === "completed") result.value = this.value;
        else if (status === "threw") result.exception = this.exception;
        else if (status === "hostCall") {
            result.call = {name: this.pendingHostCall.callable.name,
                           receiver: this.pendingHostCall.receiver,
                           arguments: this.pendingHostCall.args};
        }
        return result;
    };

    Execution.prototype.finish = function (status, value, used) {
        this.status = status;
        if (status === "completed") this.value = value;
        else this.exception = value;
        if (this.context.execution === this) this.context.execution = null;
        return this.result(status, used);
    };

    Execution.prototype.handleException = function (error) {
        while (this.frames.length) {
            var frame = this.frames[this.frames.length - 1];
            if (frame.handlers.length) {
                var handler = frame.handlers.pop();
                this.runtime.setBinding(frame.context, frame.environment,
                                        handler.name, error);
                frame.pc = handler.target;
                return true;
            }
            this.frames.pop();
        }
        return false;
    };

    Execution.prototype.resume = function (budget) {
        if (this.status === "completed" || this.status === "threw" ||
            this.status === "aborted") throw new Error("execution is no longer resumable");
        if (this.pendingHostCall) {
            throw new Error("pending host call must be completed before resume");
        }
        if (budget === undefined) budget = Infinity;
        budget = Number(budget);
        if (budget < 0 || budget !== budget ||
            (budget !== Infinity && budget !== Math.floor(budget))) {
            throw new RangeError("instruction budget must be a non-negative integer or Infinity");
        }

        this.status = "running";
        var used = 0;
        if (this.hasInjectedHostException) {
            var injected = this.injectedHostException;
            this.injectedHostException = undefined;
            this.hasInjectedHostException = false;
            if (!this.handleException(injected)) {
                return this.finish("threw", injected, 0);
            }
        }
        try {
            while (this.frames.length) {
                if (budget === 0) {
                    this.status = "budget";
                    return this.result("budget", used);
                }
                var frame = this.frames[this.frames.length - 1];
                var code = frame.code;
                var constants = frame.constants;
                var registers = frame.registers;
                var pc = frame.pc;
                var opcode = code[pc];
                var target;
                var left;
                var right;
                var index;
                var args;
                budget--;
                used++;
                this.totalInstructions++;

                if (opcode === op.CONST) {
                    registers[code[pc + 1]] = constants[code[pc + 2]];
                    frame.pc = pc + 3;
                } else if (opcode === op.GET_GLOBAL) {
                    registers[code[pc + 1]] = this.runtime.getBinding(
                        frame.context, frame.environment, constants[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.SET_GLOBAL) {
                    this.runtime.setBinding(frame.context, frame.environment,
                        constants[code[pc + 1]], registers[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.MOVE) {
                    registers[code[pc + 1]] = registers[code[pc + 2]];
                    frame.pc = pc + 3;
                } else if (opcode === op.GET_PROPERTY) {
                    registers[code[pc + 1]] = this.runtime.getProperty(
                        registers[code[pc + 2]], registers[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if (opcode === op.SET_PROPERTY) {
                    this.runtime.setProperty(registers[code[pc + 1]],
                                             registers[code[pc + 2]],
                                             registers[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if ((opcode >= op.ADD && opcode <= op.GREATER_EQUAL) ||
                           (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT)) {
                    target = code[pc + 1];
                    left = registers[code[pc + 2]];
                    right = registers[code[pc + 3]];
                    if (opcode === op.ADD) registers[target] = this.runtime.add(left, right);
                    else if (opcode === op.SUBTRACT) registers[target] = Number(left) - Number(right);
                    else if (opcode === op.MULTIPLY) registers[target] = Number(left) * Number(right);
                    else if (opcode === op.DIVIDE) registers[target] = Number(left) / Number(right);
                    else if (opcode === op.REMAINDER) registers[target] = Number(left) % Number(right);
                    else if (opcode === op.STRICT_EQUAL) registers[target] = left === right;
                    else if (opcode === op.EQUAL) registers[target] = this.runtime.equal(left, right);
                    else if (opcode === op.LESS) registers[target] = left < right;
                    else if (opcode === op.LESS_EQUAL) registers[target] = left <= right;
                    else if (opcode === op.GREATER) registers[target] = left > right;
                    else if (opcode === op.GREATER_EQUAL) registers[target] = left >= right;
                    else if (opcode === op.BIT_AND) registers[target] = left & right;
                    else if (opcode === op.BIT_OR) registers[target] = left | right;
                    else if (opcode === op.BIT_XOR) registers[target] = left ^ right;
                    else if (opcode === op.SHIFT_LEFT) registers[target] = left << right;
                    else if (opcode === op.SHIFT_RIGHT) registers[target] = left >> right;
                    else registers[target] = left >>> right;
                    frame.pc = pc + 4;
                } else if (opcode === op.NOT) {
                    registers[code[pc + 1]] = !this.runtime.truthy(registers[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.NEGATE) {
                    registers[code[pc + 1]] = -Number(registers[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.POSITIVE) {
                    registers[code[pc + 1]] = Number(registers[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.JUMP) {
                    if (code[pc + 1] <= pc) this.runtime.gcSafePoint();
                    frame.pc = code[pc + 1];
                } else if (opcode === op.JUMP_IF_FALSE) {
                    frame.pc = !this.runtime.truthy(registers[code[pc + 1]]) ?
                               code[pc + 2] : pc + 3;
                } else if (opcode === op.CALL) {
                    args = [];
                    index = 0;
                    while (index < code[pc + 5]) {
                        args[index] = registers[code[pc + 4] + index];
                        index++;
                    }
                    var callableValue = registers[code[pc + 2]];
                    var receiver = code[pc + 3] < 0 ? undefined :
                                   registers[code[pc + 3]];
                    var destination = code[pc + 1];
                    frame.pc = pc + 6;
                    if (callableValue && callableValue.guestType === "bytecodeFunction") {
                        this.frames.push(makeFrame(callableValue.program, this.runtime,
                            callableValue.homeContext || frame.context, receiver, args,
                            callableValue.closure, callableValue,
                            destination));
                        this.runtime.gcSafePoint();
                    } else if (callableValue && callableValue.guestType === "function" &&
                               callableValue.callMode === "host") {
                        this.pendingHostCall = {callable: callableValue,
                                                receiver: receiver, args: args,
                                                frame: frame, destination: destination};
                        this.status = "hostCall";
                        return this.result("hostCall", used);
                    } else {
                        registers[destination] = this.runtime.call(
                            callableValue, receiver, args);
                        this.runtime.gcSafePoint();
                    }
                } else if (opcode === op.CONSTRUCT) {
                    args = [];
                    index = 0;
                    while (index < code[pc + 4]) {
                        args[index] = registers[code[pc + 3] + index];
                        index++;
                    }
                    var constructorValue = registers[code[pc + 2]];
                    var constructDestination = code[pc + 1];
                    frame.pc = pc + 5;
                    if (constructorValue && constructorValue.guestType === "function" &&
                        constructorValue.callMode === "host") {
                        this.pendingHostCall = {callable: constructorValue,
                                                receiver: undefined, args: args,
                                                frame: frame,
                                                destination: constructDestination,
                                                construct: true};
                        this.status = "hostCall";
                        return this.result("hostCall", used);
                    }
                    registers[constructDestination] = this.runtime.construct(
                        constructorValue, args);
                    this.runtime.gcSafePoint();
                } else if (opcode === op.MAKE_FUNCTION) {
                    registers[code[pc + 1]] = this.runtime.makeGuestFunction(
                        constants[code[pc + 2]], frame.environment, frame.context);
                    this.runtime.gcSafePoint();
                    frame.pc = pc + 3;
                } else if (opcode === op.MAKE_OBJECT) {
                    registers[code[pc + 1]] = this.runtime.makeObject();
                    this.runtime.gcSafePoint();
                    frame.pc = pc + 2;
                } else if (opcode === op.MAKE_ARRAY) {
                    registers[code[pc + 1]] = this.runtime.makeArray();
                    this.runtime.gcSafePoint();
                    frame.pc = pc + 2;
                } else if (opcode === op.MAKE_REGEXP) {
                    registers[code[pc + 1]] = this.runtime.makeRegExp(
                        constants[code[pc + 2]], constants[code[pc + 3]]);
                    this.runtime.gcSafePoint();
                    frame.pc = pc + 4;
                } else if (opcode === op.THROW) {
                    var thrownValue = registers[code[pc + 1]];
                    if (!this.handleException(thrownValue)) {
                        return this.finish("threw", thrownValue, used);
                    }
                } else if (opcode === op.PUSH_CATCH) {
                    frame.handlers.push({target: code[pc + 1],
                                         name: constants[code[pc + 2]]});
                    frame.pc = pc + 3;
                } else if (opcode === op.POP_CATCH) {
                    if (!frame.handlers.length) {
                        throw new Error("catch-handler stack underflow");
                    }
                    frame.handlers.pop();
                    frame.pc = pc + 1;
                } else if (opcode === op.RETURN) {
                    var returnValue = registers[code[pc + 1]];
                    var returnedFrame = this.frames.pop();
                    if (!this.frames.length) return this.finish("completed", returnValue, used);
                    var caller = this.frames[this.frames.length - 1];
                    caller.registers[returnedFrame.returnRegister] = returnValue;
                } else {
                    throw new Error("invalid guest opcode " + opcode + " at " + pc);
                }
            }
            return this.finish("completed", undefined, used);
        } catch (error) {
            if (this.handleException(error)) {
                var resumed = this.resume(budget);
                resumed.instructions += used;
                return resumed;
            }
            return this.finish("threw", error, used);
        }
    };

    Execution.prototype.completeHostCall = function (value) {
        if (!this.pendingHostCall) throw new Error("execution has no pending host call");
        this.runtime.assertOwned(value);
        this.pendingHostCall.frame.registers[this.pendingHostCall.destination] = value;
        this.pendingHostCall = null;
        this.status = "ready";
        this.runtime.gcSafePoint();
    };

    Execution.prototype.failHostCall = function (error) {
        if (!this.pendingHostCall) throw new Error("execution has no pending host call");
        this.pendingHostCall = null;
        this.status = "ready";
        this.injectedHostException = error;
        this.hasInjectedHostException = true;
    };

    Execution.prototype.serviceHostCall = function () {
        if (!this.pendingHostCall) throw new Error("execution has no pending host call");
        var call = this.pendingHostCall;
        try {
            this.completeHostCall(call.callable.callback(call.receiver, call.args));
        } catch (error) {
            this.failHostCall(error);
        }
    };

    Execution.prototype.abort = function () {
        if (this.status === "completed" || this.status === "threw") return;
        this.frames = [];
        this.pendingHostCall = null;
        this.status = "aborted";
        if (this.context.execution === this) this.context.execution = null;
    };

    root.GuestVMExecution = Execution;
    if (typeof module !== "undefined" && module.exports) module.exports = Execution;
}(this));
