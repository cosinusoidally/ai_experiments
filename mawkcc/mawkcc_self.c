var output_object;
var output_path;
var src;
var tok_text;
var tok_text_cap;
var code_len;
var idx_pos;
var tok_pos;
var src_len;
var tok;
var TOK_EOF;
var TOK_IDENT;
var TOK_NUM;
var TOK_STR;
var TOK_RETURN;
var TOK_FUNCTION;
var TOK_VAR;
var TOK_IF;
var TOK_ELSE;
var TOK_WHILE;
var TOK_BREAK;
var TOK_LPAREN;
var TOK_RPAREN;
var TOK_LBRACE;
var TOK_RBRACE;
var TOK_SEMI;
var TOK_COMMA;
var TOK_ASSIGN;
var start_call_patch;
var loop_depth;
var next_loop_id;
var break_patch_count;
var loop_stack_p;
var break_patch_loop_p;
var break_patch_pos_p;
var current_returned;
var call_count;
var call_target_p;
var call_pos_p;
var call_argc_p;
var function_count;
var functions_p;
var function_arities_p;
var tok_num;
var global_count;
var globals_p;
var current_param_count;
var current_params_p;
var current_param_offsets_p;
var external_count;
var externals_p;
var external_types_p;
var reloc_count;
var reloc_offsets_p;
var reloc_names_p;
var reloc_types_p;
var global_bytes;
var next_data_offset;
var data_used;
var code_p;
var code_cap;
var data_byte_p;
var data_cap;
var bin_len;
var binbuf_p;
var bin_cap;
var data_patch_count;
var data_patch_offsets_p;
var data_patch_addends_p;
var builtin1_names_p;
var builtin1_count;
var builtin2_names_p;
var builtin2_count;
var builtin3_names_p;
var builtin3_count;

function init_globals() {
    tok_text = 0;
    tok_text_cap = 0;
    TOK_EOF = 0;
    TOK_IDENT = 1;
    TOK_NUM = 2;
    TOK_STR = 3;
    TOK_RETURN = 4;
    TOK_FUNCTION = 5;
    TOK_VAR = 6;
    TOK_IF = 7;
    TOK_ELSE = 8;
    TOK_WHILE = 9;
    TOK_BREAK = 10;
    TOK_LPAREN = 11;
    TOK_RPAREN = 12;
    TOK_LBRACE = 13;
    TOK_RBRACE = 14;
    TOK_SEMI = 15;
    TOK_COMMA = 16;
    TOK_ASSIGN = 17;
    code_cap = 262144;
    code_p = xmalloc(code_cap);
    bin_cap = 524288;
    binbuf_p = xmalloc(bin_cap);
    data_cap = 4096;
    data_byte_p = xmalloc(data_cap);
    globals_p = xmalloc(32768);
    functions_p = xmalloc(32768);
    function_arities_p = xmalloc(32768);
    current_params_p = xmalloc(4096);
    current_param_offsets_p = xmalloc(4096);
    externals_p = xmalloc(32768);
    external_types_p = xmalloc(16384);
    call_target_p = xmalloc(32768);
    call_pos_p = xmalloc(32768);
    call_argc_p = xmalloc(32768);
    reloc_offsets_p = xmalloc(32768);
    reloc_names_p = xmalloc(32768);
    reloc_types_p = xmalloc(32768);
    loop_stack_p = xmalloc(4096);
    break_patch_loop_p = xmalloc(32768);
    break_patch_pos_p = xmalloc(32768);
    data_patch_offsets_p = xmalloc(32768);
    data_patch_addends_p = xmalloc(32768);
    init_builtin_names();
    return 0;
}

function fail_msg(s, n) {
    write(2, s, n);
    return 1;
}

function fail(s) {
    return fail_msg(s, strlen(s));
}

function fail_name(s, name) {
    write(2, s, strlen(s));
    write(2, name, strlen(name));
    write(2, mks("\n"), 1);
    return 1;
}

function usage(program) {
    write(2, mks("usage: mawkcc [-c] [-o output] source\n"), 39);
    return 1;
}

function copy_bytes_(dst, src, n, i) {
    i = 0;
    while (LT(i, n)) {
        wi8(ADD(dst, i), ri8(ADD(src, i)));
        i = ADD(i, 1);
    }
    return 0;
}

function zero_bytes_(dst, start, n, i) {
    i = start;
    while (LT(i, n)) {
        wi8(ADD(dst, i), 0);
        i = ADD(i, 1);
    }
    return 0;
}

function ensure_code_capacity_(needed, new_cap, new_p) {
    if (LE(needed, code_cap)) {
        return 0;
    }
    new_cap = code_cap;
    while (LT(new_cap, needed)) {
        new_cap = MUL(new_cap, 2);
    }
    new_p = xmalloc(new_cap);
    copy_bytes_(new_p, code_p, code_len, 0);
    code_p = new_p;
    code_cap = new_cap;
    return 0;
}

function ensure_code_capacity(needed) {
    return ensure_code_capacity_(needed, 0, 0);
}

function ensure_bin_capacity_(needed, new_cap, new_p) {
    if (LE(needed, bin_cap)) {
        return 0;
    }
    new_cap = bin_cap;
    while (LT(new_cap, needed)) {
        new_cap = MUL(new_cap, 2);
    }
    new_p = xmalloc(new_cap);
    copy_bytes_(new_p, binbuf_p, bin_len, 0);
    binbuf_p = new_p;
    bin_cap = new_cap;
    return 0;
}

function ensure_bin_capacity(needed) {
    return ensure_bin_capacity_(needed, 0, 0);
}

function ensure_data_capacity_(needed, old_cap, new_cap, new_p) {
    if (LE(needed, data_cap)) {
        return 0;
    }
    old_cap = data_cap;
    new_cap = data_cap;
    while (LT(new_cap, needed)) {
        new_cap = MUL(new_cap, 2);
    }
    new_p = xmalloc(new_cap);
    copy_bytes_(new_p, data_byte_p, data_used, 0);
    zero_bytes_(new_p, old_cap, new_cap, 0);
    data_byte_p = new_p;
    data_cap = new_cap;
    return 0;
}

function ensure_data_capacity(needed) {
    return ensure_data_capacity_(needed, 0, 0, 0);
}

function xmalloc_(n, p) {
    p = brk(n);
    if (EQ(p, 0)) {
        fail_msg(mks("out of memory\n"), 14);
    }
    return p;
}

function xmalloc(n) {
    return xmalloc_(n, 0);
}

function xrealloc_(p, n, q) {
    q = xmalloc(n);
    if (EQ(q, 0)) {
        fail_msg(mks("out of memory\n"), 14);
    }
    return q;
}

function xrealloc(p, n) {
    return xrealloc_(p, n, 0);
}

function div_floor256(v, q) {
    q = DIV(v, 256);
    if (AND(LT(v, 0), NE(MUL(q, 256), v))) {
        q = SUB(q, 1);
    }
    return q;
}

function u32_byte(v, shift) {
    while (GT(shift, 0)) {
        v = div_floor256(v, 0);
        shift = SUB(shift, 8);
    }
    return v;
}

function free(p) {
    return 0;
}

function strlen_(s, n) {
    while (ri8(ADD(s, n))) {
        n = ADD(n, 1);
    }
    return n;
}

function strlen(s) {
    return strlen_(s, 0);
}

function strcmp_(a, b, i, ca, cb) {
    while (1) {
        ca = ri8(ADD(a, i));
        cb = ri8(ADD(b, i));
        if (NE(ca, cb)) {
            return SUB(ca, cb);
        }
        if (EQ(ca, 0)) {
            return 0;
        }
        i = ADD(i, 1);
    }
    return 0;
}

function strcmp(a, b) {
    return strcmp_(a, b, 0, 0, 0);
}

function strtoul_(s, value, i, ch) {
    value = 0;
    i = 0;
    while (1) {
        ch = ri8(ADD(s, i));
        if (OR(LT(ch, 48), GT(ch, 57))) {
            return value;
        }
        value = ADD(MUL(value, 10), SUB(ch, 48));
        i = ADD(i, 1);
    }
    return value;
}

function strtoul(s, endptr, base) {
    return strtoul_(s, 0, 0, 0);
}

function sym_name(sym) {
    return ri32(sym);
}

function sym_val(sym) {
    return ri32(ADD(sym, 4));
}

function sym_set_name(sym, name) {
    wi32(sym, name);
    return name;
}

function sym_set_val(sym, val) {
    wi32(ADD(sym, 4), val);
    return val;
}

function xstrdup_(s, n, p, i) {
    n = strlen(s);
    p = xmalloc(ADD(n, 1));
    i = 0;
    while (LE(i, n)) {
        wi8(ADD(p, i), ri8(ADD(s, i)));
        i = ADD(i, 1);
    }
    return p;
}

