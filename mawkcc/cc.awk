BEGIN {
    RS = "\n"
    ORS = ""
    DATA_BASE = 134516736
    BRK_CUR_OFFSET = 0
    RUNTIME_BYTES = 4
    if (format == "")
        format = "exec"
    init_ord_map()
}

{
    src = src $0 "\n"
}

END {
    init_lexer()
    code_reset()
    next_tok()
    if (format != "obj")
        emit_start()
    parse_program()
    expect("EOF")
    patch_calls()
    if (format == "obj")
        build_object()
    else
        build_binary()
    emit_binary()
}

function fail(msg,    near) {
    near = substr(src, tok_pos, 40)
    gsub(/\n/, "\\n", near)
    print "cc.awk: " msg " near `" near "`\n" > "/dev/stderr"
    exit 1
}

function init_lexer() {
    src_len = length(src)
    idx = 1
}

function init_ord_map(    i) {
    for (i = 0; i < 256; i++)
        ord_map[sprintf("%c", i)] = i
}

function is_space(ch) {
    return ch == " " || ch == "\t" || ch == "\n" || ch == "\r" || ch == "\f" || ch == "\v"
}

function is_digit(ch) {
    return ch >= "0" && ch <= "9"
}

function is_alpha(ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch == "_"
}

function is_alnum(ch) {
    return is_alpha(ch) || is_digit(ch)
}

function skip_ws_and_comments(    ch, ch2) {
    while (idx <= src_len) {
        ch = substr(src, idx, 1)
        if (is_space(ch)) {
            idx++
            continue
        }
        ch2 = substr(src, idx, 2)
        if (ch2 == "/*") {
            idx += 2
            while (idx <= src_len && substr(src, idx, 2) != "*/")
                idx++
            if (idx > src_len)
                fail("unterminated comment")
            idx += 2
            continue
        }
        if (ch2 == "//") {
            idx += 2
            while (idx <= src_len && substr(src, idx, 1) != "\n")
                idx++
            continue
        }
        break
    }
}

function next_tok(    ch, start, word, num) {
    skip_ws_and_comments()
    tok_pos = idx
    if (idx > src_len) {
        tok = "EOF"
        tok_text = ""
        return
    }

    ch = substr(src, idx, 1)

    if (is_alpha(ch)) {
        start = idx
        idx++
        while (idx <= src_len && is_alnum(substr(src, idx, 1)))
            idx++
        word = substr(src, start, idx - start)
        tok_text = word
        if (word == "return" || word == "function" || word == "var" || \
            word == "if" || word == "else" || word == "while" || word == "break")
            tok = word
        else
            tok = "IDENT"
        return
    }

    if (is_digit(ch)) {
        start = idx
        idx++
        while (idx <= src_len && is_digit(substr(src, idx, 1)))
            idx++
        num = substr(src, start, idx - start)
        tok = "NUM"
        tok_text = num
        tok_num = num + 0
        return
    }

    if (ch == "\"") {
        read_string_token()
        return
    }

    if (index("(){};,=", ch) > 0) {
        tok = ch
        tok_text = ch
        idx++
        return
    }

    fail("unexpected character `" ch "`")
}

function read_string_token(    out, ch, esc) {
    idx++
    out = ""
    while (idx <= src_len) {
        ch = substr(src, idx, 1)
        if (ch == "\"") {
            idx++
            tok = "STR"
            tok_text = out
            return
        }
        if (ch == "\\") {
            idx++
            if (idx > src_len)
                fail("unterminated string escape")
            esc = substr(src, idx, 1)
            if (esc == "n")
                out = out sprintf("%c", 10)
            else if (esc == "t")
                out = out sprintf("%c", 9)
            else if (esc == "r")
                out = out sprintf("%c", 13)
            else if (esc == "\"")
                out = out "\""
            else if (esc == "\\")
                out = out "\\"
            else if (esc == "0")
                out = out sprintf("%c", 0)
            else
                fail("unsupported string escape `\\" esc "`")
            idx++
            continue
        }
        out = out ch
        idx++
    }
    fail("unterminated string literal")
}

