/* Small i386 macro assembler. Callers use named instructions; raw instruction
 * arrays never appear in kernels or backend code. */
(function (root) {
    function Assembler(captureMacros) {
        this.bytes = [];
        this.macros = captureMacros === false ? null : [];
        this.stackWords = 0;
        this.labels = {};
        this.fixups = [];
    }

    Assembler.prototype.emitByte = function (value) {
        this.bytes[this.bytes.length] = value & 255;
    };

    Assembler.prototype.emitBytes2 = function (first, second) {
        var index = this.bytes.length;
        this.bytes[index] = first & 255;
        this.bytes[index + 1] = second & 255;
    };

    Assembler.prototype.emitBytes3 = function (first, second, third) {
        var index = this.bytes.length;
        this.bytes[index] = first & 255;
        this.bytes[index + 1] = second & 255;
        this.bytes[index + 2] = third & 255;
    };

    Assembler.prototype.word32 = function (value) {
        value = Number(value) >>> 0;
        var index = this.bytes.length;
        this.bytes[index] = value & 255;
        this.bytes[index + 1] = (value >>> 8) & 255;
        this.bytes[index + 2] = (value >>> 16) & 255;
        this.bytes[index + 3] = (value >>> 24) & 255;
    };

    Assembler.prototype.movEaxImmediate = function (value) {
        if (this.macros) this.macros.push("mov_eax_i32(" + (value | 0) + ")");
        this.emitByte(0xb8); this.word32(value);
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
        this.emitBytes3(0x8b, 0x45, displacement);
    };
    Assembler.prototype.subEspImmediate = function (value) {
        if (this.macros) this.macros.push("sub_esp_i32(" + value + ")");
        this.emitBytes2(0x81, 0xec); this.word32(value);
    };
    Assembler.prototype.movEaxLocal = function (index) {
        var displacement = -(index + 1) * 4;
        if (this.macros) this.macros.push("mov_eax_local(" + index + ")");
        this.emitBytes2(0x8b, 0x85); this.word32(displacement);
    };
    Assembler.prototype.movLocalEax = function (index) {
        var displacement = -(index + 1) * 4;
        if (this.macros) this.macros.push("mov_local_eax(" + index + ")");
        this.emitBytes2(0x89, 0x85); this.word32(displacement);
    };
    Assembler.prototype.movEbpArgumentEax = function (index) {
        var displacement = 8 + index * 4;
        if (this.macros) this.macros.push("mov_ebp_arg_eax(" + index + ")");
        this.emitBytes3(0x89, 0x45, displacement);
    };
    Assembler.prototype.movEaxDwordPtrEax = function () {
        if (this.macros) this.macros.push("mov_eax_dword_ptr_eax()");
        this.emitBytes2(0x8b, 0x00);
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
        this.emitBytes2(0x3b, 0x85); this.word32(displacement);
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

    Assembler.prototype.popEcx = function () {
        if (this.macros) this.macros.push("pop_ecx()"); this.emitByte(0x59); this.stackWords--;
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
        this.emitBytes2(0x03, 0x85); this.word32(displacement);
    };
    Assembler.prototype.subEcxEax = function () {
        if (this.macros) this.macros.push("sub_ecx_eax()");
        this.emitBytes2(0x29, 0xc1);
    };
    Assembler.prototype.movEaxEcx = function () {
        if (this.macros) this.macros.push("mov_eax_ecx()");
        this.emitBytes2(0x89, 0xc8);
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
    Assembler.prototype.reserveStackBytes = function (count) {
        if (this.macros) this.macros.push("sub_esp_bytes(" + count + ")");
        this.emitBytes3(0x83, 0xec, count);
    };
    Assembler.prototype.releaseStackBytes = function (count) {
        if (this.macros) this.macros.push("add_esp_bytes(" + count + ")");
        this.emitBytes3(0x83, 0xc4, count);
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
    Assembler.prototype.loadI32EaxAsF64 = function () {
        if (this.macros) this.macros.push("fild_i32_ptr_eax()");
        this.emitBytes2(0xdb, 0x00);
    };
    Assembler.prototype.storeF64EcxPop = function () {
        if (this.macros) this.macros.push("fstp_f64_ptr_ecx()");
        this.emitBytes2(0xdd, 0x19);
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
        this.labels[name] = this.bytes.length;
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
        this.fixups.push({name: name, displacement: this.bytes.length,
                          end: this.bytes.length + 4});
        this.word32(0);
    };

    Assembler.prototype.resolveLabels = function () {
        var index = 0;
        while (index < this.fixups.length) {
            var fixup = this.fixups[index++];
            var target = this.labels[fixup.name];
            if (target === undefined) throw new Error("undefined x86 label " + fixup.name);
            var value = (target - fixup.end) >>> 0;
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
        this.emitBytes3(0x8b, 0x5d, displacement);
    };
    Assembler.prototype.movEsiEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("mov_esi_ptr_ebp(" + displacement + ")");
        this.emitBytes3(0x8b, 0x75, displacement);
    };
    Assembler.prototype.movEdiEbpDisplacement = function (displacement) {
        if (this.macros) this.macros.push("mov_edi_ptr_ebp(" + displacement + ")");
        this.emitBytes3(0x8b, 0x7d, displacement);
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
