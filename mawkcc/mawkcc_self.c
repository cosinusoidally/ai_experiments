var output_object;
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
var data_byte_p;
var bin_len;
var binbuf_p;

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
    if (eq(code_p, 0)) {
        code_p = xmalloc(262144);
    }
    if (eq(binbuf_p, 0)) {
        binbuf_p = xmalloc(524288);
    }
    if (eq(data_byte_p, 0)) {
        data_byte_p = xmalloc(4096);
    }
    if (eq(globals_p, 0)) {
        globals_p = xmalloc(32768);
    }
    if (eq(functions_p, 0)) {
        functions_p = xmalloc(32768);
    }
    if (eq(function_arities_p, 0)) {
        function_arities_p = xmalloc(32768);
    }
    if (eq(current_params_p, 0)) {
        current_params_p = xmalloc(4096);
    }
    if (eq(current_param_offsets_p, 0)) {
        current_param_offsets_p = xmalloc(4096);
    }
    if (eq(externals_p, 0)) {
        externals_p = xmalloc(32768);
    }
    if (eq(external_types_p, 0)) {
        external_types_p = xmalloc(16384);
    }
    if (eq(call_target_p, 0)) {
        call_target_p = xmalloc(32768);
    }
    if (eq(call_pos_p, 0)) {
        call_pos_p = xmalloc(32768);
    }
    if (eq(call_argc_p, 0)) {
        call_argc_p = xmalloc(32768);
    }
    if (eq(reloc_offsets_p, 0)) {
        reloc_offsets_p = xmalloc(32768);
    }
    if (eq(reloc_names_p, 0)) {
        reloc_names_p = xmalloc(32768);
    }
    if (eq(reloc_types_p, 0)) {
        reloc_types_p = xmalloc(32768);
    }
    if (eq(loop_stack_p, 0)) {
        loop_stack_p = xmalloc(4096);
    }
    if (eq(break_patch_loop_p, 0)) {
        break_patch_loop_p = xmalloc(32768);
    }
    if (eq(break_patch_pos_p, 0)) {
        break_patch_pos_p = xmalloc(32768);
    }
    return 0;
}

function fail_msg(s, n) {
    write(2, s, n);
    exit(1);
    return 0;
}

function fail_code(code, arg) {
    return fail_msg(mks("mawkcc error\n"), 13);
}

function usage(program) {
    write(2, mks("usage: mawkcc [-c] source\n"), 26);
    return 1;
}

function xmalloc_(n, p) {
    p = malloc(n);
    if (eq(p, 0)) {
        fail_msg(mks("out of memory\n"), 14);
    }
    return p;
}

function xmalloc(n) {
    return xmalloc_(n, 0);
}

function xrealloc_(p, n, q) {
    q = realloc(p, n);
    if (eq(q, 0)) {
        fail_msg(mks("out of memory\n"), 14);
    }
    return q;
}

function xrealloc(p, n) {
    return xrealloc_(p, n, 0);
}

function div_floor256(v, q) {
    q = div(v, 256);
    if (and(lt(v, 0), ne(mul(q, 256), v))) {
        q = sub(q, 1);
    }
    return q;
}

function u32_byte(v, shift) {
    while (gt(shift, 0)) {
        v = div_floor256(v, 0);
        shift = sub(shift, 8);
    }
    return v;
}

function sym_name(sym) {
    return ri32(sym);
}

function sym_val(sym) {
    return ri32(add(sym, 4));
}

function sym_set_name(sym, name) {
    wi32(sym, name);
    return name;
}

function sym_set_val(sym, val) {
    wi32(add(sym, 4), val);
    return val;
}

function xstrdup_(s, n, p, i) {
    n = strlen(s);
    p = xmalloc(add(n, 1));
    i = 0;
    while (le(i, n)) {
        wi8(add(p, i), ri8(add(s, i)));
        i = add(i, 1);
    }
    return p;
}

function xstrdup(s) {
    return xstrdup_(s, 0, 0, 0);
}

function find_symbol_(arr, count, name, i, entry) {
    while (lt(i, count)) {
        entry = add(arr, mul(i, 8));
        if (eq(strcmp(sym_name(entry), name), 0)) {
            return i;
        }
        i = add(i, 1);
    }
    return neg(1);
}

function find_symbol(arr, count, name) {
    return find_symbol_(arr, count, name, 0, 0);
}

function is_space_char(ch) {
    return or(or(or(eq(ch, 32), eq(ch, 9)), or(eq(ch, 10), eq(ch, 13))), or(eq(ch, 12), eq(ch, 11)));
}

function is_digit_char(ch) {
    return and(ge(ch, 48), le(ch, 57));
}

function is_alpha_char(ch) {
    return or(or(and(ge(ch, 97), le(ch, 122)), and(ge(ch, 65), le(ch, 90))), eq(ch, 95));
}

function is_alnum_char(ch) {
    return or(is_alpha_char(ch), is_digit_char(ch));
}

