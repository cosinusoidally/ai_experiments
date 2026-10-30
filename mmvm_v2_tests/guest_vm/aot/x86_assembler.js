/* Small i386 macro assembler. Callers use named instructions; raw instruction
 * arrays never appear in kernels or backend code. */
(function (root) {
    var MAX_SIGNED_BYTE_IMMEDIATE = 127;
    var STACK_WORD_BYTES = 4;
    var INITIAL_NATIVE_BUFFER_BYTES = 64 * 1024;
    var MAX_NATIVE_BUFFER_BYTES = 0x7fffffff;
    var REGISTER_CODES = {eax: 0, ecx: 1, edx: 2, ebx: 3,
                          esp: 4, ebp: 5, esi: 6, edi: 7};
    var ADDRESS_SCALES = {1: 0, 2: 1, 4: 2, 8: 3};
    var MODRM_BYTE_DISPLACEMENT = 0x40;
    var MODRM_WORD_DISPLACEMENT = 0x80;
    var MODRM_REGISTER_SHIFT = 3;
    function Assembler(captureMacros) {
        this.bytes = [];
        this.length = 0;
        this.macros = captureMacros === false ? null : [];
        this.stackWords = 0;
        this.labels = {};
        this.fixups = [];
    }

    Assembler.prototype.emitByte = function (value) {
        this.bytes[this.length++] = value & 255;
    };

    Assembler.prototype.emitBytes2 = function (first, second) {
        var index = this.length;
        this.bytes[index] = first & 255;
        this.bytes[index + 1] = second & 255;
        this.length += 2;
    };

    Assembler.prototype.emitBytes3 = function (first, second, third) {
        var index = this.length;
        this.bytes[index] = first & 255;
        this.bytes[index + 1] = second & 255;
        this.bytes[index + 2] = third & 255;
        this.length += 3;
    };

    Assembler.prototype.word32 = function (value) {
        value = Number(value) >>> 0;
        var index = this.length;
        this.bytes[index] = value & 255;
        this.bytes[index + 1] = (value >>> 8) & 255;
        this.bytes[index + 2] = (value >>> 16) & 255;
        this.bytes[index + 3] = (value >>> 24) & 255;
        this.length += 4;
    };

    /* Optional storage policy, independent of instruction selection. The
     * backend owns this temporary allocation and releases it even if emission
     * fails. Default/debug assemblers continue exposing ordinary byte arrays. */
    Assembler.prototype.useNativeStorage = function (ffi) {
        if (this.length) throw new Error("cannot change assembler storage after emission");
        this.storageFFI = ffi;
        this.reallocPointer = ffi.resolve("realloc");
        this.freePointer = ffi.resolve("free");
        this.memcpyPointer = ffi.resolve("memcpy");
        this.nativePointer = 0;
        this.nativeCapacity = 0;
        this.bytes = null;
        this.emitByte = emitNativeByte;
        this.emitBytes2 = emitNativeBytes2;
        this.emitBytes3 = emitNativeBytes3;
        this.word32 = emitNativeWord32;
    };

    Assembler.prototype.reserveNativeStorage = function (required) {
        if (required < 0 || required > MAX_NATIVE_BUFFER_BYTES) {
            throw new RangeError("assembler byte-buffer size exceeds i386 range");
        }
        var capacity = this.nativeCapacity || INITIAL_NATIVE_BUFFER_BYTES;
        while (capacity < required) {
            capacity = Math.min(capacity * 2, MAX_NATIVE_BUFFER_BYTES);
        }
        var pointer = this.storageFFI.call(this.reallocPointer,
            [this.nativePointer, capacity]);
        if (!pointer) throw new Error("assembler byte-buffer allocation failed");
        this.nativePointer = pointer;
        this.nativeCapacity = capacity;
    };

    function emitNativeByte(value) {
        if (this.length + 1 > this.nativeCapacity) this.reserveNativeStorage(this.length + 1);
        poke8(this.nativePointer + this.length, value & 255);
        this.length++;
    }
    function emitNativeBytes2(first, second) {
        /* Reserve the complete write; the extra zero bytes are outside the
         * logical stream and are overwritten by subsequent instructions. */
        if (this.length + 4 > this.nativeCapacity) this.reserveNativeStorage(this.length + 4);
        poke32(this.nativePointer + this.length, (first & 255) | ((second & 255) << 8));
        this.length += 2;
    }
    function emitNativeBytes3(first, second, third) {
        if (this.length + 4 > this.nativeCapacity) this.reserveNativeStorage(this.length + 4);
        poke32(this.nativePointer + this.length,
            (first & 255) | ((second & 255) << 8) | ((third & 255) << 16));
        this.length += 3;
    }
    function emitNativeWord32(value) {
        if (this.length + 4 > this.nativeCapacity) this.reserveNativeStorage(this.length + 4);
        poke32(this.nativePointer + this.length, value | 0);
        this.length += 4;
    }

    Assembler.prototype.releaseStorage = function () {
        if (this.nativePointer) {
            this.storageFFI.call(this.freePointer, [this.nativePointer]);
            this.nativePointer = 0;
            this.nativeCapacity = 0;
        }
    };

    Assembler.prototype.movEaxImmediate = function (value) {
        if (this.macros) this.macros.push("mov_eax_i32(" + (value | 0) + ")");
        this.emitByte(0xb8); this.word32(value);
    };
    Assembler.prototype.movDwordPtrEaxImmediate = function (value) {
        if (this.macros) this.macros.push("mov_ptr_eax_i32(" + (value | 0) + ")");
        this.emitBytes2(0xc7, 0x00); this.word32(value);
    };
    Assembler.prototype.movBytePtrEaxImmediate = function (value) {
        if (this.macros) this.macros.push("mov_byte_ptr_eax_i8(" + (value & 255) + ")");
        this.emitBytes3(0xc6, 0x00, value);
    };
    Assembler.prototype.movEaxEdx = function () {
        if (this.macros) this.macros.push("mov_eax_edx()");
        this.emitBytes2(0x89, 0xd0);
    };
    /* Encode one register/memory instruction. EBP always needs an explicit
     * displacement, including zero. Choose the signed-byte form when it fits;
     * otherwise retain every bit of the full displacement. */
    Assembler.prototype.emitEbpMemory = function (opcode, register, displacement) {
        this.emitRegisterMemory(opcode, register, "ebp", displacement);
    };
    Assembler.prototype.emitRegisterMemory = function (opcode, register, base, displacement) {
        var code = REGISTER_CODES[register];
        var baseCode = REGISTER_CODES[base];
        if (code === undefined || baseCode === undefined) {
            throw new Error("invalid memory-operand register");
        }
        var hasOffset = displacement !== 0 || base === "ebp";
        var small = displacement >= -128 && displacement <= MAX_SIGNED_BYTE_IMMEDIATE;
        this.emitBytes2(opcode,
            (hasOffset ? (small ? MODRM_BYTE_DISPLACEMENT : MODRM_WORD_DISPLACEMENT) : 0) |
            (code << MODRM_REGISTER_SHIFT) | baseCode);
        if (base === "esp") {
            /* Scale one, no index, ESP base. */
            this.emitByte((REGISTER_CODES.esp << MODRM_REGISTER_SHIFT) | baseCode);
        }
        if (hasOffset) {
            if (small) this.emitByte(displacement);
            else this.word32(displacement);
        }
    };
    Assembler.prototype.movEaxDwordPtrRegisterDisplacement = function (base, displacement) {
        if (this.macros) this.macros.push("mov_eax_ptr_" + base + "(" + displacement + ")");
        this.emitRegisterMemory(0x8b, "eax", base, displacement);
    };
    Assembler.prototype.movzxEaxBytePtrRegisterDisplacement = function (base, displacement) {
        if (this.macros) this.macros.push("movzx_eax_byte_ptr_" + base + "(" + displacement + ")");
        this.emitByte(0x0f);
        this.emitRegisterMemory(0xb6, "eax", base, displacement);
    };
    Assembler.prototype.leaEaxRegisterDisplacement = function (base, displacement) {
        if (this.macros) this.macros.push("lea_eax_" + base + "(" + displacement + ")");
        this.emitRegisterMemory(0x8d, "eax", base, displacement);
    };
    Assembler.prototype.movEdxEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("mov_edx_ptr_ebp(" + displacement + ")");
        this.emitEbpMemory(0x8b, "edx", displacement);
    };
    Assembler.prototype.pushEdx = function () {
        if (this.macros) this.macros.push("push_edx()");
        /* Callee-save area, like pushEbx, not temporary cdecl arguments. */
        this.emitByte(0x52);
    };
    Assembler.prototype.popEdx = function () {
        if (this.macros) this.macros.push("pop_edx()");
        this.emitByte(0x5a);
    };
    Assembler.prototype.addEaxEdx = function () {
        if (this.macros) this.macros.push("add_eax_edx()");
        this.emitBytes2(0x01, 0xd0);
    };
    Assembler.prototype.compareEaxEdx = function () {
        if (this.macros) this.macros.push("cmp_eax_edx()");
        this.emitBytes2(0x39, 0xd0);
    };
    Assembler.prototype.compareRegisterImmediate = function (register, value) {
        var code = REGISTER_CODES[register];
        if (code === undefined) throw new Error("invalid comparison register");
        if (this.macros) this.macros.push("cmp_" + register + "_i32(" + (value | 0) + ")");
        if (value >= -128 && value <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0x83, 0xf8 | code, value);
        } else {
            this.emitBytes2(0x81, 0xf8 | code); this.word32(value);
        }
    };
    Assembler.prototype.compareEbpDisplacementImmediate = function (displacement, value) {
        if (this.macros) this.macros.push("cmp_ptr_ebp_i32(" + displacement + ", " +
            (value | 0) + ")");
        var smallOffset = displacement >= -128 && displacement <= MAX_SIGNED_BYTE_IMMEDIATE;
        var smallValue = value >= -128 && value <= MAX_SIGNED_BYTE_IMMEDIATE;
        this.emitBytes2(smallValue ? 0x83 : 0x81, smallOffset ? 0x7d : 0xbd);
        if (smallOffset) this.emitByte(displacement);
        else this.word32(displacement);
        if (smallValue) this.emitByte(value);
        else this.word32(value);
    };

    Assembler.prototype.movEaxArgument = function (index) {
        var displacement = 4 + index * 4 + this.stackWords * 4;
        if (this.macros) this.macros.push("mov_eax_arg(" + index + ")");
        this.emitBytes3(0x8b, 0x44, 0x24);
        this.emitByte(displacement);
    };

    Assembler.prototype.movEaxEbpArgument = function (index) {
        var displacement = 8 + index * 4;
        if (this.macros) this.macros.push("mov_eax_ebp_arg(" + index + ")");
        this.emitEbpMemory(0x8b, "eax", displacement);
    };
    Assembler.prototype.subEspImmediate = function (value) {
        if (this.macros) this.macros.push("sub_esp_i32(" + value + ")");
        this.emitBytes2(0x81, 0xec); this.word32(value);
    };
    Assembler.prototype.movEaxLocal = function (index) {
        var displacement = -(index + 1) * 4;
        if (this.macros) this.macros.push("mov_eax_local(" + index + ")");
        this.emitEbpMemory(0x8b, "eax", displacement);
    };
    Assembler.prototype.movEcxEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("mov_ecx_ebp(" + displacement + ")");
        this.emitEbpMemory(0x8b, "ecx", displacement);
    };
    Assembler.prototype.movLocalEax = function (index) {
        var displacement = -(index + 1) * 4;
        if (this.macros) this.macros.push("mov_local_eax(" + index + ")");
        this.emitEbpMemory(0x89, "eax", displacement);
    };
    Assembler.prototype.movEbpArgumentEax = function (index) {
        var displacement = 8 + index * 4;
        if (this.macros) this.macros.push("mov_ebp_arg_eax(" + index + ")");
        this.emitEbpMemory(0x89, "eax", displacement);
    };
    Assembler.prototype.movEaxDwordPtrEax = function () {
        if (this.macros) this.macros.push("mov_eax_dword_ptr_eax()");
        this.emitBytes2(0x8b, 0x00);
    };
    Assembler.prototype.movEaxDwordPtrEdxDisplacement = function (offset) {
        if (this.macros) this.macros.push("mov_eax_ptr_edx(" + offset + ")");
        if (offset >= 0 && offset <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0x8b, 0x42, offset);
        } else {
            this.emitBytes2(0x8b, 0x82);
            this.word32(offset);
        }
    };
    Assembler.prototype.movDwordPtrEdxDisplacementEax = function (offset) {
        if (this.macros) this.macros.push("mov_ptr_edx_eax(" + offset + ")");
        if (offset >= 0 && offset <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0x89, 0x42, offset);
        } else {
            this.emitBytes2(0x89, 0x82);
            this.word32(offset);
        }
    };
    Assembler.prototype.movDwordPtrEdxDisplacementImmediate = function (offset, value) {
        if (this.macros) this.macros.push("mov_ptr_edx_i32(" + offset + "," + value + ")");
        if (offset >= 0 && offset <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0xc7, 0x42, offset);
        } else {
            this.emitBytes2(0xc7, 0x82);
            this.word32(offset);
        }
        this.word32(value);
    };
    Assembler.prototype.movDwordPtrEcxDisplacementEax = function (offset) {
        if (this.macros) this.macros.push("mov_ptr_ecx_eax(" + offset + ")");
        if (offset >= 0 && offset <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0x89, 0x41, offset);
        } else {
            this.emitBytes2(0x89, 0x81);
            this.word32(offset);
        }
    };
    Assembler.prototype.movEaxDwordPtrRegisterPlusEax = function (
            register, displacement) {
        var baseBits = register === "ebx" ? 3 :
                       register === "esi" ? 6 :
                       register === "edi" ? 7 :
                       register === "edx" ? 2 : -1;
        if (baseBits < 0) {
            throw new Error("unsupported indexed-load base register " +
                            register);
        }
        displacement = displacement | 0;
        if (this.macros) {
            this.macros.push("mov_eax_ptr_" + register +
                "_plus_eax(" + displacement + ")");
        }
        if (displacement === 0) {
            this.emitBytes3(0x8b, 0x04, baseBits);
        } else {
            this.emitBytes3(0x8b, 0x84, baseBits);
            this.word32(displacement);
        }
    };
    Assembler.prototype.movEaxDwordPtrScaledRegisters = function (
            base, index, scale, displacement) {
        var registers = REGISTER_CODES;
        var scales = ADDRESS_SCALES;
        if (registers[base] === undefined || registers[index] === undefined || index === "esp" ||
            scales[scale] === undefined) {
            throw new Error("invalid scaled-register load: base=" + base +
                ", index=" + index + ", scale=" + scale +
                ", displacement=" + displacement);
        }
        if (this.macros) this.macros.push("mov_eax_ptr_scaled(" + base + ", " +
            index + ", " + scale + ", " + (displacement | 0) + ")");
        var sib = (scales[scale] << 6) | (registers[index] << 3) | registers[base];
        if (displacement === 0 && base !== "ebp") this.emitBytes3(0x8b, 0x04, sib);
        else if (displacement >= -128 && displacement <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0x8b, 0x44, sib);
            this.emitByte(displacement);
        } else {
            this.emitBytes3(0x8b, 0x84, sib);
            this.word32(displacement);
        }
    };
    Assembler.prototype.leaEaxScaledRegisters = function (base, index, scale, displacement) {
        var registers = REGISTER_CODES;
        var scales = ADDRESS_SCALES;
        if (registers[base] === undefined || registers[index] === undefined || index === "esp" ||
            scales[scale] === undefined) {
            throw new Error("invalid scaled address: base=" + base +
                ", index=" + index + ", scale=" + scale +
                ", displacement=" + displacement);
        }
        if (this.macros) this.macros.push("lea_eax_scaled(" + base + ", " +
            index + ", " + scale + ", " + (displacement | 0) + ")");
        var sib = (scales[scale] << 6) | (registers[index] << 3) | registers[base];
        if (displacement === 0 && base !== "ebp") this.emitBytes3(0x8d, 0x04, sib);
        else if (displacement >= -128 && displacement <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0x8d, 0x44, sib); this.emitByte(displacement);
        } else {
            this.emitBytes3(0x8d, 0x84, sib); this.word32(displacement);
        }
    };
    Assembler.prototype.testEaxEax = function () {
        if (this.macros) this.macros.push("test_eax()");
        this.emitBytes2(0x85, 0xc0);
    };
    Assembler.prototype.compareEaxImmediate = function (value) {
        if (this.macros) this.macros.push("cmp_eax_i32(" + (value | 0) + ")");
        this.emitByte(0x3d); this.word32(value);
    };
    Assembler.prototype.compareEaxEbx = function () {
        if (this.macros) this.macros.push("cmp_eax_ebx()");
        this.emitBytes2(0x39, 0xd8);
    };
    Assembler.prototype.compareEaxEsi = function () {
        if (this.macros) this.macros.push("cmp_eax_esi()");
        this.emitBytes2(0x39, 0xf0);
    };
    Assembler.prototype.compareEaxEdi = function () {
        if (this.macros) this.macros.push("cmp_eax_edi()");
        this.emitBytes2(0x39, 0xf8);
    };
    Assembler.prototype.compareEaxEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("cmp_eax_ptr_ebp(" + displacement + ")");
        this.emitEbpMemory(0x3b, "eax", displacement);
    };
    Assembler.prototype.compareEcxEax = function () {
        if (this.macros) this.macros.push("cmp_ecx_eax()");
        this.emitBytes2(0x39, 0xc1);
    };
    Assembler.prototype.setNotEqualAl = function () {
        if (this.macros) this.macros.push("setne_al()");
        this.emitBytes3(0x0f, 0x95, 0xc0);
    };
    Assembler.prototype.setLessAl = function () {
        if (this.macros) this.macros.push("setl_al()");
        this.emitBytes3(0x0f, 0x9c, 0xc0);
    };
    Assembler.prototype.setLessOrEqualAl = function () {
        if (this.macros) this.macros.push("setle_al()");
        this.emitBytes3(0x0f, 0x9e, 0xc0);
    };
    Assembler.prototype.setGreaterAl = function () {
        if (this.macros) this.macros.push("setg_al()");
        this.emitBytes3(0x0f, 0x9f, 0xc0);
    };
    Assembler.prototype.setGreaterOrEqualAl = function () {
        if (this.macros) this.macros.push("setge_al()");
        this.emitBytes3(0x0f, 0x9d, 0xc0);
    };

    Assembler.prototype.pushEax = function () {
        if (this.macros) this.macros.push("push_eax()"); this.emitByte(0x50); this.stackWords++;
    };

    Assembler.prototype.callDwordPtrEspDisplacement = function (displacement) {
        if (displacement < 0 || displacement > 127) {
            throw new RangeError("indirect call stack displacement is out of range");
        }
        if (this.macros) this.macros.push("call_dword_ptr_esp(" + displacement + ")");
        this.emitBytes3(0xff, 0x54, 0x24);
        this.emitByte(displacement);
    };

    Assembler.prototype.callEax = function () {
        if (this.macros) this.macros.push("call_eax()");
        this.emitBytes2(0xff, 0xd0);
    };
    Assembler.prototype.jumpEax = function () {
        if (this.macros) this.macros.push("jmp_eax()");
        this.emitBytes2(0xff, 0xe0);
    };
    Assembler.prototype.movEaxDwordPtrEcxPlusEaxTimes4LabelOffset = function (
            targetLabel, baseLabel) {
        if (this.macros) this.macros.push(
            "mov_eax_ptr_ecx_plus_eax_times_4(" + targetLabel + "-" + baseLabel + ")");
        this.emitBytes3(0x8b, 0x84, 0x81);
        this.labelDifference32(targetLabel, baseLabel);
    };

    Assembler.prototype.callLabel = function (name) {
        if (this.macros) this.macros.push("call(" + name + ")");
        this.emitByte(0xe8);
        this.relativeFixup(name);
    };

    Assembler.prototype.popEcx = function () {
        if (this.macros) this.macros.push("pop_ecx()"); this.emitByte(0x59); this.stackWords--;
    };
    Assembler.prototype.popEax = function () {
        if (this.macros) this.macros.push("pop_eax()");
        this.emitByte(0x58);
        this.stackWords--;
    };

    /* Used after a position-discovery call.  The return address was pushed by
     * the processor rather than by pushEax(), so it is deliberately absent
     * from the assembler's expression-stack accounting. */
    Assembler.prototype.popInstructionPointerEcx = function () {
        if (this.macros) this.macros.push("pop_instruction_pointer_ecx()");
        this.emitByte(0x59);
    };

    Assembler.prototype.addEaxEcx = function () {
        if (this.macros) this.macros.push("add_eax_ecx()"); this.emitBytes2(0x01, 0xc8);
    };
    Assembler.prototype.addEaxImmediate = function (value) {
        if (this.macros) this.macros.push("add_eax_i32(" + (value | 0) + ")");
        this.emitByte(0x05); this.word32(value);
    };
    Assembler.prototype.subtractEaxImmediate = function (value) {
        if (this.macros) this.macros.push("sub_eax_i32(" + (value | 0) + ")");
        this.emitByte(0x2d); this.word32(value);
    };
    Assembler.prototype.multiplyEaxImmediate = function (value) {
        if (this.macros) this.macros.push("imul_eax_i32(" + (value | 0) + ")");
        this.emitBytes2(0x69, 0xc0); this.word32(value);
    };
    Assembler.prototype.addEaxEbx = function () {
        if (this.macros) this.macros.push("add_eax_ebx()"); this.emitBytes2(0x01, 0xd8);
    };
    Assembler.prototype.addEaxEsi = function () {
        if (this.macros) this.macros.push("add_eax_esi()"); this.emitBytes2(0x01, 0xf0);
    };
    Assembler.prototype.addEaxEdi = function () {
        if (this.macros) this.macros.push("add_eax_edi()"); this.emitBytes2(0x01, 0xf8);
    };
    Assembler.prototype.addEaxEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("add_eax_ptr_ebp(" + displacement + ")");
        this.emitEbpMemory(0x03, "eax", displacement);
    };
    Assembler.prototype.subEcxEax = function () {
        if (this.macros) this.macros.push("sub_ecx_eax()");
        this.emitBytes2(0x29, 0xc1);
    };
    Assembler.prototype.subEaxEcx = function () {
        if (this.macros) this.macros.push("sub_eax_ecx()");
        this.emitBytes2(0x29, 0xc8);
    };
    Assembler.prototype.movEaxEcx = function () {
        if (this.macros) this.macros.push("mov_eax_ecx()");
        this.emitBytes2(0x89, 0xc8);
    };
    Assembler.prototype.movEcxEax = function () {
        if (this.macros) this.macros.push("mov_ecx_eax()");
        this.emitBytes2(0x89, 0xc1);
    };
    Assembler.prototype.imulEaxEcx = function () {
        if (this.macros) this.macros.push("imul_eax_ecx()");
        this.emitBytes3(0x0f, 0xaf, 0xc1);
    };
    Assembler.prototype.exchangeEaxEcx = function () {
        if (this.macros) this.macros.push("exchange_eax_ecx()");
        this.emitByte(0x91);
    };
    Assembler.prototype.signExtendEaxIntoEdx = function () {
        if (this.macros) this.macros.push("sign_extend_eax_into_edx()");
        this.emitByte(0x99);
    };
    Assembler.prototype.divideEaxByEcx = function () {
        if (this.macros) this.macros.push("divide_eax_by_ecx()");
        this.emitBytes2(0xf7, 0xf9);
    };
    Assembler.prototype.remainderEcxEax = function () {
        if (this.macros) this.macros.push("signed_remainder_ecx_eax()");
        this.emitByte(0x91);
        this.emitByte(0x99);
        this.emitBytes2(0xf7, 0xf9);
        this.emitBytes2(0x89, 0xd0);
    };
    Assembler.prototype.andEaxEcx = function () {
        if (this.macros) this.macros.push("and_eax_ecx()"); this.emitBytes2(0x21, 0xc8);
    };
    Assembler.prototype.orEaxEcx = function () {
        if (this.macros) this.macros.push("or_eax_ecx()"); this.emitBytes2(0x09, 0xc8);
    };
    Assembler.prototype.xorEaxEcx = function () {
        if (this.macros) this.macros.push("xor_eax_ecx()"); this.emitBytes2(0x31, 0xc8);
    };
    Assembler.prototype.negEax = function () {
        if (this.macros) this.macros.push("neg_eax()"); this.emitBytes2(0xf7, 0xd8);
    };
    Assembler.prototype.notEax = function () {
        if (this.macros) this.macros.push("not_eax()"); this.emitBytes2(0xf7, 0xd0);
    };
    Assembler.prototype.movEdxEax = function () {
        if (this.macros) this.macros.push("mov_edx_eax()"); this.emitBytes2(0x89, 0xc2);
    };
    Assembler.prototype.movEcxEdx = function () {
        if (this.macros) this.macros.push("mov_ecx_edx()"); this.emitBytes2(0x89, 0xd1);
    };
    Assembler.prototype.shiftLeftEaxCl = function () {
        if (this.macros) this.macros.push("shl_eax_cl()"); this.emitBytes2(0xd3, 0xe0);
    };
    Assembler.prototype.shiftRightEaxCl = function () {
        if (this.macros) this.macros.push("sar_eax_cl()"); this.emitBytes2(0xd3, 0xf8);
    };
    Assembler.prototype.shiftUnsignedRightEaxCl = function () {
        if (this.macros) this.macros.push("shr_eax_cl()"); this.emitBytes2(0xd3, 0xe8);
    };
    Assembler.prototype.shiftLeftEaxImmediate = function (count) {
        if (this.macros) this.macros.push("shl_eax_i8(" + (count & 31) + ")");
        this.emitBytes3(0xc1, 0xe0, count & 31);
    };
    Assembler.prototype.shiftRightEaxImmediate = function (count) {
        if (this.macros) this.macros.push("sar_eax_i8(" + (count & 31) + ")");
        this.emitBytes3(0xc1, 0xf8, count & 31);
    };
    Assembler.prototype.shiftUnsignedRightEaxImmediate = function (count) {
        if (this.macros) this.macros.push("shr_eax_i8(" + (count & 31) + ")");
        this.emitBytes3(0xc1, 0xe8, count & 31);
    };
    Assembler.prototype.andEaxImmediate = function (value) {
        if (this.macros) this.macros.push("and_eax_i32(" + (value | 0) + ")");
        this.emitByte(0x25); this.word32(value);
    };
    Assembler.prototype.xorEaxImmediate = function (value) {
        if (this.macros) this.macros.push("xor_eax_i32(" + (value | 0) + ")");
        this.emitByte(0x35); this.word32(value);
    };
    Assembler.prototype.reserveStackBytes = function (count) {
        if (this.macros) this.macros.push("sub_esp_bytes(" + count + ")");
        this.emitBytes3(0x83, 0xec, count);
    };
    Assembler.prototype.releaseStackBytes = function (count) {
        if (count === 0) return;
        if (this.macros) this.macros.push("add_esp_bytes(" + count + ")");
        /* ADD r/m32, imm8 sign-extends its immediate. Larger argument areas
         * require the imm32 form rather than silently wrapping the adjustment. */
        if (count <= MAX_SIGNED_BYTE_IMMEDIATE) {
            this.emitBytes3(0x83, 0xc4, count);
        } else {
            this.emitBytes2(0x81, 0xc4);
            this.word32(count);
        }
    };
    /* Unlike temporary x87 storage, these words were tracked by pushEax. */
    Assembler.prototype.discardStackWords = function (count) {
        this.releaseStackBytes(count * STACK_WORD_BYTES);
        this.stackWords -= count;
    };
    Assembler.prototype.storeX87ControlWordAtStack = function (offset) {
        if (this.macros) this.macros.push("fnstcw_stack(" + offset + ")");
        this.emitBytes3(0xd9, 0x7c, 0x24);
        this.emitByte(offset);
    };
    Assembler.prototype.loadStackWordToEax = function (offset) {
        if (this.macros) this.macros.push("movzx_eax_word_stack(" + offset + ")");
        this.emitBytes3(0x0f, 0xb7, 0x44);
        this.emitBytes2(0x24, offset);
    };
    Assembler.prototype.orEaxImmediate = function (value) {
        if (this.macros) this.macros.push("or_eax_i32(" + (value | 0) + ")");
        this.emitByte(0x0d); this.word32(value);
    };
    Assembler.prototype.storeAxAtStack = function (offset) {
        if (this.macros) this.macros.push("mov_word_stack_ax(" + offset + ")");
        this.emitBytes3(0x66, 0x89, 0x44);
        this.emitBytes2(0x24, offset);
    };
    Assembler.prototype.loadX87ControlWordFromStack = function (offset) {
        if (this.macros) this.macros.push("fldcw_stack(" + offset + ")");
        this.emitBytes3(0xd9, 0x6c, 0x24);
        this.emitByte(offset);
    };
    Assembler.prototype.storeInt64AtStackFromF64Pop = function (offset) {
        if (this.macros) this.macros.push("fistp_i64_stack(" + offset + ")");
        this.emitBytes3(0xdf, 0x7c, 0x24);
        this.emitByte(offset);
    };
    Assembler.prototype.storeInt32AtStackFromF64Pop = function (offset) {
        if (this.macros) this.macros.push("fistp_i32_stack(" + offset + ")");
        this.emitBytes3(0xdb, 0x5c, 0x24);
        this.emitByte(offset);
    };
    Assembler.prototype.loadStackDwordToEax = function (offset) {
        if (this.macros) this.macros.push("mov_eax_dword_stack(" + offset + ")");
        this.emitBytes3(0x8b, 0x44, 0x24);
        this.emitByte(offset);
    };
    Assembler.prototype.movDwordPtrEcxEax = function () {
        if (this.macros) this.macros.push("mov_dword_ptr_ecx_eax()");
        this.emitBytes2(0x89, 0x01);
    };
    Assembler.prototype.movBytePtrEcxAl = function () {
        if (this.macros) this.macros.push("mov_byte_ptr_ecx_al()");
        this.emitBytes2(0x88, 0x01);
    };
    Assembler.prototype.movzxEaxBytePtrEax = function () {
        if (this.macros) this.macros.push("movzx_eax_byte_ptr_eax()");
        this.emitBytes3(0x0f, 0xb6, 0x00);
    };
    Assembler.prototype.loadF64Eax = function () {
        if (this.macros) this.macros.push("fld_f64_ptr_eax()");
        this.emitBytes2(0xdd, 0x00);
    };
    Assembler.prototype.loadF32Eax = function () {
        if (this.macros) this.macros.push("fld_f32_ptr_eax()");
        this.emitBytes2(0xd9, 0x00);
    };
    Assembler.prototype.loadI32EaxAsF64 = function () {
        if (this.macros) this.macros.push("fild_i32_ptr_eax()");
        this.emitBytes2(0xdb, 0x00);
    };
    Assembler.prototype.storeF64EcxPop = function () {
        if (this.macros) this.macros.push("fstp_f64_ptr_ecx()");
        this.emitBytes2(0xdd, 0x19);
    };
    Assembler.prototype.storeF32EcxPop = function () {
        if (this.macros) this.macros.push("fstp_f32_ptr_ecx()");
        this.emitBytes2(0xd9, 0x19);
    };
    Assembler.prototype.addF64Pop = function () {
        if (this.macros) this.macros.push("faddp_st1_st0()");
        this.emitBytes2(0xde, 0xc1);
    };
    Assembler.prototype.subtractF64Pop = function () {
        if (this.macros) this.macros.push("fsubp_st1_st0()");
        this.emitBytes2(0xde, 0xe9);
    };
    Assembler.prototype.multiplyF64Pop = function () {
        if (this.macros) this.macros.push("fmulp_st1_st0()");
        this.emitBytes2(0xde, 0xc9);
    };
    Assembler.prototype.divideF64Pop = function () {
        if (this.macros) this.macros.push("fdivp_st1_st0()");
        this.emitBytes2(0xde, 0xf9);
    };
    Assembler.prototype.negateF64 = function () {
        if (this.macros) this.macros.push("fchs()");
        this.emitBytes2(0xd9, 0xe0);
    };
    Assembler.prototype.sqrtF64 = function () {
        if (this.macros) this.macros.push("fsqrt()");
        this.emitBytes2(0xd9, 0xfa);
    };
    Assembler.prototype.sinF64 = function () {
        if (this.macros) this.macros.push("fsin()");
        this.emitBytes2(0xd9, 0xfe);
    };
    Assembler.prototype.cosF64 = function () {
        if (this.macros) this.macros.push("fcos()");
        this.emitBytes2(0xd9, 0xff);
    };
    Assembler.prototype.atan2F64Pop = function () {
        if (this.macros) this.macros.push("fpatan_st1_st0()");
        this.emitBytes2(0xd9, 0xf3);
    };
    Assembler.prototype.partialRemainderF64 = function () {
        if (this.macros) this.macros.push("fprem_st0_st1()");
        this.emitBytes2(0xd9, 0xf8);
    };
    Assembler.prototype.storeF64StatusInAx = function () {
        if (this.macros) this.macros.push("fnstsw_ax()");
        this.emitBytes2(0xdf, 0xe0);
    };
    Assembler.prototype.testF64RemainderIncomplete = function () {
        if (this.macros) this.macros.push("test_ah_fprem_incomplete()");
        this.emitBytes3(0xf6, 0xc4, 0x04);
    };
    Assembler.prototype.absF64 = function () {
        if (this.macros) this.macros.push("fabs()");
        this.emitBytes2(0xd9, 0xe1);
    };
    Assembler.prototype.multiplyLog2F64Pop = function () {
        if (this.macros) this.macros.push("fyl2x()");
        this.emitBytes2(0xd9, 0xf1);
    };
    Assembler.prototype.duplicateF64 = function () {
        if (this.macros) this.macros.push("fld_st0()");
        this.emitBytes2(0xd9, 0xc0);
    };
    Assembler.prototype.roundF64ToIntegral = function () {
        if (this.macros) this.macros.push("frndint()");
        this.emitBytes2(0xd9, 0xfc);
    };
    Assembler.prototype.exchangeF64WithSt1 = function () {
        if (this.macros) this.macros.push("fxch_st1()");
        this.emitBytes2(0xd9, 0xc9);
    };
    Assembler.prototype.subtractSt1FromF64 = function () {
        if (this.macros) this.macros.push("fsub_st0_st1()");
        this.emitBytes2(0xd8, 0xe1);
    };
    Assembler.prototype.twoPowerF64MinusOne = function () {
        if (this.macros) this.macros.push("f2xm1()");
        this.emitBytes2(0xd9, 0xf0);
    };
    Assembler.prototype.loadOneF64 = function () {
        if (this.macros) this.macros.push("fld1()");
        this.emitBytes2(0xd9, 0xe8);
    };
    Assembler.prototype.loadLn2F64 = function () {
        if (this.macros) this.macros.push("fldln2()");
        this.emitBytes2(0xd9, 0xed);
    };
    Assembler.prototype.scaleF64BySt1 = function () {
        if (this.macros) this.macros.push("fscale()");
        this.emitBytes2(0xd9, 0xfd);
    };
    Assembler.prototype.popSt1F64 = function () {
        if (this.macros) this.macros.push("fstp_st1()");
        this.emitBytes2(0xdd, 0xd9);
    };
    Assembler.prototype.ret = function () {
        if (this.stackWords !== 0) {
            throw new Error("unbalanced assembler stack: " + this.stackWords +
                            " outstanding word(s)");
        }
        if (this.macros) this.macros.push("ret()"); this.emitByte(0xc3);
    };
    Assembler.prototype.dump = function () {
        return this.macros ? this.macros.join("\n") : "";
    };

    Assembler.prototype.label = function (name) {
        if (this.labels[name] !== undefined) throw new Error("duplicate x86 label " + name);
        if (this.macros) this.macros.push("label(" + name + ")");
        this.labels[name] = this.length;
    };

    Assembler.prototype.jump = function (name) {
        if (this.macros) this.macros.push("jmp(" + name + ")");
        this.emitByte(0xe9);
        this.relativeFixup(name);
    };

    Assembler.prototype.jumpNotEqual = function (name) {
        if (this.macros) this.macros.push("jne(" + name + ")");
        this.emitBytes2(0x0f, 0x85);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpNotZero = function (name) {
        if (this.macros) this.macros.push("jnz(" + name + ")");
        this.emitBytes2(0x0f, 0x85);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpEqual = function (name) {
        if (this.macros) this.macros.push("je(" + name + ")");
        this.emitBytes2(0x0f, 0x84);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpLess = function (name) {
        if (this.macros) this.macros.push("jl(" + name + ")");
        this.emitBytes2(0x0f, 0x8c);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpGreaterOrEqual = function (name) {
        if (this.macros) this.macros.push("jge(" + name + ")");
        this.emitBytes2(0x0f, 0x8d);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpGreater = function (name) {
        if (this.macros) this.macros.push("jg(" + name + ")");
        this.emitBytes2(0x0f, 0x8f);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpLessOrEqual = function (name) {
        if (this.macros) this.macros.push("jle(" + name + ")");
        this.emitBytes2(0x0f, 0x8e);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpParity = function (name) {
        if (this.macros) this.macros.push("jp(" + name + ")");
        this.emitBytes2(0x0f, 0x8a);
        this.relativeFixup(name);
    };

    Assembler.prototype.relativeFixup = function (name) {
        this.fixups.push({name: name, displacement: this.length,
                          end: this.length + 4});
        this.word32(0);
    };
    /* Position-independent data: unlike relativeFixup, the base need not be
     * the end of an instruction. Used for indexed dispatch table entries. */
    Assembler.prototype.labelDifference32 = function (name, baseLabel) {
        this.fixups.push({name: name, baseLabel: baseLabel,
                          displacement: this.length});
        this.word32(0);
    };

    Assembler.prototype.resolveLabels = function () {
        var index = 0;
        while (index < this.fixups.length) {
            var fixup = this.fixups[index++];
            var target = this.labels[fixup.name];
            if (target === undefined) throw new Error("undefined x86 label " + fixup.name);
            var base = fixup.baseLabel === undefined ? fixup.end :
                this.labels[fixup.baseLabel];
            if (base === undefined) throw new Error("undefined x86 base label " +
                                                    fixup.baseLabel);
            var value = (target - base) >>> 0;
            if (this.storageFFI) {
                poke32(this.nativePointer + fixup.displacement, value | 0);
                continue;
            }
            this.bytes[fixup.displacement] = value & 255;
            this.bytes[fixup.displacement + 1] = (value >>> 8) & 255;
            this.bytes[fixup.displacement + 2] = (value >>> 16) & 255;
            this.bytes[fixup.displacement + 3] = (value >>> 24) & 255;
        }
        this.fixups = [];
        return this.bytes;
    };

    Assembler.prototype.pushEbp = function () {
        if (this.macros) this.macros.push("push_ebp()"); this.emitByte(0x55);
    };
    Assembler.prototype.movEbpEsp = function () {
        if (this.macros) this.macros.push("mov_ebp_esp()"); this.emitBytes2(0x89, 0xe5);
    };
    Assembler.prototype.pushEbx = function () {
        if (this.macros) this.macros.push("push_ebx()"); this.emitByte(0x53);
    };
    Assembler.prototype.pushEsi = function () {
        if (this.macros) this.macros.push("push_esi()"); this.emitByte(0x56);
    };
    Assembler.prototype.pushEdi = function () {
        if (this.macros) this.macros.push("push_edi()"); this.emitByte(0x57);
    };
    Assembler.prototype.movEbxEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("mov_ebx_ptr_ebp(" + displacement + ")");
        this.emitEbpMemory(0x8b, "ebx", displacement);
    };
    Assembler.prototype.movEsiEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("mov_esi_ptr_ebp(" + displacement + ")");
        this.emitEbpMemory(0x8b, "esi", displacement);
    };
    Assembler.prototype.movEdiEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("mov_edi_ptr_ebp(" + displacement + ")");
        this.emitEbpMemory(0x8b, "edi", displacement);
    };
    Assembler.prototype.movEaxEbx = function () {
        if (this.macros) this.macros.push("mov_eax_ebx()");
        this.emitBytes2(0x89, 0xd8);
    };
    Assembler.prototype.movEaxEsi = function () {
        if (this.macros) this.macros.push("mov_eax_esi()");
        this.emitBytes2(0x89, 0xf0);
    };
    Assembler.prototype.movEaxEdi = function () {
        if (this.macros) this.macros.push("mov_eax_edi()");
        this.emitBytes2(0x89, 0xf8);
    };
    Assembler.prototype.movEbxEax = function () {
        if (this.macros) this.macros.push("mov_ebx_eax()");
        this.emitBytes2(0x89, 0xc3);
    };
    Assembler.prototype.movEsiEax = function () {
        if (this.macros) this.macros.push("mov_esi_eax()");
        this.emitBytes2(0x89, 0xc6);
    };
    Assembler.prototype.movEdiEax = function () {
        if (this.macros) this.macros.push("mov_edi_eax()");
        this.emitBytes2(0x89, 0xc7);
    };
    Assembler.prototype.addEsiEbx = function () {
        if (this.macros) this.macros.push("add_esi_ebx()"); this.emitBytes2(0x01, 0xde);
    };
    Assembler.prototype.popEsi = function () {
        if (this.macros) this.macros.push("pop_esi()"); this.emitByte(0x5e);
    };
    Assembler.prototype.popEdi = function () {
        if (this.macros) this.macros.push("pop_edi()"); this.emitByte(0x5f);
    };
    Assembler.prototype.popEbx = function () {
        if (this.macros) this.macros.push("pop_ebx()"); this.emitByte(0x5b);
    };
    Assembler.prototype.leave = function () {
        if (this.macros) this.macros.push("leave()"); this.emitByte(0xc9);
    };

    Assembler.prototype.movEaxHeapWord = function (offset) {
        if (this.macros) this.macros.push("mov_eax_heap_word(" + offset + ")");
        this.emitBytes2(0x8b, 0x83); this.word32(offset);
    };
    Assembler.prototype.movEaxFrameWord = function (offset) {
        if (this.macros) this.macros.push("mov_eax_frame_word(" + offset + ")");
        this.emitBytes2(0x8b, 0x86); this.word32(offset);
    };
    Assembler.prototype.movFrameWordEax = function (offset) {
        if (this.macros) this.macros.push("mov_frame_word_eax(" + offset + ")");
        this.emitBytes2(0x89, 0x86); this.word32(offset);
    };

    Assembler.prototype.compareFrameTag = function (offset, tag) {
        if (this.macros) this.macros.push("cmp_frame_tag(" + offset + "," + tag + ")");
        this.emitBytes2(0x83, 0xbe); this.word32(offset);
        this.emitByte(tag);
    };

    Assembler.prototype.loadFrameInt32AsF64 = function (offset) {
        if (this.macros) this.macros.push("fild_i32_frame(" + offset + ")");
        this.emitBytes2(0xdb, 0x86); this.word32(offset);
    };

    Assembler.prototype.loadFrameF64 = function (offset) {
        if (this.macros) this.macros.push("fld_f64_frame(" + offset + ")");
        this.emitBytes2(0xdd, 0x86); this.word32(offset);
    };

    Assembler.prototype.xorEaxOne = function () {
        if (this.macros) this.macros.push("xor_eax_1()");
        this.emitBytes3(0x83, 0xf0, 0x01);
    };
    Assembler.prototype.movFrameImmediate = function (offset, value) {
        if (this.macros) this.macros.push("mov_frame_i32(" + offset + "," + (value | 0) + ")");
        this.emitBytes2(0xc7, 0x86); this.word32(offset); this.word32(value);
    };
    Assembler.prototype.fstpFrameF64 = function (offset) {
        if (this.macros) this.macros.push("fstp_f64_frame(" + offset + ")");
        this.emitBytes2(0xdd, 0x9e); this.word32(offset);
    };
    Assembler.prototype.fucomipSt0St1 = function () {
        if (this.macros) this.macros.push("fucomip_st0_st1()"); this.emitBytes2(0xdf, 0xe9);
    };
    Assembler.prototype.fstpSt0 = function () {
        if (this.macros) this.macros.push("fstp_st0()"); this.emitBytes2(0xdd, 0xd8);
    };
    Assembler.prototype.setAboveAl = function () {
        if (this.macros) this.macros.push("seta_al()");
        this.emitBytes3(0x0f, 0x97, 0xc0);
    };
    Assembler.prototype.setAboveOrEqualAl = function () {
        if (this.macros) this.macros.push("setae_al()");
        this.emitBytes3(0x0f, 0x93, 0xc0);
    };
    Assembler.prototype.setEqualAl = function () {
        if (this.macros) this.macros.push("sete_al()");
        this.emitBytes3(0x0f, 0x94, 0xc0);
    };
    Assembler.prototype.movzxEaxAl = function () {
        if (this.macros) this.macros.push("movzx_eax_al()");
        this.emitBytes3(0x0f, 0xb6, 0xc0);
    };
    Assembler.prototype.addEaxImmediate8 = function (value) {
        if (this.macros) this.macros.push("add_eax_i8(" + value + ")");
        this.emitBytes3(0x83, 0xc0, value);
    };

    root.GuestVMX86Assembler = Assembler;
    if (typeof module !== "undefined" && module.exports) module.exports = Assembler;
}(this));