function expect(want) {
    if (tok != want)
        fail("expected `" want "`, got `" tok "`")
    next_tok()
}

function parse_program() {
    while (tok != "EOF") {
        if (tok == "var")
            parse_global()
        else
            parse_function()
    }
    if (format != "obj" && !function_seen["main"])
        fail("missing `main` function")
}

function parse_global(    name) {
    expect("var")
    if (tok != "IDENT")
        fail("expected global name")
    name = tok_text
    next_tok()
    if (tok == "=")
        fail("global `" name "` cannot be initialized at declaration time")
    expect(";")
    if (function_count > 0)
        fail("global `" name "` must be declared before functions")
    if (global_seen[name] || function_seen[name])
        fail("duplicate global `" name "`")
    global_seen[name] = 1
    global_offset[name] = global_bytes
    global_bytes += 4
    if (next_data_offset < global_bytes)
        next_data_offset = global_bytes
    if (data_used < global_bytes)
        data_used = global_bytes
}

function parse_function(    name, param_count) {
    expect("function")
    if (tok != "IDENT")
        fail("expected function name")
    name = tok_text
    next_tok()
    expect("(")
    param_count = parse_params()
    expect(")")
    if (function_seen[name])
        fail("duplicate function `" name "`")
    function_seen[name] = 1
    function_arity[name] = param_count
    function_addr[name] = code_len + 1
    function_count++
    function_name[function_count] = name
    emit_prologue()
    enter_function(name, param_count)
    expect("{")
    while (tok != "}" && tok != "EOF")
        parse_stmt()
    expect("}")
    if (!current_returned) {
        emit_mov_eax_imm32(0)
        emit_epilogue()
    }
    leave_function()
}

function parse_params(    count, name) {
    count = 0
    if (tok == ")")
        return count
    while (1) {
        if (tok != "IDENT")
            fail("expected parameter name")
        name = tok_text
        if (param_index[name] != "")
            fail("duplicate parameter `" name "`")
        param_name[++count] = name
        param_index[name] = count
        next_tok()
        if (tok != ",")
            break
        next_tok()
    }
    return count
}

function enter_function(name, param_count,    i, p) {
    current_function = name
    current_param_count = param_count
    current_returned = 0
    delete current_param_offset
    for (i = 1; i <= param_count; i++) {
        p = param_name[i]
        current_param_offset[p] = 8 + 4 * (param_count - i)
        delete param_index[p]
        delete param_name[i]
    }
}

function leave_function(    p) {
    for (p in current_param_offset)
        delete current_param_offset[p]
    current_function = ""
    current_param_count = 0
    current_returned = 0
}

function parse_stmt() {
    if (tok == "{") {
        parse_block()
        return
    }
    if (tok == "return") {
        next_tok()
        parse_expr()
        expect(";")
        emit_epilogue()
        current_returned = 1
        return
    }
    if (tok == "if") {
        parse_if()
        return
    }
    if (tok == "while") {
        parse_while()
        return
    }
    if (tok == "break") {
        parse_break()
        return
    }
    parse_expr()
    expect(";")
}

function parse_block() {
    expect("{")
    while (tok != "}" && tok != "EOF")
        parse_stmt()
    expect("}")
}

function parse_if(    false_patch, end_patch, after_then) {
    expect("if")
    expect("(")
    parse_expr()
    expect(")")
    emit_test_eax_eax()
    false_patch = emit_je_placeholder()
    parse_stmt()
    if (tok == "else") {
        end_patch = emit_jmp_placeholder()
        after_then = code_len + 1
        patch_rel32(false_patch, after_then)
        next_tok()
        parse_stmt()
        patch_rel32(end_patch, code_len + 1)
    } else {
        patch_rel32(false_patch, code_len + 1)
    }
}

function parse_while(    loop_start, exit_patch, loop_id) {
    expect("while")
    expect("(")
    loop_start = code_len + 1
    parse_expr()
    expect(")")
    emit_test_eax_eax()
    exit_patch = emit_je_placeholder()
    loop_id = push_loop(exit_patch)
    parse_stmt()
    emit_jmp(loop_start)
    patch_rel32(exit_patch, code_len + 1)
    patch_breaks(loop_id, code_len + 1)
    pop_loop()
}