function xstrdup(s) {
    return xstrdup_(s, 0, 0, 0);
}

function find_symbol_(arr, count, name, i, entry) {
    while (LT(i, count)) {
        entry = ADD(arr, MUL(i, 8));
        if (EQ(strcmp(sym_name(entry), name), 0)) {
            return i;
        }
        i = ADD(i, 1);
    }
    return NEG(1);
}

function find_symbol(arr, count, name) {
    return find_symbol_(arr, count, name, 0, 0);
}

function is_space_char(ch) {
    return OR(OR(OR(EQ(ch, mkC(" ")), EQ(ch, mkC("\t"))), OR(EQ(ch, mkC("\n")), EQ(ch, mkC("\r")))), OR(EQ(ch, mkC("\f")), EQ(ch, mkC("\v"))));
}

function is_digit_char(ch) {
    return AND(GE(ch, mkC("0")), LE(ch, mkC("9")));
}

function is_alpha_char(ch) {
    return OR(OR(AND(GE(ch, mkC("a")), LE(ch, mkC("z"))), AND(GE(ch, mkC("A")), LE(ch, mkC("Z")))), EQ(ch, mkC("_")));
}

function is_alnum_char(ch) {
    return OR(is_alpha_char(ch), is_digit_char(ch));
}

function set_tok_text_len_(s, n, i) {
    if (LT(tok_text_cap, ADD(n, 1))) {
        tok_text_cap = ADD(n, 32);
        tok_text = xrealloc(tok_text, tok_text_cap);
    }
    i = 0;
    while (LT(i, n)) {
        wi8(ADD(tok_text, i), ri8(ADD(s, i)));
        i = ADD(i, 1);
    }
    wi8(ADD(tok_text, n), 0);
    return 0;
}

function set_tok_text_len(s, n) {
    return set_tok_text_len_(s, n, 0);
}

function set_tok_text_cstr(s) {
    return set_tok_text_len(s, strlen(s));
}

function init_lexer() {
    idx_pos = 0;
    return 0;
}

function skip_ws_and_comments_(ch) {
    while (LT(idx_pos, src_len)) {
        ch = ri8(ADD(src, idx_pos));
        if (is_space_char(ch)) {
            idx_pos = ADD(idx_pos, 1);
        } else if (AND(LT(ADD(idx_pos, 1), src_len), AND(EQ(ri8(ADD(src, idx_pos)), mkC("/")), EQ(ri8(ADD(src, ADD(idx_pos, 1))), mkC("*"))))) {
            idx_pos = ADD(idx_pos, 2);
            while (AND(LT(ADD(idx_pos, 1), src_len), NOT(AND(EQ(ri8(ADD(src, idx_pos)), mkC("*")), EQ(ri8(ADD(src, ADD(idx_pos, 1))), mkC("/")))))) {
                idx_pos = ADD(idx_pos, 1);
            }
            if (GE(ADD(idx_pos, 1), src_len)) {
                fail(mks("unterminated block comment\n"));
            }
            idx_pos = ADD(idx_pos, 2);
        } else if (AND(LT(ADD(idx_pos, 1), src_len), AND(EQ(ri8(ADD(src, idx_pos)), mkC("/")), EQ(ri8(ADD(src, ADD(idx_pos, 1))), mkC("/"))))) {
            idx_pos = ADD(idx_pos, 2);
            while (AND(LT(idx_pos, src_len), NE(ri8(ADD(src, idx_pos)), mkC("\n")))) {
                idx_pos = ADD(idx_pos, 1);
            }
        } else {
            return 0;
        }
    }
    return 0;
}

function skip_ws_and_comments() {
    return skip_ws_and_comments_(0);
}

function read_string_token_(buf, cap, len, ch) {
    idx_pos = ADD(idx_pos, 1);
    cap = 64;
    len = 0;
    buf = xmalloc(cap);
    while (LT(idx_pos, src_len)) {
        ch = ri8(ADD(src, idx_pos));
        if (EQ(ch, mkC("\""))) {
            idx_pos = ADD(idx_pos, 1);
            set_tok_text_len(buf, len);
            free(buf);
            tok = TOK_STR;
            return 0;
        }
        if (EQ(ch, mkC("\\"))) {
            idx_pos = ADD(idx_pos, 1);
            if (GE(idx_pos, src_len)) {
                free(buf);
                fail(mks("unterminated string escape\n"));
            }
            ch = ri8(ADD(src, idx_pos));
            if (EQ(ch, mkC("n"))) {
                ch = mkC("\n");
            } else if (EQ(ch, mkC("t"))) {
                ch = mkC("\t");
            } else if (EQ(ch, mkC("r"))) {
                ch = mkC("\r");
            } else if (EQ(ch, mkC("f"))) {
                ch = mkC("\f");
            } else if (EQ(ch, mkC("v"))) {
                ch = mkC("\v");
            } else if (EQ(ch, mkC("\""))) {
                ch = mkC("\"");
            } else if (EQ(ch, mkC("\\"))) {
                ch = mkC("\\");
            } else if (EQ(ch, mkC("0"))) {
                ch = 0;
            } else {
                free(buf);
                fail(mks("unsupported string escape\n"));
            }
        }
        if (GE(ADD(len, 2), cap)) {
            cap = MUL(cap, 2);
            buf = xrealloc(buf, cap);
        }
        wi8(ADD(buf, len), ch);
        len = ADD(len, 1);
        idx_pos = ADD(idx_pos, 1);
    }
    free(buf);
    fail(mks("unterminated string literal\n"));
    return 0;
}

function read_string_token() {
    return read_string_token_(0, 0, 0, 0);
}

function next_tok_ident_(start) {
    start = idx_pos;
    idx_pos = ADD(idx_pos, 1);
    while (AND(LT(idx_pos, src_len), is_alnum_char(ri8(ADD(src, idx_pos))))) {
        idx_pos = ADD(idx_pos, 1);
    }
    set_tok_text_len(ADD(src, start), SUB(idx_pos, start));
    if (EQ(strcmp(tok_text, mks("return")), 0)) {
        tok = TOK_RETURN;
    } else if (EQ(strcmp(tok_text, mks("function")), 0)) {
        tok = TOK_FUNCTION;
    } else if (EQ(strcmp(tok_text, mks("var")), 0)) {
        tok = TOK_VAR;
    } else if (EQ(strcmp(tok_text, mks("if")), 0)) {
        tok = TOK_IF;
    } else if (EQ(strcmp(tok_text, mks("else")), 0)) {
        tok = TOK_ELSE;
    } else if (EQ(strcmp(tok_text, mks("while")), 0)) {
        tok = TOK_WHILE;
    } else if (EQ(strcmp(tok_text, mks("break")), 0)) {
        tok = TOK_BREAK;
    } else {
        tok = TOK_IDENT;
    }
    return 0;
}

function next_tok_num_(start) {
    start = idx_pos;
    idx_pos = ADD(idx_pos, 1);
    while (AND(LT(idx_pos, src_len), is_digit_char(ri8(ADD(src, idx_pos))))) {
        idx_pos = ADD(idx_pos, 1);
    }
    set_tok_text_len(ADD(src, start), SUB(idx_pos, start));
    tok_num = strtoul(tok_text, 0, 10);
    tok = TOK_NUM;
    return 0;
}

function next_tok_punc_(ch) {
    if (EQ(ch, mkC("("))) {
        tok = TOK_LPAREN; set_tok_text_cstr(mks("(")); idx_pos = ADD(idx_pos, 1); return 1;
    }
    if (EQ(ch, mkC(")"))) {
        tok = TOK_RPAREN; set_tok_text_cstr(mks(")")); idx_pos = ADD(idx_pos, 1); return 1;
    }
    if (EQ(ch, mkC("{"))) {
        tok = TOK_LBRACE; set_tok_text_cstr(mks("{")); idx_pos = ADD(idx_pos, 1); return 1;
    }
    if (EQ(ch, mkC("}"))) {
        tok = TOK_RBRACE; set_tok_text_cstr(mks("}")); idx_pos = ADD(idx_pos, 1); return 1;
    }
    if (EQ(ch, mkC(";"))) {
        tok = TOK_SEMI; set_tok_text_cstr(mks(";")); idx_pos = ADD(idx_pos, 1); return 1;
    }
    if (EQ(ch, mkC(","))) {
        tok = TOK_COMMA; set_tok_text_cstr(mks(",")); idx_pos = ADD(idx_pos, 1); return 1;
    }
    if (EQ(ch, mkC("="))) {
        tok = TOK_ASSIGN; set_tok_text_cstr(mks("=")); idx_pos = ADD(idx_pos, 1); return 1;
    }
    return 0;
}

