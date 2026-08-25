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
    }

    ThreadedCompiler.prototype.setFallback = function (callback) {
        this.fallback = callback;
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
        if (!program || !program.bindingRegisters || !this.supports(program)) return null;
        if (program.threadedCompiler === this && program.threadedFunction) {
            return program.threadedFunction;
        }
        var existing = this.find(program);
        if (existing >= 0) return this.compiled[existing];
        var source = program.astBody ? this.generateStructured(program) :
                                      this.generate(program);
        var factory = Function("hc", "p", source);
        var compiled = factory(this, program);
        this.programs.push(program);
        this.compiled.push(compiled);
        program.threadedCompiler = this;
        program.threadedFunction = compiled;
        return compiled;
    };

    ThreadedCompiler.prototype.supports = function (program) {
        var code = program.code;
        var pc = 0;
        while (pc < code.length) {
            var opcode = code[pc];
            if (opcode === op.PUSH_CATCH || opcode === op.POP_CATCH ||
                opcode === op.MAKE_FUNCTION) return false;
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
                                receiver, args, callable.closure, callable);
            }
            if (!this.fallback) throw new Error("compiled call needs interpreter fallback");
            return this.fallback(callable, receiver, args, context);
        }
        if (callable.guestType !== "function") throw new TypeError("value is not callable");
        return callable.callback(receiver, args);
    };

    ThreadedCompiler.prototype.callFixed = function (callable, receiver, context,
            count, a0, a1, a2, a3, a4, a5, a6, a7) {
        this.runtime.assertOwned(callable);
        if (!callable) throw new TypeError("value is not callable");
        if (callable.guestType === "bytecodeFunction") {
            var compiled = this.compile(callable.program);
            if (compiled) {
                return compiled(this.runtime, callable.homeContext || context,
                                receiver, null, callable.closure, callable,
                                a0, a1, a2, a3, a4, a5, a6, a7);
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

    ThreadedCompiler.prototype.callMemberFixed = function (object, key, context,
            count, a0, a1, a2, a3, a4, a5, a6, a7) {
        return this.callFixed(this.runtime.getProperty(object, key), object, context,
                              count, a0, a1, a2, a3, a4, a5, a6, a7);
    };

    ThreadedCompiler.prototype.construct = function (callable, args, context) {
        this.runtime.assertOwned(callable);
        if (!callable) throw new TypeError("value is not a constructor");
        if (callable.guestType === "bytecodeFunction") {
            var receiver = this.runtime.makeObject();
            var prototype = this.runtime.getProperty(callable, "prototype");
            if (prototype && prototype.guestType) receiver.prototype = prototype;
            var result = this.call(callable, receiver, args, context);
            return result && result.guestType ? result : receiver;
        }
        return this.runtime.construct(callable, args);
    };

    ThreadedCompiler.prototype.get = function (object, key) {
        return this.runtime.getProperty(object, key);
    };

    ThreadedCompiler.prototype.set = function (object, key, value) {
        return this.runtime.setProperty(object, key, value);
    };

    ThreadedCompiler.prototype.callMember = function (object, key, args, context) {
        return this.call(this.runtime.getProperty(object, key), object, args, context);
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

    ThreadedCompiler.prototype.makeObjectLiteral = function (keys, values) {
        var object = this.runtime.makeObject();
        var index = 0;
        while (index < keys.length) {
            this.runtime.setProperty(object, keys[index], values[index]);
            index++;
        }
        return object;
    };

    ThreadedCompiler.prototype.makeArrayLiteral = function (values) {
        return this.runtime.arrayFrom(values);
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
        while (index < keys.elements.length) result[keys.elements[index++]] = true;
        return result;
    };

    ThreadedCompiler.prototype.generateStructured = function (program) {
        var emitter = new StructuredEmitter(program);
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
        lines.push("}}};");
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
            lines.push(rr(1) + "=(" + rr(2) + "&&" + rr(2) +
                       ".guestType==='array'&&typeof " + rr(3) +
                       "==='number'&&" + rr(3) + ">=0&&(" + rr(3) + "|0)===" + rr(3) +
                       ")?" + rr(2) + ".elements[" + rr(3) + "]:runtime.getProperty(" +
                       rr(2) + "," + rr(3) + ");");
        } else if (opcode === op.SET_PROPERTY) {
            lines.push("if(" + rr(1) + "&&" + rr(1) +
                       ".guestType==='array'&&typeof " + rr(2) +
                       "==='number'&&" + rr(2) + ">=0&&(" + rr(2) + "|0)===" + rr(2) +
                       "){" + rr(1) + ".elements[" + rr(2) + "]=" + rr(3) +
                       ";}else{runtime.setProperty(" + rr(1) + "," + rr(2) + "," + rr(3) + ");}");
        } else if (opcode === op.GET_PROPERTY_CONST) {
            lines.push(rr(1) + "=(" + rr(2) + "&&" + rr(2) +
                       ".guestType==='array'&&" + constant(3) + "==='length')?" + rr(2) +
                       ".elements.length:(" + rr(2) + "&&" + rr(2) +
                       ".guestType==='buffer'&&" + constant(3) + "==='length')?" + rr(2) +
                       ".length:(" + rr(2) + "&&" + rr(2) + ".properties&&" + rr(2) +
                       ".properties['$'+" + constant(3) + "]!==undefined)?" + rr(2) +
                       ".properties['$'+" + constant(3) + "]:runtime.getProperty(" + rr(2) +
                       "," + constant(3) + ");");
        } else if (opcode === op.SET_PROPERTY_CONST) {
            lines.push("if(" + rr(1) + "&&" + rr(1) + ".properties){" + rr(1) +
                       ".properties['$'+" + constant(2) + "]=" + rr(3) +
                       ";}else{runtime.setProperty(" + rr(1) + "," + constant(2) +
                       "," + rr(3) + ");}");
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

    function StructuredEmitter(program) {
        this.program = program;
        this.bindings = program.bindingSlots || {};
    }

    StructuredEmitter.prototype.generate = function () {
        var lines = [];
        lines.push("return function(runtime,context,receiver,args,closure,callable," +
                   "a0,a1,a2,a3,a4,a5,a6,a7){");
        var declarations = [];
        var index = 0;
        while (index < this.program.bindings.length) {
            declarations.push("v" + index++);
        }
        if (declarations.length) lines.push("var " + declarations.join(",") + ";");
        index = 0;
        while (index < this.program.parameterSlots.length) {
            lines.push("v" + this.program.parameterSlots[index] + "=args?(" + index +
                       "<args.length?args[" + index + "]:undefined):" +
                       (index < 8 ? "a" + index : "undefined") + ";");
            index++;
        }
        if (usesIdentifier(this.program.astBody, "arguments")) {
            lines.push("v" + this.program.argumentsSlot + "=runtime.arrayFrom(args||" +
                       "[a0,a1,a2,a3,a4,a5,a6,a7].slice(0," +
                       this.program.parameters.length + "));");
        }
        lines.push("v" + this.program.thisSlot + "=receiver;");
        if (this.program.functionNameSlot >= 0) {
            lines.push("v" + this.program.functionNameSlot + "=callable;");
        }
        lines.push(this.statement(this.program.astBody));
        lines.push("return undefined;");
        lines.push("};");
        return lines.join("\n");
    };

    StructuredEmitter.prototype.local = function (name) {
        var slot = this.bindings["$" + name];
        return slot === undefined ? null : "v" + slot;
    };

    StructuredEmitter.prototype.identifier = function (name) {
        var local = this.local(name);
        if (local) return local;
        var binding = this.program.nonlocalBindings &&
                      this.program.nonlocalBindings["$" + name];
        if (binding && binding.kind === "environment") {
            return this.environment(binding.depth) + ".slots[" + binding.slot + "]";
        }
        return "context.globals[" + quote(name) + "]";
    };

    StructuredEmitter.prototype.environment = function (depth) {
        var result = "closure";
        while (depth-- > 0) result += ".parent";
        return result;
    };

    StructuredEmitter.prototype.statement = function (node) {
        var result = [];
        var index;
        if (node.type === "BlockStatement") {
            result.push("{");
            index = 0;
            while (index < node.body.length) result.push(this.statement(node.body[index++]));
            result.push("}");
        } else if (node.type === "EmptyStatement") result.push(";");
        else if (node.type === "ExpressionStatement") result.push(this.expression(node.expression) + ";");
        else if (node.type === "VariableStatement") {
            index = 0;
            while (index < node.declarations.length) {
                var declaration = node.declarations[index++];
                if (declaration.initial) {
                    result.push(this.local(declaration.name) + "=" +
                                this.expression(declaration.initial) + ";");
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
        if (node.type === "ThisExpression") return "v" + this.program.thisSlot;
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
            if (reference.kind === "local") return "(" + reference.source +
                node.operator + value + ")";
            if (reference.kind === "global") {
                if (node.operator === "=") return "(context.globals[" +
                    quote(reference.name) + "]=" + value + ")";
                return "(context.globals[" + quote(reference.name) + "]" +
                       node.operator + value + ")";
            }
            if (reference.kind === "environment") {
                if (node.operator === "=") return "(" + reference.source + "=" + value + ")";
                return "(" + reference.source + node.operator + value + ")";
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
                var globalSource = "context.globals[" + quote(reference.name) + "]";
                return node.prefix ? node.operator + globalSource : globalSource + node.operator;
            }
            if (reference.kind === "environment") {
                return node.prefix ? node.operator + reference.source :
                                     reference.source + node.operator;
            }
            return "hc.updateMember(" + reference.object + "," + reference.key + "," +
                   amount + "," + (node.prefix ? "true" : "false") + ")";
        }
        if (node.type === "CallExpression") return this.callExpression(node);
        if (node.type === "NewExpression") {
            return "hc.construct(" + this.expression(node.callee) + ",[" +
                   this.expressionList(node.arguments) + "],context)";
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
            return "hc.makeObjectLiteral([" + keys.join(",") + "],[" +
                   values.join(",") + "])";
        }
        if (node.type === "ArrayExpression") {
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
        var args = this.expressionList(node.arguments);
        if (node.callee.type === "Identifier") {
            var name = node.callee.name;
            if (name === "poke32" || name === "poke8" ||
                name === "peek32" || name === "peek8") return name + "(" + args + ")";
            if (node.arguments.length <= 8) {
                return "hc.callFixed(" + this.identifier(name) +
                       ",undefined,context," + node.arguments.length +
                       (args ? "," + args : "") + ")";
            }
            return "hc.call(" + this.identifier(name) + ",undefined,[" + args + "],context)";
        }
        if (node.callee.type === "MemberExpression") {
            if (node.callee.object.type === "Identifier" &&
                node.callee.object.name === "Math" && !node.callee.computed) {
                return "Math." + node.callee.property.value + "(" + args + ")";
            }
            var member = this.reference(node.callee);
            if (node.arguments.length <= 8) {
                return "hc.callMemberFixed(" + member.object + "," + member.key +
                       ",context," + node.arguments.length +
                       (args ? "," + args : "") + ")";
            }
            return "hc.callMember(" + member.object + "," + member.key + ",[" +
                   args + "],context)";
        }
        return "hc.call(" + this.expression(node.callee) + ",undefined,[" + args + "],context)";
    };

    StructuredEmitter.prototype.reference = function (node) {
        if (node.type === "Identifier") {
            var local = this.local(node.name);
            if (local) return {kind: "local", source: local};
            var binding = this.program.nonlocalBindings &&
                          this.program.nonlocalBindings["$" + node.name];
            if (binding && binding.kind === "environment") {
                return {kind: "environment",
                        source: this.environment(binding.depth) + ".slots[" +
                                binding.slot + "]"};
            }
            return {kind: "global", name: node.name};
        }
        if (node.type === "MemberExpression") {
            return {kind: "member", object: this.expression(node.object),
                    key: node.computed ? this.expression(node.property) :
                                         quote(node.property.value)};
        }
        throw new Error("invalid structured reference");
    };

    StructuredEmitter.prototype.memberRead = function (object, key, node) {
        if (!node.computed) {
            var propertyName = node.property.value;
            if (propertyName === "length") {
                return "(" + object + "&&" + object + ".guestType==='array'?" +
                       object + ".elements.length:(" + object + "&&" + object +
                       ".properties&&" + object + ".properties[" +
                       quote("$" + propertyName) + "]!==undefined?" + object +
                       ".properties[" + quote("$" + propertyName) +
                       "]:hc.get(" + object + "," + key + ")))";
            }
            return "(" + object + "&&" + object + ".properties?" +
                   object + ".properties[" + quote("$" + propertyName) +
                   "]:hc.get(" + object + "," + key + "))";
        }
        if (isPure(node.object) && (!node.computed || isPure(node.property))) {
            return "(" + object + "&&" + object + ".guestType==='array'&&typeof (" +
                   key + ")==='number'&&(" + key + ")>=0&&((" + key + ")|0)===(" +
                   key + ")?" + object + ".elements[" + key + "]:hc.get(" +
                   object + "," + key + "))";
        }
        return "hc.get(" + object + "," + key + ")";
    };

    StructuredEmitter.prototype.memberWrite = function (object, key, value, node) {
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