function parse_break() {
    if (loop_depth < 1)
        fail("`break` used outside of a loop")
    expect("break")
    expect(";")
    record_break(loop_stack[loop_depth], emit_jmp_placeholder())
}

function parse_expr() {
    if (tok == "IDENT")
        return parse_assign_or_primary()
    parse_primary()
}

function parse_assign_or_primary(    name) {
    name = tok_text
    next_tok()
    if (tok == "=") {
        next_tok()
        parse_expr()
        if (name in current_param_offset)
            emit_store_param(current_param_offset[name])
        else if (name in global_seen)
            emit_store_global(name)
        else
            fail("assignment target `" name "` is not a global or parameter")
        return
    }
    if (tok == "(") {
        if (builtin_arity(name) > 0)
            parse_builtin_call(name, builtin_arity(name))
        else
            emit_user_call(name, parse_user_call_args())
        return
    }
    if (name in current_param_offset) {
        emit_load_param(current_param_offset[name])
        return
    }
    if (name in global_seen) {
        emit_load_global(name)
        return
    }
    fail("unknown identifier `" name "`")
}

function parse_primary(    name, argc) {
    if (tok == "NUM") {
        emit_mov_eax_imm32(tok_num)
        next_tok()
        return
    }

    if (tok == "(") {
        next_tok()
        parse_expr()
        expect(")")
        return
    }

    fail("expected expression")
}

function parse_builtin_call(name, argc) {
    expect("(")
    if (name == "mks") {
        if (tok != "STR")
            fail("`mks` expects a string literal")
        emit_mks_literal(tok_text)
        next_tok()
        expect(")")
        return
    } else if (argc == 1) {
        parse_expr()
    } else if (argc == 2) {
        parse_expr()
        emit_push_eax()
        expect(",")
        parse_expr()
        emit_pop_ebx()
    } else if (argc == 3) {
        parse_expr()
        emit_push_eax()
        expect(",")
        parse_expr()
        emit_push_eax()
        expect(",")
        parse_expr()
        emit_mov_edx_eax()
        emit_pop_ecx()
        emit_pop_ebx()
    } else {
        fail("unsupported builtin arity")
    }
    expect(")")
    if (argc == 1)
        emit_builtin1(name)
    else if (argc == 2)
        emit_builtin2(name)
    else
        emit_builtin3(name)
}

function parse_user_call_args(    argc) {
    argc = 0
    expect("(")
    if (tok == ")") {
        next_tok()
        return argc
    }
    while (1) {
        parse_expr()
        emit_push_eax()
        argc++
        if (tok != ",")
            break
        next_tok()
    }
    expect(")")
    return argc
}

function builtin_arity(name) {
    if (name == "neg" || name == "not" || name == "ri32" || name == "ri8" || \
        name == "brk" || name == "close" || name == "mks")
        return 1
    if (name == "add" || name == "sub" || name == "mul" || name == "div" || \
        name == "eq" || name == "ne" || name == "lt" || name == "le" || \
        name == "gt" || name == "ge" || name == "and" || name == "or" || \
        name == "xor" || name == "wi32" || name == "wi8")
        return 2
    if (name == "open" || name == "read" || name == "write")
        return 3
    return 0
}

function emit_user_call(name, argc,    call_site) {
    call_site = code_len + 1
    emit1(232)
    emit4(0)
    if (argc > 0)
        emit_add_esp_imm32(4 * argc)
    call_target[++call_count] = name
    call_pos[call_count] = call_site + 1
    call_argc[call_count] = argc
}

function emit_builtin1(name) {
    if (name == "neg")
        emit_neg_eax()
    else if (name == "not")
        emit_not_eax()
    else if (name == "ri32")
        emit_read_i32()
    else if (name == "ri8")
        emit_read_u8()
    else if (name == "brk")
        emit_brk_alloc()
    else if (name == "close")
        emit_sys_close()
    else
        fail("unknown unary builtin `" name "`")
}