function next_tok_(ch) {
    skip_ws_and_comments();
    tok_pos = idx_pos;
    if (GE(idx_pos, src_len)) {
        tok = TOK_EOF;
        set_tok_text_cstr(mks(""));
        return 0;
    }
    ch = ri8(ADD(src, idx_pos));
    if (is_alpha_char(ch)) {
        next_tok_ident_(0);
        return 0;
    }
    if (is_digit_char(ch)) {
        next_tok_num_(0);
        return 0;
    }
    if (EQ(ch, mkC("\""))) {
        read_string_token();
        return 0;
    }
    if (next_tok_punc_(ch)) {
        return 0;
    }
    fail(mks("unexpected input character\n"));
    return 0;
}

function next_tok() {
    return next_tok_(0);
}

function expect(want) {
    if (NOT(EQ(tok, want))) {
        fail(mks("unexpected token\n"));
    }
    next_tok();
    return 0;
}

function emit_mov_eax_imm32(v) { emit1(184); emit4(v); }
function emit_push_eax() { emit1(80); }
function emit_push_ebx() { emit1(83); }
function emit_pop_ebx() { emit1(91); }
function emit_pop_ecx() { emit1(89); }
function emit_load_param(offset) { emit1(139); emit1(69); emit1(offset); }
function emit_store_param(offset) { emit1(137); emit1(69); emit1(offset); }
function emit_prologue() { emit1(85); emit1(137); emit1(229); emit_push_ebx(); }
function emit_epilogue() { emit1(139); emit1(93); emit1(252); emit1(137); emit1(236); emit1(93); emit1(195); }
function emit_test_eax_eax() { emit1(133); emit1(192); }
function emit_add_esp_imm32(v) { emit1(129); emit1(196); emit4(v); }
function emit_mov_eax_esp() { emit1(137); emit1(224); }
function emit_mov_ebx_ptr_esp() { emit1(139); emit1(28); emit1(36); }
function emit_mov_eax_stack_disp32(disp) { emit1(139); emit1(132); emit1(36); emit4(disp); }
function emit_mov_ebx_stack_disp32(disp) { emit1(139); emit1(156); emit1(36); emit4(disp); }
function emit_mov_stack_disp32_ebx(disp) { emit1(137); emit1(156); emit1(36); emit4(disp); }
function emit_mov_stack_disp32_eax(disp) { emit1(137); emit1(132); emit1(36); emit4(disp); }

function emit_reverse_args_(argc, i, lo, hi) {
    while (LT(i, DIV(argc, 2))) {
        lo = MUL(4, i);
        hi = MUL(4, SUB(SUB(argc, 1), i));
        emit_mov_eax_stack_disp32(lo);
        emit_mov_ebx_stack_disp32(hi);
        emit_mov_stack_disp32_ebx(lo);
        emit_mov_stack_disp32_eax(hi);
        i = ADD(i, 1);
    }
    return 0;
}

function emit_reverse_args(argc) {
    return emit_reverse_args_(argc, 0, 0, 0);
}

function emit_je_placeholder_(p) { emit1(15); emit1(132); p = code_len; emit4(0); return p; }
function emit_jne_placeholder_(p) { emit1(15); emit1(133); p = code_len; emit4(0); return p; }
function emit_jmp_placeholder_(p) { emit1(233); p = code_len; emit4(0); return p; }
function emit_je_placeholder() { return emit_je_placeholder_(0); }
function emit_jne_placeholder() { return emit_jne_placeholder_(0); }
function emit_jmp_placeholder() { return emit_jmp_placeholder_(0); }
function patch_rel32(pos, target) { patch4(pos, SUB(target, ADD(pos, 4))); return 0; }
function emit_jmp_(target, p) { p = emit_jmp_placeholder(); patch_rel32(p, target); return 0; }
function emit_jmp(target) { return emit_jmp_(target, 0); }
function emit_add_eax_imm32(v) { emit1(5); emit4(v); }
function emit_mov_ebx_eax() { emit1(137); emit1(195); }
function emit_mov_edx_eax() { emit1(137); emit1(194); }
function emit_mov_ebx_ecx() { emit1(137); emit1(203); }
function emit_mov_eax_ecx() { emit1(137); emit1(200); }
function emit_xor_ebx_ebx() { emit1(49); emit1(219); }
function emit_xor_eax_eax() { emit1(49); emit1(192); }
function emit_add_ebx_edx() { emit1(1); emit1(211); }
function emit_cmp_eax_ebx() { emit1(57); emit1(216); }
function emit_mov_eax_abs(addr) { emit1(161); emit4(addr); }
function emit_mov_ecx_abs(addr) { emit1(139); emit1(13); emit4(addr); }
function emit_mov_abs_eax(addr) { emit1(163); emit4(addr); }
function emit_mov_abs_ebx(addr) { emit1(137); emit1(29); emit4(addr); }
function emit_int_80() { emit1(205); emit1(128); }
function emit_add_eax_ebx() { emit1(1); emit1(216); }
function emit_and_eax_ebx() { emit1(33); emit1(216); }
function emit_or_eax_ebx() { emit1(9); emit1(216); }
function emit_xor_eax_ebx() { emit1(49); emit1(216); }
function emit_shl_ebx_by_eax() { emit1(137); emit1(193); emit1(211); emit1(227); emit1(137); emit1(216); }
function emit_shr_ebx_by_eax() { emit1(137); emit1(193); emit1(211); emit1(235); emit1(137); emit1(216); }
function emit_sub_from_stack_top() { emit1(137); emit1(193); emit1(137); emit1(216); emit1(41); emit1(200); }
function emit_imul_eax_ebx() { emit1(15); emit1(175); emit1(195); }
function emit_div_stack_top_by_eax() { emit1(137); emit1(193); emit1(137); emit1(216); emit1(153); emit1(247); emit1(249); }
function emit_mod_stack_top_by_eax() { emit1(137); emit1(193); emit1(137); emit1(216); emit1(153); emit1(247); emit1(249); emit1(137); emit1(208); }
function emit_cmp_set(opcode) { emit1(57); emit1(195); emit1(15); emit1(opcode); emit1(192); emit1(15); emit1(182); emit1(192); }
function emit_neg_eax() { emit1(247); emit1(216); }
function emit_not_eax() { emit1(133); emit1(192); emit1(15); emit1(148); emit1(192); emit1(15); emit1(182); emit1(192); }
function emit_read_i32() { emit1(139); emit1(0); }
function emit_read_u8() { emit1(15); emit1(182); emit1(0); }
function emit_write_i32() { emit1(137); emit1(3); }
function emit_write_u8() { emit1(136); emit1(3); emit1(15); emit1(182); emit1(192); }
function emit_sys_open() { emit_mov_eax_imm32(5); emit_int_80(); }
function emit_sys_read() { emit_mov_eax_imm32(3); emit_int_80(); }
function emit_sys_write() { emit_mov_eax_imm32(4); emit_int_80(); }
function emit_sys_close() { emit_mov_ebx_eax(); emit_mov_eax_imm32(6); emit_int_80(); }
function emit_sys_exit() { emit_mov_ebx_eax(); emit_mov_eax_imm32(1); emit_int_80(); }

function emit1(b) {
    ensure_code_capacity(ADD(code_len, 1));
    wi8(ADD(code_p, code_len), b);
    code_len = ADD(code_len, 1);
    return 0;
}

function emit4(v) {
    emit1(u32_byte(v, 0));
    emit1(u32_byte(v, 8));
    emit1(u32_byte(v, 16));
    emit1(u32_byte(v, 24));
    return 0;
}

function patch4(pos, v) {
    wi8(ADD(code_p, pos), u32_byte(v, 0));
    wi8(ADD(code_p, ADD(pos, 1)), u32_byte(v, 8));
    wi8(ADD(code_p, ADD(pos, 2)), u32_byte(v, 16));
    wi8(ADD(code_p, ADD(pos, 3)), u32_byte(v, 24));
    return 0;
}

function register_string_(text, start, len, i) {
    len = strlen(text);
    start = next_data_offset;
    ensure_data_capacity(ADD(ADD(start, len), 1));
    i = 0;
    while (LT(i, len)) {
        wi8(ADD(data_byte_p, ADD(start, i)), ri8(ADD(text, i)));
        i = ADD(i, 1);
    }
    wi8(ADD(data_byte_p, ADD(start, len)), 0);
    next_data_offset = ADD(ADD(start, len), 1);
    if (LT(data_used, next_data_offset)) {
        data_used = next_data_offset;
    }
    return start;
}

function register_string(text) {
    return register_string_(text, 0, 0, 0);
}

function emit_mks_literal_(text, addr) {
    addr = register_string(text);
    emit1(184);
    if (output_object) {
        record_reloc(code_len, mks(".data"), 1);
        emit4(addr);
        return 0;
    }
    record_data_patch(code_len, addr);
    emit4(0);
    return 0;
}

function emit_mks_literal(text) {
    return emit_mks_literal_(text, 0);
}

