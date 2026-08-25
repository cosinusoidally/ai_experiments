/* Small i386 macro assembler. Callers use named instructions; raw instruction
 * arrays never appear in kernels or backend code. */
(function (root) {
    function Assembler() {
        this.bytes = [];
        this.macros = [];
        this.stackWords = 0;
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
    Assembler.prototype.ret = function () {
        if (this.stackWords !== 0) throw new Error("unbalanced assembler stack");
        this.macros.push("ret()"); this.emitByte(0xc3);
    };
    Assembler.prototype.dump = function () { return this.macros.join("\n"); };

    root.GuestVMX86Assembler = Assembler;
    if (typeof module !== "undefined" && module.exports) module.exports = Assembler;
}(this));