function emit_builtin2(name) {
    if (name == "add")
        emit_add_eax_ebx()
    else if (name == "sub")
        emit_sub_from_stack_top()
    else if (name == "mul")
        emit_imul_eax_ebx()
    else if (name == "div")
        emit_div_stack_top_by_eax()
    else if (name == "eq")
        emit_cmp_set(148)
    else if (name == "ne")
        emit_cmp_set(149)
    else if (name == "lt")
        emit_cmp_set(156)
    else if (name == "le")
        emit_cmp_set(158)
    else if (name == "gt")
        emit_cmp_set(159)
    else if (name == "ge")
        emit_cmp_set(157)
    else if (name == "and")
        emit_and_eax_ebx()
    else if (name == "or")
        emit_or_eax_ebx()
    else if (name == "xor")
        emit_xor_eax_ebx()
    else if (name == "wi32")
        emit_write_i32()
    else if (name == "wi8")
        emit_write_u8()
    else
        fail("unknown binary builtin `" name "`")
}

function emit_builtin3(name) {
    if (name == "open")
        emit_sys_open()
    else if (name == "read")
        emit_sys_read()
    else if (name == "write")
        emit_sys_write()
    else
        fail("unknown ternary builtin `" name "`")
}

function patch_calls(    i, name, argc, addr, rel) {
    for (i = 1; i <= call_count; i++) {
        name = call_target[i]
        argc = call_argc[i]
        if (!function_seen[name])
            fail("call to undefined function `" name "`")
        if (function_arity[name] != argc)
            fail("function `" name "` called with wrong arity")
        addr = function_addr[name]
        rel = addr - (call_pos[i] + 4)
        patch4(call_pos[i], rel)
    }
}

function code_reset() {
    code_len = 0
    call_count = 0
    function_count = 0
    global_bytes = RUNTIME_BYTES
    next_data_offset = RUNTIME_BYTES
    data_used = RUNTIME_BYTES
    loop_depth = 0
    next_loop_id = 0
    current_function = ""
    current_param_count = 0
    current_returned = 0
}

function u32(v) {
    while (v < 0)
        v += 4294967296
    while (v >= 4294967296)
        v -= 4294967296
    return v
}

function emit1(b) {
    code[++code_len] = u32(b) % 256
}

function emit4(v,    n) {
    n = u32(v)
    emit1(n % 256)
    emit1(int(n / 256) % 256)
    emit1(int(n / 65536) % 256)
    emit1(int(n / 16777216) % 256)
}

function patch4(pos, v,    n) {
    n = u32(v)
    code[pos] = n % 256
    code[pos + 1] = int(n / 256) % 256
    code[pos + 2] = int(n / 65536) % 256
    code[pos + 3] = int(n / 16777216) % 256
}

function emit_mov_eax_imm32(v) {
    emit1(184)
    emit4(v)
}

function emit_push_eax() {
    emit1(80)
}

function emit_push_ebx() {
    emit1(83)
}

function emit_pop_ebx() {
    emit1(91)
}

function emit_pop_ecx() {
    emit1(89)
}

function emit_load_param(offset) {
    emit1(139)
    emit1(69)
    emit1(offset)
}

function emit_store_param(offset) {
    emit1(137)
    emit1(69)
    emit1(offset)
}

function emit_load_global(name) {
    emit1(161)
    emit4(DATA_BASE + global_offset[name])
}

function emit_store_global(name) {
    emit1(163)
    emit4(DATA_BASE + global_offset[name])
}

function emit_mks_literal(text,    addr) {
    addr = register_string(text)
    emit_mov_eax_imm32(addr)
}

function register_string(text,    start, i, ch) {
    start = next_data_offset
    for (i = 1; i <= length(text); i++) {
        ch = substr(text, i, 1)
        data_byte[start + i - 1] = ord_map[ch]
    }
    data_byte[start + length(text)] = 0
    next_data_offset = start + length(text) + 1
    if (data_used < next_data_offset)
        data_used = next_data_offset
    return DATA_BASE + start
}

function emit_prologue() {
    emit1(85)
    emit1(137)
    emit1(229)
}

function emit_epilogue() {
    emit1(137)
    emit1(236)
    emit1(93)
    emit1(195)
}