function emit_load_global_(name, idx, off) {
    idx = find_symbol(globals_p, global_count, name);
    off = sym_val(ADD(globals_p, MUL(idx, 8)));
    emit1(161);
    if (output_object) {
        record_reloc(code_len, name, 1);
        emit4(0);
        return 0;
    }
    record_data_patch(code_len, off);
    emit4(0);
    return 0;
}

function emit_load_global(name) {
    return emit_load_global_(name, 0, 0);
}

function emit_store_global_(name, idx, off) {
    idx = find_symbol(globals_p, global_count, name);
    off = sym_val(ADD(globals_p, MUL(idx, 8)));
    emit1(163);
    if (output_object) {
        record_reloc(code_len, name, 1);
        emit4(0);
        return 0;
    }
    record_data_patch(code_len, off);
    emit4(0);
    return 0;
}

function emit_store_global(name) {
    return emit_store_global_(name, 0, 0);
}

function emit_start() {
    emit_mov_eax_esp();
    emit_mov_ebx_ptr_esp();
    emit_add_eax_imm32(4);
    emit_push_eax();
    emit_push_ebx();
    emit1(232);
    start_call_patch = code_len;
    emit4(0);
    emit_add_esp_imm32(8);
    emit1(137);
    emit1(195);
    emit1(184);
    emit4(1);
    emit1(205);
    emit1(128);
    return 0;
}

function emit_brk_alloc_(cur_addr, init_skip, fail_patch, done_patch) {
    emit_mov_edx_eax();
    emit1(161);
    record_data_patch(code_len, 0);
    emit4(0);
    emit_test_eax_eax();
    init_skip = emit_jne_placeholder();
    emit_mov_eax_imm32(45);
    emit_xor_ebx_ebx();
    emit_int_80();
    emit1(163);
    record_data_patch(code_len, 0);
    emit4(0);
    patch_rel32(init_skip, code_len);
    emit1(139);
    emit1(13);
    record_data_patch(code_len, 0);
    emit4(0);
    emit_mov_ebx_ecx();
    emit_add_ebx_edx();
    emit_mov_eax_imm32(45);
    emit_int_80();
    emit_cmp_eax_ebx();
    fail_patch = emit_jne_placeholder();
    emit1(137);
    emit1(29);
    record_data_patch(code_len, 0);
    emit4(0);
    emit_mov_eax_ecx();
    done_patch = emit_jmp_placeholder();
    patch_rel32(fail_patch, code_len);
    emit_xor_eax_eax();
    patch_rel32(done_patch, code_len);
    return 0;
}

function emit_brk_alloc() {
    return emit_brk_alloc_(0, 0, 0, 0);
}

function push_loop_(id) {
    id = ADD(next_loop_id, 1);
    next_loop_id = id;
    if (GE(loop_depth, 1024)) {
        fail(mks("too many nested loops\n"));
    }
    wi32(ADD(loop_stack_p, MUL(loop_depth, 4)), id);
    loop_depth = ADD(loop_depth, 1);
    return id;
}

function push_loop() {
    return push_loop_(0);
}

function pop_loop() {
    if (GT(loop_depth, 0)) {
        loop_depth = SUB(loop_depth, 1);
    }
    return 0;
}

function record_break(loop_id, patch_pos) {
    if (GE(break_patch_count, 8192)) {
        fail(mks("too many break patches\n"));
    }
    wi32(ADD(break_patch_loop_p, MUL(break_patch_count, 4)), loop_id);
    wi32(ADD(break_patch_pos_p, MUL(break_patch_count, 4)), patch_pos);
    break_patch_count = ADD(break_patch_count, 1);
    return 0;
}

function patch_breaks_(loop_id, target, i) {
    while (LT(i, break_patch_count)) {
        if (EQ(ri32(ADD(break_patch_loop_p, MUL(i, 4))), loop_id)) {
            patch_rel32(ri32(ADD(break_patch_pos_p, MUL(i, 4))), target);
        }
        i = ADD(i, 1);
    }
    return 0;
}

function patch_breaks(loop_id, target) {
    return patch_breaks_(loop_id, target, 0);
}

function name_eq(name, text) {
    return EQ(strcmp(name, text), 0);
}

function name_is(name, lower, upper) {
    return OR(name_eq(name, lower), name_eq(name, upper));
}

function name_list_set(list, i, name) {
    wi32(ADD(list, MUL(i, 4)), name);
    return name;
}

function name_list_get(list, i) {
    return ri32(ADD(list, MUL(i, 4)));
}

function name_in_list_(name, list, count, i) {
    while (LT(i, count)) {
        if (name_eq(name, name_list_get(list, i))) {
            return 1;
        }
        i = ADD(i, 1);
    }
    return 0;
}

function name_in_list(name, list, count) {
    return name_in_list_(name, list, count, 0);
}

function init_builtin1_names() {
    builtin1_count = 11;
    builtin1_names_p = xmalloc(MUL(builtin1_count, 4));
    name_list_set(builtin1_names_p, 0, mks("neg"));
    name_list_set(builtin1_names_p, 1, mks("NEG"));
    name_list_set(builtin1_names_p, 2, mks("not"));
    name_list_set(builtin1_names_p, 3, mks("NOT"));
    name_list_set(builtin1_names_p, 4, mks("ri32"));
    name_list_set(builtin1_names_p, 5, mks("ri8"));
    name_list_set(builtin1_names_p, 6, mks("brk"));
    name_list_set(builtin1_names_p, 7, mks("close"));
    name_list_set(builtin1_names_p, 8, mks("exit"));
    name_list_set(builtin1_names_p, 9, mks("mks"));
    name_list_set(builtin1_names_p, 10, mks("mkC"));
    return 0;
}

function init_builtin2_names() {
    builtin2_count = 34;
    builtin2_names_p = xmalloc(MUL(builtin2_count, 4));
    name_list_set(builtin2_names_p, 0, mks("add"));
    name_list_set(builtin2_names_p, 1, mks("ADD"));
    name_list_set(builtin2_names_p, 2, mks("sub"));
    name_list_set(builtin2_names_p, 3, mks("SUB"));
    name_list_set(builtin2_names_p, 4, mks("mul"));
    name_list_set(builtin2_names_p, 5, mks("MUL"));
    name_list_set(builtin2_names_p, 6, mks("div"));
    name_list_set(builtin2_names_p, 7, mks("DIV"));
    name_list_set(builtin2_names_p, 8, mks("mod"));
    name_list_set(builtin2_names_p, 9, mks("MOD"));
    name_list_set(builtin2_names_p, 10, mks("eq"));
    name_list_set(builtin2_names_p, 11, mks("EQ"));
    name_list_set(builtin2_names_p, 12, mks("ne"));
    name_list_set(builtin2_names_p, 13, mks("NE"));
    name_list_set(builtin2_names_p, 14, mks("lt"));
    name_list_set(builtin2_names_p, 15, mks("LT"));
    name_list_set(builtin2_names_p, 16, mks("le"));
    name_list_set(builtin2_names_p, 17, mks("LE"));
    name_list_set(builtin2_names_p, 18, mks("gt"));
    name_list_set(builtin2_names_p, 19, mks("GT"));
    name_list_set(builtin2_names_p, 20, mks("ge"));
    name_list_set(builtin2_names_p, 21, mks("GE"));
    name_list_set(builtin2_names_p, 22, mks("and"));
    name_list_set(builtin2_names_p, 23, mks("AND"));
    name_list_set(builtin2_names_p, 24, mks("or"));
    name_list_set(builtin2_names_p, 25, mks("OR"));
    name_list_set(builtin2_names_p, 26, mks("xor"));
    name_list_set(builtin2_names_p, 27, mks("XOR"));
    name_list_set(builtin2_names_p, 28, mks("shl"));
    name_list_set(builtin2_names_p, 29, mks("SHL"));
    name_list_set(builtin2_names_p, 30, mks("shr"));
    name_list_set(builtin2_names_p, 31, mks("SHR"));
    name_list_set(builtin2_names_p, 32, mks("wi32"));
    name_list_set(builtin2_names_p, 33, mks("wi8"));
    return 0;
}

function init_builtin3_names() {
    builtin3_count = 3;
    builtin3_names_p = xmalloc(MUL(builtin3_count, 4));
    name_list_set(builtin3_names_p, 0, mks("open"));
    name_list_set(builtin3_names_p, 1, mks("read"));
    name_list_set(builtin3_names_p, 2, mks("write"));
    return 0;
}

function init_builtin_names() {
    init_builtin1_names();
    init_builtin2_names();
    init_builtin3_names();
    return 0;
}

function builtin_arity(name) {
    if (name_in_list(name, builtin1_names_p, builtin1_count)) {
        return 1;
    }
    if (name_in_list(name, builtin2_names_p, builtin2_count)) {
        return 2;
    }
    if (name_in_list(name, builtin3_names_p, builtin3_count)) {
        return 3;
    }
    return 0;
}

