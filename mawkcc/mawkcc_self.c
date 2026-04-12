var output_object;
var src;
var tok_text;
var tok_text_cap;
var dash_c;
var code_len;
var idx_pos;
var tok;
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

function init_globals() {
    tok_text = 0;
    tok_text_cap = 0;
    dash_c = dash_c_string();
    return 0;
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

function init_lexer() {
    idx_pos = 0;
    return 0;
}

function expect(want) {
    if (not(eq(tok, want))) {
        fail_expected_token(want);
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
        fail_loop_stack_overflow();
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
        fail_break_patch_overflow();
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
        fail_unknown_unary_builtin(name);
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
        fail_unknown_binary_builtin(name);
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
        fail_unknown_ternary_builtin(name);
    }
    return 0;
}

function parse_builtin_call(name, argc) {
    expect(11);
    if (streq3(name, 109, 107, 115)) {
        if (not(eq(tok, 3))) {
            fail_mks_expects_string();
        }
        emit_mks_literal(tok_text);
        next_tok();
        expect(12);
        return 0;
    } else if (eq(argc, 1)) {
        parse_expr();
    } else if (eq(argc, 2)) {
        parse_expr();
        emit_push_eax();
        expect(16);
        parse_expr();
        emit_pop_ebx();
    } else if (eq(argc, 3)) {
        parse_expr();
        emit_push_eax();
        expect(16);
        parse_expr();
        emit_push_eax();
        expect(16);
        parse_expr();
        emit_mov_edx_eax();
        emit_pop_ecx();
        emit_pop_ebx();
    } else {
        fail_unsupported_builtin_arity();
    }
    expect(12);
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
    expect(11);
    if (eq(tok, 12)) {
        next_tok();
        return 0;
    }
    while (1) {
        parse_expr();
        emit_push_eax();
        argc = add(argc, 1);
        if (not(eq(tok, 16))) {
            break;
        }
        next_tok();
    }
    expect(12);
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
                fail_undefined_function(name);
            }
        } else {
            addr = sym_val(add(functions_p, mul(fi, 8)));
            arity = sym_val(add(function_arities_p, mul(fi, 8)));
            if (not(eq(arity, argc))) {
                fail_wrong_arity(name);
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

function parse_program() {
    while (not(eq(tok, 0))) {
        if (eq(tok, 6)) {
            parse_global();
        } else {
            parse_function();
        }
    }
    if (and(not(output_object), not(has_main_function()))) {
        fail_missing_main();
    }
    return 0;
}

function parse_stmt() {
    if (eq(tok, 13)) {
        parse_block();
        return 0;
    }
    if (eq(tok, 4)) {
        next_tok();
        parse_expr();
        expect(15);
        emit_epilogue();
        current_returned = 1;
        return 0;
    }
    if (eq(tok, 7)) {
        parse_if();
        return 0;
    }
    if (eq(tok, 9)) {
        parse_while();
        return 0;
    }
    if (eq(tok, 10)) {
        parse_break();
        return 0;
    }
    parse_expr();
    expect(15);
    return 0;
}

function parse_block() {
    expect(13);
    while (and(not(eq(tok, 14)), not(eq(tok, 0)))) {
        parse_stmt();
    }
    expect(14);
    return 0;
}

function parse_if_(false_patch, end_patch, after_then) {
    expect(7);
    expect(11);
    parse_expr();
    expect(12);
    emit_test_eax_eax();
    false_patch = emit_je_placeholder();
    parse_stmt();
    if (eq(tok, 8)) {
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
    expect(9);
    expect(11);
    loop_start = code_len;
    parse_expr();
    expect(12);
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
        fail_break_outside_loop();
    }
    expect(10);
    expect(15);
    record_break(ri32(add(loop_stack_p, mul(sub(loop_depth, 1), 4))), emit_jmp_placeholder());
    return 0;
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
    expect(0);
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
        if (eq(strcmp(arg1, dash_c), 0)) {
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