function set_tok_text_len_(s, n, i) {
    if (lt(tok_text_cap, add(n, 1))) {
        tok_text_cap = add(n, 32);
        tok_text = xrealloc(tok_text, tok_text_cap);
    }
    i = 0;
    while (lt(i, n)) {
        wi8(add(tok_text, i), ri8(add(s, i)));
        i = add(i, 1);
    }
    wi8(add(tok_text, n), 0);
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
    while (lt(idx_pos, src_len)) {
        ch = ri8(add(src, idx_pos));
        if (is_space_char(ch)) {
            idx_pos = add(idx_pos, 1);
        } else if (and(lt(add(idx_pos, 1), src_len), and(eq(ri8(add(src, idx_pos)), 47), eq(ri8(add(src, add(idx_pos, 1))), 42)))) {
            idx_pos = add(idx_pos, 2);
            while (and(lt(add(idx_pos, 1), src_len), not(and(eq(ri8(add(src, idx_pos)), 42), eq(ri8(add(src, add(idx_pos, 1))), 47))))) {
                idx_pos = add(idx_pos, 1);
            }
            if (ge(add(idx_pos, 1), src_len)) {
                fail_code(29, 0);
            }
            idx_pos = add(idx_pos, 2);
        } else if (and(lt(add(idx_pos, 1), src_len), and(eq(ri8(add(src, idx_pos)), 47), eq(ri8(add(src, add(idx_pos, 1))), 47)))) {
            idx_pos = add(idx_pos, 2);
            while (and(lt(idx_pos, src_len), ne(ri8(add(src, idx_pos)), 10))) {
                idx_pos = add(idx_pos, 1);
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
    idx_pos = add(idx_pos, 1);
    cap = 64;
    len = 0;
    buf = xmalloc(cap);
    while (lt(idx_pos, src_len)) {
        ch = ri8(add(src, idx_pos));
        if (eq(ch, 34)) {
            idx_pos = add(idx_pos, 1);
            set_tok_text_len(buf, len);
            free(buf);
            tok = TOK_STR;
            return 0;
        }
        if (eq(ch, 92)) {
            idx_pos = add(idx_pos, 1);
            if (ge(idx_pos, src_len)) {
                free(buf);
                fail_code(30, 0);
            }
            ch = ri8(add(src, idx_pos));
            if (eq(ch, 110)) {
                ch = 10;
            } else if (eq(ch, 116)) {
                ch = 9;
            } else if (eq(ch, 114)) {
                ch = 13;
            } else if (eq(ch, 34)) {
                ch = 34;
            } else if (eq(ch, 92)) {
                ch = 92;
            } else if (eq(ch, 48)) {
                ch = 0;
            } else {
                free(buf);
                fail_code(32, ch);
            }
        }
        if (ge(add(len, 2), cap)) {
            cap = mul(cap, 2);
            buf = xrealloc(buf, cap);
        }
        wi8(add(buf, len), ch);
        len = add(len, 1);
        idx_pos = add(idx_pos, 1);
    }
    free(buf);
    fail_code(31, 0);
    return 0;
}

function read_string_token() {
    return read_string_token_(0, 0, 0, 0);
}

function next_tok_ident_(start) {
    start = idx_pos;
    idx_pos = add(idx_pos, 1);
    while (and(lt(idx_pos, src_len), is_alnum_char(ri8(add(src, idx_pos))))) {
        idx_pos = add(idx_pos, 1);
    }
    set_tok_text_len(add(src, start), sub(idx_pos, start));
    if (eq(strcmp(tok_text, mks("return")), 0)) {
        tok = TOK_RETURN;
    } else if (eq(strcmp(tok_text, mks("function")), 0)) {
        tok = TOK_FUNCTION;
    } else if (eq(strcmp(tok_text, mks("var")), 0)) {
        tok = TOK_VAR;
    } else if (eq(strcmp(tok_text, mks("if")), 0)) {
        tok = TOK_IF;
    } else if (eq(strcmp(tok_text, mks("else")), 0)) {
        tok = TOK_ELSE;
    } else if (eq(strcmp(tok_text, mks("while")), 0)) {
        tok = TOK_WHILE;
    } else if (eq(strcmp(tok_text, mks("break")), 0)) {
        tok = TOK_BREAK;
    } else {
        tok = TOK_IDENT;
    }
    return 0;
}

function next_tok_num_(start) {
    start = idx_pos;
    idx_pos = add(idx_pos, 1);
    while (and(lt(idx_pos, src_len), is_digit_char(ri8(add(src, idx_pos))))) {
        idx_pos = add(idx_pos, 1);
    }
    set_tok_text_len(add(src, start), sub(idx_pos, start));
    tok_num = strtoul(tok_text, 0, 10);
    tok = TOK_NUM;
    return 0;
}

function next_tok_punc_(ch) {
    if (eq(ch, 40)) {
        tok = TOK_LPAREN; set_tok_text_cstr(mks("(")); idx_pos = add(idx_pos, 1); return 1;
    }
    if (eq(ch, 41)) {
        tok = TOK_RPAREN; set_tok_text_cstr(mks(")")); idx_pos = add(idx_pos, 1); return 1;
    }
    if (eq(ch, 123)) {
        tok = TOK_LBRACE; set_tok_text_cstr(mks("{")); idx_pos = add(idx_pos, 1); return 1;
    }
    if (eq(ch, 125)) {
        tok = TOK_RBRACE; set_tok_text_cstr(mks("}")); idx_pos = add(idx_pos, 1); return 1;
    }
    if (eq(ch, 59)) {
        tok = TOK_SEMI; set_tok_text_cstr(mks(";")); idx_pos = add(idx_pos, 1); return 1;
    }
    if (eq(ch, 44)) {
        tok = TOK_COMMA; set_tok_text_cstr(mks(",")); idx_pos = add(idx_pos, 1); return 1;
    }
    if (eq(ch, 61)) {
        tok = TOK_ASSIGN; set_tok_text_cstr(mks("=")); idx_pos = add(idx_pos, 1); return 1;
    }
    return 0;
}

function next_tok_(ch) {
    skip_ws_and_comments();
    tok_pos = idx_pos;
    if (ge(idx_pos, src_len)) {
        tok = TOK_EOF;
        set_tok_text_cstr(mks(""));
        return 0;
    }
    ch = ri8(add(src, idx_pos));
    if (is_alpha_char(ch)) {
        next_tok_ident_(0);
        return 0;
    }
    if (is_digit_char(ch)) {
        next_tok_num_(0);
        return 0;
    }
    if (eq(ch, 34)) {
        read_string_token();
        return 0;
    }
    if (next_tok_punc_(ch)) {
        return 0;
    }
    fail_code(33, ch);
    return 0;
}

function next_tok() {
    return next_tok_(0);
}

function expect(want) {
    if (not(eq(tok, want))) {
        fail_code(1, want);
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
    while (lt(i, div(argc, 2))) {
        lo = mul(4, i);
        hi = mul(4, sub(sub(argc, 1), i));
        emit_mov_eax_stack_disp32(lo);
        emit_mov_ebx_stack_disp32(hi);
        emit_mov_stack_disp32_ebx(lo);
        emit_mov_stack_disp32_eax(hi);
        i = add(i, 1);
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
function patch_rel32(pos, target) { patch4(pos, sub(target, add(pos, 4))); return 0; }
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
function emit_sub_from_stack_top() { emit1(137); emit1(193); emit1(137); emit1(216); emit1(41); emit1(200); }
function emit_imul_eax_ebx() { emit1(15); emit1(175); emit1(195); }
function emit_div_stack_top_by_eax() { emit1(137); emit1(193); emit1(137); emit1(216); emit1(153); emit1(247); emit1(249); }
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

function emit1(b) {
    if (ge(code_len, 262144)) {
        exit(1);
    }
    wi8(add(code_p, code_len), b);
    code_len = add(code_len, 1);
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
    wi8(add(code_p, pos), u32_byte(v, 0));
    wi8(add(code_p, add(pos, 1)), u32_byte(v, 8));
    wi8(add(code_p, add(pos, 2)), u32_byte(v, 16));
    wi8(add(code_p, add(pos, 3)), u32_byte(v, 24));
    return 0;
}

function register_string_(text, start, len, i) {
    len = strlen(text);
    start = next_data_offset;
    if (gt(add(add(start, len), 1), 4096)) {
        fail_code(24, 0);
    }
    i = 0;
    while (lt(i, len)) {
        wi8(add(data_byte_p, add(start, i)), ri8(add(text, i)));
        i = add(i, 1);
    }
    wi8(add(data_byte_p, add(start, len)), 0);
    next_data_offset = add(add(start, len), 1);
    if (lt(data_used, next_data_offset)) {
        data_used = next_data_offset;
    }
    return add(134516736, start);
}

function register_string(text) {
    return register_string_(text, 0, 0, 0);
}

function emit_mks_literal_(text, addr) {
    addr = register_string(text);
    emit1(184);
    if (output_object) {
        record_reloc(code_len, mks(".data"), 1);
        emit4(sub(addr, 134516736));
        return 0;
    }
    emit4(addr);
    return 0;
}

function emit_mks_literal(text) {
    return emit_mks_literal_(text, 0);
}

function emit_load_global_(name, idx, off) {
    idx = find_symbol(globals_p, global_count, name);
    off = sym_val(add(globals_p, mul(idx, 8)));
    emit1(161);
    if (output_object) {
        record_reloc(code_len, name, 1);
        emit4(0);
        return 0;
    }
    emit4(add(134516736, off));
    return 0;
}

function emit_load_global(name) {
    return emit_load_global_(name, 0, 0);
}

function emit_store_global_(name, idx, off) {
    idx = find_symbol(globals_p, global_count, name);
    off = sym_val(add(globals_p, mul(idx, 8)));
    emit1(163);
    if (output_object) {
        record_reloc(code_len, name, 1);
        emit4(0);
        return 0;
    }
    emit4(add(134516736, off));
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
    cur_addr = 134516736;
    emit_mov_edx_eax();
    emit_mov_eax_abs(cur_addr);
    emit_test_eax_eax();
    init_skip = emit_jne_placeholder();
    emit_mov_eax_imm32(45);
    emit_xor_ebx_ebx();
    emit_int_80();
    emit_mov_abs_eax(cur_addr);
    patch_rel32(init_skip, code_len);
    emit_mov_ecx_abs(cur_addr);
    emit_mov_ebx_ecx();
    emit_add_ebx_edx();
    emit_mov_eax_imm32(45);
    emit_int_80();
    emit_cmp_eax_ebx();
    fail_patch = emit_jne_placeholder();
    emit_mov_abs_ebx(cur_addr);
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
    id = add(next_loop_id, 1);
    next_loop_id = id;
    if (ge(loop_depth, 1024)) {
        fail_code(2, 0);
    }
    wi32(add(loop_stack_p, mul(loop_depth, 4)), id);
    loop_depth = add(loop_depth, 1);
    return id;
}

function push_loop() {
    return push_loop_(0);
}

function pop_loop() {
    if (gt(loop_depth, 0)) {
        loop_depth = sub(loop_depth, 1);
    }
    return 0;
}

function record_break(loop_id, patch_pos) {
    if (ge(break_patch_count, 8192)) {
        fail_code(3, 0);
    }
    wi32(add(break_patch_loop_p, mul(break_patch_count, 4)), loop_id);
    wi32(add(break_patch_pos_p, mul(break_patch_count, 4)), patch_pos);
    break_patch_count = add(break_patch_count, 1);
    return 0;
}

function patch_breaks_(loop_id, target, i) {
    while (lt(i, break_patch_count)) {
        if (eq(ri32(add(break_patch_loop_p, mul(i, 4))), loop_id)) {
            patch_rel32(ri32(add(break_patch_pos_p, mul(i, 4))), target);
        }
        i = add(i, 1);
    }
    return 0;
}

function patch_breaks(loop_id, target) {
    return patch_breaks_(loop_id, target, 0);
}

function streq2(s, c0, c1) {
    return and(and(eq(ri8(s), c0), eq(ri8(add(s, 1)), c1)), eq(ri8(add(s, 2)), 0));
}

function streq3(s, c0, c1, c2) {
    return and(and(eq(ri8(s), c0), eq(ri8(add(s, 1)), c1)), and(eq(ri8(add(s, 2)), c2), eq(ri8(add(s, 3)), 0)));
}

function streq4(s, c0, c1, c2, c3) {
    return and(and(streq3_prefix(s, c0, c1, c2), eq(ri8(add(s, 3)), c3)), eq(ri8(add(s, 4)), 0));
}

function streq5(s, c0, c1, c2, c3, c4) {
    return and(and(streq4_prefix(s, c0, c1, c2, c3), eq(ri8(add(s, 4)), c4)), eq(ri8(add(s, 5)), 0));
}

function streq3_prefix(s, c0, c1, c2) {
    return and(and(eq(ri8(s), c0), eq(ri8(add(s, 1)), c1)), eq(ri8(add(s, 2)), c2));
}

function streq4_prefix(s, c0, c1, c2, c3) {
    return and(streq3_prefix(s, c0, c1, c2), eq(ri8(add(s, 3)), c3));
}

function builtin_arity(name) {
    if (or(or(or(streq3(name, 110, 101, 103), streq3(name, 110, 111, 116)), or(streq4(name, 114, 105, 51, 50), streq3(name, 114, 105, 56))), or(or(streq3(name, 98, 114, 107), streq5(name, 99, 108, 111, 115, 101)), streq3(name, 109, 107, 115)))) {
        return 1;
    }
    if (or(or(or(or(streq3(name, 97, 100, 100), streq3(name, 115, 117, 98)), or(streq3(name, 109, 117, 108), streq3(name, 100, 105, 118))), or(or(streq2(name, 101, 113), streq2(name, 110, 101)), or(streq2(name, 108, 116), streq2(name, 108, 101)))), or(or(or(streq2(name, 103, 116), streq2(name, 103, 101)), or(streq3(name, 97, 110, 100), streq2(name, 111, 114))), or(or(streq3(name, 120, 111, 114), streq4(name, 119, 105, 51, 50)), streq3(name, 119, 105, 56))))) {
        return 2;
    }
    if (or(or(streq4(name, 111, 112, 101, 110), streq4(name, 114, 101, 97, 100)), streq5(name, 119, 114, 105, 116, 101))) {
        return 3;
    }
    return 0;
}

function emit_builtin1(name) {
    if (streq3(name, 110, 101, 103)) {
        emit_neg_eax();
    } else if (streq3(name, 110, 111, 116)) {
        emit_not_eax();
    } else if (streq4(name, 114, 105, 51, 50)) {
        emit_read_i32();
    } else if (streq3(name, 114, 105, 56)) {
        emit_read_u8();
    } else if (streq3(name, 98, 114, 107)) {
        emit_brk_alloc();
    } else if (streq5(name, 99, 108, 111, 115, 101)) {
        emit_sys_close();
    } else {
        fail_code(6, name);
    }
    return 0;
}

function emit_builtin2(name) {
    if (streq3(name, 97, 100, 100)) {
        emit_add_eax_ebx();
    } else if (streq3(name, 115, 117, 98)) {
        emit_sub_from_stack_top();
    } else if (streq3(name, 109, 117, 108)) {
        emit_imul_eax_ebx();
    } else if (streq3(name, 100, 105, 118)) {
        emit_div_stack_top_by_eax();
    } else if (streq2(name, 101, 113)) {
        emit_cmp_set(148);
    } else if (streq2(name, 110, 101)) {
        emit_cmp_set(149);
    } else if (streq2(name, 108, 116)) {
        emit_cmp_set(156);
    } else if (streq2(name, 108, 101)) {
        emit_cmp_set(158);
    } else if (streq2(name, 103, 116)) {
        emit_cmp_set(159);
    } else if (streq2(name, 103, 101)) {
        emit_cmp_set(157);
    } else if (streq3(name, 97, 110, 100)) {
        emit_and_eax_ebx();
    } else if (streq2(name, 111, 114)) {
        emit_or_eax_ebx();
    } else if (streq3(name, 120, 111, 114)) {
        emit_xor_eax_ebx();
    } else if (streq4(name, 119, 105, 51, 50)) {
        emit_write_i32();
    } else if (streq3(name, 119, 105, 56)) {
        emit_write_u8();
    } else {
        fail_code(7, name);
    }
    return 0;
}

function emit_builtin3(name) {
    if (streq4(name, 111, 112, 101, 110)) {
        emit_sys_open();
    } else if (streq4(name, 114, 101, 97, 100)) {
        emit_sys_read();
    } else if (streq5(name, 119, 114, 105, 116, 101)) {
        emit_sys_write();
    } else {
        fail_code(8, name);
    }
    return 0;
}

function parse_builtin_call(name, argc) {
    expect(TOK_LPAREN);
    if (streq3(name, 109, 107, 115)) {
        if (not(eq(tok, TOK_STR))) {
            fail_code(9, 0);
        }
        emit_mks_literal(tok_text);
        next_tok();
        expect(TOK_RPAREN);
        return 0;
    } else if (eq(argc, 1)) {
        parse_expr();
    } else if (eq(argc, 2)) {
        parse_expr();
        emit_push_eax();
        expect(TOK_COMMA);
        parse_expr();
        emit_pop_ebx();
    } else if (eq(argc, 3)) {
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
        fail_code(10, 0);
    }
    expect(TOK_RPAREN);
    if (eq(argc, 1)) {
        emit_builtin1(name);
    } else if (eq(argc, 2)) {
        emit_builtin2(name);
    } else {
        emit_builtin3(name);
    }
    return 0;
}

function parse_user_call_args_(argc) {
    argc = 0;
    expect(TOK_LPAREN);
    if (eq(tok, TOK_RPAREN)) {
        next_tok();
        return 0;
    }
    while (1) {
        parse_expr();
        emit_push_eax();
        argc = add(argc, 1);
        if (not(eq(tok, TOK_COMMA))) {
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
    wi32(add(call_target_p, mul(call_count, 4)), xstrdup(name));
    wi32(add(call_pos_p, mul(call_count, 4)), code_len);
    emit4(0);
    if (gt(argc, 0)) {
        emit_add_esp_imm32(mul(4, argc));
    }
    wi32(add(call_argc_p, mul(call_count, 4)), argc);
    call_count = add(call_count, 1);
    return 0;
}

function patch_calls_(i, fi, name, pos, argc, addr, arity, rel) {
    while (lt(i, call_count)) {
        name = ri32(add(call_target_p, mul(i, 4)));
        pos = ri32(add(call_pos_p, mul(i, 4)));
        argc = ri32(add(call_argc_p, mul(i, 4)));
        fi = find_symbol(functions_p, function_count, name);
        if (lt(fi, 0)) {
            if (output_object) {
                patch4(pos, neg(4));
                record_external(name, 18);
                record_reloc(pos, name, 2);
            } else {
                fail_code(11, name);
            }
        } else {
            addr = sym_val(add(functions_p, mul(fi, 8)));
            arity = sym_val(add(function_arities_p, mul(fi, 8)));
            if (not(eq(arity, argc))) {
                fail_code(12, name);
            }
            rel = sub(addr, add(pos, 4));
            patch4(pos, rel);
        }
        i = add(i, 1);
    }
    return 0;
}

function patch_calls() {
    return patch_calls_(0, 0, 0, 0, 0, 0, 0, 0);
}

function record_external_(name, type, i, entry) {
    if (ge(find_symbol(functions_p, function_count, name), 0)) {
        return 0;
    }
    while (lt(i, external_count)) {
        entry = add(externals_p, mul(i, 8));
        if (eq(strcmp(sym_name(entry), name), 0)) {
            return 0;
        }
        i = add(i, 1);
    }
    if (ge(external_count, 4096)) {
        fail_code(16, 0);
    }
    entry = add(externals_p, mul(external_count, 8));
    sym_set_name(entry, xstrdup(name));
    sym_set_val(entry, external_count);
    wi32(add(external_types_p, mul(external_count, 4)), type);
    external_count = add(external_count, 1);
    return 0;
}

function record_external(name, type) {
    return record_external_(name, type, 0, 0);
}

function record_reloc(offset, name, type) {
    if (ge(reloc_count, 8192)) {
        fail_code(17, 0);
    }
    wi32(add(reloc_offsets_p, mul(reloc_count, 4)), offset);
    wi32(add(reloc_names_p, mul(reloc_count, 4)), xstrdup(name));
    wi32(add(reloc_types_p, mul(reloc_count, 4)), type);
    reloc_count = add(reloc_count, 1);
    return 0;
}

function parse_program() {
    while (not(eq(tok, TOK_EOF))) {
        if (eq(tok, TOK_VAR)) {
            parse_global();
        } else {
            parse_function();
        }
    }
    if (and(not(output_object), not(has_main_function()))) {
        fail_code(4, 0);
    }
    return 0;
}

function has_main_function() {
    return ge(find_symbol(functions_p, function_count, mks("main")), 0);
}

function parse_global_(name, entry) {
    expect(TOK_VAR);
    if (not(eq(tok, TOK_IDENT))) {
        fail_code(18, 0);
    }
    name = xstrdup(tok_text);
    next_tok();
    if (eq(tok, TOK_ASSIGN)) {
        fail_code(19, name);
    }
    expect(TOK_SEMI);
    if (gt(function_count, 0)) {
        fail_code(20, name);
    }
    if (or(ge(find_symbol(globals_p, global_count, name), 0), ge(find_symbol(functions_p, function_count, name), 0))) {
        fail_code(21, name);
    }
    entry = add(globals_p, mul(global_count, 8));
    sym_set_name(entry, name);
    if (output_object) {
        sym_set_val(entry, 0);
        global_count = add(global_count, 1);
        return 0;
    }
    sym_set_val(entry, global_bytes);
    global_count = add(global_count, 1);
    global_bytes = add(global_bytes, 4);
    if (lt(next_data_offset, global_bytes)) {
        next_data_offset = global_bytes;
    }
    if (lt(data_used, global_bytes)) {
        data_used = global_bytes;
    }
    return 0;
}

function parse_global() {
    return parse_global_(0, 0);
}

function param_name(param_names, i) {
    return ri32(add(param_names, mul(i, 4)));
}

function param_set_name(param_names, i, name) {
    wi32(add(param_names, mul(i, 4)), name);
    return name;
}

function parse_function_params_(param_names, param_count, i) {
    param_count = 0;
    if (not(eq(tok, TOK_RPAREN))) {
        while (1) {
            if (not(eq(tok, TOK_IDENT))) {
                fail_code(26, 0);
            }
            i = 0;
            while (lt(i, param_count)) {
                if (eq(strcmp(param_name(param_names, i), tok_text), 0)) {
                    fail_code(27, tok_text);
                }
                i = add(i, 1);
            }
            param_set_name(param_names, param_count, xstrdup(tok_text));
            param_count = add(param_count, 1);
            next_tok();
            if (not(eq(tok, TOK_COMMA))) {
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
    while (lt(i, param_count)) {
        wi32(add(current_params_p, mul(i, 4)), xstrdup(param_name(param_names, i)));
        wi32(add(current_param_offsets_p, mul(i, 4)), add(8, mul(4, i)));
        i = add(i, 1);
    }
    return 0;
}

function enter_function(name, param_count, param_names) {
    return enter_function_(name, param_count, param_names, 0);
}

function leave_function_(i) {
    i = 0;
    while (lt(i, current_param_count)) {
        free(ri32(add(current_params_p, mul(i, 4))));
        wi32(add(current_params_p, mul(i, 4)), 0);
        wi32(add(current_param_offsets_p, mul(i, 4)), 0);
        i = add(i, 1);
    }
    current_param_count = 0;
    current_returned = 0;
    return 0;
}

function leave_function() {
    return leave_function_(0);
}

function parse_function_free_params_(param_names, param_count, i) {
    while (lt(i, param_count)) {
        free(param_name(param_names, i));
        i = add(i, 1);
    }
    return 0;
}

function parse_function_(name, param_count, param_names, entry) {
    param_names = xmalloc(4096);
    expect(TOK_FUNCTION);
    if (not(eq(tok, TOK_IDENT))) {
        fail_code(25, 0);
    }
    name = xstrdup(tok_text);
    next_tok();
    expect(TOK_LPAREN);
    param_count = parse_function_params_(param_names, 0, 0);
    expect(TOK_RPAREN);

    if (ge(find_symbol(functions_p, function_count, name), 0)) {
        fail_code(28, name);
    }
    entry = add(functions_p, mul(function_count, 8));
    sym_set_name(entry, name);
    sym_set_val(entry, code_len);
    entry = add(function_arities_p, mul(function_count, 8));
    sym_set_name(entry, xstrdup(name));
    sym_set_val(entry, param_count);
    function_count = add(function_count, 1);

    emit_prologue();
    enter_function(name, param_count, param_names);
    expect(TOK_LBRACE);
    while (and(not(eq(tok, TOK_RBRACE)), not(eq(tok, TOK_EOF)))) {
        parse_stmt();
    }
    expect(TOK_RBRACE);
    if (not(current_returned)) {
        emit_mov_eax_imm32(0);
        emit_epilogue();
    }
    leave_function();
    parse_function_free_params_(param_names, param_count, 0);
    return 0;
}

function parse_function() {
    return parse_function_(0, 0, 0, 0);
}

function parse_stmt() {
    if (eq(tok, TOK_LBRACE)) {
        parse_block();
        return 0;
    }
    if (eq(tok, TOK_RETURN)) {
        next_tok();
        parse_expr();
        expect(TOK_SEMI);
        emit_epilogue();
        current_returned = 1;
        return 0;
    }
    if (eq(tok, TOK_IF)) {
        parse_if();
        return 0;
    }
    if (eq(tok, TOK_WHILE)) {
        parse_while();
        return 0;
    }
    if (eq(tok, TOK_BREAK)) {
        parse_break();
        return 0;
    }
    parse_expr();
    expect(TOK_SEMI);
    return 0;
}

function parse_block() {
    expect(TOK_LBRACE);
    while (and(not(eq(tok, TOK_RBRACE)), not(eq(tok, TOK_EOF)))) {
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
    if (eq(tok, TOK_ELSE)) {
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
    if (lt(loop_depth, 1)) {
        fail_code(5, 0);
    }
    expect(TOK_BREAK);
    expect(TOK_SEMI);
    record_break(ri32(add(loop_stack_p, mul(sub(loop_depth, 1), 4))), emit_jmp_placeholder());
    return 0;
}

function parse_expr() {
    if (eq(tok, TOK_IDENT)) {
        parse_assign_or_primary();
        return 0;
    }
    parse_primary();
    return 0;
}

function parse_assign_store_param_(name, i) {
    while (lt(i, current_param_count)) {
        if (eq(strcmp(ri32(add(current_params_p, mul(i, 4))), name), 0)) {
            emit_store_param(ri32(add(current_param_offsets_p, mul(i, 4))));
            free(name);
            return 1;
        }
        i = add(i, 1);
    }
    return 0;
}

function parse_assign_load_param_(name, i) {
    while (lt(i, current_param_count)) {
        if (eq(strcmp(ri32(add(current_params_p, mul(i, 4))), name), 0)) {
            emit_load_param(ri32(add(current_param_offsets_p, mul(i, 4))));
            free(name);
            return 1;
        }
        i = add(i, 1);
    }
    return 0;
}

function parse_assign_or_primary_(name, arity) {
    name = xstrdup(tok_text);
    next_tok();
    if (eq(tok, TOK_ASSIGN)) {
        next_tok();
        parse_expr();
        if (parse_assign_store_param_(name, 0)) {
            return 0;
        }
        if (ge(find_symbol(globals_p, global_count, name), 0)) {
            emit_store_global(name);
            free(name);
            return 0;
        }
        fail_code(13, name);
    }
    if (eq(tok, TOK_LPAREN)) {
        arity = builtin_arity(name);
        if (gt(arity, 0)) {
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
    if (ge(find_symbol(globals_p, global_count, name), 0)) {
        emit_load_global(name);
        free(name);
        return 0;
    }
    fail_code(14, name);
    return 0;
}

function parse_assign_or_primary() {
    return parse_assign_or_primary_(0, 0);
}

function parse_primary() {
    if (eq(tok, TOK_NUM)) {
        emit_mov_eax_imm32(tok_num);
        next_tok();
        return 0;
    }
    if (eq(tok, TOK_LPAREN)) {
        next_tok();
        parse_expr();
        expect(TOK_RPAREN);
        return 0;
    }
    fail_code(15, 0);
    return 0;
}

function align4(n) {
    return mul(div(add(n, 3), 4), 4);
}

function boutstr(s) {
    while (ri8(s)) {
        bout1(ri8(s));
        s = add(s, 1);
    }
    return 0;
}

function pad_to(n) {
    while (lt(bin_len, n)) {
        bout1(0);
    }
    return 0;
}

function bout1(b) {
    if (ge(bin_len, 524288)) {
        exit(1);
    }
    wi8(add(binbuf_p, bin_len), b);
    bin_len = add(bin_len, 1);
    return 0;
}

function bout2(v) {
    bout1(v);
    bout1(div(v, 256));
    return 0;
}

function bout4(v) {
    bout1(v);
    bout1(div(v, 256));
    bout1(div(v, 65536));
    bout1(div(v, 16777216));
    return 0;
}

function bin_reset_(i) {
    while (lt(i, 524288)) {
        wi8(add(binbuf_p, i), 0);
        i = add(i, 1);
    }
    bin_len = 0;
    return 0;
}

function bin_reset() {
    return bin_reset_(0);
}

function emit_binary() {
    if (ne(write(1, binbuf_p, bin_len), bin_len)) {
        exit(1);
    }
    return 0;
}

function build_object_init_symbols_(sym_name_off, sym_index, i, pos, entry, name) {
    i = 0;
    pos = 1;
    while (lt(i, function_count)) {
        entry = add(functions_p, mul(i, 8));
        name = sym_name(entry);
        wi32(add(sym_index, mul(i, 4)), add(i, 2));
        wi32(add(sym_name_off, mul(i, 4)), pos);
        pos = add(add(pos, strlen(name)), 1);
        i = add(i, 1);
    }
    i = 0;
    while (lt(i, global_count)) {
        entry = add(globals_p, mul(i, 8));
        name = sym_name(entry);
        wi32(add(sym_index, mul(add(function_count, i), 4)), add(add(function_count, i), 2));
        wi32(add(sym_name_off, mul(add(function_count, i), 4)), pos);
        pos = add(add(pos, strlen(name)), 1);
        i = add(i, 1);
    }
    i = 0;
    while (lt(i, external_count)) {
        entry = add(externals_p, mul(i, 8));
        name = sym_name(entry);
        wi32(add(sym_index, mul(add(add(function_count, global_count), i), 4)), add(add(add(function_count, global_count), i), 2));
        wi32(add(sym_name_off, mul(add(add(function_count, global_count), i), 4)), pos);
        pos = add(add(pos, strlen(name)), 1);
        i = add(i, 1);
    }
    return pos;
}

function build_object_emit_code_(i) {
    while (lt(i, code_len)) {
        bout1(ri8(add(code_p, i)));
        i = add(i, 1);
    }
    return 0;
}

function build_object_emit_data_(i) {
    while (lt(i, data_used)) {
        bout1(ri8(add(data_byte_p, i)));
        i = add(i, 1);
    }
    return 0;
}

function build_binary_(base, ehsize, phsize, headers, entry, filesz, memsz, flags, main_index, rel) {
    base = 134512640;
    ehsize = 52;
    phsize = 32;
    headers = add(ehsize, phsize);
    entry = add(base, headers);
    filesz = add(4096, data_used);
    memsz = 8192;
    flags = 7;

    if (gt(add(headers, code_len), 4096)) {
        fail_code(23, 0);
    }
    if (gt(data_used, 4096)) {
        fail_code(24, 0);
    }

    main_index = find_symbol(functions_p, function_count, mks("main"));
    if (lt(main_index, 0)) {
        fail_code(4, 0);
    }
    rel = sub(sym_val(add(functions_p, mul(main_index, 8))), add(start_call_patch, 4));
    patch4(start_call_patch, rel);

    bin_reset();
    bout1(127); bout1(69); bout1(76); bout1(70);
    bout1(1); bout1(1); bout1(1); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout2(2); bout2(3); bout4(1); bout4(entry); bout4(ehsize); bout4(0); bout4(0);
    bout2(ehsize); bout2(phsize); bout2(1); bout2(0); bout2(0); bout2(0);
    bout4(1); bout4(0); bout4(base); bout4(base); bout4(filesz); bout4(memsz); bout4(flags); bout4(4096);

    build_object_emit_code_(0);
    pad_to(4096);
    build_object_emit_data_(0);
    return 0;
}

function build_binary() {
    return build_binary_(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

function code_reset() {
    code_reset_data_(0);
    code_len = 0;
    call_count = 0;
    global_count = 0;
    function_count = 0;
    external_count = 0;
    reloc_count = 0;
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
    while (lt(i, 4096)) {
        wi8(add(data_byte_p, i), 0);
        i = add(i, 1);
    }
    return 0;
}

function build_object_emit_relocs_(sym_index, ri, si, name, off, typ, sympos) {
    while (lt(ri, reloc_count)) {
        name = ri32(add(reloc_names_p, mul(ri, 4)));
        off = ri32(add(reloc_offsets_p, mul(ri, 4)));
        typ = ri32(add(reloc_types_p, mul(ri, 4)));
        if (streq5(name, 46, 100, 97, 116, 97)) {
            bout4(off);
            bout4(add(256, typ));
        } else {
            si = find_symbol(functions_p, function_count, name);
            if (ge(si, 0)) {
                bout4(off);
                bout4(add(mul(ri32(add(sym_index, mul(si, 4))), 256), typ));
            } else {
                si = find_symbol(globals_p, global_count, name);
                if (ge(si, 0)) {
                    bout4(off);
                    bout4(add(mul(ri32(add(sym_index, mul(add(function_count, si), 4))), 256), typ));
                } else {
                    si = find_symbol(externals_p, external_count, name);
                    if (lt(si, 0)) {
                        fail_code(22, name);
                    }
                    sympos = add(add(function_count, global_count), si);
                    bout4(off);
                    bout4(add(mul(ri32(add(sym_index, mul(sympos, 4))), 256), typ));
                }
            }
        }
        ri = add(ri, 1);
    }
    return 0;
}

function build_object_emit_functions_(sym_name_off, i, start, next_start, size, entry) {
    while (lt(i, function_count)) {
        entry = add(functions_p, mul(i, 8));
        start = sym_val(entry);
        if (lt(add(i, 1), function_count)) {
            next_start = sym_val(add(functions_p, mul(add(i, 1), 8)));
        } else {
            next_start = code_len;
        }
        size = sub(next_start, start);
        bout4(ri32(add(sym_name_off, mul(i, 4))));
        bout4(start);
        bout4(size);
        bout1(18);
        bout1(0);
        bout2(1);
        i = add(i, 1);
    }
    return 0;
}

function build_object_emit_globals_(sym_name_off, i, entry) {
    while (lt(i, global_count)) {
        entry = add(globals_p, mul(i, 8));
        bout4(ri32(add(sym_name_off, mul(add(function_count, i), 4))));
        bout4(4);
        bout4(4);
        bout1(17);
        bout1(0);
        bout2(65522);
        i = add(i, 1);
    }
    return 0;
}

function build_object_emit_externals_(sym_name_off, i, sympos) {
    while (lt(i, external_count)) {
        sympos = add(add(function_count, global_count), i);
        bout4(ri32(add(sym_name_off, mul(sympos, 4))));
        bout4(0);
        bout4(0);
        bout1(ri32(add(external_types_p, mul(i, 4))));
        bout1(0);
        bout2(0);
        i = add(i, 1);
    }
    return 0;
}

function build_object_emit_strtab_(i, entry) {
    bout1(0);
    i = 0;
    while (lt(i, function_count)) {
        entry = add(functions_p, mul(i, 8));
        boutstr(sym_name(entry));
        bout1(0);
        i = add(i, 1);
    }
    i = 0;
    while (lt(i, global_count)) {
        entry = add(globals_p, mul(i, 8));
        boutstr(sym_name(entry));
        bout1(0);
        i = add(i, 1);
    }
    i = 0;
    while (lt(i, external_count)) {
        entry = add(externals_p, mul(i, 8));
        boutstr(sym_name(entry));
        bout1(0);
        i = add(i, 1);
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
    while (lt(i, count)) {
        bout1(0);
        i = add(i, 1);
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
    sym_count = add(add(add(function_count, global_count), external_count), 2);
    symtab_size = mul(sym_count, 16);
    rel_size = mul(reloc_count, 8);

    text_off = ehsize;
    data_off = align4(add(text_off, code_len));
    rel_off = align4(add(data_off, data_used));
    symtab_off = add(rel_off, rel_size);
    strtab_off = add(symtab_off, symtab_size);
    shstrtab_off = add(strtab_off, strtab_size);
    shoff = align4(add(shstrtab_off, shstrtab_size));

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
    bout4(23); bout4(8); bout4(3); bout4(0); bout4(add(data_off, data_used)); bout4(0); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(28); bout4(2); bout4(0); bout4(0); bout4(symtab_off); bout4(symtab_size); bout4(6); bout4(2); bout4(4); bout4(16);
    bout4(36); bout4(3); bout4(0); bout4(0); bout4(strtab_off); bout4(strtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(44); bout4(3); bout4(0); bout4(0); bout4(shstrtab_off); bout4(shstrtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
    return 0;
}

function build_object() {
    return build_object_(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

function read_source_(path, fp, len, buf, got) {
    fp = fopen(path, mks("rb"));
    if (eq(fp, 0)) {
        exit(1);
    }
    if (ne(fseek(fp, 0, 2), 0)) {
        exit(1);
    }
    len = ftell(fp);
    if (lt(len, 0)) {
        exit(1);
    }
    if (ne(fseek(fp, 0, 0), 0)) {
        exit(1);
    }
    buf = xmalloc(add(len, 2));
    got = fread(buf, 1, len, fp);
    if (ne(got, len)) {
        exit(1);
    }
    fclose(fp);
    wi8(add(buf, len), 10);
    wi8(add(add(buf, len), 1), 0);
    src_len = add(len, 1);
    return buf;
}

function read_source(path) {
    return read_source_(path, 0, 0, 0, 0);
}

function compile(source_path) {
    init_globals();
    src = read_source(source_path);
    init_lexer();
    code_reset();
    next_tok();
    if (not(output_object)) {
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
    emit_binary();
    return 0;
}

function main_(argc, argv, arg1) {
    if (eq(argc, 2)) {
        output_object = 0;
        return compile(ri32(add(argv, 4)));
    }
    if (eq(argc, 3)) {
        arg1 = ri32(add(argv, 4));
        if (eq(strcmp(arg1, mks("-c")), 0)) {
            output_object = 1;
            return compile(ri32(add(argv, 8)));
        }
    }
    return usage(ri32(argv));
}

function main(argc, argv) {
    init_globals();
    return main_(argc, argv, 0);
}