function emit_builtin1(name) {
    if (name_is(name, mks("neg"), mks("NEG"))) {
        emit_neg_eax();
    } else if (name_is(name, mks("not"), mks("NOT"))) {
        emit_not_eax();
    } else if (name_eq(name, mks("ri32"))) {
        emit_read_i32();
    } else if (name_eq(name, mks("ri8"))) {
        emit_read_u8();
    } else if (name_eq(name, mks("brk"))) {
        emit_brk_alloc();
    } else if (name_eq(name, mks("close"))) {
        emit_sys_close();
    } else if (name_eq(name, mks("exit"))) {
        emit_sys_exit();
    } else {
        fail_name(mks("unknown one-argument builtin: "), name);
    }
    return 0;
}

function emit_builtin2(name) {
    if (name_is(name, mks("add"), mks("ADD"))) {
        emit_add_eax_ebx();
    } else if (name_is(name, mks("sub"), mks("SUB"))) {
        emit_sub_from_stack_top();
    } else if (name_is(name, mks("mul"), mks("MUL"))) {
        emit_imul_eax_ebx();
    } else if (name_is(name, mks("div"), mks("DIV"))) {
        emit_div_stack_top_by_eax();
    } else if (name_is(name, mks("mod"), mks("MOD"))) {
        emit_mod_stack_top_by_eax();
    } else if (name_is(name, mks("eq"), mks("EQ"))) {
        emit_cmp_set(148);
    } else if (name_is(name, mks("ne"), mks("NE"))) {
        emit_cmp_set(149);
    } else if (name_is(name, mks("lt"), mks("LT"))) {
        emit_cmp_set(156);
    } else if (name_is(name, mks("le"), mks("LE"))) {
        emit_cmp_set(158);
    } else if (name_is(name, mks("gt"), mks("GT"))) {
        emit_cmp_set(159);
    } else if (name_is(name, mks("ge"), mks("GE"))) {
        emit_cmp_set(157);
    } else if (name_is(name, mks("and"), mks("AND"))) {
        emit_and_eax_ebx();
    } else if (name_is(name, mks("or"), mks("OR"))) {
        emit_or_eax_ebx();
    } else if (name_is(name, mks("xor"), mks("XOR"))) {
        emit_xor_eax_ebx();
    } else if (name_is(name, mks("shl"), mks("SHL"))) {
        emit_shl_ebx_by_eax();
    } else if (name_is(name, mks("shr"), mks("SHR"))) {
        emit_shr_ebx_by_eax();
    } else if (name_eq(name, mks("wi32"))) {
        emit_write_i32();
    } else if (name_eq(name, mks("wi8"))) {
        emit_write_u8();
    } else {
        fail_name(mks("unknown two-argument builtin: "), name);
    }
    return 0;
}

function emit_builtin3(name) {
    if (name_eq(name, mks("open"))) {
        emit_sys_open();
    } else if (name_eq(name, mks("read"))) {
        emit_sys_read();
    } else if (name_eq(name, mks("write"))) {
        emit_sys_write();
    } else {
        fail_name(mks("unknown three-argument builtin: "), name);
    }
    return 0;
}

function parse_builtin_call(name, argc) {
    expect(TOK_LPAREN);
    if (name_eq(name, mks("mks"))) {
        if (NOT(EQ(tok, TOK_STR))) {
            fail(mks("mks expects a string literal\n"));
        }
        emit_mks_literal(tok_text);
        next_tok();
        expect(TOK_RPAREN);
        return 0;
    } else if (name_eq(name, mks("mkC"))) {
        if (NOT(EQ(tok, TOK_STR))) {
            fail(mks("mkC expects a string literal\n"));
        }
        emit_mov_eax_imm32(ri8(tok_text));
        next_tok();
        expect(TOK_RPAREN);
        return 0;
    } else if (EQ(argc, 1)) {
        parse_expr();
    } else if (EQ(argc, 2)) {
        parse_expr();
        emit_push_eax();
        expect(TOK_COMMA);
        parse_expr();
        emit_pop_ebx();
    } else if (EQ(argc, 3)) {
        parse_expr();
        emit_push_eax();
        expect(TOK_COMMA);
        parse_expr();
        emit_push_eax();
        expect(TOK_COMMA);
        parse_expr();
        emit_mov_edx_eax();
        emit_pop_ecx();
        emit_pop_ebx();
    } else {
        fail(mks("unsupported builtin arity\n"));
    }
    expect(TOK_RPAREN);
    if (EQ(argc, 1)) {
        emit_builtin1(name);
    } else if (EQ(argc, 2)) {
        emit_builtin2(name);
    } else {
        emit_builtin3(name);
    }
    return 0;
}

function parse_user_call_args_(argc) {
    argc = 0;
    expect(TOK_LPAREN);
    if (EQ(tok, TOK_RPAREN)) {
        next_tok();
        return 0;
    }
    while (1) {
        parse_expr();
        emit_push_eax();
        argc = ADD(argc, 1);
        if (NOT(EQ(tok, TOK_COMMA))) {
            break;
        }
        next_tok();
    }
    expect(TOK_RPAREN);
    emit_reverse_args(argc);
    return argc;
}

function parse_user_call_args() {
    return parse_user_call_args_(0);
}

function emit_user_call(name, argc) {
    emit1(232);
    wi32(ADD(call_target_p, MUL(call_count, 4)), xstrdup(name));
    wi32(ADD(call_pos_p, MUL(call_count, 4)), code_len);
    emit4(0);
    if (GT(argc, 0)) {
        emit_add_esp_imm32(MUL(4, argc));
    }
    wi32(ADD(call_argc_p, MUL(call_count, 4)), argc);
    call_count = ADD(call_count, 1);
    return 0;
}

function patch_calls_(i, fi, name, pos, argc, addr, arity, rel) {
    while (LT(i, call_count)) {
        name = ri32(ADD(call_target_p, MUL(i, 4)));
        pos = ri32(ADD(call_pos_p, MUL(i, 4)));
        argc = ri32(ADD(call_argc_p, MUL(i, 4)));
        fi = find_symbol(functions_p, function_count, name);
        if (LT(fi, 0)) {
            if (output_object) {
                patch4(pos, NEG(4));
                record_external(name, 18);
                record_reloc(pos, name, 2);
            } else {
                fail_name(mks("undefined function: "), name);
            }
        } else {
            addr = sym_val(ADD(functions_p, MUL(fi, 8)));
            arity = sym_val(ADD(function_arities_p, MUL(fi, 8)));
            if (NOT(EQ(arity, argc))) {
                fail_name(mks("wrong argument count: "), name);
            }
            rel = SUB(addr, ADD(pos, 4));
            patch4(pos, rel);
        }
        i = ADD(i, 1);
    }
    return 0;
}

function patch_calls() {
    return patch_calls_(0, 0, 0, 0, 0, 0, 0, 0);
}

function record_external_(name, type, i, entry) {
    if (GE(find_symbol(functions_p, function_count, name), 0)) {
        return 0;
    }
    while (LT(i, external_count)) {
        entry = ADD(externals_p, MUL(i, 8));
        if (EQ(strcmp(sym_name(entry), name), 0)) {
            return 0;
        }
        i = ADD(i, 1);
    }
    if (GE(external_count, 4096)) {
        fail(mks("too many external symbols\n"));
    }
    entry = ADD(externals_p, MUL(external_count, 8));
    sym_set_name(entry, xstrdup(name));
    sym_set_val(entry, external_count);
    wi32(ADD(external_types_p, MUL(external_count, 4)), type);
    external_count = ADD(external_count, 1);
    return 0;
}

function record_external(name, type) {
    return record_external_(name, type, 0, 0);
}

function record_reloc(offset, name, type) {
    if (GE(reloc_count, 8192)) {
        fail(mks("too many relocations\n"));
    }
    wi32(ADD(reloc_offsets_p, MUL(reloc_count, 4)), offset);
    wi32(ADD(reloc_names_p, MUL(reloc_count, 4)), xstrdup(name));
    wi32(ADD(reloc_types_p, MUL(reloc_count, 4)), type);
    reloc_count = ADD(reloc_count, 1);
    return 0;
}

function record_data_patch(offset, addend) {
    if (GE(data_patch_count, 8192)) {
        fail(mks("too many relocations\n"));
    }
    wi32(ADD(data_patch_offsets_p, MUL(data_patch_count, 4)), offset);
    wi32(ADD(data_patch_addends_p, MUL(data_patch_count, 4)), addend);
    data_patch_count = ADD(data_patch_count, 1);
    return 0;
}

