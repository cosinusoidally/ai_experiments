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

    Assembler.prototype.pushEax = function () {
        this.macros.push("push_eax()"); this.emitByte(0x50); this.stackWords++;
    };

    Assembler.prototype.popEcx = function () {
        this.macros.push("pop_ecx()"); this.emitByte(0x59); this.stackWords--;
    };

    Assembler.prototype.addEaxEcx = function () {
        this.macros.push("add_eax_ecx()"); this.emitByte(0x01); this.emitByte(0xc8);
    };
    Assembler.prototype.subEcxEaxMoveEax = function () {
        this.macros.push("sub_ecx_eax();mov_eax_ecx()");
        this.emitByte(0x29); this.emitByte(0xc1);
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

    Assembler.prototype.beginFrameKernel = function () {
        this.macros.push("prologue_frame_kernel()");
        this.emitByte(0x55);                         /* push ebp */
        this.emitByte(0x89); this.emitByte(0xe5);   /* mov ebp,esp */
        this.emitByte(0x53);                         /* push ebx */
        this.emitByte(0x56);                         /* push esi */
        this.emitByte(0x8b); this.emitByte(0x5d); this.emitByte(0x08); /* ebx=arg0 */
        this.emitByte(0x8b); this.emitByte(0x75); this.emitByte(0x0c); /* esi=arg1 */
        this.emitByte(0x01); this.emitByte(0xde);   /* add esi,ebx */
    };

    Assembler.prototype.endFrameKernel = function () {
        this.macros.push("epilogue_frame_kernel()");
        this.emitByte(0x5e); this.emitByte(0x5b);   /* pop esi; pop ebx */
        this.emitByte(0xc9); this.emitByte(0xc3);   /* leave; ret */
    };

    Assembler.prototype.copyHeapWordToFrame = function (heapOffset, frameOffset) {
        this.macros.push("copy_heap_word_to_frame(" + heapOffset + "," + frameOffset + ")");
        this.emitByte(0x8b); this.emitByte(0x83); this.word32(heapOffset); /* eax=[ebx+] */
        this.emitByte(0x89); this.emitByte(0x86); this.word32(frameOffset); /* [esi+]=eax */
    };

    Assembler.prototype.copyFrameWord = function (sourceOffset, targetOffset) {
        this.macros.push("copy_frame_word(" + sourceOffset + "," + targetOffset + ")");
        this.emitByte(0x8b); this.emitByte(0x86); this.word32(sourceOffset);
        this.emitByte(0x89); this.emitByte(0x86); this.word32(targetOffset);
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

    Assembler.prototype.storeFrameF64 = function (tagOffset, payloadOffset) {
        this.macros.push("store_f64_frame(" + tagOffset + "," + payloadOffset + ")");
        this.emitByte(0xc7); this.emitByte(0x86); this.word32(tagOffset); this.word32(6);
        this.emitByte(0xdd); this.emitByte(0x9e); this.word32(payloadOffset);
        this.emitByte(0xc7); this.emitByte(0x86); this.word32(payloadOffset + 8);
        this.word32(0);
    };
    Assembler.prototype.compareF64AboveToEax = function () {
        this.macros.push("fucomip_st0_st1();fstp_st0();seta_al();movzx_eax_al()");
        this.emitByte(0xdf); this.emitByte(0xe9);
        this.emitByte(0xdd); this.emitByte(0xd8);
        this.emitByte(0x0f); this.emitByte(0x97); this.emitByte(0xc0);
        this.emitByte(0x0f); this.emitByte(0xb6); this.emitByte(0xc0);
    };
    Assembler.prototype.compareF64AboveOrEqualToEax = function () {
        this.macros.push("fucomip_st0_st1();fstp_st0();setae_al();movzx_eax_al()");
        this.emitByte(0xdf); this.emitByte(0xe9);
        this.emitByte(0xdd); this.emitByte(0xd8);
        this.emitByte(0x0f); this.emitByte(0x93); this.emitByte(0xc0);
        this.emitByte(0x0f); this.emitByte(0xb6); this.emitByte(0xc0);
    };
    Assembler.prototype.compareF64EqualToEax = function () {
        this.macros.push("fucomip_st0_st1();fstp_st0();sete_al();movzx_eax_al()");
        this.emitByte(0xdf); this.emitByte(0xe9);
        this.emitByte(0xdd); this.emitByte(0xd8);
        this.emitByte(0x0f); this.emitByte(0x94); this.emitByte(0xc0);
        this.emitByte(0x0f); this.emitByte(0xb6); this.emitByte(0xc0);
    };
    Assembler.prototype.xorEaxOne = function () {
        this.macros.push("xor_eax_1()");
        this.emitByte(0x83); this.emitByte(0xf0); this.emitByte(0x01);
    };
    Assembler.prototype.storeFrameBoolean = function (offset) {
        this.macros.push("store_boolean_frame(" + offset + ")");
        this.emitByte(0x83); this.emitByte(0xc0); this.emitByte(0x03);
        this.emitByte(0x89); this.emitByte(0x86); this.word32(offset);
        this.emitByte(0xc7); this.emitByte(0x86); this.word32(offset + 4); this.word32(0);
        this.emitByte(0xc7); this.emitByte(0x86); this.word32(offset + 8); this.word32(0);
        this.emitByte(0xc7); this.emitByte(0x86); this.word32(offset + 12); this.word32(0);
    };

    root.GuestVMX86Assembler = Assembler;
    if (typeof module !== "undefined" && module.exports) module.exports = Assembler;
}(this));
