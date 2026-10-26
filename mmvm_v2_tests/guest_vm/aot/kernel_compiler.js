/* Shared kernel front/middle end. It parses a deliberately small, statically
 * validated integer-function dialect and produces host-independent typed IR. */
(function (root) {
    var Parser = root.GuestVMParser;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("../parser.js");
    }

    function KernelCompiler() {}

    /* Function#toString formatting is host-specific. Fingerprint the parsed
     * syntax, retaining semantic fields but excluding source positions/text.
     * This is equally usable by the bootstrap shell and a standalone guest;
     * it does not require compiling machine code merely to validate an image. */
    KernelCompiler.prototype.sourceFingerprint = function (source) {
        return this.prepareSource(source).fingerprint;
    };

    /* A compilation transaction owns this result. Reuse its syntax for
     * lowering, not across builds: validation still parses all source. */
    KernelCompiler.prototype.prepareSource = function (source) {
        var parseStarted = new Date().getTime();
        var tree = new Parser(source, "<kernel-fingerprint>", {
            captureRaw: false, captureLocations: false,
            captureFunctionSource: true, compactLiterals: true
        }).parseProgram();
        var parsedAt = new Date().getTime();
        var FNV1A_OFFSET_BASIS = -2128831035;
        var FNV1A_PRIME = 16777619;
        var hash = FNV1A_OFFSET_BASIS;
        var textHashes = {};
        var fieldSchemas = {};
        var STRUCTURAL_HASH_MULTIPLIER = 65599;
        function tokenDigest(text) {
            /* The canonical traversal repeatedly emits the same field names,
             * node types and punctuation. Hash each distinct token once per
             * build, then mix its digest into the ordered structural stream.
             * This is not a source/parse cache: every AST field is still
             * visited and every build parses and validates all source. */
            var key = "$" + text;
            var digest = textHashes[key];
            if (digest === undefined) {
                digest = FNV1A_OFFSET_BASIS;
                var index = 0;
                while (index < text.length) {
                    var code = text.charCodeAt(index++);
                    digest = ((digest ^ (code & 255)) * FNV1A_PRIME) | 0;
                    digest = ((digest ^ (code >>> 8)) * FNV1A_PRIME) | 0;
                }
                textHashes[key] = digest;
            }
            return digest;
        }
        function mix(digest) {
            /* A signed word times 65599 plus a signed word is exactly
             * representable in binary64, on both bootstrap hosts. */
            hash = (hash * STRUCTURAL_HASH_MULTIPLIER + digest) | 0;
        }
        function append(text) { mix(tokenDigest(text)); }
        var nullDigest = tokenDigest("null;");
        var arrayStartDigest = tokenDigest("[");
        var arrayEndDigest = tokenDigest("]");
        var objectStartDigest = tokenDigest("{");
        var objectEndDigest = tokenDigest("}");

        /* Cache only the ordering of fields within this traversal, not AST
         * contents. Validate every own semantic field on every occurrence:
         * optional fields or a different shape must rebuild the schema. */
        function schemaFor(value) {
            var cacheKey = "$" + value.type;
            var schema = fieldSchemas[cacheKey];
            var count = 0, matches = !!schema, key;
            for (key in value) {
                if (key !== "location" && key !== "source" &&
                    key !== "sourceEnd" && key !== "filename" &&
                    Object.prototype.hasOwnProperty.call(value, key)) {
                    count++;
                    if (matches && schema.members["$" + key] !== true) {
                        matches = false;
                    }
                }
            }
            if (matches && count === schema.keys.length) return schema;
            var keys = [], members = {}, digests = [];
            for (key in value) {
                if (key !== "location" && key !== "source" &&
                    key !== "sourceEnd" && key !== "filename" &&
                    Object.prototype.hasOwnProperty.call(value, key)) {
                    keys.push(key);
                    members["$" + key] = true;
                }
            }
            keys.sort();
            var index = 0;
            while (index < keys.length) {
                key = keys[index++];
                digests.push(tokenDigest(key.length + ":" + key + ":"));
            }
            schema = {keys: keys, members: members, digests: digests};
            fieldSchemas[cacheKey] = schema;
            return schema;
        }
        function visit(value) {
            if (value === null) { mix(nullDigest); return; }
            var type = typeof value;
            if (type !== "object") {
                var text = String(value);
                append(type + ":" + text.length + ":" + text + ";");
                return;
            }
            /* SpiderMonkey's decompiler inserts braces around a single
             * controlled statement. Kernel blocks have no lexical bindings;
             * those braces do not change this dialect's execution. */
            if (value.type === "BlockStatement" && value.body.length === 1) {
                visit(value.body[0]);
                return;
            }
            if (value instanceof Array) {
                mix(arrayStartDigest);
                var index = 0;
                while (index < value.length) visit(value[index++]);
                mix(arrayEndDigest);
                return;
            }
            var schema = schemaFor(value);
            var keys = schema.keys;
            mix(objectStartDigest);
            var keyIndex = 0;
            while (keyIndex < keys.length) {
                var key = keys[keyIndex];
                mix(schema.digests[keyIndex++]);
                visit(value[key]);
            }
            mix(objectEndDigest);
        }
        visit(tree);
        var fingerprintedAt = new Date().getTime();
        var functions = {}, entry = null, statementIndex = 0;
        while (statementIndex < tree.body.length) {
            var statement = tree.body[statementIndex++];
            if (statement.type === "FunctionDeclaration") {
                /* A declaration and its function expression share these
                 * semantic fields. Do not mutate the fingerprinted tree. */
                var expression = {type: "FunctionExpression",
                    name: statement.name, parameters: statement.parameters,
                    body: statement.body, strict: statement.strict,
                    source: statement.source};
                functions["$" + statement.name] = expression;
                if (!entry) entry = expression;
            }
        }
        return {fingerprint: hash >>> 0, functions: functions, entry: entry,
                timings: {parse: parsedAt - parseStarted,
                          fingerprint: fingerprintedAt - parsedAt}};
    };

    function sameFunctionSource(left, right) {
        /* Decompilers may surround a function with ASCII whitespace. Anything
         * else must match exactly; a mismatch takes the normal parser path. */
        function trim(source) {
            var start = 0, end = source.length;
            while (start < end && source.charCodeAt(start) <= 32) start++;
            while (end > start && source.charCodeAt(end - 1) <= 32) end--;
            return source.substring(start, end);
        }
        return typeof right === "string" && trim(left) === trim(right);
    }

    KernelCompiler.prototype.compileGraph = function (entry, dependencies,
                                                       options) {
        dependencies = dependencies || {};
        options = options || {};
        validateConstantOptions(options);
        var functions = [];
        var signatures = {};
        var preparation = {reusedFunctions: 0, parsedFunctions: 0};
        var aggregateTimings = options.timings || null;
        if (aggregateTimings) {
            aggregateTimings.source = 0;
            aggregateTimings.parse = 0;
            aggregateTimings.collect = 0;
            aggregateTimings.lower = 0;
        }
        function addFunction(name, fn) {
            if (typeof fn !== "function") {
                throw new TypeError("kernel graph member " + name +
                                    " is not a function");
            }
            var sourceStarted = aggregateTimings ? new Date().getTime() : 0;
            var source = fn.toString();
            if (aggregateTimings) {
                aggregateTimings.source +=
                    new Date().getTime() - sourceStarted;
            }
            var parseStarted = aggregateTimings ? new Date().getTime() : 0;
            var prepared = options.preparedSource;
            var expectedName = fn.name || name;
            var expression = prepared ? (expectedName ?
                prepared.functions["$" + expectedName] : prepared.entry) : null;
            if (!expression || !sameFunctionSource(source, expression.source)) {
                expression = parseKernelFunctionSource(source, "<kernel-graph>");
                preparation.parsedFunctions++;
            } else preparation.reusedFunctions++;
            if (aggregateTimings) {
                aggregateTimings.parse +=
                    new Date().getTime() - parseStarted;
            }
            var actualName = fn.name || name || expression.name;
            if (!actualName) {
                throw new SyntaxError("kernel graph member must be named");
            }
            if (!name) name = actualName;
            if (actualName !== name) {
                throw new SyntaxError("kernel graph key " + name +
                                      " does not match function " + actualName);
            }
            if (signatures[name]) {
                throw new SyntaxError("duplicate kernel function " + name);
            }
            /* Function.length is absent on the Firefox 1 era shell used by
             * js_min. Parse each graph member exactly once: the same tree is
             * authoritative for arity, constant validation, and lowering. */
            signatures[name] = {
                name: name,
                arity: expression.parameters.length
            };
            functions.push({name: name, fn: fn, source: source,
                            expression: expression, localNames: null});
        }
        if (!entry || typeof entry !== "function") {
            throw new TypeError("kernel graph entry must be a named function");
        }
        addFunction(null, entry);
        var entryName = functions[0].name;
        var entryDependencies = [];
        functions[0].localNames = [];
        var sharedConstants = collectFunctionConstants(
            entry, options.constantOverrides || {}, functions[0].expression,
            dependencies, signatures, entryDependencies,
            functions[0].localNames, options.legacyConstantLocals === true);
        copyExternalConstants(sharedConstants, options.constantBindings);
        entryDependencies.sort();
        var entryDependencyIndex = 0;
        while (entryDependencyIndex < entryDependencies.length) {
            var entryDependency = entryDependencies[entryDependencyIndex++];
            addFunction(entryDependency, dependencies[entryDependency]);
        }
        var constantMemberIndex = 1;
        while (constantMemberIndex < functions.length) {
            var memberDependencies = [];
            functions[constantMemberIndex].localNames = [];
            var memberConstants = collectFunctionConstants(
                functions[constantMemberIndex].fn,
                options.constantOverrides || {},
                functions[constantMemberIndex].expression,
                dependencies, signatures, memberDependencies,
                functions[constantMemberIndex].localNames,
                options.legacyConstantLocals === true);
            var memberConstantName;
            for (memberConstantName in memberConstants) {
                if (Object.prototype.hasOwnProperty.call(
                        memberConstants, memberConstantName)) {
                    if (Object.prototype.hasOwnProperty.call(
                            sharedConstants, memberConstantName) &&
                        sharedConstants[memberConstantName] !==
                            memberConstants[memberConstantName]) {
                        throw new SyntaxError("kernel graph constant " +
                            memberConstantName + " has conflicting values in " +
                            entryName + " and " +
                            functions[constantMemberIndex].name);
                    }
                    sharedConstants[memberConstantName] =
                        memberConstants[memberConstantName];
                }
            }
            memberDependencies.sort();
            var memberDependencyIndex = 0;
            while (memberDependencyIndex < memberDependencies.length) {
                var memberDependency =
                    memberDependencies[memberDependencyIndex++];
                addFunction(memberDependency, dependencies[memberDependency]);
            }
            constantMemberIndex++;
        }
        var entryMember = functions[0];
        var helperMembers = functions.slice(1);
        helperMembers.sort(function (left, right) {
            return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
        });
        functions = [entryMember].concat(helperMembers);
        var compiled = [];
        var index = 0;
        while (index < functions.length) {
            var memberOptions = {};
            var optionName;
            for (optionName in options) {
                if (optionName !== "source" && optionName !== "timings" &&
                    optionName !== "preparedSource" &&
                    optionName !== "registerPreferencesByFunction" &&
                    Object.prototype.hasOwnProperty.call(options, optionName)) {
                    memberOptions[optionName] = options[optionName];
                }
            }
            var memberTimings = aggregateTimings ? {} : null;
            if (memberTimings) memberOptions.timings = memberTimings;
            var member = functions[index++];
            memberOptions.kernelFunctions = signatures;
            memberOptions.constantBindings = sharedConstants;
            memberOptions.source = member.source;
            memberOptions.functionExpression = member.expression;
            memberOptions.precollectedLocalNames = member.localNames;
            if (member.name !== entryName) {
                var perFunctionPreferences =
                    options.registerPreferencesByFunction || {};
                memberOptions.registerPreferences =
                    perFunctionPreferences[member.name] || [];
            }
            try {
                compiled.push(this.compile(member.fn, memberOptions));
            } catch (error) {
                error.message = "kernel function " + member.name + ": " +
                                error.message;
                throw error;
            }
            if (aggregateTimings) {
                aggregateTimings.source += memberTimings.source || 0;
                aggregateTimings.parse += memberTimings.parse || 0;
                aggregateTimings.collect += memberTimings.collect || 0;
                aggregateTimings.lower += memberTimings.lower || 0;
            }
        }
        var graph = {kernelGraph: true, entry: entryName, functions: compiled,
                     signatures: signatures, preparation: preparation};
        inlineSmallCalls(graph);
        return graph;
    };

    /* Keep the optimization in the shared middle end. The JS backend retains
     * ordinary calls; native code uses the equivalent inline body. Eligibility
     * is structural, never name-based. Bodies may call other kernel functions,
     * but inserted bodies are not expanded again: recursive graphs stay finite.
     * Unknown native ABI calls remain outside this policy. */
    function inlineSmallCalls(graph) {
        var MAX_INLINE_NODES = 96;
        var candidates = {}, functionIndex = 0;
        var statistics = {eligibleFunctions: [], callSites: 0};
        graph.inlining = statistics;
        function inspect(node, assigned) {
            if (!node || typeof node !== "object") return 0;
            if (node.op === "call_native_i32" ||
                node.op === "call_native_f64") return MAX_INLINE_NODES + 1;
            if (node.op === "set_argument") assigned[node.index] = true;
            /* Decompilers can add braces around a single statement. Such
             * scope-free blocks must not change eligibility or snapshots. */
            var count = node instanceof Array || node.op === "block" ? 0 : 1, key;
            for (key in node) {
                if (Object.prototype.hasOwnProperty.call(node, key)) {
                    count += inspect(node[key], assigned);
                    /* Once over budget neither the exact count nor the
                     * remaining assignment set can affect eligibility.
                     * Do not traverse a giant interpreter body just to
                     * prove again that it is not a small inline candidate. */
                    if (count > MAX_INLINE_NODES) return MAX_INLINE_NODES + 1;
                }
            }
            return count;
        }
        while (functionIndex < graph.functions.length) {
            var candidate = graph.functions[functionIndex++];
            var assigned = [];
            var nodeCount = inspect(candidate.body, assigned);
            if (nodeCount <= MAX_INLINE_NODES) {
                /* Rewriting a preceding graph member can append locals and
                 * inline its callees. Keep the original eligible body and
                 * local map: otherwise the advertised one-level/node budget
                 * depends on function order and can grow transitively. */
                candidates["$" + candidate.name] = {fn: {
                    name: candidate.name, body: candidate.body,
                    locals: candidate.locals.slice(0)
                }, assigned: assigned};
                statistics.eligibleFunctions.push({name: candidate.name, nodes: nodeCount});
            }
        }
        functionIndex = 0;
        while (functionIndex < graph.functions.length) {
            var caller = graph.functions[functionIndex++];
            var site = 0;
            var rewrite = function (node, tailPosition) {
                if (!node || typeof node !== "object") return node;
                if (node instanceof Array) {
                    var array = null, arrayIndex = 0;
                    while (arrayIndex < node.length) {
                        var element = rewrite(node[arrayIndex]);
                        if (element !== node[arrayIndex]) {
                            if (!array) array = node.slice(0);
                            array[arrayIndex] = element;
                        }
                        arrayIndex++;
                    }
                    return array || node;
                }
                /* Tail calls can reuse the native frame instead. Expanding
                 * their bodies bloats error/exit paths without helping their
                 * callers retain a result for subsequent computation. */
                var inlineCandidate = node.op === "call_kernel_i32" && !tailPosition ?
                    candidates["$" + node.name] : null;
                if (inlineCandidate) {
                    var pureArguments = true, argumentIndex = 0;
                    while (argumentIndex < node.arguments.length) {
                        if (!simpleStoreOperand(node.arguments[argumentIndex++])) {
                            pureArguments = false;
                        }
                    }
                    if (pureArguments) {
                        statistics.callSites++;
                        var parameterMap = [], localMap = [], bindings = [];
                        var prefix = "$inline" + site++ + "$";
                        argumentIndex = 0;
                        while (argumentIndex < node.arguments.length) {
                            var argument = node.arguments[argumentIndex];
                            if (inlineCandidate.assigned[argumentIndex]) {
                                var parameterIndex = caller.locals.length;
                                caller.locals.push(prefix + "arg" + argumentIndex);
                                parameterMap[argumentIndex] = {op: "local_i32",
                                    index: parameterIndex, type: "i32"};
                                bindings.push({op: "set_local", index: parameterIndex,
                                    value: argument});
                            } else parameterMap[argumentIndex] = argument;
                            argumentIndex++;
                        }
                        var localIndex = 0;
                        while (localIndex < inlineCandidate.fn.locals.length) {
                            localMap[localIndex] = caller.locals.length;
                            caller.locals.push(prefix + inlineCandidate.fn.locals[localIndex++]);
                        }
                        return {op: "inline_call_i32", name: node.name,
                            arguments: node.arguments, type: "i32", bindings: bindings,
                            body: cloneInlineBody(inlineCandidate.fn.body,
                                parameterMap, localMap)};
                    }
                }
                var result = null, key;
                for (key in node) {
                    if (Object.prototype.hasOwnProperty.call(node, key)) {
                        var child = rewrite(node[key], node.op === "return" && key === "value");
                        if (child !== node[key]) {
                            if (!result) {
                                result = {};
                                var copyKey;
                                for (copyKey in node) {
                                    if (Object.prototype.hasOwnProperty.call(node, copyKey)) {
                                        result[copyKey] = node[copyKey];
                                    }
                                }
                            }
                            result[key] = child;
                        }
                    }
                }
                return result || node;
            };
            caller.body = rewrite(caller.body);
        }
    }

    function cloneInlineBody(node, parameters, locals) {
        if (!node || typeof node !== "object") return node;
        if (node instanceof Array) {
            var array = [], index = 0;
            while (index < node.length) array.push(cloneInlineBody(node[index++], parameters, locals));
            return array;
        }
        if (node.op === "arg_i32") return parameters[node.index];
        var result = {}, key;
        for (key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                result[key] = cloneInlineBody(node[key], parameters, locals);
            }
        }
        if (node.op === "local_i32" || node.op === "set_local") {
            result.index = locals[node.index];
        } else if (node.op === "set_argument") {
            result.op = "set_local";
            result.index = parameters[node.index].index;
        }
        return result;
    }

    function parseKernelFunctionSource(source, filename) {
        var parsed = new Parser("var __kernel = " + source + ";",
                                filename, {captureRaw: false,
                                    captureLocations: false,
                                    captureFunctionSource: false,
                                    compactLiterals: true});
        var program = parsed.parseProgram();
        return program.body[0].declarations[0].initial;
    }

    function kernelFunctionExpression(functionObject) {
        return parseKernelFunctionSource(functionObject.toString(),
                                         "<kernel-constants>");
    }

    function collectFunctionConstants(functionObject, overrides,
                                      parsedExpression, dependencies,
                                      signatures, dependencyNames,
                                      localNames, legacyConstantLocals) {
        var expression = parsedExpression ||
            kernelFunctionExpression(functionObject);
        var result = {};
        var seenDependencies = {};
        var seenLocals = {};
        var parameterIndex = 0;
        while (parameterIndex < expression.parameters.length) {
            seenLocals["$" + expression.parameters[parameterIndex++]] = true;
        }
        function visit(node) {
            if (!node || typeof node !== "object") return;
            if (dependencyNames && node.type === "CallExpression" &&
                node.callee && node.callee.type === "Identifier") {
                var calledName = node.callee.name;
                if (!signatures[calledName] &&
                    !seenDependencies[calledName] &&
                    Object.prototype.hasOwnProperty.call(
                        dependencies, calledName)) {
                    seenDependencies[calledName] = true;
                    dependencyNames.push(calledName);
                }
            }
            if (node.type === "VariableStatement") {
                var declarationIndex = 0;
                while (declarationIndex < node.declarations.length) {
                    var declaration = node.declarations[declarationIndex++];
                    if (legacyConstantLocals &&
                        isKernelConstantDeclaration(declaration)) {
                        result[declaration.name] =
                            Object.prototype.hasOwnProperty.call(
                                overrides, declaration.name) ?
                            overrides[declaration.name] | 0 :
                            kernelConstantValue(declaration.initial);
                    } else if (localNames &&
                               !seenLocals["$" + declaration.name]) {
                        seenLocals["$" + declaration.name] = true;
                        localNames.push(declaration.name);
                    }
                }
            }
            var key;
            for (key in node) {
                if (key !== "loc" &&
                    Object.prototype.hasOwnProperty.call(node, key)) {
                    var value = node[key];
                    if (value && typeof value === "object") {
                        if (typeof value.length === "number") {
                            var index = 0;
                            while (index < value.length) visit(value[index++]);
                        } else visit(value);
                    }
                }
            }
        }
        visit(expression.body);
        return result;
    }

    var READ_FIELD_ACCESSORS = {
        propertyDescriptorKey: "PROPERTY_DESCRIPTOR_KEY",
        propertyDescriptorAttributes: "PROPERTY_DESCRIPTOR_ATTRIBUTES",
        propertyDescriptorSetter: "PROPERTY_DESCRIPTOR_SETTER",
        recordType: "RECORD_TYPE",
        recordSize: "RECORD_SIZE",
        recordMark: "RECORD_MARK",
        recordFlags: "RECORD_FLAGS",
        objectPrototype: "OBJECT_PROTOTYPE",
        objectPropertyHead: "OBJECT_PROPERTY_HEAD",
        objectPropertyIndex: "OBJECT_PROPERTY_INDEX",
        propertyIndexHead: "PROPERTY_INDEX_HEAD",
        propertyIndexVersion: "PROPERTY_INDEX_VERSION",
        propertyIndexCount: "PROPERTY_INDEX_COUNT",
        propertyIndexCapacity: "PROPERTY_INDEX_CAPACITY",
        propertyStorageLength: "PROPERTY_STORAGE_LENGTH",
        propertyStorageCapacity: "PROPERTY_STORAGE_CAPACITY",
        propertyStorageLiveCount: "PROPERTY_STORAGE_LIVE_COUNT",
        propertyStorageHashIndex: "PROPERTY_STORAGE_HASH",
        objectExtensible: "OBJECT_EXTENSIBLE",
        arrayElements: "ARRAY_ELEMENTS",
        arrayPrototype: "ARRAY_PROTOTYPE",
        arrayPropertyHead: "ARRAY_PROPERTY_HEAD",
        arrayReserved: "ARRAY_RESERVED",
        functionClosure: "FUNCTION_CLOSURE",
        functionMetadata: "FUNCTION_METADATA",
        nativeFunctionMetadata: "NATIVE_FUNCTION_METADATA",
        functionHomeContext: "FUNCTION_HOME_CONTEXT",
        functionGCNext: "FUNCTION_GC_NEXT",
        environmentParent: "ENVIRONMENT_PARENT",
        environmentCount: "ENVIRONMENT_COUNT",
        environmentProgram: "ENVIRONMENT_PROGRAM",
        environmentObject: "ENVIRONMENT_RESERVED",
        regexpPattern: "REGEXP_PATTERN",
        regexpFlags: "REGEXP_FLAGS",
        regexpPrototype: "REGEXP_PROTOTYPE",
        regexpPropertyHead: "REGEXP_PROPERTY_HEAD",
        bufferViewBacking: "BUFFER_VIEW_BACKING",
        bufferViewOffset: "BUFFER_VIEW_OFFSET",
        bufferViewLength: "BUFFER_VIEW_LENGTH",
        bufferViewKind: "BUFFER_VIEW_KIND",
        bufferViewPrototype: "BUFFER_VIEW_PROTOTYPE",
        bufferViewPropertyHead: "BUFFER_VIEW_PROPERTY_HEAD",
        bufferBackingPointer: "BUFFER_BACKING_POINTER",
        bufferBackingMetadata: "BUFFER_BACKING_METADATA",
        vectorCapacity: "VECTOR_CAPACITY",
        frameProgram: "FRAME_PROGRAM",
        frameEnvironment: "FRAME_ENVIRONMENT",
        frameCaller: "FRAME_CALLER",
        frameSavedPC: "FRAME_PC",
        frameReturnSlot: "FRAME_RETURN_SLOT",
        frameRegisterCount: "FRAME_REGISTER_COUNT",
        frameHandler: "FRAME_HANDLER",
        frameContext: "FRAME_CONTEXT",
        programBytecode: "PROGRAM_BYTECODE",
        programConstants: "PROGRAM_CONSTANTS",
        programConstantRegisters: "PROGRAM_CONSTANT_REGISTERS",
        programBindingRegisters: "PROGRAM_BINDING_REGISTERS",
        programBindingCount: "PROGRAM_BINDING_COUNT",
        programSource: "PROGRAM_SOURCE",
        programParameterSlots: "PROGRAM_PARAMETER_SLOTS",
        programRegisterCount: "PROGRAM_REGISTER_COUNT",
        programArgumentsSlot: "PROGRAM_ARGUMENTS_SLOT",
        programThisSlot: "PROGRAM_THIS_SLOT",
        programFunctionNameSlot: "PROGRAM_FUNCTION_NAME_SLOT",
        programFlags: "PROGRAM_FLAGS",
        bytecodeLength: "BYTECODE_LENGTH",
        bytecodeExecutionCache: "BYTECODE_EXECUTION_CACHE",
        contextGlobal: "CONTEXT_GLOBAL",
        contextActiveFrame: "CONTEXT_ACTIVE_FRAME",
        contextNext: "CONTEXT_NEXT",
        handlerNext: "HANDLER_NEXT",
        handlerTarget: "HANDLER_TARGET",
        handlerBindingSlot: "HANDLER_BINDING_SLOT",
        handlerEnvironment: "HANDLER_RESERVED",
        engineCurrentFrame: "ENGINE_CURRENT_FRAME",
        engineRecordCurrentFrame: "ENGINE_RECORD_CURRENT_FRAME",
        engineFreeFrame: "ENGINE_FREE_FRAME",
        engineScratchLeft: "ENGINE_SCRATCH_LEFT",
        engineScratchRight: "ENGINE_SCRATCH_RIGHT",
        valueCellTag: "VALUE_CELL_TAG",
        valueCellReference: "VALUE_CELL_REFERENCE",
        valueCellInt32: "VALUE_CELL_INT32",
        valueCellDoubleHigh: "VALUE_CELL_HIGH",
        valueCellDoubleLow: "VALUE_CELL_LOW",
        stringLength: "STRING_LENGTH",
        stringHash: "STRING_HASH",
        stringRopeLeft: "STRING_ROPE_LEFT",
        stringSliceBacking: "STRING_SLICE_BACKING",
        stringSliceStart: "STRING_SLICE_START",
        stringRopeRight: "STRING_ROPE_RIGHT",
        stringRopeDepth: "STRING_ROPE_DEPTH",
        vectorLength: "VECTOR_LENGTH",
        integerVectorLength: "VECTOR_LENGTH",
        vectorCapacity: "VECTOR_CAPACITY",
        objectPropertyHead: "OBJECT_PROPERTY_HEAD",
        regexpPropertyHead: "REGEXP_PROPERTY_HEAD",
        bufferViewPropertyHead: "BUFFER_VIEW_PROPERTY_HEAD",
        propertyNext: "PROPERTY_NEXT",
        propertyKey: "PROPERTY_KEY",
        propertyAttributes: "PROPERTY_ATTRIBUTES",
        propertySetter: "PROPERTY_SETTER",
        propertyValueTag: "PROPERTY_VALUE",
        propertyValueReference: "PROPERTY_VALUE_REFERENCE",
        engineHeapBump: "ENGINE_HEAP_BUMP",
        engineHeapLimit: "ENGINE_HEAP_LIMIT",
        engineInstructions: "ENGINE_INSTRUCTIONS",
        engineResult: "ENGINE_RESULT",
        engineCallRejectReason: "ENGINE_CALL_REJECT_REASON",
        engineNativeRegionEnd: "ENGINE_NATIVE_REGION_END",
        engineNativeFreeRegion: "ENGINE_NATIVE_FREE_REGION",
        engineNativeTailBump: "ENGINE_NATIVE_TAIL_BUMP",
        engineNativeTailLimit: "ENGINE_NATIVE_TAIL_LIMIT",
        engineNativeMaximumLimit: "ENGINE_NATIVE_MAX_LIMIT",
        engineNativeRegionActive: "ENGINE_NATIVE_REGION_ACTIVE",
        engineAllocationFailed: "ENGINE_ALLOCATION_FAILED",
        engineNativeRetiredRegion: "ENGINE_NATIVE_RETIRED_REGION",
        engineGCGeneration: "ENGINE_GC_GENERATION",
        engineGCStackBase: "ENGINE_GC_STACK_BASE",
        engineGCStackLimit: "ENGINE_GC_STACK_LIMIT",
        engineGCCollections: "ENGINE_GC_COLLECTIONS",
        engineGCMarkMicroseconds: "ENGINE_GC_MARK_US",
        engineGCSweepMicroseconds: "ENGINE_GC_SWEEP_US",
        engineGCIndexMicroseconds: "ENGINE_GC_INDEX_US",
        engineGCTotalMicroseconds: "ENGINE_GC_TOTAL_US",
        engineGCMaximumPauseMicroseconds: "ENGINE_GC_MAX_PAUSE_US",
        engineGCLiveBytes: "ENGINE_GC_LIVE_BYTES",
        engineGCStressInterval: "ENGINE_GC_STRESS_INTERVAL",
        engineGCStressRemaining: "ENGINE_GC_STRESS_REMAINING",
        engineGCRoot: "ENGINE_GC_ROOT",
        engineGCContextHead: "ENGINE_GC_CONTEXT_HEAD",
        engineGCNativeFunctionHead: "ENGINE_GC_NATIVE_FUNCTION_HEAD",
        engineGCRootSlotHead: "ENGINE_GC_ROOT_SLOT_HEAD",
        rootSlotNext: "ROOT_SLOT_NEXT",
        enginePlatformServices: "ENGINE_PLATFORM_SERVICES",
        engineClockSeconds: "ENGINE_CLOCK_SECONDS",
        engineClockMicroseconds: "ENGINE_CLOCK_MICROSECONDS",
        engineRecordPlatformServices: "ENGINE_RECORD_PLATFORM_SERVICES",
        platformDlsymPointer: "PLATFORM_DLSYM_POINTER",
        platformArraySlicePointer: "PLATFORM_ARRAY_SLICE_POINTER",
        platformArrayConcatPointer: "PLATFORM_ARRAY_CONCAT_POINTER",
        platformGettimeofdayPointer: "PLATFORM_GETTIMEOFDAY_POINTER",
        platformDateIntrinsicPointer: "PLATFORM_DATE_INTRINSIC_POINTER",
        platformNumericPropertyPointer: "PLATFORM_NUMERIC_PROPERTY_POINTER",
        platformStrtodPointer: "PLATFORM_STRTOD_POINTER",
        platformMallocPointer: "PLATFORM_MALLOC_POINTER",
        platformFreePointer: "PLATFORM_FREE_POINTER",
        platformSnprintfPointer: "PLATFORM_SNPRINTF_POINTER",
        platformMemsetPointer: "PLATFORM_MEMSET_POINTER"
    };

    var WRITE_FIELD_ACCESSORS = {
        setFreeRecordNext: "RECORD_MARK",
        setPropertyDescriptorKey: "PROPERTY_DESCRIPTOR_KEY",
        setPropertyDescriptorAttributes: "PROPERTY_DESCRIPTOR_ATTRIBUTES",
        setPropertyDescriptorSetter: "PROPERTY_DESCRIPTOR_SETTER",
        setPropertyStorageLength: "PROPERTY_STORAGE_LENGTH",
        setPropertyStorageCapacity: "PROPERTY_STORAGE_CAPACITY",
        setPropertyStorageLiveCount: "PROPERTY_STORAGE_LIVE_COUNT",
        setPropertyStorageHashIndex: "PROPERTY_STORAGE_HASH",
        setValueCellTag: "VALUE_CELL_TAG",
        setVectorLength: "VECTOR_LENGTH",
        setRecordType: "RECORD_TYPE",
        setRecordSize: "RECORD_SIZE",
        setRecordMark: "RECORD_MARK",
        setRecordFlags: "RECORD_FLAGS",
        setObjectPrototype: "OBJECT_PROTOTYPE",
        setEnvironmentParent: "ENVIRONMENT_PARENT",
        setEnvironmentCount: "ENVIRONMENT_COUNT",
        setEnvironmentProgram: "ENVIRONMENT_PROGRAM",
        setEnvironmentReserved: "ENVIRONMENT_RESERVED",
        setFunctionClosure: "FUNCTION_CLOSURE",
        setFunctionMetadata: "FUNCTION_METADATA",
        setFunctionHomeContext: "FUNCTION_HOME_CONTEXT",
        setStringLength: "STRING_LENGTH",
        setStringHash: "STRING_HASH",
        setStringRopeLeft: "STRING_ROPE_LEFT",
        setStringSliceBacking: "STRING_SLICE_BACKING",
        setStringSliceStart: "STRING_SLICE_START",
        setStringRopeRight: "STRING_ROPE_RIGHT",
        setStringRopeDepth: "STRING_ROPE_DEPTH",
        setArrayPrototype: "ARRAY_PROTOTYPE",
        setArrayPropertyHead: "ARRAY_PROPERTY_HEAD",
        setArrayElements: "ARRAY_ELEMENTS",
        setArrayReserved: "ARRAY_RESERVED",
        setObjectPropertyHead: "OBJECT_PROPERTY_HEAD",
        setObjectPropertyIndex: "OBJECT_PROPERTY_INDEX",
        setPropertyIndexHead: "PROPERTY_INDEX_HEAD",
        setPropertyIndexVersion: "PROPERTY_INDEX_VERSION",
        setPropertyIndexCount: "PROPERTY_INDEX_COUNT",
        setPropertyIndexCapacity: "PROPERTY_INDEX_CAPACITY",
        setObjectExtensible: "OBJECT_EXTENSIBLE",
        setObjectReserved: "OBJECT_RESERVED",
        setRegexpPattern: "REGEXP_PATTERN",
        setRegexpFlags: "REGEXP_FLAGS",
        setRegexpPrototype: "REGEXP_PROTOTYPE",
        setRegexpPropertyHead: "REGEXP_PROPERTY_HEAD",
        setBufferViewBacking: "BUFFER_VIEW_BACKING",
        setBufferViewOffset: "BUFFER_VIEW_OFFSET",
        setBufferViewLength: "BUFFER_VIEW_LENGTH",
        setBufferViewKind: "BUFFER_VIEW_KIND",
        setBufferViewPrototype: "BUFFER_VIEW_PROTOTYPE",
        setBufferViewPropertyHead: "BUFFER_VIEW_PROPERTY_HEAD",
        setBufferBackingPointer: "BUFFER_BACKING_POINTER",
        setBufferBackingLength: "BUFFER_BACKING_LENGTH",
        setBufferBackingMetadata: "BUFFER_BACKING_METADATA",
        setPropertyNext: "PROPERTY_NEXT",
        setPropertyKey: "PROPERTY_KEY",
        setPropertyAttributes: "PROPERTY_ATTRIBUTES",
        setPropertySetter: "PROPERTY_SETTER",
        setPropertyReserved: "PROPERTY_RESERVED",
        setFrameHandler: "FRAME_HANDLER",
        setFrameProgram: "FRAME_PROGRAM",
        setFrameEnvironment: "FRAME_ENVIRONMENT",
        setFrameCaller: "FRAME_CALLER",
        setHandlerNext: "HANDLER_NEXT",
        setHandlerTarget: "HANDLER_TARGET",
        setHandlerBindingSlot: "HANDLER_BINDING_SLOT",
        setHandlerReserved: "HANDLER_RESERVED",
        setFramePC: "FRAME_PC",
        setFrameReturnSlot: "FRAME_RETURN_SLOT",
        setFrameRegisterCount: "FRAME_REGISTER_COUNT",
        setFrameContext: "FRAME_CONTEXT",
        setContextActiveFrame: "CONTEXT_ACTIVE_FRAME",
        setVectorCapacity: "VECTOR_CAPACITY",
        setBytecodeLength: "BYTECODE_LENGTH",
        setBytecodeExecutionCache: "BYTECODE_EXECUTION_CACHE",
        setProgramBytecode: "PROGRAM_BYTECODE",
        setProgramConstants: "PROGRAM_CONSTANTS",
        setProgramConstantRegisters: "PROGRAM_CONSTANT_REGISTERS",
        setProgramBindingRegisters: "PROGRAM_BINDING_REGISTERS",
        setProgramParameterSlots: "PROGRAM_PARAMETER_SLOTS",
        setProgramRegisterCount: "PROGRAM_REGISTER_COUNT",
        setProgramArgumentsSlot: "PROGRAM_ARGUMENTS_SLOT",
        setProgramThisSlot: "PROGRAM_THIS_SLOT",
        setProgramFunctionNameSlot: "PROGRAM_FUNCTION_NAME_SLOT",
        setProgramMetadata: "PROGRAM_METADATA",
        setProgramFlags: "PROGRAM_FLAGS",
        setProgramBindingCount: "PROGRAM_BINDING_COUNT",
        setProgramSource: "PROGRAM_SOURCE",
        setEngineExitReason: "ENGINE_EXIT_REASON",
        setEnginePC: "ENGINE_PC",
        setEngineResult: "ENGINE_RESULT",
        setEngineInstructions: "ENGINE_INSTRUCTIONS",
        setEngineCallRejectReason: "ENGINE_CALL_REJECT_REASON",
        setEngineCurrentFrame: "ENGINE_CURRENT_FRAME",
        setEngineFreeFrame: "ENGINE_FREE_FRAME",
        setEngineScratchLeft: "ENGINE_SCRATCH_LEFT",
        setEngineScratchRight: "ENGINE_SCRATCH_RIGHT",
        setEngineHeapBump: "ENGINE_HEAP_BUMP",
        setEngineHeapLimit: "ENGINE_HEAP_LIMIT",
        setEngineNativeRegionEnd: "ENGINE_NATIVE_REGION_END",
        setEngineNativeFreeRegion: "ENGINE_NATIVE_FREE_REGION",
        setEngineNativeTailBump: "ENGINE_NATIVE_TAIL_BUMP",
        setEngineNativeTailLimit: "ENGINE_NATIVE_TAIL_LIMIT",
        setEngineNativeRegionActive: "ENGINE_NATIVE_REGION_ACTIVE",
        setEngineAllocationFailed: "ENGINE_ALLOCATION_FAILED",
        setEngineNativeRetiredRegion: "ENGINE_NATIVE_RETIRED_REGION",
        setEngineGCGeneration: "ENGINE_GC_GENERATION",
        setEngineGCCollections: "ENGINE_GC_COLLECTIONS",
        setEngineGCMarkMicroseconds: "ENGINE_GC_MARK_US",
        setEngineGCSweepMicroseconds: "ENGINE_GC_SWEEP_US",
        setEngineGCIndexMicroseconds: "ENGINE_GC_INDEX_US",
        setEngineGCTotalMicroseconds: "ENGINE_GC_TOTAL_US",
        setEngineGCMaximumPauseMicroseconds: "ENGINE_GC_MAX_PAUSE_US",
        setEngineGCLiveBytes: "ENGINE_GC_LIVE_BYTES",
        setEngineGCStressInterval: "ENGINE_GC_STRESS_INTERVAL",
        setEngineGCStressRemaining: "ENGINE_GC_STRESS_REMAINING"
    };

    var INDEXED_ADDRESS_ACCESSORS = {
        propertyStorageDescriptorAt: {field: "PROPERTY_STORAGE_KEY", stride: "PROPERTY_STORAGE_ENTRY_BYTES"},
        propertyStorageValueCellAt: {field: "PROPERTY_STORAGE_VALUE", stride: "PROPERTY_STORAGE_ENTRY_BYTES"},
        valueCellAddress: {fieldValue: 0, stride: "VALUE_CELL_BYTES"},
        bytecodeRegisterCellAddress: {fieldValue: 0, stride: "BYTECODE_REGISTER_SCALE"},
        vectorCellAddress: {field: "VECTOR_CELLS",
                            stride: "VALUE_CELL_BYTES"},
        frameRegisterCellAddress: {field: "FRAME_REGISTERS",
                                   stride: "VALUE_CELL_BYTES"},
        environmentCellAddress: {field: "ENVIRONMENT_CELLS",
                                 stride: "VALUE_CELL_BYTES"},
        bytecodeWordAddress: {field: "BYTECODE_WORDS", strideValue: 4}
    };

    var READ_INDEXED_FIELD_ACCESSORS = {
        integerVectorValue: {field: "VECTOR_CELLS", stride: "HEAP_WORD_BYTES"},
        propertyStorageKeyAt: {field: "PROPERTY_STORAGE_KEY", stride: "PROPERTY_STORAGE_ENTRY_BYTES"},
        propertyStorageAttributesAt: {field: "PROPERTY_STORAGE_ATTRIBUTES", stride: "PROPERTY_STORAGE_ENTRY_BYTES"},
        propertyStorageSetterAt: {field: "PROPERTY_STORAGE_SETTER", stride: "PROPERTY_STORAGE_ENTRY_BYTES"},
        propertyIndexSlot: {field: "PROPERTY_INDEX_SLOTS", stride: "HEAP_WORD_BYTES"},
        /* The interpreter caches the payload offset, not its record header. */
        bytecodePayloadWord: {fieldValue: 0, strideValue: 4},
        propertyCacheObject: {field: "ENGINE_PROPERTY_CACHE_OBJECT",
                              stride: "PROPERTY_CACHE_ENTRY_BYTES"},
        propertyCacheKey: {field: "ENGINE_PROPERTY_CACHE_KEY",
                           stride: "PROPERTY_CACHE_ENTRY_BYTES"},
        propertyCacheVersion: {field: "ENGINE_PROPERTY_CACHE_VERSION",
                               stride: "PROPERTY_CACHE_ENTRY_BYTES"},
        propertyCacheGeneration: {field: "ENGINE_PROPERTY_CACHE_GENERATION",
                                  stride: "PROPERTY_CACHE_ENTRY_BYTES"},
        propertyCacheHead: {field: "ENGINE_PROPERTY_CACHE_HEAD",
                            stride: "PROPERTY_CACHE_ENTRY_BYTES"},
        propertyCacheProperty: {field: "ENGINE_PROPERTY_CACHE_PROPERTY",
                                stride: "PROPERTY_CACHE_ENTRY_BYTES"}
    };

    var WRITE_INDEXED_FIELD_ACCESSORS = {
        setIntegerVectorValue: READ_INDEXED_FIELD_ACCESSORS.integerVectorValue,
        setRecordPayloadWord: {field: "HEAP_HEADER_BYTES", stride: "HEAP_WORD_BYTES"},
        setPropertyStorageKeyAt: READ_INDEXED_FIELD_ACCESSORS.propertyStorageKeyAt,
        setPropertyStorageAttributesAt: READ_INDEXED_FIELD_ACCESSORS.propertyStorageAttributesAt,
        setPropertyStorageSetterAt: READ_INDEXED_FIELD_ACCESSORS.propertyStorageSetterAt,
        setPropertyStoragePaddingAt: {field: "PROPERTY_STORAGE_PADDING", stride: "PROPERTY_STORAGE_ENTRY_BYTES"},
        setPropertyIndexSlot: READ_INDEXED_FIELD_ACCESSORS.propertyIndexSlot,
        setPropertyCacheObject: READ_INDEXED_FIELD_ACCESSORS.propertyCacheObject,
        setPropertyCacheKey: READ_INDEXED_FIELD_ACCESSORS.propertyCacheKey,
        setPropertyCacheVersion: READ_INDEXED_FIELD_ACCESSORS.propertyCacheVersion,
        setPropertyCacheGeneration:
            READ_INDEXED_FIELD_ACCESSORS.propertyCacheGeneration,
        setPropertyCacheHead: READ_INDEXED_FIELD_ACCESSORS.propertyCacheHead,
        setPropertyCacheProperty:
            READ_INDEXED_FIELD_ACCESSORS.propertyCacheProperty
    };

    var FIELD_ADDRESS_ACCESSORS = {
        legacyPropertyDescriptorAddress: "PROPERTY_KEY",
        propertyDescriptorValueCell: "PROPERTY_DESCRIPTOR_VALUE",
        recordPayloadAddress: "HEAP_HEADER_BYTES",
        propertyIndexSlotsAddress: "PROPERTY_INDEX_SLOTS",
        valueCellPayloadAddress: "VALUE_CELL_LOW",
        engineScratchLeftAddress: "ENGINE_SCRATCH_LEFT",
        engineScratchRightAddress: "ENGINE_SCRATCH_RIGHT",
        propertyValueCellAddress: "PROPERTY_VALUE"
    };

    KernelCompiler.prototype.compile = function (functionObject, options) {
        if (typeof functionObject !== "function") {
            throw new TypeError("kernel compiler requires a function");
        }
        options = options || {};
        validateConstantOptions(options);
        var timings = options.timings || null;
        var started = timings ? new Date().getTime() : 0;
        var source = options.source === undefined ?
            functionObject.toString() : String(options.source);
        if (timings) timings.source = new Date().getTime() - started;
        var fn = options.functionExpression || null;
        var parseStarted = timings ? new Date().getTime() : 0;
        if (!fn) fn = parseKernelFunctionSource(source, "<kernel>");
        if (timings) timings.parse = new Date().getTime() - parseStarted;
        if (!fn || fn.type !== "FunctionExpression") {
            throw new SyntaxError("kernel source must contain one function");
        }
        if (needsControlFlow(fn.body.body) || options.kernelFunctions ||
            options.constantBindings) {
            return compileControlFlow(fn, source, options, timings);
        }
        var locals = {};
        var parameterIndex = 0;
        while (parameterIndex < fn.parameters.length) {
            locals["$" + fn.parameters[parameterIndex]] = parameterIndex;
            parameterIndex++;
        }
        var instructions = [];
        var resultExpression = null;
        var statementIndex = 0;
        while (statementIndex < fn.body.body.length) {
            var statement = fn.body.body[statementIndex++];
            if (statement.type === "ExpressionStatement" &&
                statement.expression.type === "CallExpression" &&
                statement.expression.callee.type === "Identifier" &&
                statement.expression.callee.name === "store32" &&
                statement.expression.arguments.length === 2) {
                instructions.push({op: "store_u32",
                    address: lower(statement.expression.arguments[0], locals),
                    value: lower(statement.expression.arguments[1], locals)});
            } else if (statement.type === "ExpressionStatement" &&
                statement.expression.type === "CallExpression" &&
                statement.expression.callee.type === "Identifier" &&
                statement.expression.callee.name === "storeF64" &&
                statement.expression.arguments.length === 2) {
                instructions.push({op: "store_f64",
                    address: lower(statement.expression.arguments[0], locals),
                    value: lowerF64(statement.expression.arguments[1], locals)});
            } else if (statement.type === "ReturnStatement" &&
                       statement.argument !== null &&
                       statementIndex === fn.body.body.length) {
                resultExpression = lower(statement.argument, locals);
            } else throw new SyntaxError("unsupported kernel statement " + statement.type);
        }
        if (!resultExpression) throw new SyntaxError("kernel function must return a value");
        return {name: fn.name || "kernel", parameters: fn.parameters.slice(0),
                resultType: "i32", instructions: instructions,
                expression: resultExpression,
                source: source};
    };

    function needsControlFlow(statements) {
        var index = 0;
        while (index < statements.length) {
            var statement = statements[index++];
            if (statement.type === "VariableStatement" ||
                statement.type === "IfStatement" ||
                statement.type === "WhileStatement" ||
                statement.type === "ForStatement" ||
                statement.type === "BlockStatement") return true;
            if (statement.type === "ExpressionStatement" &&
                (statement.expression.type === "AssignmentExpression" ||
                 statement.expression.type === "UpdateExpression")) return true;
            if (statement.type === "ReturnStatement" &&
                containsShortCircuit(statement.argument)) return true;
            if (statement.type === "ExpressionStatement" &&
                containsShortCircuit(statement.expression)) return true;
        }
        return false;
    }

    function containsShortCircuit(node) {
        if (!node || typeof node !== "object") return false;
        if (node.type === "BinaryExpression" &&
            (node.operator === "&&" || node.operator === "||")) return true;
        var key;
        for (key in node) {
            if (key !== "loc" && Object.prototype.hasOwnProperty.call(node, key) &&
                containsShortCircuit(node[key])) return true;
        }
        return false;
    }

    function compileControlFlow(fn, source, options, timings) {
        var symbols = {};
        var constantBindings = options.constantBindings || {};
        var constantName;
        for (constantName in constantBindings) {
            if (Object.prototype.hasOwnProperty.call(
                    constantBindings, constantName)) {
                symbols["$" + constantName] = {
                    kind: "constant", value: constantBindings[constantName]
                };
            }
        }
        var parameterIndex = 0;
        while (parameterIndex < fn.parameters.length) {
            symbols["$" + fn.parameters[parameterIndex]] =
                {kind: "argument", index: parameterIndex};
            parameterIndex++;
        }
        var localNames = [];
        var collectStarted = timings ? new Date().getTime() : 0;
        if (options.precollectedLocalNames) {
            var precollectedIndex = 0;
            while (precollectedIndex <
                    options.precollectedLocalNames.length) {
                var precollectedName =
                    options.precollectedLocalNames[precollectedIndex++];
                var existing = symbolAt(symbols, precollectedName);
                if (existing === undefined ||
                    (!options.legacyConstantLocals &&
                     existing.kind === "constant")) {
                    symbols["$" + precollectedName] = {
                        kind: "local", index: localNames.length
                    };
                    localNames.push(precollectedName);
                }
            }
        } else {
            collectLocals(fn.body, symbols, localNames,
                          options.constantOverrides || {},
                          options.legacyConstantLocals === true);
        }
        symbols.$kernelFunctions = options.kernelFunctions || null;
        symbols.$kernelFunctionName = fn.name || "kernel";
        if (timings) timings.collect = new Date().getTime() - collectStarted;
        var lowerStarted = timings ? new Date().getTime() : 0;
        /* Validate/lower both branches first. Configuration constants must
         * not make unsupported source syntax disappear from validation. */
        var body = combineStoreRuns(pruneConstantBranches(
            lowerStatements(fn.body.body, symbols)));
        if (timings) timings.lower = new Date().getTime() - lowerStarted;
        var registerPreferences = resolveRegisterPreferences(
            options.registerPreferences || [], symbols);
        var ir = {name: fn.name || "kernel", parameters: fn.parameters.slice(0),
                locals: localNames, resultType: "i32", body: body,
                controlFlow: true, source: source,
                registerPreferences: registerPreferences};
        forwardSingleUseLocals(ir);
        return ir;
    }

    /* Kernel blocks have function-scoped var bindings, already collected
     * above. Flattening their statement lists does not change scope. Prune
     * before use counting/inlining, rather than waiting for native emission,
     * so disabled diagnostics do not inhibit ordinary dataflow analysis. */
    function pruneConstantBranches(body) {
        var output = [], index = 0;
        while (index < body.length) {
            var statement = body[index++];
            if (statement.op === "if") {
                if (statement.test.op === "const_i32") {
                    var selected = statement.test.value ?
                        statement.consequent : statement.alternate;
                    statement = {op: "block", body: selected ? [selected] : []};
                } else {
                    statement.consequent = {op: "block", body:
                        pruneConstantBranches([statement.consequent])};
                    statement.alternate = {op: "block", body:
                        statement.alternate ? pruneConstantBranches([statement.alternate]) : []};
                }
            }
            if (statement.op === "block") {
                var nested = pruneConstantBranches(statement.body), nestedIndex = 0;
                while (nestedIndex < nested.length) output.push(nested[nestedIndex++]);
            } else {
                if (statement.op === "while" || statement.op === "opcode_dispatch") {
                    statement.body = {op: "block", body: pruneConstantBranches([statement.body])};
                }
                output.push(statement);
            }
        }
        return output;
    }

    /* Forward single-definition/single-use temporaries through straight-line
     * runs of side-effect-free assignments. This removes stack traffic for
     * decoded operand indices without changing the kernel source dialect.
     * Memory writes, calls and control-flow boundaries stop forwarding. */
    function forwardSingleUseLocals(ir) {
        var definitions = [], uses = [], eliminated = 0;
        function count(node) {
            if (!node || typeof node !== "object") return;
            if (node.op === "local_i32") {
                uses[node.index] = (uses[node.index] || 0) + 1;
                return;
            }
            if (node.op === "set_local") {
                definitions[node.index] = (definitions[node.index] || 0) + 1;
            }
            var key;
            for (key in node) {
                if (Object.prototype.hasOwnProperty.call(node, key)) count(node[key]);
            }
        }
        function movable(node) {
            if (!node) return false;
            if (node.op === "const_i32" || node.op === "local_i32" ||
                node.op === "arg_i32") return true;
            if (node.op === "load_u32" || node.op === "load_u8") return movable(node.address);
            if (node.op === "neg_i32" || node.op === "not_i32" ||
                node.op === "as_i32") return movable(node.value);
            if (node.op === "add_i32" || node.op === "sub_i32" ||
                node.op === "mul_i32" || node.op === "and_i32" ||
                node.op === "or_i32" || node.op === "xor_i32" ||
                node.op === "shl_i32" || node.op === "shr_i32" ||
                node.op === "ushr_i32") {
                return movable(node.left) && movable(node.right);
            }
            return false;
        }
        function dependencies(node, result) {
            if (!node || typeof node !== "object") return;
            if (node.op === "local_i32") result[node.index] = true;
            var key;
            for (key in node) {
                if (Object.prototype.hasOwnProperty.call(node, key)) {
                    dependencies(node[key], result);
                }
            }
        }
        function list(body) {
            var result = [], pending = {}, index = 0;
            function substitute(node) {
                if (!node || typeof node !== "object") return node;
                if (node.op === "local_i32" && pending[node.index]) {
                    var definition = pending[node.index];
                    delete pending[node.index];
                    result[definition.position] = null;
                    eliminated++;
                    return definition.value;
                }
                var changed = null, key;
                for (key in node) {
                    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
                    var child = substitute(node[key]);
                    if (child !== node[key]) {
                        if (!changed) {
                            changed = {};
                            var field;
                            for (field in node) {
                                if (Object.prototype.hasOwnProperty.call(node, field)) {
                                    changed[field] = node[field];
                                }
                            }
                        }
                        changed[key] = child;
                    }
                }
                return changed || node;
            }
            while (index < body.length) {
                var statement = body[index++];
                visit(statement);
                if (statement.op !== "set_local" || !movable(statement.value)) {
                    /* Consume an address/value before the boundary's first
                     * effect, but never forward through the effect itself.
                     * store_fields values must remain simple operands: its
                     * emitter reserves scratch registers while writing them. */
                    if ((statement.op === "copy_words" &&
                         movable(statement.target) && movable(statement.source)) ||
                        ((statement.op === "store_u32" || statement.op === "store_u8" ||
                          statement.op === "store_raw_u32" || statement.op === "store_raw_u8") &&
                         movable(statement.address) && movable(statement.value)) ||
                        (statement.op === "return" && movable(statement.value))) {
                        statement = substitute(statement);
                    } else if (statement.op === "store_fields" && movable(statement.base)) {
                        statement = {op: statement.op, base: substitute(statement.base),
                            offsets: statement.offsets, values: statement.values};
                    }
                    pending = {};
                    result.push(statement);
                    continue;
                }
                var value = substitute(statement.value);
                var key;
                for (key in pending) {
                    if (pending[key].dependencies[statement.index]) delete pending[key];
                }
                var position = result.length;
                result.push({op: "set_local", index: statement.index, value: value});
                if (definitions[statement.index] === 1 && uses[statement.index] === 1) {
                    var inputs = {};
                    dependencies(value, inputs);
                    pending[statement.index] = {position: position, value: value,
                        dependencies: inputs};
                }
            }
            var compact = [];
            for (index = 0; index < result.length; index++) {
                if (result[index]) compact.push(result[index]);
            }
            return compact;
        }
        function visit(node) {
            if (!node) return;
            if (node.op === "block") node.body = list(node.body);
            else if (node.op === "if") {
                visit(node.consequent);
                visit(node.alternate);
            } else if (node.op === "while" || node.op === "opcode_dispatch") {
                visit(node.body);
            }
        }
        count(ir.body);
        ir.body = list(ir.body);
        ir.localForwarding = {eliminatedAssignments: eliminated};
    }

    function symbolAt(symbols, name) {
        var key = "$" + name;
        /* Symbol keys are always prefixed with '$', so none can alias an
         * Object.prototype member. Direct lookup is both sufficient and
         * available while the guest compiler is running without host calls. */
        return symbols[key];
    }

    function simpleStoreOperand(node) {
        return node.op === "const_i32" || node.op === "local_i32" ||
            node.op === "arg_i32";
    }

    function storeAddressParts(node) {
        var offset = 0;
        while (node.op === "add_i32" && node.right.op === "const_i32") {
            offset = (offset + node.right.value) | 0;
            node = node.left;
        }
        if (node.op !== "local_i32" && node.op !== "arg_i32") return null;
        return {base: node, offset: offset};
    }

    /* A basic-block optimization, independent of value-cell layouts. Adjacent
     * writes through one unchanged pointer can share its address calculation.
     * Only literal/local/argument values qualify: no loads, calls, conversions,
     * or other side effects can be reordered or observe intermediate writes. */
    function combineStoreRuns(body) {
        var result = [], index = 0;
        while (index < body.length) {
            var statement = body[index];
            if (statement.op === "block" || statement.op === "while" ||
                statement.op === "opcode_dispatch") {
                if (statement.body instanceof Array) {
                    statement.body = combineStoreRuns(statement.body);
                } else if (statement.body && statement.body.op === "block") {
                    statement.body.body = combineStoreRuns(statement.body.body);
                }
            } else if (statement.op === "if") {
                if (statement.consequent) statement.consequent =
                    combineStoreRuns([statement.consequent])[0];
                if (statement.alternate) statement.alternate =
                    combineStoreRuns([statement.alternate])[0];
            }
            var first = statement.op === "store_u32" &&
                simpleStoreOperand(statement.value) ?
                storeAddressParts(statement.address) : null;
            if (first) {
                var offsets = [first.offset], values = [statement.value];
                var next = index + 1;
                while (next < body.length) {
                    var candidate = body[next];
                    if (candidate.op !== "store_u32" ||
                        !simpleStoreOperand(candidate.value)) break;
                    var address = storeAddressParts(candidate.address);
                    if (!address || address.base.op !== first.base.op ||
                        address.base.index !== first.base.index) break;
                    offsets.push(address.offset);
                    values.push(candidate.value);
                    next++;
                }
                if (values.length > 1) {
                    result.push({op: "store_fields", base: first.base,
                        offsets: offsets, values: values});
                    index = next;
                    continue;
                }
            }
            result.push(statement);
            index++;
        }
        return result;
    }

    function resolveRegisterPreferences(names, symbols) {
        var preferences = [];
        var index = 0;
        while (index < names.length) {
            var name = names[index++];
            var symbol = symbolAt(symbols, name);
            if (!symbol || symbol.kind === "constant") {
                throw new SyntaxError("unknown kernel register preference " + name);
            }
            preferences.push(symbol.kind + ":" + symbol.index);
        }
        return preferences;
    }

    function collectLocals(node, symbols, names, constantOverrides,
                           legacyConstantLocals) {
        if (!node || typeof node !== "object") return;
        if (node.type === "VariableStatement") {
            var declarationIndex = 0;
            while (declarationIndex < node.declarations.length) {
                var declaration = node.declarations[declarationIndex++];
                var name = declaration.name;
                var existing = symbolAt(symbols, name);
                if (existing === undefined ||
                    (!legacyConstantLocals && existing.kind === "constant")) {
                    if (legacyConstantLocals &&
                        isKernelConstantDeclaration(declaration)) {
                        symbols["$" + name] = {
                            kind: "constant",
                            value: Object.prototype.hasOwnProperty.call(
                                constantOverrides, name) ?
                                constantOverrides[name] | 0 :
                                kernelConstantValue(declaration.initial)
                        };
                    } else {
                        symbols["$" + name] = {kind: "local", index: names.length};
                        names.push(name);
                    }
                }
            }
        }
        var key;
        for (key in node) {
            if (key !== "loc" && Object.prototype.hasOwnProperty.call(node, key)) {
                var value = node[key];
                if (value && typeof value === "object") {
                    if (typeof value.length === "number") {
                        var index = 0;
                        while (index < value.length) {
                            collectLocals(value[index++], symbols, names,
                                          constantOverrides, legacyConstantLocals);
                        }
                    } else collectLocals(value, symbols, names,
                                         constantOverrides, legacyConstantLocals);
                }
            }
        }
    }

    function isKernelConstantDeclaration(declaration) {
        return isKernelConstantName(declaration.name) &&
               kernelConstantValue(declaration.initial) !== null;
    }

    function validateConstantOptions(options) {
        if (options.constantOverrides && !options.legacyConstantLocals) {
            throw new SyntaxError("constantOverrides requires the temporary " +
                "legacyConstantLocals mode; use real external bindings instead");
        }
        copyExternalConstants({}, options.constantBindings);
    }

    function copyExternalConstants(target, bindings) {
        if (!bindings) return;
        for (var name in bindings) {
            if (Object.prototype.hasOwnProperty.call(bindings, name)) {
                var value = bindings[name];
                if (typeof value !== "number" || value !== (value | 0)) {
                    throw new TypeError("kernel external binding must be int32: " +
                                        name);
                }
                target[name] = value;
            }
        }
    }

    function isKernelConstantName(name) {
        if (!name.length) return false;
        var first = name.charCodeAt(0);
        if (first < 65 || first > 90) return false;
        var index = 1;
        while (index < name.length) {
            var code = name.charCodeAt(index++);
            if (code >= 65 && code <= 90) continue;
            if (code >= 48 && code <= 57) continue;
            if (code === 95) continue;
            return false;
        }
        return true;
    }

    function kernelConstantValue(expression) {
        if (typeof expression === "number" &&
            expression === (expression | 0)) {
            return expression | 0;
        }
        if (expression && expression.type === "Literal" &&
            typeof expression.value === "number" &&
            expression.value === (expression.value | 0)) {
            return expression.value | 0;
        }
        if (expression && expression.type === "UnaryExpression" &&
            expression.operator === "-" && expression.argument &&
            ((typeof expression.argument === "number" &&
              -expression.argument === (-expression.argument | 0)) ||
             (expression.argument.type === "Literal" &&
              typeof expression.argument.value === "number" &&
              -expression.argument.value ===
                  (-expression.argument.value | 0)))) {
            var argumentValue = typeof expression.argument === "number" ?
                expression.argument : expression.argument.value;
            return -argumentValue | 0;
        }
        return null;
    }

    function lowerStatements(statements, symbols) {
        var body = [];
        var index = 0;
        while (index < statements.length) {
            var lowered = lowerStatement(statements[index++], symbols);
            if (lowered.op === "dispatch_marker") {
                if (index >= statements.length) {
                    throw new SyntaxError("kernel dispatch marker requires a body");
                }
                lowered = {op: "opcode_dispatch", value: lowered.value,
                    minimum: lowered.minimum, maximum: lowered.maximum,
                    body: lowerStatement(statements[index++], symbols)};
            }
            if (lowered.op === "block") {
                var child = 0;
                while (child < lowered.body.length) body.push(lowered.body[child++]);
            } else body.push(lowered);
        }
        return body;
    }

    function lowerStatement(statement, symbols) {
        if (statement.type === "EmptyStatement") {
            return {op: "block", body: []};
        }
        if (statement.type === "BlockStatement") {
            return {op: "block", body: lowerStatements(statement.body, symbols)};
        }
        if (statement.type === "VariableStatement") {
            var declarations = [];
            var index = 0;
            while (index < statement.declarations.length) {
                var declaration = statement.declarations[index++];
                if (declaration.initial !== null) {
                    var declarationSymbol = symbolAt(symbols,
                                                     declaration.name);
                    if (!declarationSymbol) {
                        throw new SyntaxError("unknown kernel declaration " +
                            declaration.name + " (constantName=" +
                            isKernelConstantName(declaration.name) +
                            ", constantValue=" +
                            kernelConstantValue(declaration.initial) + ")");
                    }
                    if (declarationSymbol.kind !== "constant") {
                        declarations.push({op: "set_local",
                            index: requireLocal(symbols, declaration.name).index,
                            value: lowerKernelExpression(
                                declaration.initial, symbols)});
                    }
                }
            }
            return {op: "block", body: declarations};
        }
        if (statement.type === "ExpressionStatement") {
            var expression = statement.expression;
            /* The value of a standalone ++/-- is discarded, so prefix and
             * postfix forms have the same effect here. Expression-valued
             * updates remain unsupported rather than losing their value. */
            if (expression.type === "UpdateExpression" &&
                expression.argument.type === "Identifier") {
                var updateTarget = writableKernelIdentifier(
                    symbols, expression.argument.name);
                return {op: updateTarget.kind === "local" ?
                            "set_local" : "set_argument",
                    index: updateTarget.index,
                    value: {op: expression.operator === "++" ? "add_i32" : "sub_i32",
                        left: lowerKernelExpression(expression.argument, symbols),
                        right: {op: "const_i32", value: 1, type: "i32"},
                        type: "i32"}};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "copyValueCell" &&
                expression.arguments.length === 2) {
                return lowerValueCellCopy(expression.arguments[0],
                                          expression.arguments[1], symbols);
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                (expression.callee.name === "setValueCellUndefined" ||
                 expression.callee.name === "setValueCellFalse" ||
                 expression.callee.name === "setValueCellTrue" ||
                 expression.callee.name === "setValueCellInt32" ||
                 expression.callee.name === "setValueCellReference" ||
                 expression.callee.name === "setValueCellDoubleBits") &&
                (expression.arguments.length >= 1 &&
                 expression.arguments.length <= 3)) {
                return setValueCellBlock(expression.callee.name,
                                         expression.arguments, symbols);
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "beginOpcodeDispatch" &&
                expression.arguments.length === 3) {
                var minimum = lowerKernelExpression(
                    expression.arguments[1], symbols);
                var maximum = lowerKernelExpression(
                    expression.arguments[2], symbols);
                if (minimum.op !== "const_i32" || maximum.op !== "const_i32") {
                    throw new SyntaxError(
                        "kernel opcode dispatch bounds must be constants");
                }
                return {op: "dispatch_marker",
                    value: lowerKernelExpression(expression.arguments[0], symbols),
                    minimum: minimum.value, maximum: maximum.value};
            }
            if (expression.type === "AssignmentExpression" &&
                expression.operator === "=" &&
                expression.left.type === "Identifier") {
                var target = writableKernelIdentifier(
                    symbols, expression.left.name);
                return {op: target.kind === "local" ? "set_local" : "set_argument",
                        index: target.index,
                        value: lowerKernelExpression(expression.right, symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "setOpcodeExecutionCount" &&
                expression.arguments.length === 4) {
                return {op: "store_u32",
                    address: opcodeCounterAddress(
                        expression.arguments, symbols),
                    value: lowerKernelExpression(
                        expression.arguments[3], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                WRITE_INDEXED_FIELD_ACCESSORS[expression.callee.name] &&
                expression.arguments.length === 4) {
                return {op: "store_u32",
                    address: indexedAddressDescriptor(
                        WRITE_INDEXED_FIELD_ACCESSORS[expression.callee.name],
                        expression.arguments, symbols),
                    value: lowerKernelExpression(
                        expression.arguments[3], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                WRITE_FIELD_ACCESSORS[expression.callee.name] &&
                expression.arguments.length === 3) {
                return {op: "store_u32",
                    address: namedFieldAddress(expression.callee.name,
                        expression.arguments, symbols, WRITE_FIELD_ACCESSORS),
                    value: lowerKernelExpression(expression.arguments[2], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "setStringCharacterByte" &&
                expression.arguments.length === 4) {
                return {op: "store_u8",
                    address: stringCharacterByteAddress(
                        expression.arguments, symbols),
                    value: lowerKernelExpression(
                        expression.arguments[3], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "store32" &&
                expression.arguments.length === 2) {
                return {op: "store_u32",
                    address: lowerKernelExpression(expression.arguments[0], symbols),
                    value: lowerKernelExpression(expression.arguments[1], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "storeF64" &&
                expression.arguments.length === 2) {
                return {op: "store_f64",
                    address: lowerKernelExpression(expression.arguments[0], symbols),
                    value: lowerKernelF64Expression(expression.arguments[1], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                (expression.callee.name === "storeRaw8" ||
                 expression.callee.name === "storeRaw32") &&
                expression.arguments.length === 2) {
                return {op: expression.callee.name === "storeRaw8" ?
                            "store_raw_u8" : "store_raw_u32",
                    address: lowerKernelExpression(
                        expression.arguments[0], symbols),
                    value: lowerKernelExpression(
                        expression.arguments[1], symbols)};
            }
            if (expression.type === "CallExpression") {
                return {op: "expression", value: lowerKernelExpression(expression, symbols)};
            }
            throw new SyntaxError("unsupported kernel expression statement");
        }
        if (statement.type === "IfStatement") {
            return {op: "if", test: lowerKernelExpression(statement.test, symbols),
                    consequent: lowerStatement(statement.consequent, symbols),
                    alternate: statement.alternate ?
                        lowerStatement(statement.alternate, symbols) :
                        {op: "block", body: []}};
        }
        if (statement.type === "WhileStatement") {
            return {op: "while", test: lowerKernelExpression(statement.test, symbols),
                    body: lowerStatement(statement.body, symbols)};
        }
        if (statement.type === "ForStatement") {
            /* Desugar to existing control-flow IR, shared by both backends.
             * break/continue are still rejected: a future continue lowering
             * must target the update, not simply the loop condition. */
            var loopStatements = [];
            if (statement.initial !== null) {
                loopStatements.push(lowerStatement(
                    statement.initial.type === "VariableStatement" ?
                        statement.initial :
                        {type: "ExpressionStatement",
                         expression: statement.initial}, symbols));
            }
            var iteration = [lowerStatement(statement.body, symbols)];
            if (statement.update !== null) {
                iteration.push(lowerStatement({type: "ExpressionStatement",
                    expression: statement.update}, symbols));
            }
            loopStatements.push({op: "while",
                test: statement.test === null ?
                    {op: "const_i32", value: 1, type: "i32"} :
                    lowerKernelExpression(statement.test, symbols),
                body: {op: "block", body: iteration}});
            return {op: "block", body: loopStatements};
        }
        if (statement.type === "ReturnStatement" &&
            statement.argument !== null) {
            return {op: "return",
                    value: lowerKernelExpression(statement.argument, symbols)};
        }
        throw new SyntaxError("unsupported control-flow kernel statement " +
                              statement.type);
    }

    function requireLocal(symbols, name) {
        var symbol = symbolAt(symbols, name);
        if (!symbol || symbol.kind !== "local") {
            throw new SyntaxError("kernel local is not declared: " + name);
        }
        return symbol;
    }

    function writableKernelIdentifier(symbols, name) {
        var target = symbolAt(symbols, name);
        if (!target) throw new SyntaxError("unknown kernel assignment " + name);
        if (target.kind === "constant") {
            throw new SyntaxError("kernel constant cannot be assigned: " + name);
        }
        return target;
    }

    function valueCellFieldAddress(expression, fieldName, symbols) {
        var field = symbolAt(symbols, fieldName);
        if (!field || field.kind !== "constant") {
            throw new SyntaxError("value-cell operation requires " + fieldName);
        }
        return offsetAddress(lowerKernelExpression(expression, symbols),
                             field.value);
    }

    /* Nested named accessors describe one address, not several runtime adds.
     * Fold their static displacements without moving or repeating evaluation
     * of the base expression. Both backends receive the same simplified IR. */
    function offsetAddress(address, displacement) {
        if (address.op === "add_i32" && address.right.op === "const_i32") {
            displacement = (address.right.value + displacement) | 0;
            address = address.left;
        }
        if (displacement === 0) return address;
        return {op: "add_i32", left: address,
                right: {op: "const_i32", value: displacement, type: "i32"},
                type: "i32"};
    }

    function lowerValueCellCopy(target, source, symbols) {
        var fields = ["VALUE_CELL_TAG", "VALUE_CELL_LOW",
                      "VALUE_CELL_HIGH", "VALUE_CELL_AUX"];
        var WORD_BYTES = 4;
        var index = 0;
        while (index < fields.length) {
            var field = symbolAt(symbols, fields[index]);
            if (!field || field.kind !== "constant" ||
                field.value !== index * WORD_BYTES) {
                throw new SyntaxError("copyValueCell requires contiguous word fields");
            }
            index++;
        }
        /* Preserve a block copy in the shared IR. Both pointer expressions
         * are evaluated once, in argument order, like an ordinary JS call. */
        return {op: "copy_words", target: lowerKernelExpression(target, symbols),
            source: lowerKernelExpression(source, symbols), wordCount: fields.length};
    }

    function setValueCellBlock(name, argumentsList, symbols) {
        var tagName = name === "setValueCellUndefined" ?
            "VALUE_TAG_UNDEFINED" : name === "setValueCellFalse" ?
            "VALUE_TAG_FALSE" : name === "setValueCellTrue" ?
            "VALUE_TAG_TRUE" : name === "setValueCellInt32" ?
            "VALUE_TAG_INT32" : name === "setValueCellDoubleBits" ?
            "VALUE_TAG_DOUBLE" : "VALUE_TAG_REFERENCE";
        var tag = symbolAt(symbols, tagName);
        if (!tag || tag.kind !== "constant") {
            throw new SyntaxError("value-cell operation requires " + tagName);
        }
        var tagOnly = name === "setValueCellUndefined" ||
                      name === "setValueCellFalse" ||
                      name === "setValueCellTrue";
        var doubleBits = name === "setValueCellDoubleBits";
        if ((tagOnly && argumentsList.length !== 1) ||
            (!tagOnly && !doubleBits && argumentsList.length !== 2) ||
            (doubleBits && argumentsList.length !== 3)) {
            throw new SyntaxError("invalid value-cell operation arity");
        }
        var payload = tagOnly ?
            {op: "const_i32", value: 0, type: "i32"} :
            lowerKernelExpression(argumentsList[1], symbols);
        var payloadHigh = doubleBits ?
            lowerKernelExpression(argumentsList[2], symbols) :
            {op: "const_i32", value: 0, type: "i32"};
        var target = argumentsList[0];
        var fields = ["VALUE_CELL_TAG", "VALUE_CELL_LOW",
                      "VALUE_CELL_HIGH", "VALUE_CELL_AUX"];
        var values = [{op: "const_i32", value: tag.value, type: "i32"},
                      payload, payloadHigh,
                      {op: "const_i32", value: 0, type: "i32"}];
        var body = [];
        var index = 0;
        while (index < fields.length) {
            body.push({op: "store_u32",
                address: valueCellFieldAddress(target, fields[index], symbols),
                value: values[index]});
            index++;
        }
        return {op: "block", body: body};
    }

    function lowerKernelExpression(node, symbols) {
        if (typeof node === "number" && node === (node | 0)) {
            return {op: "const_i32", value: node | 0, type: "i32"};
        }
        if (node.type === "Literal" && typeof node.value === "number" &&
            node.value === (node.value | 0)) {
            return {op: "const_i32", value: node.value | 0, type: "i32"};
        }
        if (node.type === "Identifier") {
            var symbol = symbolAt(symbols, node.name);
            if (!symbol) throw new SyntaxError("unknown kernel identifier " + node.name);
            if (symbol.kind === "constant") {
                return {op: "const_i32", value: symbol.value, type: "i32"};
            }
            return {op: symbol.kind === "local" ? "local_i32" : "arg_i32",
                    index: symbol.index, type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            INDEXED_ADDRESS_ACCESSORS[node.callee.name] &&
            node.arguments.length === 3) {
            return indexedAddress(node.callee.name, node.arguments, symbols);
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            FIELD_ADDRESS_ACCESSORS[node.callee.name] &&
            node.arguments.length === 2) {
            return fieldAddress(node.callee.name, node.arguments, symbols);
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            READ_INDEXED_FIELD_ACCESSORS[node.callee.name] &&
            node.arguments.length === 3) {
            return {op: "load_u32",
                    address: indexedAddressDescriptor(
                        READ_INDEXED_FIELD_ACCESSORS[node.callee.name],
                        node.arguments, symbols),
                    type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            READ_FIELD_ACCESSORS[node.callee.name] &&
            node.arguments.length === 2) {
            return {op: "load_u32",
                    address: namedFieldAddress(node.callee.name,
                        node.arguments, symbols, READ_FIELD_ACCESSORS),
                    type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "opcodeExecutionCount" &&
            node.arguments.length === 3) {
            return {op: "load_u32", address: opcodeCounterAddress(
                node.arguments, symbols), type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            (node.callee.name === "latin1StringCharacterCodeUnit" ||
             node.callee.name === "flatStringStorageByte") &&
            node.arguments.length === 3) {
            return {op: "load_u8", address: stringCharacterByteAddress(
                node.arguments, symbols), type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "flatStringStorageWord" &&
            node.arguments.length === 3) {
            return {op: "load_u32", address: stringCharacterByteAddress(
                node.arguments, symbols), type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "flatStringCharacterCodeUnit" &&
            node.arguments.length === 3) {
            return {op: "load_u32", address: stringCharacterAddress(
                node.arguments, symbols), type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "load32" && node.arguments.length === 1) {
            return {op: "load_u32",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            (node.callee.name === "loadRaw8" ||
             node.callee.name === "loadRaw32") && node.arguments.length === 1) {
            return {op: node.callee.name === "loadRaw8" ?
                        "load_raw_u8" : "load_raw_u32",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier") {
            var kernelFunctions = symbols.$kernelFunctions;
            var kernelFunction = kernelFunctions &&
                kernelFunctions[node.callee.name];
            if (kernelFunction) {
                if (node.arguments.length !== kernelFunction.arity) {
                    throw new SyntaxError("kernel call " + node.callee.name +
                        " expects " + kernelFunction.arity + " argument(s)");
                }
                var kernelArguments = [];
                var kernelArgumentIndex = 0;
                while (kernelArgumentIndex < node.arguments.length) {
                    kernelArguments.push(lowerKernelExpression(
                        node.arguments[kernelArgumentIndex++], symbols));
                }
                return {op: "call_kernel_i32", name: node.callee.name,
                        arguments: kernelArguments, type: "i32"};
            }
            if (node.callee.name === "callNativeI32" &&
                node.arguments.length >= 1 && node.arguments.length <= 9) {
                var nativeArguments = [];
                var nativeArgumentIndex = 1;
                while (nativeArgumentIndex < node.arguments.length) {
                    nativeArguments.push(lowerKernelExpression(
                        node.arguments[nativeArgumentIndex++], symbols));
                }
                return {op: "call_native_i32",
                    pointer: lowerKernelExpression(node.arguments[0], symbols),
                    arguments: nativeArguments, type: "i32"};
            }
            if (node.callee.name === "toInt32F64" &&
                node.arguments.length === 1) {
                return {op: "to_i32_f64",
                    value: lowerKernelF64Expression(node.arguments[0], symbols),
                    type: "i32"};
            }
            if (node.callee.name === "toNativeI32F64" &&
                node.arguments.length === 1) {
                return {op: "to_native_i32_f64",
                    value: lowerKernelF64Expression(node.arguments[0], symbols),
                    type: "i32"};
            }
            var comparisons = {equalF64: "eq_f64", lessF64: "lt_f64",
                lessEqualF64: "le_f64", greaterF64: "gt_f64",
                greaterEqualF64: "ge_f64"};
            var comparison = comparisons[node.callee.name];
            if (comparison && node.arguments.length === 2) {
                return {op: comparison,
                    left: lowerKernelF64Expression(node.arguments[0], symbols),
                    right: lowerKernelF64Expression(node.arguments[1], symbols),
                    type: "i32"};
            }
        }
        if (node.type === "UnaryExpression" &&
            (node.operator === "-" || node.operator === "~" ||
             node.operator === "+" || node.operator === "!")) {
            return {op: node.operator === "-" ? "neg_i32" :
                        node.operator === "~" ? "not_i32" :
                        node.operator === "!" ? "logical_not_i32" : "as_i32",
                    value: lowerKernelExpression(node.argument, symbols), type: "i32"};
        }
        if (node.type === "BinaryExpression") {
            if (node.operator === "&&" || node.operator === "||") {
                return {op: node.operator === "&&" ?
                    "logical_and_i32" : "logical_or_i32",
                    left: lowerKernelExpression(node.left, symbols),
                    right: lowerKernelExpression(node.right, symbols),
                    type: "i32"};
            }
            var operations = {"+": "add_i32", "-": "sub_i32", "*": "mul_i32",
                "%": "rem_i32",
                "&": "and_i32", "|": "or_i32", "^": "xor_i32",
                "<<": "shl_i32", ">>": "shr_i32", ">>>": "ushr_i32",
                "===": "eq_i32", "!==": "ne_i32", "<": "lt_i32",
                "<=": "le_i32", ">": "gt_i32", ">=": "ge_i32"};
            var operation = operations[node.operator];
            if (!operation) throw new SyntaxError("unsupported kernel operator " +
                                                  node.operator);
            var left = lowerKernelExpression(node.left, symbols);
            var right = lowerKernelExpression(node.right, symbols);
            if (left.op === "const_i32" && right.op === "const_i32") {
                return foldIntegerOperation(operation, left.value, right.value);
            }
            return {op: operation, left: left, right: right, type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "divideI32" &&
            node.arguments.length === 2) {
            return {op: "div_i32",
                    left: lowerKernelExpression(node.arguments[0], symbols),
                    right: lowerKernelExpression(node.arguments[1], symbols),
                    type: "i32"};
        }
        throw new SyntaxError("unsupported control-flow kernel expression " + node.type);
    }

    function foldIntegerOperation(operation, left, right) {
        var value;
        if (operation === "add_i32") value = left + right;
        else if (operation === "sub_i32") value = left - right;
        else if (operation === "mul_i32") value = left * right;
        else if (operation === "rem_i32") value = left % right;
        else if (operation === "div_i32") value = (left / right) | 0;
        else if (operation === "and_i32") value = left & right;
        else if (operation === "or_i32") value = left | right;
        else if (operation === "xor_i32") value = left ^ right;
        else if (operation === "shl_i32") value = left << right;
        else if (operation === "shr_i32") value = left >> right;
        else if (operation === "ushr_i32") value = left >>> right;
        else if (operation === "eq_i32") value = left === right ? 1 : 0;
        else if (operation === "ne_i32") value = left !== right ? 1 : 0;
        else if (operation === "lt_i32") value = left < right ? 1 : 0;
        else if (operation === "le_i32") value = left <= right ? 1 : 0;
        else if (operation === "gt_i32") value = left > right ? 1 : 0;
        else value = left >= right ? 1 : 0;
        return {op: "const_i32", value: value | 0, type: "i32"};
    }

    function namedFieldAddress(name, argumentsList, symbols, accessors) {
        var fieldName = accessors[name];
        var field = symbolAt(symbols, fieldName);
        if (!field || field.kind !== "constant") {
            throw new SyntaxError("kernel field accessor " + name +
                                  " requires " + fieldName);
        }
        return {op: "add_i32",
            left: {op: "add_i32",
                left: lowerKernelExpression(argumentsList[0], symbols),
                right: lowerKernelExpression(argumentsList[1], symbols),
                type: "i32"},
            right: {op: "const_i32", value: field.value, type: "i32"},
            type: "i32"};
    }

    function fieldAddress(name, argumentsList, symbols) {
        var fieldName = FIELD_ADDRESS_ACCESSORS[name];
        var field = symbolAt(symbols, fieldName);
        if (!field || field.kind !== "constant") {
            throw new SyntaxError("kernel address accessor " + name +
                                  " requires " + fieldName);
        }
        return {op: "add_i32",
            left: {op: "add_i32",
                left: lowerKernelExpression(argumentsList[0], symbols),
                right: lowerKernelExpression(argumentsList[1], symbols),
                type: "i32"},
            right: {op: "const_i32", value: field.value, type: "i32"},
            type: "i32"};
    }

    function indexedAddress(name, argumentsList, symbols) {
        return indexedAddressDescriptor(
            INDEXED_ADDRESS_ACCESSORS[name], argumentsList, symbols);
    }

    function indexedAddressDescriptor(descriptor, argumentsList, symbols) {
        var field = descriptor.field ? symbolAt(symbols, descriptor.field) : null;
        var stride = descriptor.stride ?
            symbolAt(symbols, descriptor.stride) : null;
        if (descriptor.field && (!field || field.kind !== "constant") ||
            descriptor.stride && (!stride || stride.kind !== "constant")) {
            throw new SyntaxError(
                "kernel indexed field accessor requires layout constants");
        }
        return {op: "add_i32",
            left: {op: "add_i32",
                left: lowerKernelExpression(argumentsList[0], symbols),
                right: lowerKernelExpression(argumentsList[1], symbols),
                type: "i32"},
            right: {op: "add_i32",
                left: {op: "const_i32",
                    value: descriptor.fieldValue === undefined ?
                        field.value : descriptor.fieldValue,
                    type: "i32"},
                right: {op: "mul_i32",
                    left: lowerKernelExpression(argumentsList[2], symbols),
                    right: {op: "const_i32",
                        value: descriptor.strideValue || stride.value,
                        type: "i32"},
                    type: "i32"},
                type: "i32"},
            type: "i32"};
    }

    function opcodeCounterAddress(argumentsList, symbols) {
        var field = symbols.$ENGINE_OPCODE_COUNTS;
        if (!field || field.kind !== "constant") {
            throw new SyntaxError(
                "opcode counter accessor requires ENGINE_OPCODE_COUNTS");
        }
        return {op: "add_i32",
            left: {op: "add_i32",
                left: lowerKernelExpression(argumentsList[0], symbols),
                right: lowerKernelExpression(argumentsList[1], symbols),
                type: "i32"},
            right: {op: "add_i32",
                left: {op: "const_i32", value: field.value, type: "i32"},
                right: {op: "mul_i32",
                    left: lowerKernelExpression(argumentsList[2], symbols),
                    right: {op: "const_i32", value: 4, type: "i32"},
                    type: "i32"}, type: "i32"}, type: "i32"};
    }

    function stringCharacterAddress(argumentsList, symbols) {
        var chars = symbols.$STRING_CHARS;
        if (!chars || chars.kind !== "constant") {
            throw new SyntaxError(
                "string character accessor requires STRING_CHARS");
        }
        return {op: "add_i32",
            left: {op: "add_i32",
                left: lowerKernelExpression(argumentsList[0], symbols),
                right: lowerKernelExpression(argumentsList[1], symbols),
                type: "i32"},
            right: {op: "add_i32",
                left: {op: "const_i32", value: chars.value, type: "i32"},
                right: {op: "mul_i32",
                    left: lowerKernelExpression(argumentsList[2], symbols),
                    right: {op: "const_i32", value: 2, type: "i32"},
                    type: "i32"}, type: "i32"}, type: "i32"};
    }

    function stringCharacterByteAddress(argumentsList, symbols) {
        var chars = symbols.$STRING_CHARS;
        if (!chars || chars.kind !== "constant") {
            throw new SyntaxError(
                "string character writer requires STRING_CHARS");
        }
        return {op: "add_i32",
            left: {op: "add_i32",
                left: lowerKernelExpression(argumentsList[0], symbols),
                right: lowerKernelExpression(argumentsList[1], symbols),
                type: "i32"},
            right: {op: "add_i32",
                left: {op: "const_i32", value: chars.value, type: "i32"},
                right: lowerKernelExpression(argumentsList[2], symbols),
                type: "i32"}, type: "i32"};
    }

    function lowerKernelF64Expression(node, symbols) {
        if (node.type !== "CallExpression" || node.callee.type !== "Identifier") {
            throw new SyntaxError("kernel binary64 value must be an intrinsic call");
        }
        var name = node.callee.name;
        if (name === "callNativeF64" && node.arguments.length >= 1 &&
            node.arguments.length <= 9) {
            var nativeArguments = [];
            var nativeArgumentIndex = 1;
            while (nativeArgumentIndex < node.arguments.length) {
                nativeArguments.push(lowerKernelExpression(
                    node.arguments[nativeArgumentIndex++], symbols));
            }
            return {op: "call_native_f64",
                pointer: lowerKernelExpression(node.arguments[0], symbols),
                arguments: nativeArguments, type: "f64"};
        }
        if ((name === "loadF64" || name === "loadI32F64") &&
            node.arguments.length === 1) {
            return {op: name === "loadF64" ? "load_f64" : "load_i32_f64",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    type: "f64"};
        }
        if (name === "loadNumberF64" && node.arguments.length === 2) {
            return {op: "load_number_f64",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    tag: lowerKernelExpression(node.arguments[1], symbols),
                    type: "f64"};
        }
        var unaryOperations = {sqrtF64: "sqrt_f64", absF64: "abs_f64",
                               logF64: "log_f64",
                               truncateF64: "truncate_f64",
                               floorF64: "floor_f64", ceilF64: "ceil_f64",
                               sinF64: "sin_f64", cosF64: "cos_f64"};
        if (unaryOperations[name] && node.arguments.length === 1) {
            return {op: unaryOperations[name],
                    value: lowerKernelF64Expression(node.arguments[0], symbols),
                    type: "f64"};
        }
        var operations = {addF64: "add_f64", subtractF64: "sub_f64",
                          multiplyF64: "mul_f64", divideF64: "div_f64",
                          powF64: "pow_f64", atan2F64: "atan2_f64",
                          remainderF64: "rem_f64"};
        if (operations[name] && node.arguments.length === 2) {
            return {op: operations[name],
                    left: lowerKernelF64Expression(node.arguments[0], symbols),
                    right: lowerKernelF64Expression(node.arguments[1], symbols),
                    type: "f64"};
        }
        throw new SyntaxError("unsupported control-flow binary64 intrinsic " + name);
    }

    function lower(node, locals) {
        if (typeof node === "number" && node === (node | 0)) {
            return {op: "const_i32", value: node | 0, type: "i32"};
        }
        if (node.type === "Literal" && typeof node.value === "number" &&
            node.value === (node.value | 0)) {
            return {op: "const_i32", value: node.value | 0, type: "i32"};
        }
        if (node.type === "Identifier" && locals["$" + node.name] !== undefined) {
            return {op: "arg_i32", index: locals["$" + node.name], type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "callNativeI32" &&
            node.arguments.length >= 1 && node.arguments.length <= 9) {
            var nativeArguments = [];
            var nativeArgumentIndex = 1;
            while (nativeArgumentIndex < node.arguments.length) {
                nativeArguments.push(lower(
                    node.arguments[nativeArgumentIndex++], locals));
            }
            return {op: "call_native_i32",
                pointer: lower(node.arguments[0], locals),
                arguments: nativeArguments, type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            (node.callee.name === "toInt32F64" ||
             node.callee.name === "toNativeI32F64") &&
            node.arguments.length === 1) {
            return {op: node.callee.name === "toInt32F64" ?
                        "to_i32_f64" : "to_native_i32_f64",
                    value: lowerF64(node.arguments[0], locals), type: "i32"};
        }
        if (node.type === "UnaryExpression" &&
            (node.operator === "-" || node.operator === "~" ||
             node.operator === "+")) {
            return {op: node.operator === "-" ? "neg_i32" :
                        node.operator === "~" ? "not_i32" : "as_i32",
                    value: lower(node.argument, locals), type: "i32"};
        }
        if (node.type === "BinaryExpression") {
            var operations = {"+": "add_i32", "-": "sub_i32", "*": "mul_i32",
                "%": "rem_i32",
                              "&": "and_i32", "|": "or_i32", "^": "xor_i32",
                              "<<": "shl_i32", ">>": "shr_i32"};
            var operation = operations[node.operator];
            if (!operation) throw new SyntaxError("unsupported kernel operator " +
                                                  node.operator);
            return {op: operation, left: lower(node.left, locals),
                    right: lower(node.right, locals), type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "divideI32" &&
            node.arguments.length === 2) {
            return {op: "div_i32", left: lower(node.arguments[0], locals),
                    right: lower(node.arguments[1], locals), type: "i32"};
        }
        throw new SyntaxError("unsupported kernel expression " + node.type);
    }

    function lowerF64(node, locals) {
        if (node.type !== "CallExpression" ||
            node.callee.type !== "Identifier") {
            throw new SyntaxError("binary64 kernel expression must be an intrinsic call");
        }
        var name = node.callee.name;
        if (name === "callNativeF64" && node.arguments.length >= 1 &&
            node.arguments.length <= 9) {
            var nativeArguments = [];
            var nativeArgumentIndex = 1;
            while (nativeArgumentIndex < node.arguments.length) {
                nativeArguments.push(lower(
                    node.arguments[nativeArgumentIndex++], locals));
            }
            return {op: "call_native_f64",
                pointer: lower(node.arguments[0], locals),
                arguments: nativeArguments, type: "f64"};
        }
        if (name === "loadF64" && node.arguments.length === 1) {
            return {op: "load_f64", address: lower(node.arguments[0], locals),
                    type: "f64"};
        }
        var operations = {addF64: "add_f64", subtractF64: "sub_f64",
                          multiplyF64: "mul_f64", divideF64: "div_f64"};
        if (operations[name] && node.arguments.length === 2) {
            return {op: operations[name],
                    left: lowerF64(node.arguments[0], locals),
                    right: lowerF64(node.arguments[1], locals), type: "f64"};
        }
        throw new SyntaxError("unsupported binary64 kernel intrinsic " + name);
    }

    root.GuestVMKernelCompiler = KernelCompiler;
    if (typeof module !== "undefined" && module.exports) module.exports = KernelCompiler;
}(this));