function parse_program() {
    while (NOT(EQ(tok, TOK_EOF))) {
        if (EQ(tok, TOK_VAR)) {
            parse_global();
        } else {
            parse_function();
        }
    }
    if (AND(NOT(output_object), NOT(has_main_function()))) {
        fail(mks("missing main function\n"));
    }
    return 0;
}

function has_main_function() {
    return GE(find_symbol(functions_p, function_count, mks("main")), 0);
}

function parse_global_(name, entry) {
    expect(TOK_VAR);
    if (NOT(EQ(tok, TOK_IDENT))) {
        fail(mks("expected global name\n"));
    }
    name = xstrdup(tok_text);
    next_tok();
    if (EQ(tok, TOK_ASSIGN)) {
        fail_name(mks("global initializers are unsupported: "), name);
    }
    expect(TOK_SEMI);
    if (OR(GE(find_symbol(globals_p, global_count, name), 0), GE(find_symbol(functions_p, function_count, name), 0))) {
        fail_name(mks("duplicate global: "), name);
    }
    entry = ADD(globals_p, MUL(global_count, 8));
    sym_set_name(entry, name);
    if (output_object) {
        sym_set_val(entry, 0);
        global_count = ADD(global_count, 1);
        return 0;
    }
    if (LT(global_bytes, next_data_offset)) {
        global_bytes = align4(next_data_offset);
        next_data_offset = global_bytes;
    }
    sym_set_val(entry, global_bytes);
    global_count = ADD(global_count, 1);
    global_bytes = ADD(global_bytes, 4);
    if (LT(next_data_offset, global_bytes)) {
        next_data_offset = global_bytes;
    }
    if (LT(data_used, global_bytes)) {
        data_used = global_bytes;
    }
    ensure_data_capacity(data_used);
    return 0;
}

function parse_global() {
    return parse_global_(0, 0);
}

function param_name(param_names, i) {
    return ri32(ADD(param_names, MUL(i, 4)));
}

function param_set_name(param_names, i, name) {
    wi32(ADD(param_names, MUL(i, 4)), name);
    return name;
}

function parse_function_params_(param_names, param_count, i) {
    param_count = 0;
    if (NOT(EQ(tok, TOK_RPAREN))) {
        while (1) {
            if (NOT(EQ(tok, TOK_IDENT))) {
                fail(mks("expected parameter name\n"));
            }
            i = 0;
            while (LT(i, param_count)) {
                if (EQ(strcmp(param_name(param_names, i), tok_text), 0)) {
                    fail_name(mks("duplicate parameter: "), tok_text);
                }
                i = ADD(i, 1);
            }
            param_set_name(param_names, param_count, xstrdup(tok_text));
            param_count = ADD(param_count, 1);
            next_tok();
            if (NOT(EQ(tok, TOK_COMMA))) {
                return param_count;
            }
            next_tok();
        }
    }
    return param_count;
}

function enter_function_(name, param_count, param_names, i) {
    current_param_count = param_count;
    current_returned = 0;
    i = 0;
    while (LT(i, param_count)) {
        wi32(ADD(current_params_p, MUL(i, 4)), xstrdup(param_name(param_names, i)));
        wi32(ADD(current_param_offsets_p, MUL(i, 4)), ADD(8, MUL(4, i)));
        i = ADD(i, 1);
    }
    return 0;
}

function enter_function(name, param_count, param_names) {
    return enter_function_(name, param_count, param_names, 0);
}

function leave_function_(i) {
    i = 0;
    while (LT(i, current_param_count)) {
        free(ri32(ADD(current_params_p, MUL(i, 4))));
        wi32(ADD(current_params_p, MUL(i, 4)), 0);
        wi32(ADD(current_param_offsets_p, MUL(i, 4)), 0);
        i = ADD(i, 1);
    }
    current_param_count = 0;
    current_returned = 0;
    return 0;
}

function leave_function() {
    return leave_function_(0);
}

function parse_function_free_params_(param_names, param_count, i) {
    while (LT(i, param_count)) {
        free(param_name(param_names, i));
        i = ADD(i, 1);
    }
    return 0;
}

function parse_function_(name, param_count, param_names, entry) {
    param_names = xmalloc(4096);
    expect(TOK_FUNCTION);
    if (NOT(EQ(tok, TOK_IDENT))) {
        fail(mks("expected function name\n"));
    }
    name = xstrdup(tok_text);
    next_tok();
    expect(TOK_LPAREN);
    param_count = parse_function_params_(param_names, 0, 0);
    expect(TOK_RPAREN);

    if (GE(find_symbol(functions_p, function_count, name), 0)) {
        fail_name(mks("duplicate function: "), name);
    }
    entry = ADD(functions_p, MUL(function_count, 8));
    sym_set_name(entry, name);
    sym_set_val(entry, code_len);
    entry = ADD(function_arities_p, MUL(function_count, 8));
    sym_set_name(entry, xstrdup(name));
    sym_set_val(entry, param_count);
    function_count = ADD(function_count, 1);

    emit_prologue();
    enter_function(name, param_count, param_names);
    expect(TOK_LBRACE);
    while (AND(NOT(EQ(tok, TOK_RBRACE)), NOT(EQ(tok, TOK_EOF)))) {
        parse_stmt();
    }
    expect(TOK_RBRACE);
    emit_mov_eax_imm32(0);
    emit_epilogue();
    leave_function();
    parse_function_free_params_(param_names, param_count, 0);
    return 0;
}

function parse_function() {
    return parse_function_(0, 0, 0, 0);
}

function parse_stmt() {
    if (EQ(tok, TOK_LBRACE)) {
        parse_block();
        return 0;
    }
    if (EQ(tok, TOK_RETURN)) {
        next_tok();
        parse_expr();
        expect(TOK_SEMI);
        emit_epilogue();
        current_returned = 1;
        return 0;
    }
    if (EQ(tok, TOK_IF)) {
        parse_if();
        return 0;
    }
    if (EQ(tok, TOK_WHILE)) {
        parse_while();
        return 0;
    }
    if (EQ(tok, TOK_BREAK)) {
        parse_break();
        return 0;
    }
    parse_expr();
    expect(TOK_SEMI);
    return 0;
}

function parse_block() {
    expect(TOK_LBRACE);
    while (AND(NOT(EQ(tok, TOK_RBRACE)), NOT(EQ(tok, TOK_EOF)))) {
        parse_stmt();
    }
    expect(TOK_RBRACE);
    return 0;
}

function parse_if_(false_patch, end_patch, after_then) {
    expect(TOK_IF);
    expect(TOK_LPAREN);
    parse_expr();
    expect(TOK_RPAREN);
    emit_test_eax_eax();
    false_patch = emit_je_placeholder();
    parse_stmt();
    if (EQ(tok, TOK_ELSE)) {
        end_patch = emit_jmp_placeholder();
        after_then = code_len;
        patch_rel32(false_patch, after_then);
        next_tok();
        parse_stmt();
        patch_rel32(end_patch, code_len);
    } else {
        patch_rel32(false_patch, code_len);
    }
    return 0;
}

function parse_if() {
    return parse_if_(0, 0, 0);
}

function parse_while_(loop_start, exit_patch, loop_id) {
    expect(TOK_WHILE);
    expect(TOK_LPAREN);
    loop_start = code_len;
    parse_expr();
    expect(TOK_RPAREN);
    emit_test_eax_eax();
    exit_patch = emit_je_placeholder();
    loop_id = push_loop();
    record_break(loop_id, exit_patch);
    parse_stmt();
    emit_jmp(loop_start);
    patch_rel32(exit_patch, code_len);
    patch_breaks(loop_id, code_len);
    pop_loop();
    return 0;
}

function parse_while() {
    return parse_while_(0, 0, 0);
}

function parse_break() {
    if (LT(loop_depth, 1)) {
        fail(mks("break outside loop\n"));
    }
    expect(TOK_BREAK);
    expect(TOK_SEMI);
    record_break(ri32(ADD(loop_stack_p, MUL(SUB(loop_depth, 1), 4))), emit_jmp_placeholder());
    return 0;
}

function parse_expr() {
    if (EQ(tok, TOK_IDENT)) {
        parse_assign_or_primary();
        return 0;
    }
    parse_primary();
    return 0;
}

function parse_assign_store_param_(name, i) {
    while (LT(i, current_param_count)) {
        if (EQ(strcmp(ri32(ADD(current_params_p, MUL(i, 4))), name), 0)) {
            emit_store_param(ri32(ADD(current_param_offsets_p, MUL(i, 4))));
            free(name);
            return 1;
        }
        i = ADD(i, 1);
    }
    return 0;
}

function parse_assign_load_param_(name, i) {
    while (LT(i, current_param_count)) {
        if (EQ(strcmp(ri32(ADD(current_params_p, MUL(i, 4))), name), 0)) {
            emit_load_param(ri32(ADD(current_param_offsets_p, MUL(i, 4))));
            free(name);
            return 1;
        }
        i = ADD(i, 1);
    }
    return 0;
}

