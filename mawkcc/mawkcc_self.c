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
