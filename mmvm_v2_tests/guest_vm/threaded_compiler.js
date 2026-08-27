/* Portable bytecode-to-JavaScript basic-block compiler. This is the reference
 * backend for the future kernel compiler; it never evaluates guest source. */
(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");

    function ThreadedCompiler(runtime) {
        this.runtime = runtime;
        this.programs = [];
        this.compiled = [];
        this.fallback = null;
        this.profileSerial = 0;
        this.profileTimes = {};
        this.profileSamples = {};
        this.profileNextReport = 0;
        this.nativeMemmove = null;
        this.constructionReceivers = [];
        this.pixelObject = null;
        this.pixelVersion = -1;
        this.pixelFormat = null;
        this.pixelAddress = 0;
        this.pixelWidth = 0;
        this.pixelHeight = 0;
    }

    ThreadedCompiler.prototype.setFallback = function (callback) {
        this.fallback = callback;
    };

    ThreadedCompiler.prototype.setNativeMemmove = function (callback) {
        this.nativeMemmove = callback;
    };

    ThreadedCompiler.prototype.find = function (program) {
        var index = 0;
        while (index < this.programs.length) {
            if (this.programs[index] === program) return index;
            index++;
        }
        return -1;
    };

    ThreadedCompiler.prototype.compile = function (program) {
        if (!program) return null;
        var numeric = program.bindingRegisters &&
                      this.runtime.numericBytecodeBackend &&
                      this.runtime.numericBytecodeBackend.compile(program);
        if (numeric) {
            var numericFunction = this.makeNumericFunction(program, numeric);
            this.programs.push(program);
            this.compiled.push(numericFunction);
            program.threadedCompiler = this;
            program.threadedFunction = numericFunction;
            this.runtime.nativeCompilations.push(numeric);
            this.reportCompileDecision(program, "numeric " + numeric.backend);
            return numericFunction;
        }
        if (program.threadedCompiler === this && program.threadedFunction) {
            return program.threadedFunction;
        }
        if (!program.astBody ||
            !this.supports(program)) return null;
        /* Old SpiderMonkey does not reliably preserve constructor receivers
         * through a generated Function calling back into this compiler.  Keep
         * construction-bearing functions in the semantic interpreter.  The
         * functions they call remain independently compilable. */
        if (program.astBody && containsGuestConstruction(program.astBody)) {
            this.reportCompileDecision(program, "interpreter: guest construction");
            return null;
        }
        var existing = this.find(program);
        if (existing >= 0) return this.compiled[existing];
        var source = program.astBody ? this.generateStructured(program) :
                                      this.generate(program);
        var factory = Function("hc", "p", "ic", source);
        var compiled = factory(this, program,
            {objects: [], versions: [], cells: [], arrayObjects: [],
             arrayVersions: [], arrayVectors: [], arrayLengths: []});
        this.programs.push(program);
        this.compiled.push(compiled);
        program.threadedCompiler = this;
        program.threadedFunction = compiled;
        this.reportCompileDecision(program, "structured");
        return compiled;
    };

    ThreadedCompiler.prototype.reportCompileDecision = function (program, decision) {
        if (this.runtime.profileOpcodeCounts) {
            var compileLine = "guest VM compile: " +
                (program.name || "<anonymous>") + " -> " + decision;
            if (typeof print === "function") print(compileLine);
            else if (typeof console !== "undefined" && console.log) {
                console.log(compileLine);
            }
        }
    };

    ThreadedCompiler.prototype.makeNumericFunction = function (program, compiled) {
        var compiler = this;
        var frames = [];
        var depth = 0;
        return function (runtime, context, receiver, args, closure, callable, argc,
                         a0, a1, a2, a3, a4, a5, a6, a7) {
            var guardIndex = 0;
            while (guardIndex < program.parameterSlots.length) {
                var guardValue = args ?
                    (guardIndex < args.length ? args[guardIndex] : undefined) :
                    (guardIndex < argc ? fixedArgument(guardIndex,
                        a0, a1, a2, a3, a4, a5, a6, a7) : undefined);
                if (typeof guardValue !== "number") {
                    return compiler.fallbackCompiled(callable, receiver, args, argc,
                        a0, a1, a2, a3, a4, a5, a6, a7);
                }
                guardIndex++;
            }
            var frame = frames[depth];
            if (!frame) {
                frame = runtime.heapRecords.allocateFrame(
                    runtime.programAddress(program), 0, 0, -1,
                    program.registerCount || 0);
                frames[depth] = frame;
            }
            depth++;
            try {
                var parameterIndex = 0;
                while (parameterIndex < program.parameterSlots.length) {
                    var argument = args ?
                        (parameterIndex < args.length ? args[parameterIndex] : undefined) :
                        (parameterIndex < argc ? fixedArgument(parameterIndex,
                            a0, a1, a2, a3, a4, a5, a6, a7) : undefined);
                    runtime.writeHeapValue(runtime.heapRecords.frameRegisterCell(
                        frame, program.bindingRegisters[
                            program.parameterSlots[parameterIndex]]), argument);
                    parameterIndex++;
                }
                runtime.writeHeapValue(runtime.heapRecords.frameRegisterCell(frame,
                    program.bindingRegisters[program.thisSlot]), receiver);
                if (program.functionNameSlot >= 0) {
                    runtime.writeHeapValue(runtime.heapRecords.frameRegisterCell(frame,
                        program.bindingRegisters[program.functionNameSlot]), callable);
                }
                compiled.fn(runtime.linearHeap.memory.nativeAddress(0), frame);
                return runtime.readHeapValue(runtime.heapRecords.frameRegisterCell(
                    frame, compiled.returnRegister));
            } finally {
                depth--;
            }
        };
    };

    function fixedArgument(index, a0, a1, a2, a3, a4, a5, a6, a7) {
        if (index === 0) return a0;
        if (index === 1) return a1;
        if (index === 2) return a2;
        if (index === 3) return a3;
        if (index === 4) return a4;
        if (index === 5) return a5;
        if (index === 6) return a6;
        return a7;
    }

    ThreadedCompiler.prototype.supports = function (program) {
        var code = program.code;
        var pc = 0;
        while (pc < code.length) {
            var opcode = code[pc];
            if (opcode === op.PUSH_CATCH || opcode === op.POP_CATCH) return false;
            if (opcode === op.MAKE_FUNCTION && !program.astBody) return false;
            pc += width(opcode);
        }
        return true;
    };

    ThreadedCompiler.prototype.call = function (callable, receiver, args, context) {
        this.runtime.assertOwned(callable);
        if (!callable) throw new TypeError("value is not callable");
        if (callable.guestType === "bytecodeFunction") {
            var compiled = this.compile(callable.program);
            if (compiled) {
                return compiled(this.runtime, callable.homeContext || context,
                                receiver, args, this.runtime.functionClosure(callable), callable);
            }
            if (!this.fallback) throw new Error("compiled call needs interpreter fallback");
            return this.fallback(callable, receiver, args, context);
        }
        if (callable.guestType !== "function") throw new TypeError("value is not callable");
        return callable.callback(receiver, args);
    };

    ThreadedCompiler.prototype.callFixed = function (callable, receiver, context,
            count, a0, a1, a2, a3, a4, a5, a6, a7) {
        if (!this.runtime.profileOpcodeCounts && callable &&
            callable.threadedCompiler === this &&
            callable.threadedFunction) {
            return callable.threadedFunction(this.runtime,
                callable.homeContext || context, receiver, null,
                this.runtime.functionClosure(callable),
                callable, count, a0, a1, a2, a3, a4, a5, a6, a7);
        }
        this.runtime.assertOwned(callable);
        if (!callable) throw new TypeError("value is not callable");
        if (callable.guestType === "bytecodeFunction") {
            var compiled = this.compile(callable.program);
            if (compiled) {
                callable.threadedCompiler = this;
                callable.threadedFunction = compiled;
                if (this.runtime.profileOpcodeCounts) {
                    var started = new Date().getTime();
                    try {
                        return compiled(this.runtime, callable.homeContext || context,
                                        receiver, null, this.runtime.functionClosure(callable), callable,
                                        count, a0, a1, a2, a3, a4, a5, a6, a7);
                    } finally {
                        this.recordProfile(callable.name || "<anonymous>",
                                           new Date().getTime() - started);
                    }
                }
                return compiled(this.runtime, callable.homeContext || context,
                                receiver, null, this.runtime.functionClosure(callable), callable,
                                count, a0, a1, a2, a3, a4, a5, a6, a7);
            }
        }
        var args = [];
        if (count > 0) args[0] = a0;
        if (count > 1) args[1] = a1;
        if (count > 2) args[2] = a2;
        if (count > 3) args[3] = a3;
        if (count > 4) args[4] = a4;
        if (count > 5) args[5] = a5;
        if (count > 6) args[6] = a6;
        if (count > 7) args[7] = a7;
        return this.call(callable, receiver, args, context);
    };

    ThreadedCompiler.prototype.recordProfile = function (name, elapsed) {
        if (elapsed >= 100) {
            var slowLine = "guest VM slow compiled call: " + name + "=" + elapsed + "ms";
            if (typeof print === "function") print(slowLine);
            else if (typeof console !== "undefined" && console.log) console.log(slowLine);
        }
        var key = "$" + name;
        this.profileTimes[key] = (this.profileTimes[key] || 0) + elapsed;
        this.profileSamples[key] = (this.profileSamples[key] || 0) + 1;
        var now = new Date().getTime();
        if (!this.profileNextReport) this.profileNextReport = now + 5000;
        if (now < this.profileNextReport) return;
        var entries = [];
        for (key in this.profileTimes) {
            if (Object.prototype.hasOwnProperty.call(this.profileTimes, key)) {
                entries.push({name: key.substring(1), time: this.profileTimes[key],
                              samples: this.profileSamples[key]});
            }
        }
        entries.sort(function (left, right) { return right.time - left.time; });
        var parts = [];
        var index = 0;
        while (index < entries.length && index < 12) {
            parts.push(entries[index].name + "=" + entries[index].time + "ms/" +
                       entries[index].samples);
            index++;
        }
        var line = "guest VM compiled profile: " + parts.join(" ");
        if (typeof print === "function") print(line);
        else if (typeof console !== "undefined" && console.log) console.log(line);
        this.profileTimes = {};
        this.profileSamples = {};
        this.profileNextReport = now + 5000;
    };

    ThreadedCompiler.prototype.callMemberFixed = function (object, key, context,
            count, a0, a1, a2, a3, a4, a5, a6, a7) {
        return this.callFixed(this.runtime.getProperty(object, key), object, context,
                              count, a0, a1, a2, a3, a4, a5, a6, a7);
    };

    ThreadedCompiler.prototype.setPixelFast = function (
            framebuffer, x, y, red, green, blue, context) {
        if (framebuffer && framebuffer.guestType === "object" &&
            typeof poke32 === "function") {
            if (this.pixelObject !== framebuffer ||
                this.pixelVersion !== framebuffer.valueVersion) {
                this.pixelObject = framebuffer;
                this.pixelVersion = framebuffer.valueVersion;
                this.pixelFormat = this.runtime.getProperty(
                    framebuffer, "pixelFormat");
                this.pixelAddress = this.runtime.getProperty(
                    framebuffer, "pixelAddress");
                this.pixelWidth = this.runtime.getProperty(framebuffer, "width");
                this.pixelHeight = this.runtime.getProperty(framebuffer, "height");
            }
            if (this.pixelFormat !== "bgrx32le" || !this.pixelAddress) {
                return this.callMemberFixed(framebuffer, "setPixel", context, 5,
                                            x, y, red, green, blue);
            }
            x = Number(x);
            y = Number(y);
            if (x < 0 || y < 0 || x >= this.pixelWidth ||
                y >= this.pixelHeight) return undefined;
            poke32(this.pixelAddress + (y * this.pixelWidth + x) * 4,
                   ((Number(red) & 255) << 16) |
                   ((Number(green) & 255) << 8) | (Number(blue) & 255));
            return undefined;
        }
        return this.callMemberFixed(framebuffer, "setPixel", context, 5,
                                    x, y, red, green, blue);
    };

    ThreadedCompiler.prototype.fallbackCompiled = function (callable, receiver, args,
            argumentCount, a0, a1, a2, a3, a4, a5, a6, a7) {
        if (!this.fallback) throw new Error("compiled specialization needs interpreter fallback");
        if (!args) {
            args = [];
            if (argumentCount > 0) args[0] = a0;
            if (argumentCount > 1) args[1] = a1;
            if (argumentCount > 2) args[2] = a2;
            if (argumentCount > 3) args[3] = a3;
            if (argumentCount > 4) args[4] = a4;
            if (argumentCount > 5) args[5] = a5;
            if (argumentCount > 6) args[6] = a6;
            if (argumentCount > 7) args[7] = a7;
        }
        return this.fallback(callable, receiver, args,
                             callable.homeContext || null);
    };

    ThreadedCompiler.prototype.construct = function (callable, args, context) {
        this.runtime.assertOwned(callable);
        if (!callable) throw new TypeError("value is not a constructor");
        if (callable.guestType === "bytecodeFunction") {
            /* Keep this binding distinct from the generated function's
             * `receiver` formal.  The Firefox 1 shell used by js_min.exe can
             * otherwise reuse the caller's activation slot across this
             * recursive host-JavaScript call. */
            var constructedReceiver = this.runtime.makeObject();
            var prototype = this.runtime.getProperty(callable, "prototype");
            if (prototype && prototype.guestType) {
                this.runtime.setPrototype(constructedReceiver, prototype);
            }
            /* Construction is uncommon and requires preserving an implicit
             * receiver across a nested call.  Run the constructor body through
             * the semantic fallback; leaf functions it calls can still use the
             * compiled tier.  This also avoids an activation-aliasing defect in
             * the Firefox 1 host used by js_min.exe. */
            if (!this.fallback) {
                throw new Error("compiled construction needs interpreter fallback");
            }
            var constructionIndex = this.constructionReceivers.length;
            this.constructionReceivers[constructionIndex] = constructedReceiver;
            var result;
            try {
                result = this.fallback(callable,
                    this.constructionReceivers[constructionIndex], args,
                    callable.homeContext || context);
                return result && result.guestType ? result :
                       this.constructionReceivers[constructionIndex];
            } finally {
                this.constructionReceivers.length = constructionIndex;
            }
        }
        return this.runtime.construct(callable, args);
    };

    ThreadedCompiler.prototype.get = function (object, key) {
        return this.runtime.getProperty(object, key);
    };

    ThreadedCompiler.prototype.getConstantCached = function (
            cache, site, object, key) {
        if (object && object.heapAddress && object.guestType !== "array" &&
            object.guestType !== "buffer") {
            if (cache.objects[site] === object &&
                cache.versions[site] === object.propertyVersion) {
                return this.runtime.readHeapValue(cache.cells[site]);
            }
            var property = this.runtime.heapOwnProperty(object, key, false);
            if (property) {
                cache.objects[site] = object;
                cache.versions[site] = object.propertyVersion;
                cache.cells[site] = this.runtime.heapRecords.propertyValueCell(property);
                return this.runtime.readHeapValue(cache.cells[site]);
            }
        }
        if (object && object.guestType === "array" && key === "length") {
            return this.runtime.arrayLength(object);
        }
        return this.runtime.getProperty(object, key);
    };

    ThreadedCompiler.prototype.getComputedCached = function (
            cache, site, object, key) {
        if (object && object.guestType === "array" && typeof key === "number" &&
            key >= 0 && key === Math.floor(key)) {
            if (cache.arrayObjects[site] !== object ||
                cache.arrayVersions[site] !== object.arrayStructureVersion) {
                var vector = this.runtime.heapRecords.arrayElements(object.heapAddress);
                cache.arrayObjects[site] = object;
                cache.arrayVersions[site] = object.arrayStructureVersion;
                cache.arrayVectors[site] = vector;
                cache.arrayLengths[site] =
                    this.runtime.heapRecords.vectorLength(vector);
            }
            if (key >= cache.arrayLengths[site]) return undefined;
            var cell = this.runtime.heapRecords.vectorCellWithinLength(
                cache.arrayVectors[site], key);
            if (this.runtime.valueCells.tagAt(cell) === 0) return undefined;
            return this.runtime.readHeapValue(cell);
        }
        return this.runtime.getProperty(object, key);
    };

    ThreadedCompiler.prototype.assignMemberCached = function (
            cache, site, object, key, value, operator) {
        if (operator && operator !== "=") {
            value = applyAssignment(operator,
                this.getConstantCached(cache, site, object, key), value,
                this.runtime);
        }
        if (object && object.heapAddress && object.guestType !== "array" &&
            object.guestType !== "buffer") {
            if (cache.objects[site] === object &&
                cache.versions[site] === object.propertyVersion) {
                this.runtime.writeHeapValue(cache.cells[site], value);
                object.valueVersion++;
                return value;
            }
            var property = this.runtime.heapOwnProperty(object, key, true);
            cache.objects[site] = object;
            cache.versions[site] = object.propertyVersion;
            cache.cells[site] = this.runtime.heapRecords.propertyValueCell(property);
            this.runtime.writeHeapValue(cache.cells[site], value);
            object.valueVersion++;
            return value;
        }
        this.runtime.setProperty(object, key, value);
        return value;
    };

    ThreadedCompiler.prototype.assignComputed = function (
            object, key, value, operator) {
        if (operator && operator !== "=") {
            value = applyAssignment(operator, this.getComputed(object, key),
                                    value, this.runtime);
        }
        this.runtime.setProperty(object, key, value);
        return value;
    };

    ThreadedCompiler.prototype.assignComputedCached = function (
            cache, site, object, key, value, operator) {
        if (operator && operator !== "=") {
            value = applyAssignment(operator,
                this.getComputedCached(cache, site, object, key), value,
                this.runtime);
        }
        if (object && object.guestType === "array" && typeof key === "number" &&
            key >= 0 && key === Math.floor(key)) {
            if (cache.arrayObjects[site] !== object ||
                cache.arrayVersions[site] !== object.arrayStructureVersion ||
                key >= cache.arrayLengths[site]) {
                this.runtime.arraySet(object, key, value);
                return value;
            }
            this.runtime.writeHeapValue(
                this.runtime.heapRecords.vectorCellWithinLength(
                    cache.arrayVectors[site], key), value);
            return value;
        }
        this.runtime.setProperty(object, key, value);
        return value;
    };

    ThreadedCompiler.prototype.set = function (object, key, value) {
        return this.runtime.setProperty(object, key, value);
    };

    ThreadedCompiler.prototype.callMember = function (object, key, args, context) {
        return this.call(this.runtime.getProperty(object, key), object, args, context);
    };

    ThreadedCompiler.prototype.callApply = function (callable, receiver, argumentArray,
                                                       context) {
        var args = [];
        if (argumentArray !== null && argumentArray !== undefined) {
            if (!argumentArray.guestType || argumentArray.guestType !== "array") {
                throw new TypeError("apply arguments must be array-like");
            }
            args = this.runtime.arrayToHost(argumentArray);
        }
        return this.call(callable, receiver, args, context);
    };

    ThreadedCompiler.prototype.assignMember = function (object, key, value, operator) {
        if (operator && operator !== "=") {
            var current = this.runtime.getProperty(object, key);
            value = applyAssignment(operator, current, value, this.runtime);
        }
        this.runtime.setProperty(object, key, value);
        return value;
    };

    ThreadedCompiler.prototype.updateMember = function (object, key, amount, prefix) {
        var old = Number(this.runtime.getProperty(object, key));
        var value = old + amount;
        this.runtime.setProperty(object, key, value);
        return prefix ? value : old;
    };

    ThreadedCompiler.prototype.updateHeapCell = function (cell, amount, prefix) {
        var old = Number(this.runtime.readHeapValue(cell));
        var value = old + amount;
        this.runtime.writeHeapValue(cell, value);
        return prefix ? value : old;
    };

    ThreadedCompiler.prototype.makeObjectLiteral = function (keys, values) {
        var object = this.runtime.makeObject();
        var index = 0;
        while (index < keys.length) {
            this.runtime.setProperty(object, keys[index], values[index]);
            index++;
        }
        return object;
    };

    ThreadedCompiler.prototype.makeObjectLiteralFixed = function (count,
            k0, v0, k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6, k7, v7) {
        var object = this.runtime.makeObject();
        if (count > 0) this.runtime.setProperty(object, k0, v0);
        if (count > 1) this.runtime.setProperty(object, k1, v1);
        if (count > 2) this.runtime.setProperty(object, k2, v2);
        if (count > 3) this.runtime.setProperty(object, k3, v3);
        if (count > 4) this.runtime.setProperty(object, k4, v4);
        if (count > 5) this.runtime.setProperty(object, k5, v5);
        if (count > 6) this.runtime.setProperty(object, k6, v6);
        if (count > 7) this.runtime.setProperty(object, k7, v7);
        return object;
    };

    ThreadedCompiler.prototype.makeObjectLiteral3 = function (
            k0, v0, k1, v1, k2, v2) {
        var object = this.runtime.makeObject();
        this.runtime.setProperty(object, k0, v0);
        this.runtime.setProperty(object, k1, v1);
        this.runtime.setProperty(object, k2, v2);
        return object;
    };

    ThreadedCompiler.prototype.makeObjectLiteral5 = function (
            k0, v0, k1, v1, k2, v2, k3, v3, k4, v4) {
        var object = this.runtime.makeObject();
        this.runtime.setProperty(object, k0, v0);
        this.runtime.setProperty(object, k1, v1);
        this.runtime.setProperty(object, k2, v2);
        this.runtime.setProperty(object, k3, v3);
        this.runtime.setProperty(object, k4, v4);
        return object;
    };

    ThreadedCompiler.prototype.makeArrayLiteral = function (values) {
        return this.runtime.arrayFrom(values);
    };

    ThreadedCompiler.prototype.makeArrayLiteralFixed = function (count,
            v0, v1, v2, v3, v4, v5, v6, v7) {
        var array = this.runtime.makeArray();
        if (count > 0) this.runtime.arraySet(array, 0, v0);
        if (count > 1) this.runtime.arraySet(array, 1, v1);
        if (count > 2) this.runtime.arraySet(array, 2, v2);
        if (count > 3) this.runtime.arraySet(array, 3, v3);
        if (count > 4) this.runtime.arraySet(array, 4, v4);
        if (count > 5) this.runtime.arraySet(array, 5, v5);
        if (count > 6) this.runtime.arraySet(array, 6, v6);
        if (count > 7) this.runtime.arraySet(array, 7, v7);
        return array;
    };

    ThreadedCompiler.prototype.makeArrayLiteral0 = function () {
        return this.runtime.makeArray();
    };

    ThreadedCompiler.prototype.updateGlobal = function (
            context, closure, name, amount, prefix) {
        var old = Number(this.runtime.getBinding(context, closure, name));
        var value = old + amount;
        this.runtime.setBinding(context, closure, name, value);
        return prefix ? value : old;
    };

    ThreadedCompiler.prototype.hostProperties = function (object) {
        var keys = this.runtime.keys(object);
        var result = {};
        var index = 0;
        while (index < this.runtime.arrayLength(keys)) {
            result[this.runtime.arrayGet(keys, index++)] = true;
        }
        return result;
    };

    ThreadedCompiler.prototype.arrayElementsHaveProperties = function (array) {
        if (!array || array.guestType !== "array") return false;
        var index = 0;
        while (index < this.runtime.arrayLength(array)) {
            var value = this.runtime.arrayGet(array, index++);
            if (!value || !value.heapAddress) return false;
        }
        return true;
    };

    ThreadedCompiler.prototype.arrayElementPropertiesAreArrays = function (array, key) {
        if (!this.arrayElementsHaveProperties(array)) return false;
        var index = 0;
        while (index < this.runtime.arrayLength(array)) {
            var value = this.runtime.getProperty(
                this.runtime.arrayGet(array, index++), key);
            if (!value || value.guestType !== "array") return false;
        }
        return true;
    };

    ThreadedCompiler.prototype.generateStructured = function (program) {
        var emitter = new StructuredEmitter(program, null, true);
        emitter.threadedCompiler = this;
        return emitter.generate();
    };

    ThreadedCompiler.prototype.generate = function (program) {
        var code = program.code;
        var starts = blockStarts(program);
        var lines = [];
        lines.push("return function(runtime,context,receiver,args,closure,callable){");
        var declarations = [];
        var registerIndex = 0;
        while (registerIndex < program.registerCount) {
            declarations.push("r" + registerIndex++);
        }
        lines.push("var " + declarations.join(",") + ";");
        lines.push("args=args||[];");
        emitRegisterInitialization(lines, program);
        lines.push("var env=closure||null;");
        lines.push("var pc=0;");
        lines.push("runtime.compiledDepth++;");
        lines.push("try{");
        lines.push("while(true){switch(pc){");
        var pc = 0;
        var open = false;
        var terminated = false;
        while (pc < code.length) {
            if (starts[pc]) {
                if (open && !terminated) {
                    lines.push("pc=" + pc + ";continue;");
                    lines.push("}");
                }
                lines.push("case " + pc + ":{");
                open = true;
                terminated = false;
            }
            var opcode = code[pc];
            var next = pc + width(opcode);
            emitInstruction(lines, program, pc, next, opcode);
            if (opcode === op.JUMP || opcode === op.JUMP_IF_FALSE ||
                opcode === op.RETURN || opcode === op.THROW) {
                lines.push("}");
                open = false;
                terminated = true;
            }
            pc = next;
        }
        if (open) lines.push("return undefined;}");
        lines.push("default:throw new Error('invalid compiled pc '+pc);");
        lines.push("}}");
        lines.push("}catch(e){throw runtime.locateError(e,p,pc);}" +
                   "finally{runtime.compiledDepth--;}");
        lines.push("};");
        return lines.join("\n");
    };

    function emitInstruction(lines, program, pc, next, opcode) {
        var c = program.code;
        function rr(index) { return "r" + c[pc + index]; }
        function constant(index) { return "p.constants[" + c[pc + index] + "]"; }
        if (opcode === op.CONST) lines.push(rr(1) + "=" + constant(2) + ";");
        else if (opcode === op.GET_GLOBAL) {
            lines.push(rr(1) + "=runtime.getGlobal(context," + constant(2) + ");");
        } else if (opcode === op.SET_GLOBAL) {
            lines.push("runtime.setGlobal(context," + constant(1) + "," + rr(2) + ");");
        } else if (opcode === op.GET_LOCAL) {
            lines.push(rr(1) + "=runtime.getEnvironmentSlot(env," + c[pc + 2] + "," +
                       c[pc + 3] + ");");
        } else if (opcode === op.SET_LOCAL) {
            lines.push("runtime.setEnvironmentSlot(env," + c[pc + 1] + "," +
                       c[pc + 2] + "," + rr(3) + ");");
        } else if (opcode === op.MOVE) lines.push(rr(1) + "=" + rr(2) + ";");
        else if (opcode === op.GET_PROPERTY) {
            lines.push(rr(1) + "=runtime.getProperty(" + rr(2) + "," + rr(3) + ");");
        } else if (opcode === op.SET_PROPERTY) {
            lines.push("runtime.setProperty(" + rr(1) + "," + rr(2) + "," + rr(3) + ");");
        } else if (opcode === op.GET_PROPERTY_CONST) {
            lines.push(rr(1) + "=runtime.getProperty(" + rr(2) +
                       "," + constant(3) + ");");
        } else if (opcode === op.SET_PROPERTY_CONST) {
            lines.push("runtime.setProperty(" + rr(1) + "," + constant(2) +
                       "," + rr(3) + ");");
        } else if (opcode === op.ADD) {
            lines.push(rr(1) + "=(typeof " + rr(2) + "==='number'&&typeof " + rr(3) +
                       "==='number')?" + rr(2) + "+" + rr(3) + ":runtime.add(" +
                       rr(2) + "," + rr(3) + ");");
        }
        else if (opcode === op.SUBTRACT) lines.push(rr(1) + "=Number(" + rr(2) + ")-Number(" + rr(3) + ");");
        else if (opcode === op.MULTIPLY) lines.push(rr(1) + "=Number(" + rr(2) + ")*Number(" + rr(3) + ");");
        else if (opcode === op.DIVIDE) lines.push(rr(1) + "=Number(" + rr(2) + ")/Number(" + rr(3) + ");");
        else if (opcode === op.REMAINDER) lines.push(rr(1) + "=Number(" + rr(2) + ")%Number(" + rr(3) + ");");
        else if (opcode === op.STRICT_EQUAL) lines.push(rr(1) + "=" + rr(2) + "===" + rr(3) + ";");
        else if (opcode === op.EQUAL) lines.push(rr(1) + "=runtime.equal(" + rr(2) + "," + rr(3) + ");");
        else if (opcode === op.LESS) lines.push(rr(1) + "=" + rr(2) + "<" + rr(3) + ";");
        else if (opcode === op.LESS_EQUAL) lines.push(rr(1) + "=" + rr(2) + "<=" + rr(3) + ";");
        else if (opcode === op.GREATER) lines.push(rr(1) + "=" + rr(2) + ">" + rr(3) + ";");
        else if (opcode === op.GREATER_EQUAL) lines.push(rr(1) + "=" + rr(2) + ">=" + rr(3) + ";");
        else if (opcode === op.BIT_AND) lines.push(rr(1) + "=" + rr(2) + "&" + rr(3) + ";");
        else if (opcode === op.BIT_OR) lines.push(rr(1) + "=" + rr(2) + "|" + rr(3) + ";");
        else if (opcode === op.BIT_XOR) lines.push(rr(1) + "=" + rr(2) + "^" + rr(3) + ";");
        else if (opcode === op.SHIFT_LEFT) lines.push(rr(1) + "=" + rr(2) + "<<" + rr(3) + ";");
        else if (opcode === op.SHIFT_RIGHT) lines.push(rr(1) + "=" + rr(2) + ">>" + rr(3) + ";");
        else if (opcode === op.SHIFT_UNSIGNED_RIGHT) lines.push(rr(1) + "=" + rr(2) + ">>>" + rr(3) + ";");
        else if (opcode === op.NOT) lines.push(rr(1) + "=!" + rr(2) + ";");
        else if (opcode === op.NEGATE) lines.push(rr(1) + "=-Number(" + rr(2) + ");");
        else if (opcode === op.POSITIVE) lines.push(rr(1) + "=Number(" + rr(2) + ");");
        else if (opcode === op.BIT_NOT) lines.push(rr(1) + "=~" + rr(2) + ";");
        else if (opcode === op.TYPEOF) lines.push(rr(1) + "=runtime.typeOf(" + rr(2) + ");");
        else if (opcode === op.DELETE_PROPERTY) {
            lines.push(rr(1) + "=runtime.deleteProperty(" + rr(2) + "," + rr(3) + ");");
        } else if (opcode === op.DELETE_PROPERTY_CONST) {
            lines.push(rr(1) + "=runtime.deleteProperty(" + rr(2) + "," + constant(3) + ");");
        } else if (opcode === op.GET_KEYS) lines.push(rr(1) + "=runtime.keys(" + rr(2) + ");");
        else if (opcode === op.JUMP) {
            if (c[pc + 1] <= pc) lines.push("if(runtime.gcPending)runtime.gcSafePoint();");
            lines.push("pc=" + c[pc + 1] + ";continue;");
        } else if (opcode === op.JUMP_IF_FALSE) {
            lines.push("pc=!" + rr(1) + "?" + c[pc + 2] + ":" + next + ";continue;");
        } else if (opcode === op.CALL) {
            var callRegisters = program.constants[c[pc + 4]];
            var callHint = program.registerHints && program.registerHints[c[pc + 2]];
            if (callHint === "global:poke32" || callHint === "global:poke8" ||
                callHint === "global:peek32" || callHint === "global:peek8") {
                lines.push(rr(1) + "=" + callHint.substring(7) + "(" +
                           directArguments(callRegisters) + ");");
            } else if (callHint && callHint.indexOf("math:") === 0) {
                lines.push(rr(1) + "=Math." + callHint.substring(5) + "(" +
                           directArguments(callRegisters) + ");");
            } else if (callHint === "property:writeUInt32LE") {
                lines.push("runtime.bufferSupport.write32LE(" + rr(3) + "," +
                           "r" + callRegisters[1] + ",r" + callRegisters[0] + ");");
                lines.push(rr(1) + "=r" + callRegisters[1] + "+4;");
            } else {
                lines.push(rr(1) + "=hc.call(" + rr(2) + "," +
                           (c[pc + 3] < 0 ? "undefined" : rr(3)) + "," +
                           argumentSource(callRegisters) + ",context);");
            }
        } else if (opcode === op.CONSTRUCT) {
            lines.push(rr(1) + "=hc.construct(" + rr(2) + "," +
                       argumentSource(program.constants[c[pc + 3]]) + ",context);");
        } else if (opcode === op.MAKE_OBJECT) lines.push(rr(1) + "=runtime.makeObject();");
        else if (opcode === op.MAKE_ARRAY) lines.push(rr(1) + "=runtime.makeArray();");
        else if (opcode === op.MAKE_REGEXP) {
            lines.push(rr(1) + "=runtime.makeRegExp(" + constant(2) + "," + constant(3) + ");");
        } else if (opcode === op.RETURN) lines.push("return " + rr(1) + ";");
        else if (opcode === op.THROW) lines.push("throw " + rr(1) + ";");
        else throw new Error("unsupported threaded opcode " + opcode);
    }

    function argumentSource(registers) {
        var parts = [];
        var index = 0;
        while (index < registers.length) parts.push("r" + registers[index++]);
        return "[" + parts.join(",") + "]";
    }

    function directArguments(registers) {
        var parts = [];
        var index = 0;
        while (index < registers.length) parts.push("r" + registers[index++]);
        return parts.join(",");
    }

    function emitRegisterInitialization(lines, program) {
        var constantRegisters = program.constantRegisters || [];
        var index = 0;
        while (index < constantRegisters.length) {
            if (constantRegisters[index] !== undefined) {
                lines.push("r" + constantRegisters[index] + "=p.constants[" + index + "];");
            }
            index++;
        }
        var bindings = program.bindingRegisters;
        index = 0;
        while (index < program.parameterSlots.length) {
            lines.push("r" + bindings[program.parameterSlots[index]] +
                       "=" + index + "<args.length?args[" + index + "]:undefined;");
            index++;
        }
        lines.push("r" + bindings[program.argumentsSlot] + "=runtime.arrayFrom(args);");
        lines.push("r" + bindings[program.thisSlot] + "=receiver;");
        if (program.functionNameSlot >= 0) {
            lines.push("r" + bindings[program.functionNameSlot] + "=callable;");
        }
    }

    function StructuredEmitter(program, fastPlan, genericOnly) {
        this.program = program;
        this.bindings = program.bindingSlots || {};
        this.fastPlan = fastPlan || null;
        this.genericOnly = !!genericOnly;
        this.useEnvironment = !program.bindingRegisters;
        this.callIndex = 0;
        this.memberIndex = 0;
        this.pixelIndex = 0;
        this.environmentCells = {};
        this.environmentValues = {};
        this.globalCells = {};
        this.globalValues = {};
        this.environmentCellCount = 0;
        this.globalCellCount = 0;
        this.reloadIndex = 0;
        var bindingName;
        var nonlocalBindings = program.nonlocalBindings || {};
        for (bindingName in nonlocalBindings) {
            if (Object.prototype.hasOwnProperty.call(
                    nonlocalBindings, bindingName) &&
                (!program.bindingSlots ||
                 program.bindingSlots[bindingName] === undefined) &&
                nonlocalBindings[bindingName].kind === "environment") {
                this.environmentCells[bindingName] =
                    "e" + this.environmentCellCount;
                this.environmentValues[bindingName] =
                    "n" + this.environmentCellCount++;
            } else if (Object.prototype.hasOwnProperty.call(
                    nonlocalBindings, bindingName) &&
                (!program.bindingSlots ||
                 program.bindingSlots[bindingName] === undefined) &&
                nonlocalBindings[bindingName].kind === "global") {
                this.globalCells[bindingName] = "g" + this.globalCellCount;
                this.globalValues[bindingName] = "u" + this.globalCellCount++;
            }
        }
    }

    StructuredEmitter.prototype.generate = function () {
        var lines = [];
        lines.push("return function(runtime,context,receiver,args,closure,callable,argc," +
                   "a0,a1,a2,a3,a4,a5,a6,a7){");
        var declarations = [];
        var index = 0;
        while (index < this.program.bindings.length) {
            declarations.push("v" + index++);
        }
        if (declarations.length) {
            lines.push("var " + declarations.join(",") + ";");
        }
        var callCount = countDirectCalls(this.program.astBody);
        if (callCount) {
            var callDeclarations = [];
            index = 0;
            while (index < callCount) callDeclarations.push("c" + index++);
            lines.push("var " + callDeclarations.join(",") + ";");
        }
        var reloadCount = countReloadSites(this.program.astBody);
        if (reloadCount && (this.useEnvironment || this.environmentCellCount ||
                            this.globalCellCount)) {
            var reloadDeclarations = [];
            index = 0;
            while (index < reloadCount) reloadDeclarations.push("q" + index++);
            lines.push("var " + reloadDeclarations.join(",") + ";");
        }
        var memberCount = countMemberReads(this.program.astBody);
        if (memberCount) {
            var memberDeclarations = [];
            index = 0;
            while (index < memberCount) {
                memberDeclarations.push("m" + index, "k" + index);
                index++;
            }
            lines.push("var " + memberDeclarations.join(",") + ";");
        }
        var pixelCount = countSetPixelCalls(this.program.astBody);
        if (pixelCount) {
            var pixelDeclarations = [];
            index = 0;
            while (index < pixelCount) {
                var pixelPart = 0;
                while (pixelPart < 6) {
                    pixelDeclarations.push("s" + index + "_" + pixelPart++);
                }
                index++;
            }
            lines.push("var " + pixelDeclarations.join(",") + ";");
        }
        if (this.useEnvironment) {
            lines.push("var callArgs=args||[a0,a1,a2,a3,a4,a5,a6,a7].slice(0,argc);");
            lines.push("var env=runtime.makeCallEnvironment(p,receiver,callArgs," +
                       "closure,callable);");
            var localCellDeclarations = [];
            var localCellInitializers = [];
            index = 0;
            while (index < this.program.bindings.length) {
                localCellDeclarations.push("l" + index);
                localCellInitializers.push("l" + index +
                    "=runtime.heapRecords.environmentCell(env.heapAddress," +
                    index + ")");
                index++;
            }
            if (localCellDeclarations.length) {
                lines.push("var " + localCellDeclarations.join(",") + ";");
                lines.push(localCellInitializers.join(";") + ";");
            }
        } else lines.push("var env=closure;");
        if (this.environmentCellCount) {
            var environmentDeclarations = [];
            var environmentInitializers = [];
            var environmentName;
            for (environmentName in this.environmentCells) {
                if (Object.prototype.hasOwnProperty.call(
                        this.environmentCells, environmentName)) {
                    var environmentBinding =
                        this.program.nonlocalBindings[environmentName];
                    var environmentCell = this.environmentCells[environmentName];
                    var environmentValue = this.environmentValues[environmentName];
                    environmentDeclarations.push(environmentCell, environmentValue);
                    environmentInitializers.push(environmentCell +
                        "=runtime.environmentCellAddress(closure," +
                        (environmentBinding.depth - (this.useEnvironment ? 1 : 0)) +
                        "," + environmentBinding.slot + ")");
                    environmentInitializers.push(environmentValue +
                        "=runtime.readHeapValue(" + environmentCell + ")");
                }
            }
            lines.push("var " + environmentDeclarations.join(",") + ";");
            lines.push(environmentInitializers.join(";") + ";");
        }
        if (this.globalCellCount) {
            var globalDeclarations = [];
            var globalInitializers = [];
            var globalName;
            for (globalName in this.globalCells) {
                if (Object.prototype.hasOwnProperty.call(this.globalCells, globalName)) {
                    var globalCell = this.globalCells[globalName];
                    var globalValue = this.globalValues[globalName];
                    var plainGlobalName = globalName.substring(1);
                    globalDeclarations.push(globalCell, globalValue);
                    globalInitializers.push(globalCell +
                        "=runtime.globalCellAddress(context," +
                        quote(plainGlobalName) + ")");
                    globalInitializers.push(globalValue + "=" + globalCell +
                        "?runtime.readHeapValue(" + globalCell +
                        "):undefined");
                }
            }
            lines.push("var " + globalDeclarations.join(",") + ";");
            lines.push(globalInitializers.join(";") + ";");
        }
        index = 0;
        while (index < this.program.parameterSlots.length) {
            lines.push(this.slot(this.program.parameterSlots[index]) + "=args?(" + index +
                       "<args.length?args[" + index + "]:undefined):" +
                       (index < 8 ? "a" + index : "undefined") + ";");
            index++;
        }
        if (usesIdentifier(this.program.astBody, "arguments")) {
            lines.push(this.slot(this.program.argumentsSlot) + "=runtime.arrayFrom(args||" +
                       "[a0,a1,a2,a3,a4,a5,a6,a7].slice(0,argc));");
        }
        lines.push(this.slot(this.program.thisSlot) + "=receiver;");
        if (this.program.functionNameSlot >= 0) {
            lines.push(this.slot(this.program.functionNameSlot) + "=callable;");
        }
        this.emitHoistedFunctions(lines, this.program.astBody);
        lines.push("runtime.compiledDepth++;");
        lines.push("try{");
        var plan = this.genericOnly ? null : analyzeFastPath(this.program, this);
        if (plan && plan.guards.length) {
            var fastEmitter = new StructuredEmitter(this.program, plan, true);
            fastEmitter.threadedCompiler = this.threadedCompiler;
            lines.push("if(!(" + plan.guards.join("&&") + "))return " +
                       "hc.fallbackCompiled(callable,receiver,args,argc," +
                       "a0,a1,a2,a3,a4,a5,a6,a7);");
            if (plan.aliasDeclarations.length) {
                lines.push("var " + plan.aliasDeclarations.join(",") + ";");
            }
            lines.push(fastEmitter.statement(this.program.astBody));
        } else {
            lines.push(this.statement(this.program.astBody));
        }
        lines.push("return undefined;");
        lines.push("}catch(e){throw runtime.locateError(e,p);}" +
                   "finally{" + this.spillLocals() + "runtime.compiledDepth--;}");
        lines.push("};");
        return lines.join("\n");
    };

    StructuredEmitter.prototype.local = function (name) {
        var slot = this.bindings["$" + name];
        return slot === undefined ? null : this.slot(slot);
    };

    StructuredEmitter.prototype.slot = function (slot) {
        return "v" + slot;
    };

    StructuredEmitter.prototype.emitHoistedFunctions = function (lines, node) {
        var emitter = this;
        function visit(value) {
            if (!value || typeof value !== "object") return;
            if (value.type === "FunctionDeclaration") {
                lines.push(emitter.referenceStore(value.name,
                    "runtime.makeGuestFunction(p.constants[" +
                    value.guestProgramConstant + "],env,context)") + ";");
                return;
            }
            visitChildren(value, visit, false);
        }
        visit(node);
    };

    StructuredEmitter.prototype.referenceStore = function (name, value) {
        var local = this.local(name);
        if (local) return local + "=" + value;
        var binding = this.program.nonlocalBindings &&
                      this.program.nonlocalBindings["$" + name];
        if (binding && binding.kind === "environment") {
            var storedValue = this.environmentValues["$" + name];
            return "((" + storedValue + "=" + value + ")," +
                   "runtime.writeHeapValue(" + this.environmentCells["$" + name] +
                   "," + storedValue + ")," + storedValue + ")";
        }
        var globalValue = this.globalValues["$" + name];
        if (globalValue) {
            return "((" + globalValue + "=" + value + ")," +
                "runtime.setGlobal(context," + quote(name) + "," + globalValue +
                "),(" + this.globalCells["$" + name] +
                "=runtime.globalCellAddress(context," + quote(name) + "))," +
                globalValue + ")";
        }
        return "runtime.setGlobal(context," + quote(name) + "," + value + ")";
    };

    StructuredEmitter.prototype.identifier = function (name) {
        var local = this.local(name);
        if (local) return local;
        var binding = this.program.nonlocalBindings &&
                      this.program.nonlocalBindings["$" + name];
        if (binding && binding.kind === "environment") {
            return this.environmentValues["$" + name];
        }
        var cachedGlobal = this.globalValues["$" + name];
        return cachedGlobal ? "(" + this.globalCells["$" + name] + "?" +
               cachedGlobal + ":runtime.getGlobal(context," + quote(name) + "))" :
               "runtime.getGlobal(context," + quote(name) + ")";
    };

    StructuredEmitter.prototype.environment = function (depth) {
        var result = "closure";
        while (depth-- > 0) result += ".parent";
        return result;
    };

    StructuredEmitter.prototype.spillLocals = function () {
        if (!this.useEnvironment) return "";
        var parts = [];
        var index = 0;
        while (index < this.program.bindings.length) {
            parts.push("runtime.writeHeapValue(l" + index + ",v" + index + ");");
            index++;
        }
        return parts.join("");
    };

    StructuredEmitter.prototype.spillLocalExpressions = function () {
        if (!this.useEnvironment) return [];
        var parts = [];
        var index = 0;
        while (index < this.program.bindings.length) {
            parts.push("runtime.writeHeapValue(l" + index + ",v" + index + ")");
            index++;
        }
        return parts;
    };

    StructuredEmitter.prototype.reloadLocalExpressions = function () {
        if (!this.useEnvironment) return [];
        var parts = [];
        var index = 0;
        while (index < this.program.bindings.length) {
            parts.push("v" + index + "=runtime.readHeapValue(l" + index + ")");
            index++;
        }
        return parts;
    };

    StructuredEmitter.prototype.reloadAfter = function (expression) {
        if (!this.useEnvironment && !this.environmentCellCount &&
            !this.globalCellCount) return expression;
        var temporary = "q" + this.reloadIndex++;
        var reloads = this.reloadLocalExpressions();
        var spills = this.spillLocalExpressions();
        var name;
        for (name in this.environmentCells) {
            if (Object.prototype.hasOwnProperty.call(this.environmentCells, name)) {
                reloads.push(this.environmentValues[name] +
                    "=runtime.readHeapValue(" + this.environmentCells[name] + ")");
            }
        }
        for (name in this.globalCells) {
            if (Object.prototype.hasOwnProperty.call(this.globalCells, name)) {
                reloads.push(this.globalValues[name] + "=" + this.globalCells[name] +
                    "?runtime.readHeapValue(" + this.globalCells[name] +
                    "):undefined");
            }
        }
        return "(" + (spills.length ? spills.join(",") + "," : "") +
               "(" + temporary + "=" + expression + ")," +
               reloads.join(",") + "," + temporary + ")";
    };

    StructuredEmitter.prototype.statement = function (node) {
        var result = [];
        var index;
        if (node.type === "BlockStatement") {
            result.push("{");
            index = 0;
            while (index < node.body.length) result.push(this.statement(node.body[index++]));
            result.push("}");
        } else if (node.type === "EmptyStatement" ||
                   node.type === "FunctionDeclaration") result.push(";");
        else if (node.type === "ExpressionStatement") result.push(this.expression(node.expression) + ";");
        else if (node.type === "VariableStatement") {
            index = 0;
            while (index < node.declarations.length) {
                var declaration = node.declarations[index++];
                if (declaration.initial) {
                    result.push(this.local(declaration.name) + "=" +
                                this.expression(declaration.initial) + ";");
                    if (this.fastPlan && this.fastPlan.memberAliases[
                            "$" + declaration.name]) {
                        var declarationKind = this.fastPlan.kinds[
                            "$" + declaration.name];
                        result.push(this.fastPlan.memberAliases["$" + declaration.name] +
                                    "=" + this.local(declaration.name) +
                                    (declarationKind === "array" ? ".elements" :
                                     ".properties") + ";");
                    }
                }
            }
        } else if (node.type === "IfStatement") {
            result.push("if(" + this.expression(node.test) + ")" +
                        this.statement(node.consequent));
            if (node.alternate) result.push("else " + this.statement(node.alternate));
        } else if (node.type === "WhileStatement") {
            result.push("while(" + this.expression(node.test) + ")" + this.statement(node.body));
        } else if (node.type === "DoWhileStatement") {
            result.push("do" + this.statement(node.body) + "while(" +
                        this.expression(node.test) + ");");
        } else if (node.type === "ForStatement") {
            var initial = "";
            if (node.initial) {
                if (node.initial.type === "VariableStatement") {
                    var initialParts = [];
                    index = 0;
                    while (index < node.initial.declarations.length) {
                        declaration = node.initial.declarations[index++];
                        if (declaration.initial) {
                            initialParts.push(this.local(declaration.name) + "=" +
                                              this.expression(declaration.initial));
                        }
                    }
                    initial = initialParts.join(",");
                } else initial = this.expression(node.initial);
            }
            result.push("for(" + initial + ";" +
                        (node.test ? this.expression(node.test) : "") + ";" +
                        (node.update ? this.expression(node.update) : "") + ")" +
                        this.statement(node.body));
        } else if (node.type === "ForInStatement") {
            var left;
            if (node.left.type === "VariableStatement") {
                left = this.local(node.left.declarations[0].name);
            } else left = this.reference(node.left).source;
            result.push("for(" + left + " in hc.hostProperties(" +
                        this.expression(node.right) + "))" + this.statement(node.body));
        } else if (node.type === "BreakStatement") result.push("break;");
        else if (node.type === "ContinueStatement") result.push("continue;");
        else if (node.type === "ReturnStatement") {
            result.push("return " + (node.argument ? this.expression(node.argument) :
                                     "undefined") + ";");
        } else if (node.type === "ThrowStatement") result.push("throw " + this.expression(node.argument) + ";");
        else throw new Error("unsupported structured statement " + node.type);
        return result.join("");
    };

    StructuredEmitter.prototype.expression = function (node) {
        if (node.type === "Literal") return literal(node.value);
        if (node.type === "Identifier") return this.identifier(node.name);
        if (node.type === "ThisExpression") return this.slot(this.program.thisSlot);
        if (node.type === "BinaryExpression") {
            return "(" + this.expression(node.left) + node.operator +
                   this.expression(node.right) + ")";
        }
        if (node.type === "ConditionalExpression") {
            return "(" + this.expression(node.test) + "?" +
                   this.expression(node.consequent) + ":" +
                   this.expression(node.alternate) + ")";
        }
        if (node.type === "UnaryExpression") {
            if (node.operator === "typeof") return "runtime.typeOf(" + this.expression(node.argument) + ")";
            if (node.operator === "delete") {
                var deleted = this.reference(node.argument);
                return deleted.kind === "member" ? "runtime.deleteProperty(" + deleted.object +
                       "," + deleted.key + ")" : "true";
            }
            return "(" + node.operator + this.expression(node.argument) + ")";
        }
        if (node.type === "MemberExpression") {
            var member = this.reference(node);
            return this.memberRead(member.object, member.key, node);
        }
        if (node.type === "AssignmentExpression") {
            var reference = this.reference(node.left);
            var value = this.expression(node.right);
            if (reference.kind === "local") {
                var localAlias = this.fastPlan && node.left.type === "Identifier" &&
                    this.fastPlan.memberAliases["$" + node.left.name];
                if (localAlias && node.operator === "=") {
                    var localKind = this.fastPlan.kinds["$" + node.left.name];
                    return "((" + reference.source + "=" + value + "),(" +
                           localAlias + "=" + reference.source +
                           (localKind === "array" ? ".elements" : ".properties") +
                           ")," + reference.source + ")";
                }
                return "(" + reference.source + node.operator + value + ")";
            }
            if (reference.kind === "global") {
                if (reference.value) {
                    var globalOperator = node.operator.substring(
                        0, node.operator.length - 1);
                    return "((" + reference.value + "=" +
                        (node.operator === "=" ? value : reference.source +
                         globalOperator + value) + "),runtime.setGlobal(context," +
                        quote(reference.name) + "," + reference.value + ")," +
                        "(" + reference.cell + "=runtime.globalCellAddress(context," +
                        quote(reference.name) + "))," +
                        reference.value + ")";
                }
                if (node.operator === "=") return "runtime.setGlobal(context," +
                    quote(reference.name) + "," + value + ")";
                return "runtime.setGlobal(context," + quote(reference.name) +
                       ",runtime.getGlobal(context," + quote(reference.name) + ")" +
                       node.operator.substring(0, node.operator.length - 1) + value + ")";
            }
            if (reference.kind === "environment") {
                var environmentOperator = node.operator.substring(
                    0, node.operator.length - 1);
                return "((" + reference.value + "=" +
                    (node.operator === "=" ? value : reference.source +
                     environmentOperator + value) + ")," +
                    "runtime.writeHeapValue(" + reference.cell + "," +
                    reference.value + ")," + reference.value + ")";
            }
            var fastAssignmentTarget = this.fastMemberTarget(node.left,
                reference.object, reference.key);
            if (fastAssignmentTarget) {
                return "(" + fastAssignmentTarget + node.operator + value + ")";
            }
            if (node.operator === "=" && isPure(node.left.object) &&
                (!node.left.computed || isPure(node.left.property))) {
                return this.memberWrite(reference.object, reference.key, value,
                                        node.left);
            }
            return "hc.assignMember(" + reference.object + "," + reference.key + "," +
                   value + "," + quote(node.operator) + ")";
        }
        if (node.type === "UpdateExpression") {
            reference = this.reference(node.argument);
            if (reference.kind === "local") {
                return node.prefix ? node.operator + reference.source :
                                     reference.source + node.operator;
            }
            var amount = node.operator === "++" ? 1 : -1;
            if (reference.kind === "global") {
                if (reference.value) {
                    return node.prefix ? "((" + reference.value + "=" +
                        reference.source + "+(" + amount + ")" +
                        "),runtime.setGlobal(context," + quote(reference.name) + "," +
                        reference.value + "),(" + reference.cell +
                        "=runtime.globalCellAddress(context," + quote(reference.name) +
                        "))," + reference.value + ")" :
                        "((" + reference.value + "=" + reference.source + "+(" + amount + ")" +
                        "),runtime.setGlobal(context," + quote(reference.name) + "," +
                        reference.value + "),(" + reference.cell +
                        "=runtime.globalCellAddress(context," + quote(reference.name) +
                        "))," + reference.value + "-(" + amount + "))";
                }
                return "hc.updateGlobal(context,null," + quote(reference.name) +
                       "," + amount + "," + (node.prefix ? "true" : "false") + ")";
            }
            if (reference.kind === "environment") {
                return node.prefix ? "((" + reference.value + "+=" + amount + ")," +
                    "runtime.writeHeapValue(" + reference.cell + "," +
                    reference.value + ")," + reference.value + ")" :
                    "((" + reference.value + "+=" + amount + ")," +
                    "runtime.writeHeapValue(" + reference.cell + "," +
                    reference.value + ")," + reference.value + "-(" + amount + "))";
            }
            var fastUpdateTarget = this.fastMemberTarget(node.argument,
                reference.object, reference.key);
            if (fastUpdateTarget) {
                return node.prefix ? node.operator + fastUpdateTarget :
                                     fastUpdateTarget + node.operator;
            }
            return "hc.updateMember(" + reference.object + "," + reference.key + "," +
                   amount + "," + (node.prefix ? "true" : "false") + ")";
        }
        if (node.type === "CallExpression") return this.callExpression(node);
        if (node.type === "NewExpression") {
            return this.reloadAfter("hc.construct(" + this.expression(node.callee) +
                   ",[" + this.expressionList(node.arguments) + "],context)");
        }
        if (node.type === "FunctionExpression") {
            return "runtime.makeGuestFunction(p.constants[" +
                   node.guestProgramConstant + "],env,context)";
        }
        if (node.type === "ObjectExpression") {
            var keys = [];
            var values = [];
            var propertyIndex = 0;
            while (propertyIndex < node.properties.length) {
                keys.push(quote(node.properties[propertyIndex].key));
                values.push(this.expression(node.properties[propertyIndex].value));
                propertyIndex++;
            }
            if (keys.length <= 8) {
                var fixed = [];
                propertyIndex = 0;
                while (propertyIndex < keys.length) {
                    fixed.push(keys[propertyIndex], values[propertyIndex]);
                    propertyIndex++;
                }
                var exactArity = keys.length === 3 || keys.length === 5;
                return (exactArity ? "runtime.makeObjectLiteral" + keys.length :
                        "hc.makeObjectLiteralFixed") + "(" +
                       (exactArity ? fixed.join(",") : keys.length +
                        (fixed.length ? "," + fixed.join(",") : "")) + ")";
            }
            return "hc.makeObjectLiteral([" + keys.join(",") + "],[" +
                   values.join(",") + "])";
        }
        if (node.type === "ArrayExpression") {
            if (node.elements.length <= 8) {
                if (node.elements.length === 0) return "runtime.makeArrayLiteral0()";
                return "hc.makeArrayLiteralFixed(" + node.elements.length +
                       (node.elements.length ? "," +
                        this.expressionList(node.elements) : "") + ")";
            }
            return "hc.makeArrayLiteral([" + this.expressionList(node.elements) + "])";
        }
        if (node.type === "RegExpLiteral") {
            return "runtime.makeRegExp(" + quote(node.pattern) + "," + quote(node.flags) + ")";
        }
        if (node.type === "SequenceExpression") {
            return "(" + this.expression(node.left) + "," + this.expression(node.right) + ")";
        }
        throw new Error("unsupported structured expression " + node.type);
    };

    StructuredEmitter.prototype.expressionList = function (values) {
        var result = [];
        var index = 0;
        while (index < values.length) result.push(this.expression(values[index++]));
        return result.join(",");
    };

    StructuredEmitter.prototype.callExpression = function (node) {
        var argumentSources = [];
        var sourceArgumentIndex = 0;
        while (sourceArgumentIndex < node.arguments.length) {
            argumentSources.push(this.expression(node.arguments[sourceArgumentIndex++]));
        }
        var args = argumentSources.join(",");
        if (node.callee.type === "Identifier") {
            var name = node.callee.name;
            if (name === "poke32" || name === "poke8" ||
                name === "peek32" || name === "peek8") return name + "(" + args + ")";
            if (node.arguments.length <= 8) {
                var callTemporary = "c" + this.callIndex++;
                var directArgs = args ? "," + args : "";
                var directCall = "((" + callTemporary + "=" + this.identifier(name) + ")," +
                       callTemporary + "&&" + callTemporary +
                       ".threadedCompiler===hc?" + callTemporary +
                       ".threadedFunction(runtime," + callTemporary +
                       ".homeContext||context,undefined,null," + callTemporary +
                       "?runtime.functionClosure(" + callTemporary + "):null," + callTemporary + "," + node.arguments.length +
                       directArgs + "):" +
                       "hc.callFixed(" + callTemporary +
                       ",undefined,context," + node.arguments.length +
                       directArgs + "))";
                return isSafeIntrinsicName(name) ? directCall :
                       this.reloadAfter(directCall);
            }
            var arrayCall = "hc.call(" + this.identifier(name) +
                ",undefined,[" + args + "],context)";
            return isSafeIntrinsicName(name) ? arrayCall :
                   this.reloadAfter(arrayCall);
        }
        if (node.callee.type === "MemberExpression") {
            if (!node.callee.computed && node.callee.property.value === "call") {
                var explicitCallable = this.expression(node.callee.object);
                var explicitReceiver = node.arguments.length ?
                    argumentSources[0] : "undefined";
                var explicitArguments = argumentSources.slice(1);
                if (explicitArguments.length <= 8) {
                    return this.reloadAfter("hc.callFixed(" + explicitCallable + "," +
                           explicitReceiver + ",context," +
                           explicitArguments.length +
                           (explicitArguments.length ? "," +
                            explicitArguments.join(",") : "") + ")");
                }
                return this.reloadAfter("hc.call(" + explicitCallable + "," +
                       explicitReceiver + ",[" + explicitArguments.join(",") +
                       "],context)");
            }
            if (!node.callee.computed && node.callee.property.value === "apply") {
                return this.reloadAfter("hc.callApply(" +
                       this.expression(node.callee.object) + "," +
                       (argumentSources.length ? argumentSources[0] : "undefined") +
                       "," + (argumentSources.length > 1 ? argumentSources[1] :
                              "undefined") + ",context)");
            }
            if (node.callee.object.type === "Identifier" &&
                node.callee.object.name === "NodeLibc" &&
                !node.callee.computed &&
                node.callee.property.value === "memmove" &&
                node.arguments.length === 3) {
                return "hc.nativeMemmove(" + args + ")";
            }
            if (node.callee.object.type === "Identifier" &&
                (node.callee.object.name === "Math" ||
                 node.callee.object.name === "String" ||
                 node.callee.object.name === "Number") && !node.callee.computed) {
                return node.callee.object.name + "." +
                       node.callee.property.value + "(" + args + ")";
            }
            var member = this.reference(node.callee);
            if (!node.callee.computed && node.callee.property.value === "setPixel" &&
                node.arguments.length === 5) {
                return "hc.setPixelFast(" + member.object + "," + args +
                       ",context)";
                var pixelSite = this.pixelIndex++;
                var pixelArguments = argumentSources;
                var pixelObject = "s" + pixelSite + "_0";
                var pixelX = "s" + pixelSite + "_1";
                var pixelY = "s" + pixelSite + "_2";
                var pixelRed = "s" + pixelSite + "_3";
                var pixelGreen = "s" + pixelSite + "_4";
                var pixelBlue = "s" + pixelSite + "_5";
                return "((" + pixelObject + "=" + member.object + "),(" +
                       pixelX + "=" + pixelArguments[0] + "),(" + pixelY + "=" +
                       pixelArguments[1] + "),(" + pixelRed + "=" + pixelArguments[2] +
                       "),(" + pixelGreen + "=" + pixelArguments[3] + "),(" +
                       pixelBlue + "=" + pixelArguments[4] + "),(" + pixelObject +
                       "&&" + pixelObject + ".guestType==='object'&&" + pixelObject +
                       ".properties.$pixelFormat==='bgrx32le'&&" + pixelObject +
                       ".properties.$pixelAddress&&typeof poke32==='function'?((" +
                       pixelX + "=Number(" + pixelX + ")),(" + pixelY + "=Number(" +
                       pixelY + ")),(" + pixelX + "<0||" + pixelY + "<0||" +
                       pixelX + ">=" + pixelObject + ".properties.$width||" + pixelY +
                       ">=" + pixelObject + ".properties.$height?undefined:poke32(" +
                       pixelObject + ".properties.$pixelAddress+(" + pixelY + "*" +
                       pixelObject + ".properties.$width+" + pixelX + ")*4,((Number(" +
                       pixelRed + ")&255)<<16)|((Number(" + pixelGreen +
                       ")&255)<<8)|(Number(" + pixelBlue + ")&255)))):" +
                       "hc.callMemberFixed(" + pixelObject + ",\"setPixel\",context,5," +
                       pixelX + "," + pixelY + "," + pixelRed + "," + pixelGreen +
                       "," + pixelBlue + ")))";
            }
            if (!node.callee.computed && node.callee.property.value === "push" &&
                node.callee.object.type === "Identifier" && this.fastPlan &&
                this.fastPlan.kinds["$" + node.callee.object.name] === "array") {
                var arrayAlias = this.fastPlan.memberAliases[
                    "$" + node.callee.object.name];
                return (arrayAlias || member.object + ".elements") +
                       ".push(" + args + ")";
            }
            if (node.arguments.length <= 8) {
                return this.reloadAfter("hc.callMemberFixed(" + member.object +
                       "," + member.key +
                       ",context," + node.arguments.length +
                       (args ? "," + args : "") + ")");
            }
            return this.reloadAfter("hc.callMember(" + member.object + "," +
                   member.key + ",[" + args + "],context)");
        }
        return this.reloadAfter("hc.call(" + this.expression(node.callee) +
               ",undefined,[" + args + "],context)");
    };

    StructuredEmitter.prototype.reference = function (node) {
        if (node.type === "Identifier") {
            var local = this.local(node.name);
            if (local) return {kind: "local", source: local};
            var binding = this.program.nonlocalBindings &&
                          this.program.nonlocalBindings["$" + node.name];
            if (binding && binding.kind === "environment") {
                var depth = binding.depth - (this.useEnvironment ? 1 : 0);
                return {kind: "environment", depth: depth, slot: binding.slot,
                        cell: this.environmentCells["$" + node.name],
                        value: this.environmentValues["$" + node.name],
                        source: this.environmentValues["$" + node.name]};
            }
            return {kind: "global", name: node.name,
                    cell: this.globalCells["$" + node.name],
                    value: this.globalValues["$" + node.name],
                    source: this.globalValues["$" + node.name] ?
                        "(" + this.globalCells["$" + node.name] + "?" +
                        this.globalValues["$" + node.name] +
                        ":runtime.getGlobal(context," + quote(node.name) + "))" :
                        "runtime.getGlobal(context," + quote(node.name) + ")"};
        }
        if (node.type === "MemberExpression") {
            return {kind: "member", object: this.expression(node.object),
                    key: node.computed ? this.expression(node.property) :
                                         quote(node.property.value)};
        }
        throw new Error("invalid structured reference");
    };

    StructuredEmitter.prototype.memberRead = function (object, key, node) {
        var heapSite = this.memberIndex++;
        return node.computed ?
            "hc.getComputedCached(ic," + heapSite + "," + object + "," + key + ")" :
            "hc.getConstantCached(ic," + heapSite + "," + object + "," + key + ")";
        /* The specializations below are retained as design history while the
         * heap backends gain equivalent checked fast paths. */
        if (this.fastPlan && node.object.type === "MemberExpression" &&
            node.object.computed && node.object.object.type === "Identifier" &&
            !node.computed && this.fastPlan.arrayElementKinds[
                "$" + node.object.object.name] === "properties") {
            return object + ".properties[" + quote("$" + node.property.value) + "]";
        }
        if (this.fastPlan && node.object.type === "MemberExpression" &&
            !node.object.computed && node.object.object.type === "Identifier") {
            var nestedKey = "$" + node.object.object.name + ":$" +
                            node.object.property.value;
            if (this.fastPlan.nestedArrays[nestedKey]) {
                if (!node.computed && node.property.value === "length") {
                    return object + ".elements.length";
                }
                if (node.computed) return object + ".elements[" + key + "]";
            }
        }
        var fastKind = this.fastMemberKind(node);
        var alias = this.fastMemberAlias(node);
        if (fastKind === "array") {
            if (!node.computed && node.property.value === "length") {
                return (alias || object + ".elements") + ".length";
            }
            if (node.computed) return (alias || object + ".elements") + "[" + key + "]";
        }
        if (fastKind && !node.computed) {
            return (alias || object + ".properties") + "[" +
                   quote("$" + node.property.value) + "]";
        }
        var memberNumber = this.memberIndex++;
        if (node.object.type !== "Identifier") {
            var objectTemporary = "m" + memberNumber;
            return "((" + objectTemporary + "=" + object + ")," +
                   this.genericMemberRead(objectTemporary, key, node, memberNumber) + ")";
        }
        return this.genericMemberRead(object, key, node, memberNumber);
    };

    StructuredEmitter.prototype.genericMemberRead = function (object, key, node,
                                                                memberNumber) {
        var keyPrefix = "";
        var keySuffix = "";
        if (node.computed && node.property.type !== "Identifier" &&
            node.property.type !== "Literal") {
            var keyTemporary = "k" + memberNumber;
            keyPrefix = "((" + keyTemporary + "=" + key + "),";
            keySuffix = ")";
            key = keyTemporary;
        }
        if (!node.computed) {
            var propertyName = node.property.value;
            if (propertyName === "length") {
                return keyPrefix + "(" + object + "&&" + object + ".guestType==='array'?" +
                       object + ".elements.length:(" + object + "&&" + object +
                       ".properties&&" + object + ".properties[" +
                       quote("$" + propertyName) + "]!==undefined?" + object +
                       ".properties[" + quote("$" + propertyName) +
                       "]:hc.get(" + object + "," + key + ")))" + keySuffix;
            }
            return keyPrefix + "(" + object + "&&" + object + ".properties?" +
                   object + ".properties[" + quote("$" + propertyName) +
                   "]:hc.get(" + object + "," + key + "))" + keySuffix;
        }
        if (isPure(node.object) && (!node.computed || isPure(node.property))) {
            return keyPrefix + "(" + object + "&&" + object + ".guestType==='array'&&typeof (" +
                   key + ")==='number'&&(" + key + ")>=0&&((" + key + ")|0)===(" +
                   key + ")?" + object + ".elements[" + key + "]:hc.get(" +
                   object + "," + key + "))" + keySuffix;
        }
        return keyPrefix + "hc.get(" + object + "," + key + ")" + keySuffix;
    };

    StructuredEmitter.prototype.memberWrite = function (object, key, value, node) {
        var heapSite = this.memberIndex++;
        return node.computed ?
            "hc.assignComputedCached(ic," + heapSite + "," + object + "," + key +
                "," + value + ",\"=\")" :
            "hc.assignMemberCached(ic," + heapSite + "," + object + "," + key +
                "," + value + ",\"=\")";
        /* See memberRead: direct host-object fields are no longer semantic. */
        var fastKind = this.fastMemberKind(node);
        var alias = this.fastMemberAlias(node);
        if (fastKind === "array" && node.computed) {
            return "(" + (alias || object + ".elements") + "[" + key + "]=" + value + ")";
        }
        if (fastKind && !node.computed) {
            return "(" + (alias || object + ".properties") + "[" +
                   quote("$" + node.property.value) + "]=" + value + ")";
        }
        if (!node.computed) {
            var propertyName = node.property.value;
            return "(" + object + "&&" + object + ".properties?" +
                   object + ".properties[" + quote("$" + propertyName) + "]=" +
                   value + ":hc.assignMember(" + object + "," + key + "," +
                   value + ",\"=\"))";
        }
        return "(" + object + "&&" + object + ".guestType==='array'&&typeof (" +
               key + ")==='number'&&(" + key + ")>=0&&((" + key + ")|0)===(" +
               key + ")?" + object + ".elements[" + key + "]=" + value +
               ":hc.assignMember(" + object + "," + key + "," + value +
               ",\"=\"))";
    };

    StructuredEmitter.prototype.fastMemberKind = function (node) {
        if (!this.fastPlan || !node.object || node.object.type !== "Identifier") {
            return null;
        }
        return this.fastPlan.kinds["$" + node.object.name] || null;
    };

    StructuredEmitter.prototype.fastMemberAlias = function (node) {
        if (!this.fastPlan || !node.object || node.object.type !== "Identifier") return null;
        return this.fastPlan.memberAliases["$" + node.object.name] || null;
    };

    StructuredEmitter.prototype.fastMemberTarget = function (node, object, key) {
        var kind = this.fastMemberKind(node);
        var alias = this.fastMemberAlias(node);
        if (kind === "array" && node.computed) {
            return (alias || object + ".elements") + "[" + key + "]";
        }
        if (kind && !node.computed) {
            return (alias || object + ".properties") + "[" +
                   quote("$" + node.property.value) + "]";
        }
        return null;
    };

    function analyzeFastPath(program, emitter) {
        var aliases = {};
        var known = {};
        var kinds = {};
        var roots = {};
        var written = {};
        var unsafeWritten = {};
        var elementSources = {};
        var nestedArrays = {};
        var arrayElementKinds = {};
        var callableKindGuards = {};
        var parameters = {};
        var index = 0;
        while (index < program.parameters.length) parameters["$" + program.parameters[index++]] = true;
        known.$arguments = "array";

        function writes(node) {
            if (!node || typeof node !== "object") return;
            if ((node.type === "AssignmentExpression" ||
                 node.type === "UpdateExpression") &&
                (node.left || node.argument).type === "Identifier") {
                var writtenName = (node.left || node.argument).name;
                written["$" + writtenName] = true;
                if (node.type !== "AssignmentExpression" ||
                    node.operator !== "=" || node.right.type !== "Identifier") {
                    unsafeWritten["$" + writtenName] = true;
                } else {
                    var assignedRoot = rootName(node.right.name);
                    if (!parameters["$" + assignedRoot] && !known["$" + assignedRoot]) {
                        unsafeWritten["$" + writtenName] = true;
                    }
                }
            }
            visitChildren(node, writes, false);
        }

        function declarations(node) {
            if (!node || typeof node !== "object") return;
            if (node.type === "VariableStatement") {
                var declarationIndex = 0;
                while (declarationIndex < node.declarations.length) {
                    var declaration = node.declarations[declarationIndex++];
                    var initial = declaration.initial;
                    if (initial && initial.type === "Identifier") {
                        aliases["$" + declaration.name] = initial.name;
                    } else if (initial && initial.type === "ArrayExpression") {
                        known["$" + declaration.name] = "array";
                    } else if (initial && initial.type === "ObjectExpression") {
                        known["$" + declaration.name] = "properties";
                    } else if (initial && initial.type === "NewExpression" &&
                               initial.callee.type === "Identifier" &&
                               initial.callee.name === "Array") {
                        known["$" + declaration.name] = "array";
                    } else if (initial && initial.type === "MemberExpression" &&
                               initial.computed &&
                               initial.object.type === "Identifier") {
                        known["$" + declaration.name] = "properties";
                        elementSources["$" + declaration.name] =
                            initial.object.name;
                    } else if (initial && initial.type === "CallExpression" &&
                               initial.callee.type === "Identifier") {
                        var initialKind = knownFunctionReturnKind(
                            initial.callee.name);
                        if (initialKind) {
                            known["$" + declaration.name] = initialKind;
                            callableKindGuards["$" + initial.callee.name] = initialKind;
                        }
                    }
                }
            }
            visitChildren(node, declarations, false);
        }

        function rootName(name) {
            var seen = {};
            while (aliases["$" + name] && !seen["$" + name]) {
                seen["$" + name] = true;
                name = aliases["$" + name];
            }
            return name;
        }

        function members(node) {
            if (!node || typeof node !== "object") return;
            if (node.type === "CallExpression" &&
                node.callee && node.callee.type === "MemberExpression") {
                if (!node.callee.computed &&
                    node.callee.property.value === "push" &&
                    node.callee.object.type === "Identifier") {
                    markMember(node.callee.object.name, "array");
                    if (node.arguments.length === 1 &&
                        node.arguments[0].type === "CallExpression" &&
                        node.arguments[0].callee.type === "Identifier") {
                        var pushedKind = knownFunctionReturnKind(
                            node.arguments[0].callee.name);
                        if (pushedKind) {
                            arrayElementKinds["$" + node.callee.object.name] =
                                pushedKind;
                            callableKindGuards["$" +
                                node.arguments[0].callee.name] = pushedKind;
                        }
                    }
                }
                var argumentIndex = 0;
                while (argumentIndex < node.arguments.length) members(node.arguments[argumentIndex++]);
                members(node.callee.object);
                if (node.callee.computed) members(node.callee.property);
                return;
            }
            if (node.type === "MemberExpression" &&
                node.object && node.object.type === "Identifier") {
                var needed = node.computed || node.property.value === "length" ?
                             "array" : "properties";
                markMember(node.object.name, needed);
            } else if (node.type === "MemberExpression" &&
                       node.object && node.object.type === "MemberExpression" &&
                       !node.object.computed &&
                       node.object.object.type === "Identifier" &&
                       (node.computed || node.property.value === "length")) {
                var baseName = node.object.object.name;
                if (elementSources["$" + baseName]) {
                    nestedArrays["$" + baseName + ":$" +
                                 node.object.property.value] = true;
                    markMember(baseName, "properties");
                }
            }
            visitChildren(node, members, true);
        }

        function markMember(name, needed) {
                var localKnown = known["$" + name];
                if (!localKnown || localKnown === needed ||
                    (localKnown === "array" && needed === "properties")) {
                    var root = rootName(name);
                    var rootKnown = known["$" + root];
                    var rootIsParameter = parameters["$" + root];
                    var nonlocal = program.nonlocalBindings &&
                                   program.nonlocalBindings["$" + root];
                    if (localKnown || rootKnown || rootIsParameter || nonlocal) {
                        if (kinds["$" + name] !== "array") kinds["$" + name] = needed;
                        if (!rootKnown) {
                            roots["$" + root] = roots["$" + root] === "array" ?
                                                   "array" : needed;
                        }
                    }
                }
        }

        function knownFunctionReturnKind(name) {
            var compiler = emitter.threadedCompiler;
            var runtime = compiler && compiler.runtime;
            var context = runtime && runtime.contexts.length ? runtime.contexts[0] : null;
            var callable = context && emitter.threadedCompiler.runtime.getGlobal(
                context, name);
            return callable && callable.guestType === "bytecodeFunction" ?
                   callable.program.returnKind : null;
        }

        declarations(program.astBody);
        writes(program.astBody);
        members(program.astBody);
        var guards = [];
        var root;
        for (root in roots) {
            if (Object.prototype.hasOwnProperty.call(roots, root)) {
                var name = root.substring(1);
                var source = emitter.identifier(name);
                guards.push(roots[root] === "array" ?
                    "(" + source + "&&" + source + ".guestType==='array')" :
                    "(" + source + "&&" + source + ".properties)");
            }
        }
        var derivedName;
        for (derivedName in elementSources) {
            if (Object.prototype.hasOwnProperty.call(elementSources, derivedName) &&
                kinds[derivedName]) {
                guards.push("hc.arrayElementsHaveProperties(" +
                    emitter.identifier(elementSources[derivedName]) + ")");
            }
        }
        var nestedName;
        for (nestedName in nestedArrays) {
            if (Object.prototype.hasOwnProperty.call(nestedArrays, nestedName)) {
                var separator = nestedName.indexOf(":$");
                var nestedBase = nestedName.substring(1, separator);
                var nestedProperty = nestedName.substring(separator + 2);
                guards.push("hc.arrayElementPropertiesAreArrays(" +
                    emitter.identifier(elementSources["$" + nestedBase]) + "," +
                    quote(nestedProperty) + ")");
            }
        }
        var callableName;
        for (callableName in callableKindGuards) {
            if (Object.prototype.hasOwnProperty.call(callableKindGuards, callableName)) {
                var globalName = callableName.substring(1);
                var callableSource = emitter.identifier(globalName);
                guards.push("(" + callableSource + "&&" + callableSource +
                    ".guestType==='bytecodeFunction'&&" + callableSource +
                    ".program.returnKind===" + quote(callableKindGuards[callableName]) + ")");
            }
        }
        var memberAliases = {};
        var aliasDeclarations = [];
        var aliasNumber = 0;
        var memberName;
        for (memberName in kinds) {
            if (Object.prototype.hasOwnProperty.call(kinds, memberName) &&
                !unsafeWritten[memberName]) {
                var plainName = memberName.substring(1);
                var rootNameValue = rootName(plainName);
                if (parameters["$" + plainName] ||
                    (plainName === rootNameValue &&
                     program.nonlocalBindings &&
                     program.nonlocalBindings["$" + plainName])) {
                    var aliasName = "f" + aliasNumber++;
                    var base = emitter.identifier(plainName);
                    memberAliases[memberName] = aliasName;
                    aliasDeclarations.push(aliasName + "=" + base +
                        (kinds[memberName] === "array" ? ".elements" : ".properties"));
                } else if (known[memberName]) {
                    aliasName = "f" + aliasNumber++;
                    memberAliases[memberName] = aliasName;
                    aliasDeclarations.push(aliasName);
                }
            }
        }
        return guards.length ? {kinds: kinds, guards: guards,
            memberAliases: memberAliases,
            aliasDeclarations: aliasDeclarations,
            nestedArrays: nestedArrays,
            arrayElementKinds: arrayElementKinds} : null;
    }

    function visitChildren(node, callback, includeFunctionBodies) {
        if (!includeFunctionBodies && (node.type === "FunctionExpression" ||
                                       node.type === "FunctionDeclaration")) return;
        var key;
        for (key in node) {
            if (key !== "loc" && Object.prototype.hasOwnProperty.call(node, key)) {
                var value = node[key];
                if (value && typeof value === "object") {
                    if (typeof value.length === "number") {
                        var index = 0;
                        while (index < value.length) callback(value[index++]);
                    } else callback(value);
                }
            }
        }
    }

    function containsGuestConstruction(node) {
        var found = false;
        function visit(value) {
            if (!value || typeof value !== "object" || found) return;
            if (value.type === "NewExpression") {
                var calleeName = value.callee && value.callee.type === "Identifier" ?
                                 value.callee.name : null;
                /* These constructors are runtime intrinsics and do not enter a
                 * generated guest constructor activation. */
                if (calleeName !== "Array" && calleeName !== "Date" &&
                    calleeName !== "Error" && calleeName !== "Object" &&
                    calleeName !== "String" && calleeName !== "Number") {
                    found = true;
                    return;
                }
            }
            visitChildren(value, visit, false);
        }
        visit(node);
        return found;
    }

    function isPure(node) {
        if (!node) return true;
        if (node.type === "Literal" || node.type === "Identifier" ||
            node.type === "ThisExpression") return true;
        if (node.type === "MemberExpression") return isPure(node.object) && isPure(node.property);
        if (node.type === "BinaryExpression") return isPure(node.left) && isPure(node.right);
        return false;
    }

    function usesIdentifier(node, name) {
        if (!node || typeof node !== "object") return false;
        if (node.type === "Identifier" && node.name === name) return true;
        var key;
        for (key in node) {
            if (key !== "loc" && Object.prototype.hasOwnProperty.call(node, key)) {
                var value = node[key];
                if (value && typeof value === "object") {
                    if (typeof value.length === "number") {
                        var index = 0;
                        while (index < value.length) {
                            if (usesIdentifier(value[index++], name)) return true;
                        }
                    } else if (usesIdentifier(value, name)) return true;
                }
            }
        }
        return false;
    }

    function countDirectCalls(node) {
        var count = 0;
        function visit(value) {
            if (!value || typeof value !== "object") return;
            if (value.type === "CallExpression" &&
                value.callee && value.callee.type === "Identifier" &&
                value.callee.name !== "poke32" && value.callee.name !== "poke8" &&
                value.callee.name !== "peek32" && value.callee.name !== "peek8" &&
                value.arguments.length <= 8) count++;
            visitChildren(value, visit, false);
        }
        visit(node);
        return count;
    }

    function countReloadSites(node) {
        var count = 0;
        function visit(value) {
            if (!value || typeof value !== "object") return;
            if (value.type === "CallExpression" || value.type === "NewExpression") {
                count++;
            }
            visitChildren(value, visit, false);
        }
        visit(node);
        return count;
    }

    function isSafeIntrinsicName(name) {
        return name === "Number" || name === "String" || name === "Boolean" ||
               name === "parseInt" || name === "parseFloat" ||
               name === "isNaN" || name === "isFinite";
    }

    function countMemberReads(node) {
        var count = 0;
        function visit(value) {
            if (!value || typeof value !== "object") return;
            if (value.type === "MemberExpression") count++;
            visitChildren(value, visit, false);
        }
        visit(node);
        return count;
    }

    function countSetPixelCalls(node) {
        var count = 0;
        function visit(value) {
            if (!value || typeof value !== "object") return;
            if (value.type === "CallExpression" && value.callee &&
                value.callee.type === "MemberExpression" &&
                !value.callee.computed && value.callee.property.value === "setPixel" &&
                value.arguments.length === 5) count++;
            visitChildren(value, visit, false);
        }
        visit(node);
        return count;
    }

    function quote(value) {
        value = String(value);
        var result = "\"";
        var index = 0;
        while (index < value.length) {
            var code = value.charCodeAt(index++);
            if (code === 34) result += "\\\"";
            else if (code === 92) result += "\\\\";
            else if (code === 10) result += "\\n";
            else if (code === 13) result += "\\r";
            else if (code === 9) result += "\\t";
            else if (code < 32 || code > 126) {
                var hex = code.toString(16);
                while (hex.length < 4) hex = "0" + hex;
                result += "\\u" + hex;
            } else result += String.fromCharCode(code);
        }
        return result + "\"";
    }

    function literal(value) {
        if (value === undefined) return "undefined";
        if (value === null) return "null";
        if (typeof value === "string") return quote(value);
        if (typeof value === "number") {
            if (value !== value) return "NaN";
            if (value === Infinity) return "Infinity";
            if (value === -Infinity) return "-Infinity";
            if (value === 0 && 1 / value < 0) return "-0";
        }
        return String(value);
    }

    function applyAssignmentSource(operator, left, right) {
        return "(" + left + operator.charAt(0) + right + ")";
    }

    function applyAssignment(operator, left, right, runtime) {
        if (operator === "+=") return runtime.add(left, right);
        if (operator === "-=") return Number(left) - Number(right);
        if (operator === "*=") return Number(left) * Number(right);
        if (operator === "/=") return Number(left) / Number(right);
        if (operator === "%=") return Number(left) % Number(right);
        if (operator === "&=") return left & right;
        if (operator === "|=") return left | right;
        if (operator === "^=") return left ^ right;
        throw new Error("unsupported compiled assignment " + operator);
    }

    function blockStarts(program) {
        var starts = {0: true};
        var code = program.code;
        var pc = 0;
        while (pc < code.length) {
            var opcode = code[pc];
            var next = pc + width(opcode);
            if (opcode === op.JUMP) starts[code[pc + 1]] = true;
            else if (opcode === op.JUMP_IF_FALSE) {
                starts[code[pc + 2]] = true;
                if (next < code.length) starts[next] = true;
            } else if (opcode === op.RETURN || opcode === op.THROW) {
                if (next < code.length) starts[next] = true;
            }
            pc = next;
        }
        return starts;
    }

    function width(opcode) {
        if (opcode === op.CONST || opcode === op.GET_GLOBAL ||
            opcode === op.SET_GLOBAL || opcode === op.MOVE || opcode === op.NOT ||
            opcode === op.NEGATE || opcode === op.POSITIVE ||
            opcode === op.MAKE_FUNCTION || opcode === op.BIT_NOT ||
            opcode === op.TYPEOF || opcode === op.GET_KEYS ||
            opcode === op.PUSH_CATCH) return 3;
        if (opcode === op.GET_PROPERTY || opcode === op.SET_PROPERTY ||
            opcode === op.GET_LOCAL || opcode === op.SET_LOCAL ||
            opcode === op.GET_PROPERTY_CONST || opcode === op.SET_PROPERTY_CONST ||
            opcode === op.DELETE_PROPERTY_CONST || opcode === op.DELETE_PROPERTY ||
            (opcode >= op.ADD && opcode <= op.GREATER_EQUAL) ||
            (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT) ||
            opcode === op.MAKE_REGEXP || opcode === op.CONSTRUCT) return 4;
        if (opcode === op.JUMP || opcode === op.RETURN ||
            opcode === op.MAKE_OBJECT || opcode === op.MAKE_ARRAY ||
            opcode === op.THROW) return 2;
        if (opcode === op.POP_CATCH) return 1;
        if (opcode === op.JUMP_IF_FALSE) return 3;
        if (opcode === op.CALL) return 5;
        throw new Error("invalid threaded opcode " + opcode);
    }

    root.GuestVMThreadedCompiler = ThreadedCompiler;
    if (typeof module !== "undefined" && module.exports) module.exports = ThreadedCompiler;
}(this));