function parse_assign_or_primary_(name, arity) {
    name = xstrdup(tok_text);
    next_tok();
    if (EQ(tok, TOK_ASSIGN)) {
        next_tok();
        parse_expr();
        if (parse_assign_store_param_(name, 0)) {
            return 0;
        }
        if (GE(find_symbol(globals_p, global_count, name), 0)) {
            emit_store_global(name);
            free(name);
            return 0;
        }
        fail_name(mks("assignment to unknown variable: "), name);
    }
    if (EQ(tok, TOK_LPAREN)) {
        arity = builtin_arity(name);
        if (GT(arity, 0)) {
            parse_builtin_call(name, arity);
        } else {
            emit_user_call(name, parse_user_call_args());
        }
        free(name);
        return 0;
    }
    if (parse_assign_load_param_(name, 0)) {
        return 0;
    }
    if (GE(find_symbol(globals_p, global_count, name), 0)) {
        emit_load_global(name);
        free(name);
        return 0;
    }
    fail_name(mks("unknown identifier: "), name);
    return 0;
}

function parse_assign_or_primary() {
    return parse_assign_or_primary_(0, 0);
}

function parse_primary() {
    if (EQ(tok, TOK_NUM)) {
        emit_mov_eax_imm32(tok_num);
        next_tok();
        return 0;
    }
    if (EQ(tok, TOK_STR)) {
        emit_mks_literal(tok_text);
        next_tok();
        return 0;
    }
    if (EQ(tok, TOK_LPAREN)) {
        next_tok();
        parse_expr();
        expect(TOK_RPAREN);
        return 0;
    }
    fail(mks("expected expression\n"));
    return 0;
}

function align4(n) {
    return MUL(DIV(ADD(n, 3), 4), 4);
}

function boutstr(s) {
    while (ri8(s)) {
        bout1(ri8(s));
        s = ADD(s, 1);
    }
    return 0;
}

function pad_to(n) {
    while (LT(bin_len, n)) {
        bout1(0);
    }
    return 0;
}

function bout1(b) {
    ensure_bin_capacity(ADD(bin_len, 1));
    wi8(ADD(binbuf_p, bin_len), b);
    bin_len = ADD(bin_len, 1);
    return 0;
}

function bout2(v) {
    bout1(v);
    bout1(DIV(v, 256));
    return 0;
}

function bout4(v) {
    bout1(v);
    bout1(DIV(v, 256));
    bout1(DIV(v, 65536));
    bout1(DIV(v, 16777216));
    return 0;
}

function bin_reset_(i) {
    bin_len = 0;
    return 0;
}

function bin_reset() {
    return bin_reset_(0);
}

function emit_binary_(fd) {
    if (NE(write(fd, binbuf_p, bin_len), bin_len)) {
        fail_msg(mks("write failed\n"), 13);
    }
    return 0;
}

function emit_binary(out_fd) {
    if (EQ(output_path, 0)) {
        return emit_binary_(1);
    }
    out_fd = open(output_path, 577, 438);
    if (LT(out_fd, 0)) {
        return fail_name(mks("cannot open output "), output_path);
    }
    emit_binary_(out_fd);
    close(out_fd);
    return 0;
}

function build_object_init_symbols_(sym_name_off, sym_index, i, pos, entry, name) {
    i = 0;
    pos = 1;
    while (LT(i, function_count)) {
        entry = ADD(functions_p, MUL(i, 8));
        name = sym_name(entry);
        wi32(ADD(sym_index, MUL(i, 4)), ADD(i, 2));
        wi32(ADD(sym_name_off, MUL(i, 4)), pos);
        pos = ADD(ADD(pos, strlen(name)), 1);
        i = ADD(i, 1);
    }
    i = 0;
    while (LT(i, global_count)) {
        entry = ADD(globals_p, MUL(i, 8));
        name = sym_name(entry);
        wi32(ADD(sym_index, MUL(ADD(function_count, i), 4)), ADD(ADD(function_count, i), 2));
        wi32(ADD(sym_name_off, MUL(ADD(function_count, i), 4)), pos);
        pos = ADD(ADD(pos, strlen(name)), 1);
        i = ADD(i, 1);
    }
    i = 0;
    while (LT(i, external_count)) {
        entry = ADD(externals_p, MUL(i, 8));
        name = sym_name(entry);
        wi32(ADD(sym_index, MUL(ADD(ADD(function_count, global_count), i), 4)), ADD(ADD(ADD(function_count, global_count), i), 2));
        wi32(ADD(sym_name_off, MUL(ADD(ADD(function_count, global_count), i), 4)), pos);
        pos = ADD(ADD(pos, strlen(name)), 1);
        i = ADD(i, 1);
    }
    return pos;
}

function build_object_emit_code_(i) {
    while (LT(i, code_len)) {
        bout1(ri8(ADD(code_p, i)));
        i = ADD(i, 1);
    }
    return 0;
}

function build_object_emit_data_(i) {
    while (LT(i, data_used)) {
        bout1(ri8(ADD(data_byte_p, i)));
        i = ADD(i, 1);
    }
    return 0;
}

function patch_data_patches_(data_base, i, pos, addend) {
    i = 0;
    while (LT(i, data_patch_count)) {
        pos = ri32(ADD(data_patch_offsets_p, MUL(i, 4)));
        addend = ri32(ADD(data_patch_addends_p, MUL(i, 4)));
        patch4(pos, ADD(data_base, addend));
        i = ADD(i, 1);
    }
    return 0;
}

function patch_data_patches(data_base) {
    return patch_data_patches_(data_base, 0, 0, 0);
}

function build_binary_(base, ehsize, phsize, headers, entry, filesz, memsz, flags, main_index, rel, data_off, data_base) {
    base = 134512640;
    ehsize = 52;
    phsize = 32;
    headers = ADD(ehsize, phsize);
    entry = ADD(base, headers);
    data_off = align4(ADD(headers, code_len));
    data_base = ADD(base, data_off);
    filesz = ADD(data_off, data_used);
    memsz = filesz;
    flags = 7;

    main_index = find_symbol(functions_p, function_count, mks("main"));
    if (LT(main_index, 0)) {
        fail(mks("missing main function\n"));
    }
    rel = SUB(sym_val(ADD(functions_p, MUL(main_index, 8))), ADD(start_call_patch, 4));
    patch4(start_call_patch, rel);
    patch_data_patches(data_base);

    bin_reset();
    bout1(127); bout1(69); bout1(76); bout1(70);
    bout1(1); bout1(1); bout1(1); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout2(2); bout2(3); bout4(1); bout4(entry); bout4(ehsize); bout4(0); bout4(0);
    bout2(ehsize); bout2(phsize); bout2(1); bout2(0); bout2(0); bout2(0);
    bout4(1); bout4(0); bout4(base); bout4(base); bout4(filesz); bout4(memsz); bout4(flags); bout4(4096);

    build_object_emit_code_(0);
    pad_to(data_off);
    build_object_emit_data_(0);
    return 0;
}

