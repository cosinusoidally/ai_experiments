/* Small i386 decoder for instructions emitted by our macro assembler.
 * Unknown encodings stop disassembly; never guess an instruction boundary. */
(function (root) {
    var names = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"];
    var bytes = ["al", "cl", "dl", "bl", "ah", "ch", "dh", "bh"];
    var shorts = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
    var conditions = ["o", "no", "b", "ae", "e", "ne", "be", "a", "s", "ns", "p", "np", "l", "ge", "le", "g"];
    var binary = {1: "add", 3: "add", 9: "or", 11: "or", 33: "and", 35: "and",
        41: "sub", 43: "sub", 49: "xor", 51: "xor", 57: "cmp", 59: "cmp"};
    function hex(n) { return root.KernelDebuggerFormat.hex32(n); }
    function decode(read, address) {
        var pc = address, octets = [], operand16 = false;
        function u8() { if (octets.length >= 15) throw new Error("instruction exceeds 15 bytes"); var value = read(pc++); octets.push(value); return value; }
        function signed8() { var n = u8(); return n & 128 ? n - 256 : n; }
        function word(width) { var n = 0, scale = 1; for (var i = 0; i < width; i++) { n += u8() * scale; scale *= 256; } return n >>> 0; }
        function immediate() { return hex(word(operand16 ? 2 : 4)); }
        function modrm(byteOperand) {
            var n = u8(), mode = n >>> 6, reg = (n >>> 3) & 7, rm = n & 7;
            var registers = byteOperand ? bytes : operand16 ? shorts : names, operand;
            if (mode === 3) operand = registers[rm];
            else {
                var parts = [], displacement = 0;
                if (rm === 4) {
                    var sib = u8(), base = sib & 7, index = (sib >>> 3) & 7, scale = 1 << (sib >>> 6);
                    if (base !== 5 || mode !== 0) parts.push(names[base]); else displacement = word(4);
                    if (index !== 4) parts.push(names[index] + "*" + scale);
                } else if (rm === 5 && mode === 0) displacement = word(4);
                else parts.push(names[rm]);
                if (mode === 1) displacement = signed8();
                if (mode === 2) displacement = word(4) | 0;
                if (displacement || !parts.length) parts.push(displacement < 0 ? "-" + hex(-displacement) : hex(displacement));
                operand = "[" + parts.join("+").replace("+-", "-") + "]";
            }
            return {reg: reg, register: registers[reg], operand: operand, mode: mode, raw: n};
        }
        var op = u8(), text = "", m, relative, secondary;
        if (op === 0x66) { operand16 = true; op = u8(); }
        if (op >= 0x50 && op <= 0x57) text = "push " + names[op - 0x50];
        else if (op >= 0x58 && op <= 0x5f) text = "pop " + names[op - 0x58];
        else if (op >= 0xb8 && op <= 0xbf) text = "mov " + names[op - 0xb8] + ", " + immediate();
        else if (op === 0x68 || op === 0x6a) text = "push " + (op === 0x68 ? immediate() : signed8());
        else if (op === 0xc3) text = "ret";
        else if (op === 0xc9) text = "leave";
        else if (op === 0x90) text = "nop";
        else if (op === 0x91) text = "xchg eax, ecx";
        else if (op === 0x99) text = "cdq";
        else if (op === 0xcc) text = "int3";
        else if (op === 0xe8 || op === 0xe9 || op === 0xeb || op >= 0x70 && op <= 0x7f) {
            relative = op === 0xeb || op >= 0x70 && op <= 0x7f ? signed8() : word(4) | 0;
            text = (op === 0xe8 ? "call" : op >= 0x70 && op <= 0x7f ? "j" + conditions[op & 15] : "jmp") + " " + hex(pc + relative);
        } else if (op === 0x0f) {
            secondary = u8();
            if (secondary >= 0x80 && secondary <= 0x8f) { relative = word(4) | 0; text = "j" + conditions[secondary & 15] + " " + hex(pc + relative); }
            else if (secondary === 0x0b) text = "ud2";
            else if (secondary >= 0x90 && secondary <= 0x9f) { m = modrm(true); text = "set" + conditions[secondary & 15] + " " + m.operand; }
            else if (secondary === 0xaf || secondary === 0xb6 || secondary === 0xb7) {
                m = modrm(false);
                if (secondary === 0xaf) text = "imul " + m.register + ", " + m.operand;
                else text = "movzx " + names[m.reg] + ", " + (m.mode === 3 ?
                    (secondary === 0xb6 ? bytes : shorts)[m.raw & 7] :
                    (secondary === 0xb6 ? "byte ptr " : "word ptr ") + m.operand);
            }
        } else if (op === 0x89 || op === 0x8b || op === 0x88 || op === 0x8d || op === 0x85 || binary[op]) {
            m = modrm(op === 0x88);
            var mnemonic = binary[op] || (op === 0x85 ? "test" : op === 0x8d ? "lea" : "mov");
            var reversed = op === 0x8b || op === 0x8d || binary[op] && (op & 2);
            text = mnemonic + " " + (reversed ? m.register + ", " + m.operand : m.operand + ", " + m.register);
        } else if (op === 0xc7 || op === 0xc6) { m = modrm(op === 0xc6); if (m.reg === 0) text = "mov " + m.operand + ", " + (op === 0xc6 ? u8() : immediate()); }
        else if (op === 0x81 || op === 0x83) { m = modrm(false); text = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"][m.reg] + " " + m.operand + ", " + (op === 0x83 ? signed8() : immediate()); }
        else if (op === 0x05 || op === 0x0d || op === 0x25 || op === 0x2d || op === 0x35 || op === 0x3d) text = ({5: "add", 13: "or", 37: "and", 45: "sub", 53: "xor", 61: "cmp"})[op] + " eax, " + immediate();
        else if (op === 0x69 || op === 0x6b) { m = modrm(false); text = "imul " + m.register + ", " + m.operand + ", " + (op === 0x69 ? immediate() : signed8()); }
        else if (op === 0xd3 || op === 0xc1) { m = modrm(false); var shift = ({4: "shl", 5: "shr", 7: "sar"})[m.reg]; if (shift) text = shift + " " + m.operand + ", " + (op === 0xc1 ? u8() : "cl"); }
        else if (op === 0xff) { m = modrm(false); var group = ({0: "inc", 1: "dec", 2: "call", 4: "jmp", 6: "push"})[m.reg]; if (group) text = group + " " + m.operand; }
        else if (op === 0xf7 || op === 0xf6) { m = modrm(op === 0xf6); var unary = ({0: "test", 2: "not", 3: "neg", 7: "idiv"})[m.reg]; if (unary) text = unary + " " + m.operand + (m.reg === 0 ? ", " + (op === 0xf6 ? u8() : immediate()) : ""); }
        else if (op >= 0xd8 && op <= 0xdf) {
            m = modrm(false);
            if (m.mode !== 3) {
                var fp = ({216: ["fadd", "fmul", "fcom", "fcomp", "fsub", "fsubr", "fdiv", "fdivr"],
                    217: ["fld", null, "fst", "fstp", null, "fldcw", null, "fnstcw"],
                    219: ["fild", null, "fist", "fistp"], 221: ["fld", null, "fst", "fstp"],
                    223: ["fild", null, "fist", "fistp", null, "fild", null, "fistp"]})[op];
                if (fp && fp[m.reg]) text = fp[m.reg] + " " + m.operand;
            } else {
                var pair = op * 256 + m.raw;
                var fixed = {0xd9c0: "fld st(0)", 0xd9c9: "fxch st(1)", 0xd9e0: "fchs", 0xd9e1: "fabs",
                    0xd9e8: "fld1", 0xd9ed: "fldln2", 0xd9f0: "f2xm1", 0xd9f1: "fyl2x", 0xd9f3: "fpatan",
                    0xd9f8: "fprem", 0xd9fa: "fsqrt", 0xd9fc: "frndint", 0xd9fd: "fscale", 0xd9fe: "fsin", 0xd9ff: "fcos",
                    0xdec1: "faddp", 0xdec9: "fmulp", 0xdee9: "fsubp", 0xdef9: "fdivp", 0xdfe0: "fnstsw ax",
                    0xdfe9: "fucomip st(0), st(1)", 0xddd8: "fstp st(0)", 0xddd9: "fstp st(1)", 0xd8e1: "fsub st(0), st(1)"};
                text = fixed[pair] || "";
            }
        }
        if (!text) throw new Error("unsupported x86 encoding at " + hex(address) + "; disassembly stopped");
        return {address: address, length: pc - address, text: text, bytes: octets};
    }
    root.KernelDebuggerX86 = {decode: decode};
}(this));