function emit_test_eax_eax() {
    emit1(133)
    emit1(192)
}

function emit_start() {
    emit_mov_eax_esp()
    emit_mov_ebx_ptr_esp()
    emit_add_eax_imm32(4)
    emit_push_ebx()
    emit_push_eax()
    emit1(232)
    start_call_patch = code_len + 1
    emit4(0)
    emit_add_esp_imm32(8)
    emit1(137)
    emit1(195)
    emit1(184)
    emit4(1)
    emit1(205)
    emit1(128)
}

function emit_add_esp_imm32(v) {
    emit1(129)
    emit1(196)
    emit4(v)
}

function emit_mov_eax_esp() {
    emit1(137)
    emit1(224)
}

function emit_mov_ebx_ptr_esp() {
    emit1(139)
    emit1(28)
    emit1(36)
}

function emit_je_placeholder(    pos) {
    emit1(15)
    emit1(132)
    pos = code_len + 1
    emit4(0)
    return pos
}

function emit_jne_placeholder(    pos) {
    emit1(15)
    emit1(133)
    pos = code_len + 1
    emit4(0)
    return pos
}

function emit_jmp_placeholder(    pos) {
    emit1(233)
    pos = code_len + 1
    emit4(0)
    return pos
}

function emit_jmp(target,    pos) {
    pos = emit_jmp_placeholder()
    patch_rel32(pos, target)
}

function patch_rel32(pos, target,    rel) {
    rel = target - (pos + 4)
    patch4(pos, rel)
}

function emit_add_eax_imm32(v) {
    emit1(5)
    emit4(v)
}

function emit_add_ebx_imm32(v) {
    emit1(129)
    emit1(195)
    emit4(v)
}

function emit_mov_ebx_eax() {
    emit1(137)
    emit1(195)
}

function emit_mov_edx_eax() {
    emit1(137)
    emit1(194)
}

function emit_mov_ebx_ecx() {
    emit1(137)
    emit1(203)
}

function emit_mov_eax_ecx() {
    emit1(137)
    emit1(200)
}

function emit_xor_ebx_ebx() {
    emit1(49)
    emit1(219)
}

function emit_xor_eax_eax() {
    emit1(49)
    emit1(192)
}

function emit_add_ebx_edx() {
    emit1(1)
    emit1(211)
}

function emit_cmp_eax_ebx() {
    emit1(57)
    emit1(216)
}

function emit_mov_eax_abs(addr) {
    emit1(161)
    emit4(addr)
}

function emit_mov_ecx_abs(addr) {
    emit1(139)
    emit1(13)
    emit4(addr)
}

function emit_mov_abs_eax(addr) {
    emit1(163)
    emit4(addr)
}

function emit_mov_abs_ebx(addr) {
    emit1(137)
    emit1(29)
    emit4(addr)
}

function emit_int_80() {
    emit1(205)
    emit1(128)
}

function emit_add_eax_ebx() {
    emit1(1)
    emit1(216)
}

function emit_and_eax_ebx() {
    emit1(33)
    emit1(216)
}

function emit_or_eax_ebx() {
    emit1(9)
    emit1(216)
}

function emit_xor_eax_ebx() {
    emit1(49)
    emit1(216)
}

function emit_sub_from_stack_top() {
    emit1(137)
    emit1(193)
    emit1(137)
    emit1(216)
    emit1(41)
    emit1(200)
}

function emit_imul_eax_ebx() {
    emit1(15)
    emit1(175)
    emit1(195)
}

function emit_div_stack_top_by_eax() {
    emit1(137)
    emit1(193)
    emit1(137)
    emit1(216)
    emit1(153)
    emit1(247)
    emit1(249)
}

function emit_cmp_set(opcode) {
    emit1(57)
    emit1(195)
    emit1(15)
    emit1(opcode)
    emit1(192)
    emit1(15)
    emit1(182)
    emit1(192)
}

function emit_neg_eax() {
    emit1(247)
    emit1(216)
}

function emit_not_eax() {
    emit1(133)
    emit1(192)
    emit1(15)
    emit1(148)
    emit1(192)
    emit1(15)
    emit1(182)
    emit1(192)
}

