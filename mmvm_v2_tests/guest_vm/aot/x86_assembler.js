/* Small i386 macro assembler. Callers use named instructions; raw instruction
 * arrays never appear in kernels or backend code. */
(function (root) {
    function Assembler() {
        this.bytes = [];
        this.macros = [];
        this.stackWords = 0;
        this.labels = {};
        this.fixups = [];
    }

    Assembler.prototype.emitByte = function (value) {
        this.bytes.push(value & 255);
    };

    Assembler.prototype.word32 = function (value) {
        value = Number(value) >>> 0;
        this.emitByte(value); this.emitByte(value >>> 8);
        this.emitByte(value >>> 16); this.emitByte(value >>> 24);
    };

    Assembler.prototype.movEaxImmediate = function (value) {
        this.macros.push("mov_eax_i32(" + (value | 0) + ")");
        this.emitByte(0xb8); this.word32(value);
    };

    Assembler.prototype.movEaxArgument = function (index) {
        var displacement = 4 + index * 4 + this.stackWords * 4;
        this.macros.push("mov_eax_arg(" + index + ")");
        this.emitByte(0x8b); this.emitByte(0x44); this.emitByte(0x24);
        this.emitByte(displacement);
    };

    Assembler.prototype.movEaxEbpArgument = function (index) {
        var displacement = 8 + index * 4;
        this.macros.push("mov_eax_ebp_arg(" + index + ")");
        this.emitByte(0x8b); this.emitByte(0x45); this.emitByte(displacement);
    };
    Assembler.prototype.subEspImmediate = function (value) {
        this.macros.push("sub_esp_i32(" + value + ")");
        this.emitByte(0x81); this.emitByte(0xec); this.word32(value);
    };
    Assembler.prototype.movEaxLocal = function (index) {
        var displacement = -(index + 1) * 4;
        this.macros.push("mov_eax_local(" + index + ")");
        this.emitByte(0x8b); this.emitByte(0x85); this.word32(displacement);
    };
    Assembler.prototype.movLocalEax = function (index) {
        var displacement = -(index + 1) * 4;
        this.macros.push("mov_local_eax(" + index + ")");
        this.emitByte(0x89); this.emitByte(0x85); this.word32(displacement);
    };
    Assembler.prototype.movEbpArgumentEax = function (index) {
        var displacement = 8 + index * 4;
        this.macros.push("mov_ebp_arg_eax(" + index + ")");
        this.emitByte(0x89); this.emitByte(0x45); this.emitByte(displacement);
    };
    Assembler.prototype.movEaxDwordPtrEax = function () {
        this.macros.push("mov_eax_dword_ptr_eax()");
        this.emitByte(0x8b); this.emitByte(0x00);
    };
    Assembler.prototype.testEaxEax = function () {
        this.macros.push("test_eax()");
        this.emitByte(0x85); this.emitByte(0xc0);
    };
    Assembler.prototype.compareEcxEax = function () {
        this.macros.push("cmp_ecx_eax()");
        this.emitByte(0x39); this.emitByte(0xc1);
    };
    Assembler.prototype.setNotEqualAl = function () {
        this.macros.push("setne_al()");
        this.emitByte(0x0f); this.emitByte(0x95); this.emitByte(0xc0);
    };
    Assembler.prototype.setLessAl = function () {
        this.macros.push("setl_al()");
        this.emitByte(0x0f); this.emitByte(0x9c); this.emitByte(0xc0);
    };
    Assembler.prototype.setLessOrEqualAl = function () {
        this.macros.push("setle_al()");
        this.emitByte(0x0f); this.emitByte(0x9e); this.emitByte(0xc0);
    };
    Assembler.prototype.setGreaterAl = function () {
        this.macros.push("setg_al()");
        this.emitByte(0x0f); this.emitByte(0x9f); this.emitByte(0xc0);
    };
    Assembler.prototype.setGreaterOrEqualAl = function () {
        this.macros.push("setge_al()");
        this.emitByte(0x0f); this.emitByte(0x9d); this.emitByte(0xc0);
    };

    Assembler.prototype.pushEax = function () {
        this.macros.push("push_eax()"); this.emitByte(0x50); this.stackWords++;
    };

    Assembler.prototype.popEcx = function () {
        this.macros.push("pop_ecx()"); this.emitByte(0x59); this.stackWords--;
    };

    Assembler.prototype.addEaxEcx = function () {
        this.macros.push("add_eax_ecx()"); this.emitByte(0x01); this.emitByte(0xc8);
    };
    Assembler.prototype.subEcxEax = function () {
        this.macros.push("sub_ecx_eax()");
        this.emitByte(0x29); this.emitByte(0xc1);
    };
    Assembler.prototype.movEaxEcx = function () {
        this.macros.push("mov_eax_ecx()");
        this.emitByte(0x89); this.emitByte(0xc8);
    };
    Assembler.prototype.imulEaxEcx = function () {
        this.macros.push("imul_eax_ecx()");
        this.emitByte(0x0f); this.emitByte(0xaf); this.emitByte(0xc1);
    };
    Assembler.prototype.andEaxEcx = function () {
        this.macros.push("and_eax_ecx()"); this.emitByte(0x21); this.emitByte(0xc8);
    };
    Assembler.prototype.orEaxEcx = function () {
        this.macros.push("or_eax_ecx()"); this.emitByte(0x09); this.emitByte(0xc8);
    };
    Assembler.prototype.xorEaxEcx = function () {
        this.macros.push("xor_eax_ecx()"); this.emitByte(0x31); this.emitByte(0xc8);
    };
    Assembler.prototype.negEax = function () {
        this.macros.push("neg_eax()"); this.emitByte(0xf7); this.emitByte(0xd8);
    };
    Assembler.prototype.notEax = function () {
        this.macros.push("not_eax()"); this.emitByte(0xf7); this.emitByte(0xd0);
    };
    Assembler.prototype.movDwordPtrEcxEax = function () {
        this.macros.push("mov_dword_ptr_ecx_eax()");
        this.emitByte(0x89); this.emitByte(0x01);
    };
    Assembler.prototype.loadF64Eax = function () {
        this.macros.push("fld_f64_ptr_eax()");
        this.emitByte(0xdd); this.emitByte(0x00);
    };
    Assembler.prototype.storeF64EcxPop = function () {
        this.macros.push("fstp_f64_ptr_ecx()");
        this.emitByte(0xdd); this.emitByte(0x19);
    };
    Assembler.prototype.addF64Pop = function () {
        this.macros.push("faddp_st1_st0()");
        this.emitByte(0xde); this.emitByte(0xc1);
    };
    Assembler.prototype.subtractF64Pop = function () {
        this.macros.push("fsubp_st1_st0()");
        this.emitByte(0xde); this.emitByte(0xe9);
    };
    Assembler.prototype.multiplyF64Pop = function () {
        this.macros.push("fmulp_st1_st0()");
        this.emitByte(0xde); this.emitByte(0xc9);
    };
    Assembler.prototype.divideF64Pop = function () {
        this.macros.push("fdivp_st1_st0()");
        this.emitByte(0xde); this.emitByte(0xf9);
    };
    Assembler.prototype.negateF64 = function () {
        this.macros.push("fchs()");
        this.emitByte(0xd9); this.emitByte(0xe0);
    };
    Assembler.prototype.ret = function () {
        if (this.stackWords !== 0) throw new Error("unbalanced assembler stack");
        this.macros.push("ret()"); this.emitByte(0xc3);
    };
    Assembler.prototype.dump = function () { return this.macros.join("\n"); };

    Assembler.prototype.label = function (name) {
        if (this.labels[name] !== undefined) throw new Error("duplicate x86 label " + name);
        this.macros.push("label(" + name + ")");
        this.labels[name] = this.bytes.length;
    };

    Assembler.prototype.jump = function (name) {
        this.macros.push("jmp(" + name + ")");
        this.emitByte(0xe9);
        this.relativeFixup(name);
    };

    Assembler.prototype.jumpNotEqual = function (name) {
        this.macros.push("jne(" + name + ")");
        this.emitByte(0x0f); this.emitByte(0x85);
        this.relativeFixup(name);
    };
    Assembler.prototype.jumpEqual = function (name) {
        this.macros.push("je(" + name + ")");
        this.emitByte(0x0f); this.emitByte(0x84);
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
        this.macros.push("push_ebp()"); this.emitByte(0x55);
    };
    Assembler.prototype.movEbpEsp = function () {
        this.macros.push("mov_ebp_esp()"); this.emitByte(0x89); this.emitByte(0xe5);
    };
    Assembler.prototype.pushEbx = function () {
        this.macros.push("push_ebx()"); this.emitByte(0x53);
    };
    Assembler.prototype.pushEsi = function () {
        this.macros.push("push_esi()"); this.emitByte(0x56);
    };
    Assembler.prototype.movEbxEbpDisplacement = function (displacement) {
        this.macros.push("mov_ebx_ptr_ebp(" + displacement + ")");
        this.emitByte(0x8b); this.emitByte(0x5d); this.emitByte(displacement);
    };
    Assembler.prototype.movEsiEbpDisplacement = function (displacement) {
        this.macros.push("mov_esi_ptr_ebp(" + displacement + ")");
        this.emitByte(0x8b); this.emitByte(0x75); this.emitByte(displacement);
    };
    Assembler.prototype.addEsiEbx = function () {
        this.macros.push("add_esi_ebx()"); this.emitByte(0x01); this.emitByte(0xde);
    };
    Assembler.prototype.popEsi = function () {
        this.macros.push("pop_esi()"); this.emitByte(0x5e);
    };
    Assembler.prototype.popEbx = function () {
        this.macros.push("pop_ebx()"); this.emitByte(0x5b);
    };
    Assembler.prototype.leave = function () {
        this.macros.push("leave()"); this.emitByte(0xc9);
    };

    Assembler.prototype.movEaxHeapWord = function (offset) {
        this.macros.push("mov_eax_heap_word(" + offset + ")");
        this.emitByte(0x8b); this.emitByte(0x83); this.word32(offset);
    };
    Assembler.prototype.movEaxFrameWord = function (offset) {
        this.macros.push("mov_eax_frame_word(" + offset + ")");
        this.emitByte(0x8b); this.emitByte(0x86); this.word32(offset);
    };
    Assembler.prototype.movFrameWordEax = function (offset) {
        this.macros.push("mov_frame_word_eax(" + offset + ")");
        this.emitByte(0x89); this.emitByte(0x86); this.word32(offset);
    };

    Assembler.prototype.compareFrameTag = function (offset, tag) {
        this.macros.push("cmp_frame_tag(" + offset + "," + tag + ")");
        this.emitByte(0x83); this.emitByte(0xbe); this.word32(offset);
        this.emitByte(tag);
    };

    Assembler.prototype.loadFrameInt32AsF64 = function (offset) {
        this.macros.push("fild_i32_frame(" + offset + ")");
        this.emitByte(0xdb); this.emitByte(0x86); this.word32(offset);
    };

    Assembler.prototype.loadFrameF64 = function (offset) {
        this.macros.push("fld_f64_frame(" + offset + ")");
        this.emitByte(0xdd); this.emitByte(0x86); this.word32(offset);
    };

    Assembler.prototype.xorEaxOne = function () {
        this.macros.push("xor_eax_1()");
        this.emitByte(0x83); this.emitByte(0xf0); this.emitByte(0x01);
    };
    Assembler.prototype.movFrameImmediate = function (offset, value) {
        this.macros.push("mov_frame_i32(" + offset + "," + (value | 0) + ")");
        this.emitByte(0xc7); this.emitByte(0x86); this.word32(offset); this.word32(value);
    };
    Assembler.prototype.fstpFrameF64 = function (offset) {
        this.macros.push("fstp_f64_frame(" + offset + ")");
        this.emitByte(0xdd); this.emitByte(0x9e); this.word32(offset);
    };
    Assembler.prototype.fucomipSt0St1 = function () {
        this.macros.push("fucomip_st0_st1()"); this.emitByte(0xdf); this.emitByte(0xe9);
    };
    Assembler.prototype.fstpSt0 = function () {
        this.macros.push("fstp_st0()"); this.emitByte(0xdd); this.emitByte(0xd8);
    };
    Assembler.prototype.setAboveAl = function () {
        this.macros.push("seta_al()");
        this.emitByte(0x0f); this.emitByte(0x97); this.emitByte(0xc0);
    };
    Assembler.prototype.setAboveOrEqualAl = function () {
        this.macros.push("setae_al()");
        this.emitByte(0x0f); this.emitByte(0x93); this.emitByte(0xc0);
    };
    Assembler.prototype.setEqualAl = function () {
        this.macros.push("sete_al()");
        this.emitByte(0x0f); this.emitByte(0x94); this.emitByte(0xc0);
    };
    Assembler.prototype.movzxEaxAl = function () {
        this.macros.push("movzx_eax_al()");
        this.emitByte(0x0f); this.emitByte(0xb6); this.emitByte(0xc0);
    };
    Assembler.prototype.addEaxImmediate8 = function (value) {
        this.macros.push("add_eax_i8(" + value + ")");
        this.emitByte(0x83); this.emitByte(0xc0); this.emitByte(value);
    };

    root.GuestVMX86Assembler = Assembler;
    if (typeof module !== "undefined" && module.exports) module.exports = Assembler;
}(this));