function build_binary() {
    return build_binary_(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

function code_reset() {
    code_reset_data_(0);
    code_len = 0;
    call_count = 0;
    global_count = 0;
    function_count = 0;
    external_count = 0;
    reloc_count = 0;
    data_patch_count = 0;
    global_bytes = 4;
    next_data_offset = 4;
    data_used = 4;
    loop_depth = 0;
    next_loop_id = 0;
    break_patch_count = 0;
    current_param_count = 0;
    current_returned = 0;
    return 0;
}

function code_reset_data_(i) {
    while (LT(i, data_cap)) {
        wi8(ADD(data_byte_p, i), 0);
        i = ADD(i, 1);
    }
    return 0;
}

function build_object_emit_relocs_(sym_index, ri, si, name, off, typ, sympos) {
    while (LT(ri, reloc_count)) {
        name = ri32(ADD(reloc_names_p, MUL(ri, 4)));
        off = ri32(ADD(reloc_offsets_p, MUL(ri, 4)));
        typ = ri32(ADD(reloc_types_p, MUL(ri, 4)));
        if (name_eq(name, mks(".data"))) {
            bout4(off);
            bout4(ADD(256, typ));
        } else {
            si = find_symbol(functions_p, function_count, name);
            if (GE(si, 0)) {
                bout4(off);
                bout4(ADD(MUL(ri32(ADD(sym_index, MUL(si, 4))), 256), typ));
            } else {
                si = find_symbol(globals_p, global_count, name);
                if (GE(si, 0)) {
                    bout4(off);
                    bout4(ADD(MUL(ri32(ADD(sym_index, MUL(ADD(function_count, si), 4))), 256), typ));
                } else {
                    si = find_symbol(externals_p, external_count, name);
                    if (LT(si, 0)) {
                        fail_name(mks("unresolved relocation symbol: "), name);
                    }
                    sympos = ADD(ADD(function_count, global_count), si);
                    bout4(off);
                    bout4(ADD(MUL(ri32(ADD(sym_index, MUL(sympos, 4))), 256), typ));
                }
            }
        }
        ri = ADD(ri, 1);
    }
    return 0;
}

function build_object_emit_functions_(sym_name_off, i, start, next_start, size, entry) {
    while (LT(i, function_count)) {
        entry = ADD(functions_p, MUL(i, 8));
        start = sym_val(entry);
        if (LT(ADD(i, 1), function_count)) {
            next_start = sym_val(ADD(functions_p, MUL(ADD(i, 1), 8)));
        } else {
            next_start = code_len;
        }
        size = SUB(next_start, start);
        bout4(ri32(ADD(sym_name_off, MUL(i, 4))));
        bout4(start);
        bout4(size);
        bout1(18);
        bout1(0);
        bout2(1);
        i = ADD(i, 1);
    }
    return 0;
}

function build_object_emit_globals_(sym_name_off, i, entry) {
    while (LT(i, global_count)) {
        entry = ADD(globals_p, MUL(i, 8));
        bout4(ri32(ADD(sym_name_off, MUL(ADD(function_count, i), 4))));
        bout4(4);
        bout4(4);
        bout1(17);
        bout1(0);
        bout2(65522);
        i = ADD(i, 1);
    }
    return 0;
}

function build_object_emit_externals_(sym_name_off, i, sympos) {
    while (LT(i, external_count)) {
        sympos = ADD(ADD(function_count, global_count), i);
        bout4(ri32(ADD(sym_name_off, MUL(sympos, 4))));
        bout4(0);
        bout4(0);
        bout1(ri32(ADD(external_types_p, MUL(i, 4))));
        bout1(0);
        bout2(0);
        i = ADD(i, 1);
    }
    return 0;
}

function build_object_emit_strtab_(i, entry) {
    bout1(0);
    i = 0;
    while (LT(i, function_count)) {
        entry = ADD(functions_p, MUL(i, 8));
        boutstr(sym_name(entry));
        bout1(0);
        i = ADD(i, 1);
    }
    i = 0;
    while (LT(i, global_count)) {
        entry = ADD(globals_p, MUL(i, 8));
        boutstr(sym_name(entry));
        bout1(0);
        i = ADD(i, 1);
    }
    i = 0;
    while (LT(i, external_count)) {
        entry = ADD(externals_p, MUL(i, 8));
        boutstr(sym_name(entry));
        bout1(0);
        i = ADD(i, 1);
    }
    return 0;
}

function build_object_emit_shstrtab() {
    bout1(0);
    boutstr(mks(".text")); bout1(0);
    boutstr(mks(".rel.text")); bout1(0);
    boutstr(mks(".data")); bout1(0);
    boutstr(mks(".bss")); bout1(0);
    boutstr(mks(".symtab")); bout1(0);
    boutstr(mks(".strtab")); bout1(0);
    boutstr(mks(".shstrtab")); bout1(0);
    return 0;
}

function build_object_emit_zeroes_(count, i) {
    while (LT(i, count)) {
        bout1(0);
        i = ADD(i, 1);
    }
    return 0;
}

function build_object_(sym_name_off, sym_index, ehsize, shentsize, shnum, shstrndx, text_off, data_off, rel_off, symtab_off, strtab_off, shstrtab_off, shoff, strtab_size, shstrtab_size, sym_count, symtab_size, rel_size) {
    sym_name_off = xmalloc(16384);
    sym_index = xmalloc(16384);

    ehsize = 52;
    shentsize = 40;
    shnum = 8;
    shstrndx = 7;
    strtab_size = build_object_init_symbols_(sym_name_off, sym_index, 0, 0, 0, 0);
    shstrtab_size = 54;
    sym_count = ADD(ADD(ADD(function_count, global_count), external_count), 2);
    symtab_size = MUL(sym_count, 16);
    rel_size = MUL(reloc_count, 8);

    text_off = ehsize;
    data_off = align4(ADD(text_off, code_len));
    rel_off = align4(ADD(data_off, data_used));
    symtab_off = ADD(rel_off, rel_size);
    strtab_off = ADD(symtab_off, symtab_size);
    shstrtab_off = ADD(strtab_off, strtab_size);
    shoff = align4(ADD(shstrtab_off, shstrtab_size));

    bin_reset();

    bout1(127); bout1(69); bout1(76); bout1(70);
    bout1(1); bout1(1); bout1(1); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout2(1); bout2(3); bout4(1); bout4(0); bout4(0); bout4(shoff); bout4(0);
    bout2(ehsize); bout2(0); bout2(0); bout2(shentsize); bout2(shnum); bout2(shstrndx);

    build_object_emit_code_(0);

    pad_to(data_off);
    build_object_emit_data_(0);

    pad_to(rel_off);
    build_object_emit_relocs_(sym_index, 0, 0, 0, 0, 0, 0);

    pad_to(symtab_off);
    build_object_emit_zeroes_(16, 0);
    bout4(0);
    bout4(0);
    bout4(data_used);
    bout1(3);
    bout1(0);
    bout2(3);
    build_object_emit_functions_(sym_name_off, 0, 0, 0, 0, 0);
    build_object_emit_globals_(sym_name_off, 0, 0);
    build_object_emit_externals_(sym_name_off, 0, 0);

    build_object_emit_strtab_(0, 0);
    build_object_emit_shstrtab();

    pad_to(shoff);
    build_object_emit_zeroes_(40, 0);

    bout4(1); bout4(1); bout4(6); bout4(0); bout4(text_off); bout4(code_len); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(7); bout4(9); bout4(64); bout4(0); bout4(rel_off); bout4(rel_size); bout4(5); bout4(1); bout4(4); bout4(8);
    bout4(17); bout4(1); bout4(3); bout4(0); bout4(data_off); bout4(data_used); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(23); bout4(8); bout4(3); bout4(0); bout4(ADD(data_off, data_used)); bout4(0); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(28); bout4(2); bout4(0); bout4(0); bout4(symtab_off); bout4(symtab_size); bout4(6); bout4(2); bout4(4); bout4(16);
    bout4(36); bout4(3); bout4(0); bout4(0); bout4(strtab_off); bout4(strtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(44); bout4(3); bout4(0); bout4(0); bout4(shstrtab_off); bout4(shstrtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
    return 0;
}

function build_object() {
    return build_object_(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

function read_source_(path, fd, cap, buf, used, got, new_cap, new_buf) {
    fd = open(path, 0, 0);
    if (LT(fd, 0)) {
        return 0;
    }
    cap = 4096;
    buf = xmalloc(ADD(cap, 2));
    used = 0;
    while (1) {
        if (GE(used, cap)) {
            new_cap = MUL(cap, 2);
            new_buf = xmalloc(ADD(new_cap, 2));
            copy_bytes_(new_buf, buf, used, 0);
            buf = new_buf;
            cap = new_cap;
        }
        got = read(fd, ADD(buf, used), SUB(cap, used));
        if (LT(got, 0)) {
            close(fd);
            return 0;
        }
        if (EQ(got, 0)) {
            break;
        }
        used = ADD(used, got);
    }
    close(fd);
    wi8(ADD(buf, used), mkC("\n"));
    wi8(ADD(ADD(buf, used), 1), 0);
    src_len = ADD(used, 1);
    return buf;
}

function read_source(path) {
    return read_source_(path, 0, 0, 0, 0, 0, 0, 0);
}

function compile(source_path) {
    src = read_source(source_path);
    init_lexer();
    code_reset();
    next_tok();
    if (NOT(output_object)) {
        emit_start();
    }
    parse_program();
    expect(TOK_EOF);
    patch_calls();
    if (output_object) {
        build_object();
    } else {
        build_binary();
    }
    emit_binary(0);
    return 0;
}

function main_(argc, argv, i, arg, source_path) {
    output_object = 0;
    output_path = 0;
    source_path = 0;
    i = 1;
    while (LT(i, argc)) {
        arg = ri32(ADD(argv, MUL(i, 4)));
        if (EQ(strcmp(arg, mks("-c")), 0)) {
            output_object = 1;
        } else {
            if (EQ(strcmp(arg, mks("-o")), 0)) {
                i = ADD(i, 1);
                if (GE(i, argc)) {
                    return usage(ri32(argv));
                }
                output_path = ri32(ADD(argv, MUL(i, 4)));
            } else {
                if (NE(source_path, 0)) {
                    return usage(ri32(argv));
                }
                source_path = arg;
            }
        }
        i = ADD(i, 1);
    }
    if (NE(source_path, 0)) {
        return compile(source_path);
    }
    return usage(ri32(argv));
}

function main(argc, argv) {
    init_globals();
    return main_(argc, argv, 0, 0, 0);
}
