(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");

    function makeFrame(program, runtime, context, receiver, args, closure, callable,
                       returnRegister, caller) {
        args = args || [];
        var registers = [];
        runtime.initializeFrameRegisters(program, registers, receiver, args, callable);
        var environment = runtime.makeCallEnvironment(
            program, receiver, args, closure, callable);
        var frame = {program: program, code: program.code, constants: program.constants,
                registers: registers, pc: 0,
                context: context,
                environment: environment,
                returnRegister: returnRegister};
        frame.heapAddress = runtime.heapRecords.allocateFrame(
            runtime.programAddress(program), environment ? environment.heapAddress : 0,
            caller ? caller.heapAddress : 0, returnRegister,
            program.registerCount || 0, context ? context.heapAddress : 0);
        if (runtime.nativeInterpreter) {
            runtime.heapRecords.setFramePC(frame.heapAddress, 0);
            var initializedRegister = 0;
            while (initializedRegister < frame.registers.length) {
                if (frame.registers[initializedRegister] !== undefined) {
                    runtime.spillFrameRegister(frame, initializedRegister);
                }
                initializedRegister++;
            }
        } else runtime.spillFrame(frame);
        frame.nativeHeapCurrent = true;
        return frame;
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
        this.compiledEntry = null;
        runtime.heapRecords.setContextActiveFrame(context.heapAddress,
                                                  this.frames[0].heapAddress);
    }

    Execution.fromFunction = function (callable, runtime, context, receiver, args) {
        if (!callable || callable.guestType !== "bytecodeFunction") {
            throw new TypeError("entry value is not a guest bytecode function");
        }
        runtime.assertOwned(callable);
        var execution = new Execution(callable.program, runtime, context);
        while (execution.frames.length) {
            execution.releaseFrame(execution.frames.pop());
        }
        execution.frames = [makeFrame(callable.program, runtime,
            callable.homeContext || context, receiver, args || [], runtime.functionClosure(callable),
            callable, -1)];
        runtime.heapRecords.setContextActiveFrame(
            (callable.homeContext || context).heapAddress,
            execution.frames[0].heapAddress);
        if (runtime.threadedCompiler) {
            var compiled = runtime.threadedCompiler.compile(callable.program);
            if (compiled) {
                execution.compiledEntry = {fn: compiled, callable: callable,
                    context: callable.homeContext || context, receiver: receiver,
                    args: args || []};
            }
        }
        return execution;
    };

    Execution.prototype.result = function (status, used) {
        this.spillFrames();
        this.runtime.heapRecords.setContextActiveFrame(this.context.heapAddress,
            this.frames.length ? this.frames[this.frames.length - 1].heapAddress : 0);
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

    Execution.prototype.spillFrames = function () {
        var index = 0;
        while (index < this.frames.length) {
            var frame = this.frames[index++];
            if (!this.runtime.nativeInterpreter || !frame.nativeHeapCurrent) {
                this.runtime.spillFrame(frame);
                frame.nativeHeapCurrent = true;
            }
        }
    };

    Execution.prototype.reloadNativeOperand = function (frame, register) {
        if (register >= 0) {
            var registerCount = this.runtime.heapRecords.frameRegisterCount(
                frame.heapAddress);
            if (register >= registerCount) {
                throw new Error("native frame/program mismatch: frame=" +
                    frame.heapAddress + " program=" +
                    this.runtime.heapRecords.frameProgram(frame.heapAddress) +
                    " register=" + register + " registerCount=" +
                    registerCount + " pc=" + frame.pc);
            }
            this.runtime.reloadFrameRegister(frame, register);
        }
    };

    Execution.prototype.reloadNativeOperands = function (frame, pc, opcode) {
        var code = frame.code;
        var constants = frame.constants;
        if (opcode === op.SET_GLOBAL) {
            this.reloadNativeOperand(frame, code[pc + 2]);
        } else if (opcode === op.MOVE) {
            this.reloadNativeOperand(frame, code[pc + 2]);
        } else if (opcode === op.GET_PROPERTY) {
            this.reloadNativeOperand(frame, code[pc + 2]);
            this.reloadNativeOperand(frame, code[pc + 3]);
        } else if (opcode === op.SET_PROPERTY) {
            this.reloadNativeOperand(frame, code[pc + 1]);
            this.reloadNativeOperand(frame, code[pc + 2]);
            this.reloadNativeOperand(frame, code[pc + 3]);
        } else if ((opcode >= op.ADD && opcode <= op.GREATER_EQUAL) ||
                   (opcode >= op.BIT_AND &&
                    opcode <= op.SHIFT_UNSIGNED_RIGHT)) {
            this.reloadNativeOperand(frame, code[pc + 2]);
            this.reloadNativeOperand(frame, code[pc + 3]);
        } else if (opcode === op.NOT || opcode === op.NEGATE ||
                   opcode === op.POSITIVE || opcode === op.BIT_NOT ||
                   opcode === op.TYPEOF || opcode === op.GET_KEYS) {
            this.reloadNativeOperand(frame, code[pc + 2]);
        } else if (opcode === op.JUMP_IF_FALSE || opcode === op.THROW) {
            this.reloadNativeOperand(frame, code[pc + 1]);
        } else if (opcode === op.CALL) {
            this.reloadNativeOperand(frame, code[pc + 2]);
            this.reloadNativeOperand(frame, code[pc + 3]);
            var callRegisters = constants[code[pc + 4]];
            var callIndex = 0;
            while (callIndex < callRegisters.length) {
                this.reloadNativeOperand(frame, callRegisters[callIndex++]);
            }
        } else if (opcode === op.CONSTRUCT) {
            this.reloadNativeOperand(frame, code[pc + 2]);
            var constructRegisters = constants[code[pc + 3]];
            var constructIndex = 0;
            while (constructIndex < constructRegisters.length) {
                this.reloadNativeOperand(
                    frame, constructRegisters[constructIndex++]);
            }
        } else if (opcode === op.DELETE_PROPERTY) {
            this.reloadNativeOperand(frame, code[pc + 2]);
            this.reloadNativeOperand(frame, code[pc + 3]);
        } else if (opcode === op.SET_LOCAL) {
            this.reloadNativeOperand(frame, code[pc + 3]);
        } else if (opcode === op.GET_PROPERTY_CONST ||
                   opcode === op.DELETE_PROPERTY_CONST) {
            this.reloadNativeOperand(frame, code[pc + 2]);
        } else if (opcode === op.SET_PROPERTY_CONST) {
            this.reloadNativeOperand(frame, code[pc + 1]);
            this.reloadNativeOperand(frame, code[pc + 3]);
        } else if (opcode === op.RETURN) {
            this.reloadNativeOperand(frame, code[pc + 1]);
        }
    };

    Execution.prototype.fallbackHasDestination = function (opcode) {
        return opcode === op.CONST || opcode === op.GET_GLOBAL ||
            opcode === op.MOVE || opcode === op.GET_PROPERTY ||
            (opcode >= op.ADD && opcode <= op.POSITIVE) ||
            opcode === op.CALL || opcode === op.CONSTRUCT ||
            opcode === op.MAKE_FUNCTION || opcode === op.MAKE_OBJECT ||
            opcode === op.MAKE_ARRAY || opcode === op.MAKE_REGEXP ||
            (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT) ||
            opcode === op.BIT_NOT || opcode === op.TYPEOF ||
            opcode === op.DELETE_PROPERTY || opcode === op.GET_KEYS ||
            opcode === op.GET_LOCAL || opcode === op.GET_PROPERTY_CONST ||
            opcode === op.DELETE_PROPERTY_CONST;
    };

    Execution.prototype.synchronizeFallbackStep = function (frame, pc, opcode) {
        var index = 0;
        var live = false;
        while (index < this.frames.length) {
            if (this.frames[index++] === frame) live = true;
        }
        if (!live) return;
        this.runtime.spillFramePC(frame);
        if (this.fallbackHasDestination(opcode)) {
            this.runtime.spillFrameRegister(frame, frame.code[pc + 1]);
        }
        frame.nativeHeapCurrent = true;
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
            var handler = this.runtime.heapRecords.popFrameHandler(
                frame.heapAddress);
            if (handler) {
                var nameConstant =
                    this.runtime.heapRecords.handlerNameConstant(handler);
                var target = this.runtime.heapRecords.handlerTarget(handler);
                this.runtime.linearHeap.freeRecord(handler);
                this.runtime.setBinding(frame.context, frame.environment,
                    frame.constants[nameConstant],
                    this.runtime.importCaughtException(error));
                frame.pc = target;
                return true;
            }
            this.frames.pop();
            this.releaseFrame(frame);
        }
        return false;
    };

    Execution.prototype.releaseFrame = function (frame) {
        var handler;
        while ((handler = this.runtime.heapRecords.popFrameHandler(
                    frame.heapAddress))) {
            this.runtime.linearHeap.freeRecord(handler);
        }
        this.runtime.linearHeap.freeRecord(frame.heapAddress);
    };

    Execution.prototype.synchronizeNativeFrames = function (currentFrameAddress) {
        var existing = {};
        var index = 0;
        while (index < this.frames.length) {
            existing["$" + this.frames[index].heapAddress] = this.frames[index];
            index++;
        }
        var addresses = [];
        var address = currentFrameAddress;
        while (address) {
            addresses.push(address);
            address = this.runtime.heapRecords.frameCaller(address);
        }
        var synchronizedFrames = [];
        index = addresses.length - 1;
        while (index >= 0) {
            address = addresses[index--];
            var frame = existing["$" + address];
            var authoritativeProgram =
                this.runtime.heapRecords.frameProgram(address);
            if (frame && this.runtime.programAddress(frame.program) !==
                authoritativeProgram) {
                frame = null;
            }
            if (!frame) {
                var programAddress = authoritativeProgram;
                var program = this.runtime.programMetadata["$" + programAddress];
                if (!program) {
                    throw new Error("native frame references unknown guest program " +
                                    programAddress);
                }
                var contextAddress = this.runtime.heapRecords.frameContext(address);
                var context = null;
                var contextIndex = 0;
                while (contextIndex < this.runtime.contexts.length) {
                    if (this.runtime.contexts[contextIndex].heapAddress ===
                        contextAddress) {
                        context = this.runtime.contexts[contextIndex];
                        break;
                    }
                    contextIndex++;
                }
                var environmentAddress =
                    this.runtime.heapRecords.frameEnvironment(address);
                var environmentMetadata = environmentAddress ?
                    this.runtime.environmentMetadata["$" + environmentAddress] : null;
                frame = {program: program, code: program.code,
                         constants: program.constants, registers: [],
                         pc: this.runtime.heapRecords.framePC(address),
                         context: context || this.context,
                         environment: environmentMetadata ?
                                      environmentMetadata.handle : null,
                         returnRegister:
                            this.runtime.heapRecords.frameReturnSlot(address),
                         heapAddress: address, nativeHeapCurrent: true};
            }
            synchronizedFrames.push(frame);
        }
        this.frames = synchronizedFrames;
        return synchronizedFrames[synchronizedFrames.length - 1];
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
        if (this.runtime.nativeInterpreter) this.compiledEntry = null;
        if (this.compiledEntry && budget === Infinity) {
            var entry = this.compiledEntry;
            this.compiledEntry = null;
            while (this.frames.length) {
                this.releaseFrame(this.frames.pop());
            }
            try {
                var compiledValue;
                if (this.runtime.profileOpcodeCounts) {
                    var compiledStarted = new Date().getTime();
                    try {
                        compiledValue = entry.fn(this.runtime, entry.context,
                            entry.receiver, entry.args,
                            this.runtime.functionClosure(entry.callable),
                            entry.callable);
                    } finally {
                        this.runtime.threadedCompiler.recordProfile(
                            entry.callable.name || "<anonymous>",
                            new Date().getTime() - compiledStarted);
                    }
                } else {
                    compiledValue = entry.fn(this.runtime, entry.context,
                        entry.receiver, entry.args,
                        this.runtime.functionClosure(entry.callable), entry.callable);
                }
                this.runtime.gcSafePoint();
                return this.finish("completed", compiledValue, 0);
            } catch (compiledError) {
                return this.finish("threw", this.runtime.locateError(
                    compiledError, entry.callable.program), 0);
            }
        }
        if (this.compiledEntry) this.compiledEntry = null;
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
                if (this.runtime.nativeInterpreter) {
                    var nativeFrame = this.frames[this.frames.length - 1];
                    if (!nativeFrame.nativeHeapCurrent) {
                        this.runtime.spillFrame(nativeFrame);
                        nativeFrame.nativeHeapCurrent = true;
                    }
                    var nativeBudget = budget === Infinity ? 2147483647 : budget;
                    var nativeResult = this.runtime.nativeInterpreter.run(
                        nativeFrame.heapAddress, nativeFrame.program, nativeBudget,
                        nativeFrame.context);
                    nativeFrame = this.synchronizeNativeFrames(nativeResult.frame);
                    nativeFrame.pc = nativeResult.pc;
                    used += nativeResult.instructions;
                    this.totalInstructions += nativeResult.instructions;
                    if (budget !== Infinity) budget -= nativeResult.instructions;
                    if (nativeResult.reason === 1) {
                        this.status = "budget";
                        return this.result("budget", used);
                    }
                    if (nativeResult.reason === 2) {
                        var nativeReturnValue = this.runtime.readHeapValue(
                            nativeResult.resultCell);
                        var nativeReturnedFrame = this.frames.pop();
                        if (nativeReturnedFrame.constructReceiver &&
                            (!nativeReturnValue || !nativeReturnValue.guestType)) {
                            nativeReturnValue = nativeReturnedFrame.constructReceiver;
                        }
                        this.releaseFrame(nativeReturnedFrame);
                        if (!this.frames.length) {
                            return this.finish("completed", nativeReturnValue, used);
                        }
                        var nativeCaller = this.frames[this.frames.length - 1];
                        nativeCaller.registers[nativeReturnedFrame.returnRegister] =
                            nativeReturnValue;
                        this.runtime.spillFrameRegister(nativeCaller,
                            nativeReturnedFrame.returnRegister);
                        nativeCaller.nativeHeapCurrent = true;
                        continue;
                    }
                    if (nativeResult.reason !== 3) {
                        throw new Error("unknown native interpreter exit " +
                                        nativeResult.reason);
                    }
                    if (budget === 0) {
                        this.status = "budget";
                        return this.result("budget", used);
                    }
                    this.reloadNativeOperands(
                        nativeFrame, nativeResult.pc, nativeResult.opcode);
                }
                var frame = this.frames[this.frames.length - 1];
                var code = frame.code;
                var constants = frame.constants;
                var registers = frame.registers;
                var pc = frame.pc;
                var opcode = code[pc];
                if (this.runtime.profileOpcodeCounts) {
                    this.runtime.countOpcode(opcode, frame.program.name);
                }
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
                    registers[code[pc + 1]] = this.runtime.getGlobal(
                        frame.context, constants[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.SET_GLOBAL) {
                    this.runtime.setGlobal(frame.context,
                        constants[code[pc + 1]], registers[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.GET_LOCAL) {
                    registers[code[pc + 1]] = this.runtime.getEnvironmentSlot(
                        frame.environment, code[pc + 2], code[pc + 3]);
                    frame.pc = pc + 4;
                } else if (opcode === op.SET_LOCAL) {
                    this.runtime.setEnvironmentSlot(frame.environment,
                        code[pc + 1], code[pc + 2], registers[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if (opcode === op.MOVE) {
                    /* Compiler temporaries and contiguous call arguments often
                     * form long MOVE runs. Dispatch the run here while keeping
                     * every bytecode visible to budgets and profiling. */
                    while (true) {
                        registers[code[pc + 1]] = registers[code[pc + 2]];
                        pc += 3;
                        if (budget === 0 || code[pc] !== op.MOVE) break;
                        budget--;
                        used++;
                        this.totalInstructions++;
                        if (this.runtime.profileOpcodeCounts) {
                            this.runtime.countOpcode(op.MOVE, frame.program.name);
                        }
                    }
                    frame.pc = pc;
                } else if (opcode === op.GET_PROPERTY) {
                    registers[code[pc + 1]] = this.runtime.getProperty(
                        registers[code[pc + 2]], registers[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if (opcode === op.SET_PROPERTY) {
                    this.runtime.setProperty(registers[code[pc + 1]],
                                             registers[code[pc + 2]],
                                             registers[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if (opcode === op.GET_PROPERTY_CONST) {
                    registers[code[pc + 1]] = this.runtime.getProperty(
                        registers[code[pc + 2]], constants[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if (opcode === op.SET_PROPERTY_CONST) {
                    this.runtime.setProperty(registers[code[pc + 1]],
                                             constants[code[pc + 2]],
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
                } else if (opcode === op.BIT_NOT) {
                    registers[code[pc + 1]] = ~registers[code[pc + 2]];
                    frame.pc = pc + 3;
                } else if (opcode === op.TYPEOF) {
                    registers[code[pc + 1]] = this.runtime.typeOf(registers[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.DELETE_PROPERTY) {
                    registers[code[pc + 1]] = this.runtime.deleteProperty(
                        registers[code[pc + 2]], registers[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if (opcode === op.DELETE_PROPERTY_CONST) {
                    registers[code[pc + 1]] = this.runtime.deleteProperty(
                        registers[code[pc + 2]], constants[code[pc + 3]]);
                    frame.pc = pc + 4;
                } else if (opcode === op.GET_KEYS) {
                    registers[code[pc + 1]] = this.runtime.keys(registers[code[pc + 2]]);
                    frame.pc = pc + 3;
                } else if (opcode === op.JUMP) {
                    if (code[pc + 1] <= pc) this.runtime.gcSafePoint();
                    frame.pc = code[pc + 1];
                } else if (opcode === op.JUMP_IF_FALSE) {
                    frame.pc = !this.runtime.truthy(registers[code[pc + 1]]) ?
                               code[pc + 2] : pc + 3;
                } else if (opcode === op.CALL) {
                    args = [];
                    var argumentRegisters = constants[code[pc + 4]];
                    index = 0;
                    while (index < argumentRegisters.length) {
                        args[index] = registers[argumentRegisters[index]];
                        index++;
                    }
                    var callableValue = registers[code[pc + 2]];
                    if (this.runtime.nativeInterpreter &&
                        this.runtime.profileOpcodeCounts) {
                        this.runtime.nativeInterpreter.noteFallbackCall(
                            callableValue);
                    }
                    var receiver = code[pc + 3] < 0 ? undefined :
                                   registers[code[pc + 3]];
                    if (callableValue &&
                        callableValue.intrinsicKind === "functionApply") {
                        callableValue = receiver;
                        receiver = args.length ? args[0] : undefined;
                        if (args.length > 1 && args[1] !== null &&
                            args[1] !== undefined) {
                            if (!args[1].guestType ||
                                args[1].guestType !== "array") {
                                throw new TypeError("apply arguments must be array-like");
                            }
                            args = this.runtime.arrayToHost(args[1]);
                        } else args = [];
                    }
                    var destination = code[pc + 1];
                    frame.pc = pc + 5;
                    if (callableValue && callableValue.guestType === "bytecodeFunction") {
                        var threaded = budget === Infinity &&
                            this.runtime.threadedCompiler &&
                            this.runtime.threadedCompiler.compile(callableValue.program);
                        if (threaded) {
                            if (this.runtime.profileOpcodeCounts) {
                                var compiledStarted = new Date().getTime();
                                try {
                                    registers[destination] = threaded(this.runtime,
                                        callableValue.homeContext || frame.context,
                                        receiver, args, this.runtime.functionClosure(callableValue),
                                        callableValue);
                                } finally {
                                    this.runtime.threadedCompiler.recordProfile(
                                        callableValue.name || "<anonymous>",
                                        new Date().getTime() - compiledStarted);
                                }
                            } else {
                                registers[destination] = threaded(this.runtime,
                                    callableValue.homeContext || frame.context, receiver,
                                    args, this.runtime.functionClosure(callableValue), callableValue);
                            }
                        } else {
                            this.frames.push(makeFrame(callableValue.program, this.runtime,
                                callableValue.homeContext || frame.context, receiver, args,
                                this.runtime.functionClosure(callableValue), callableValue,
                                destination, frame));
                        }
                        this.runtime.gcSafePoint();
                    } else if (callableValue && callableValue.guestType === "function" &&
                               callableValue.callMode === "host") {
                        this.pendingHostCall = {callable: callableValue,
                                                receiver: receiver, args: args,
                                                frame: frame, destination: destination,
                                                locationPc: pc};
                        this.status = "hostCall";
                        if (this.runtime.nativeInterpreter) {
                            this.synchronizeFallbackStep(frame, pc, opcode);
                        }
                        return this.result("hostCall", used);
                    } else {
                        registers[destination] = this.runtime.call(
                            callableValue, receiver, args);
                        this.runtime.gcSafePoint();
                    }
                } else if (opcode === op.CONSTRUCT) {
                    args = [];
                    var constructorArgumentRegisters = constants[code[pc + 3]];
                    index = 0;
                    while (index < constructorArgumentRegisters.length) {
                        args[index] = registers[constructorArgumentRegisters[index]];
                        index++;
                    }
                    var constructorValue = registers[code[pc + 2]];
                    var constructDestination = code[pc + 1];
                    frame.pc = pc + 4;
                    if (constructorValue && constructorValue.guestType === "function" &&
                        constructorValue.callMode === "host") {
                        this.pendingHostCall = {callable: constructorValue,
                                                receiver: undefined, args: args,
                                                frame: frame,
                                                destination: constructDestination,
                                                construct: true,
                                                locationPc: pc};
                        this.status = "hostCall";
                        if (this.runtime.nativeInterpreter) {
                            this.synchronizeFallbackStep(frame, pc, opcode);
                        }
                        return this.result("hostCall", used);
                    }
                    if (constructorValue &&
                        constructorValue.guestType === "bytecodeFunction") {
                        var constructedReceiver = this.runtime.makeObject();
                        var constructorPrototype = this.runtime.getProperty(
                            constructorValue, "prototype");
                        if (constructorPrototype && constructorPrototype.guestType) {
                            this.runtime.setPrototype(constructedReceiver,
                                                      constructorPrototype);
                        }
                        var constructorFrame = makeFrame(constructorValue.program,
                            this.runtime, constructorValue.homeContext || frame.context,
                            constructedReceiver, args, this.runtime.functionClosure(constructorValue),
                            constructorValue, constructDestination, frame);
                        constructorFrame.constructReceiver = constructedReceiver;
                        this.frames.push(constructorFrame);
                        this.runtime.gcSafePoint();
                    } else {
                        registers[constructDestination] = this.runtime.construct(
                            constructorValue, args);
                        this.runtime.gcSafePoint();
                    }
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
                    this.runtime.heapRecords.pushFrameHandler(
                        frame.heapAddress, code[pc + 1], code[pc + 2]);
                    frame.pc = pc + 3;
                } else if (opcode === op.POP_CATCH) {
                    var poppedHandler = this.runtime.heapRecords.popFrameHandler(
                        frame.heapAddress);
                    if (!poppedHandler) {
                        throw new Error("catch-handler stack underflow");
                    }
                    this.runtime.linearHeap.freeRecord(poppedHandler);
                    frame.pc = pc + 1;
                } else if (opcode === op.RETURN) {
                    var returnValue = registers[code[pc + 1]];
                    var returnedFrame = this.frames.pop();
                    if (returnedFrame.constructReceiver &&
                        (!returnValue || !returnValue.guestType)) {
                        returnValue = returnedFrame.constructReceiver;
                    }
                    this.releaseFrame(returnedFrame);
                    if (!this.frames.length) return this.finish("completed", returnValue, used);
                    var caller = this.frames[this.frames.length - 1];
                    caller.registers[returnedFrame.returnRegister] = returnValue;
                } else {
                    throw new Error("invalid guest opcode " + opcode + " at " + pc);
                }
                if (this.runtime.nativeInterpreter) {
                    this.synchronizeFallbackStep(frame, pc, opcode);
                }
            }
            return this.finish("completed", undefined, used);
        } catch (error) {
            error = this.runtime.locateError(error, frame && frame.program, pc);
            if (this.handleException(error)) {
                if (this.runtime.nativeInterpreter && this.frames.length) {
                    this.frames[this.frames.length - 1].nativeHeapCurrent = false;
                }
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
        if (this.runtime.nativeInterpreter) {
            this.runtime.spillFrameRegister(this.pendingHostCall.frame,
                                            this.pendingHostCall.destination);
            this.pendingHostCall.frame.nativeHeapCurrent = true;
        }
        this.pendingHostCall = null;
        this.status = "ready";
        this.runtime.gcSafePoint();
    };

    Execution.prototype.failHostCall = function (error) {
        if (!this.pendingHostCall) throw new Error("execution has no pending host call");
        var call = this.pendingHostCall;
        error = this.runtime.locateError(error, call.frame.program, call.locationPc);
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