function emit_read_i32() {
    emit1(139)
    emit1(0)
}

function emit_read_u8() {
    emit1(15)
    emit1(182)
    emit1(0)
}

function emit_write_i32() {
    emit1(137)
    emit1(3)
}

function emit_write_u8() {
    emit1(136)
    emit1(3)
    emit1(15)
    emit1(182)
    emit1(192)
}

function emit_brk_alloc(    cur_addr, init_skip, fail_patch, done_patch) {
    cur_addr = DATA_BASE + BRK_CUR_OFFSET

    emit_mov_edx_eax()
    emit_mov_eax_abs(cur_addr)
    emit_test_eax_eax()
    init_skip = emit_jne_placeholder()

    emit_mov_eax_imm32(45)
    emit_xor_ebx_ebx()
    emit_int_80()
    emit_mov_abs_eax(cur_addr)

    patch_rel32(init_skip, code_len + 1)

    emit_mov_ecx_abs(cur_addr)
    emit_mov_ebx_ecx()
    emit_add_ebx_edx()
    emit_mov_eax_imm32(45)
    emit_int_80()
    emit_cmp_eax_ebx()
    fail_patch = emit_jne_placeholder()

    emit_mov_abs_ebx(cur_addr)
    emit_mov_eax_ecx()
    done_patch = emit_jmp_placeholder()

    patch_rel32(fail_patch, code_len + 1)
    emit_xor_eax_eax()
    patch_rel32(done_patch, code_len + 1)
}

function emit_sys_open() {
    emit_mov_eax_imm32(5)
    emit_int_80()
}

function emit_sys_read() {
    emit_mov_eax_imm32(3)
    emit_int_80()
}

function emit_sys_write() {
    emit_mov_eax_imm32(4)
    emit_int_80()
}

function emit_sys_close() {
    emit_mov_ebx_eax()
    emit_mov_eax_imm32(6)
    emit_int_80()
}

function bin_reset() {
    bin_len = 0
}

function bout1(b) {
    bin[++bin_len] = u32(b) % 256
}

function bout2(v) {
    bout1(v)
    bout1(int(v / 256))
}

function bout4(v,    n) {
    n = u32(v)
    bout1(n % 256)
    bout1(int(n / 256) % 256)
    bout1(int(n / 65536) % 256)
    bout1(int(n / 16777216) % 256)
}

function boutstr(s,    i) {
    for (i = 1; i <= length(s); i++)
        bout1(ord_map[substr(s, i, 1)])
}

function pad_to(n) {
    while (bin_len < n)
        bout1(0)
}

function align4(n) {
    return int((n + 3) / 4) * 4
}

function build_binary(    i, base, ehsize, phsize, headers, entry, filesz, memsz, flags, rel) {
    base = 134512640
    ehsize = 52
    phsize = 32
    headers = ehsize + phsize
    entry = base + headers
    filesz = 4096 + data_used
    memsz = 8192
    flags = 7

    if (headers + code_len > 4096)
        fail("program too large for fixed code page")
    if (data_used > 4096)
        fail("program data too large for fixed data page")

    rel = function_addr["main"] - (start_call_patch + 4)
    patch4(start_call_patch, rel)

    bin_reset()

    bout1(127); bout1(69); bout1(76); bout1(70)
    bout1(1); bout1(1); bout1(1); bout1(0)
    bout1(0); bout1(0); bout1(0); bout1(0)
    bout1(0); bout1(0); bout1(0); bout1(0)

    bout2(2)
    bout2(3)
    bout4(1)
    bout4(entry)
    bout4(ehsize)
    bout4(0)
    bout4(0)
    bout2(ehsize)
    bout2(phsize)
    bout2(1)
    bout2(0)
    bout2(0)
    bout2(0)

    bout4(1)
    bout4(0)
    bout4(base)
    bout4(base)
    bout4(filesz)
    bout4(memsz)
    bout4(flags)
    bout4(4096)

    for (i = 1; i <= code_len; i++)
        bout1(code[i])

    while (bin_len < 4096)
        bout1(0)

    for (i = 0; i < data_used; i++) {
        if ((i in data_byte))
            bout1(data_byte[i])
        else
            bout1(0)
    }
}

function build_object(    i, ehsize, shentsize, shnum, shstrndx, text_off, symtab_off, strtab_off, shstrtab_off, shoff, strtab_size, shstrtab_size, sym_count, symtab_size, name, start, next_start, size) {
    if (global_bytes != RUNTIME_BYTES || data_used != RUNTIME_BYTES)
        fail("object output does not support globals or string data yet")

    ehsize = 52
    shentsize = 40
    shnum = 5
    shstrndx = 4
    strtab_size = 1
    for (i = 1; i <= function_count; i++) {
        name = function_name[i]
        sym_name_off[i] = strtab_size
        strtab_size += length(name) + 1
    }
    shstrtab_size = 33
    sym_count = function_count + 1
    symtab_size = sym_count * 16

    text_off = ehsize
    symtab_off = align4(text_off + code_len)
    strtab_off = symtab_off + symtab_size
    shstrtab_off = strtab_off + strtab_size
    shoff = align4(shstrtab_off + shstrtab_size)

    bin_reset()

    bout1(127); bout1(69); bout1(76); bout1(70)
    bout1(1); bout1(1); bout1(1); bout1(0)
    bout1(0); bout1(0); bout1(0); bout1(0)
    bout1(0); bout1(0); bout1(0); bout1(0)

    bout2(1)
    bout2(3)
    bout4(1)
    bout4(0)
    bout4(0)
    bout4(shoff)
    bout4(0)
    bout2(ehsize)
    bout2(0)
    bout2(0)
    bout2(shentsize)
    bout2(shnum)
    bout2(shstrndx)

    for (i = 1; i <= code_len; i++)
        bout1(code[i])

    pad_to(symtab_off)

    for (i = 0; i < 16; i++)
        bout1(0)
    for (i = 1; i <= function_count; i++) {
        name = function_name[i]
        start = function_addr[name] - 1
        if (i < function_count)
            next_start = function_addr[function_name[i + 1]] - 1
        else
            next_start = code_len
        size = next_start - start
        bout4(sym_name_off[i])
        bout4(start)
        bout4(size)
        bout1(18)
        bout1(0)
        bout2(1)
    }

    bout1(0)
    for (i = 1; i <= function_count; i++) {
        boutstr(function_name[i])
        bout1(0)
    }

    bout1(0)
    boutstr(".text"); bout1(0)
    boutstr(".symtab"); bout1(0)
    boutstr(".strtab"); bout1(0)
    boutstr(".shstrtab"); bout1(0)

    pad_to(shoff)

    for (i = 0; i < 40; i++)
        bout1(0)

    bout4(1); bout4(1); bout4(6); bout4(0); bout4(text_off); bout4(code_len); bout4(0); bout4(0); bout4(1); bout4(0)
    bout4(7); bout4(2); bout4(0); bout4(0); bout4(symtab_off); bout4(symtab_size); bout4(3); bout4(1); bout4(4); bout4(16)
    bout4(15); bout4(3); bout4(0); bout4(0); bout4(strtab_off); bout4(strtab_size); bout4(0); bout4(0); bout4(1); bout4(0)
    bout4(23); bout4(3); bout4(0); bout4(0); bout4(shstrtab_off); bout4(shstrtab_size); bout4(0); bout4(0); bout4(1); bout4(0)
}

function emit_binary(    i) {
    for (i = 1; i <= bin_len; i++)
        printf "%c", bin[i]
}

function push_loop(exit_patch,    id) {
    id = ++next_loop_id
    loop_stack[++loop_depth] = id
    loop_exit_patch[id] = exit_patch
    break_count[id] = 0
    return id
}

function pop_loop() {
    delete loop_exit_patch[loop_stack[loop_depth]]
    loop_depth--
}

function record_break(loop_id, patch_pos) {
    break_patch[loop_id, ++break_count[loop_id]] = patch_pos
}

function patch_breaks(loop_id, target,    i) {
    for (i = 1; i <= break_count[loop_id]; i++)
        patch_rel32(break_patch[loop_id, i], target)
}
