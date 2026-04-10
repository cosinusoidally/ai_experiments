BEGIN {
    RS = "\n"
    ORS = ""
    DATA_BASE = 134516736
}

{
    src = src $0 "\n"
}

END {
    init_lexer()
    code_reset()
    next_tok()
    emit_start()
    parse_program()
    expect("EOF")
    patch_calls()
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
        if (word == "return" || word == "function")
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

    if (index("(){};,", ch) > 0) {
        tok = ch
        tok_text = ch
        idx++
        return
    }

    fail("unexpected character `" ch "`")
}

function expect(want) {
    if (tok != want)
        fail("expected `" want "`, got `" tok "`")
    next_tok()
}

function parse_program() {
    while (tok != "EOF")
        parse_function()
    if (!function_seen["main"])
        fail("missing `main` function")
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
    if (tok == "return") {
        next_tok()
        parse_expr()
        expect(";")
        emit_epilogue()
        current_returned = 1
        return
    }
    parse_expr()
    expect(";")
}

function parse_expr() {
    parse_primary()
}

function parse_primary(    name, argc) {
    if (tok == "NUM") {
        emit_mov_eax_imm32(tok_num)
        next_tok()
        return
    }

    if (tok == "IDENT") {
        name = tok_text
        next_tok()
        if (tok == "(") {
            argc = builtin_arity(name)
            if (argc > 0)
                parse_builtin_call(name, argc)
            else {
                argc = parse_user_call_args()
                emit_user_call(name, argc)
            }
            return
        }
        if (!(name in current_param_offset))
            fail("unknown identifier `" name "`")
        emit_load_param(current_param_offset[name])
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
    if (argc == 1) {
        parse_expr()
    } else if (argc == 2) {
        parse_expr()
        emit_push_eax()
        expect(",")
        parse_expr()
        emit_pop_ebx()
    } else {
        fail("unsupported builtin arity")
    }
    expect(")")
    if (argc == 1)
        emit_builtin1(name)
    else
        emit_builtin2(name)
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
    if (name == "neg" || name == "not" || name == "ri32" || name == "ri8")
        return 1
    if (name == "add" || name == "sub" || name == "mul" || name == "div" || \
        name == "eq" || name == "ne" || name == "lt" || name == "le" || \
        name == "gt" || name == "ge" || name == "and" || name == "or" || \
        name == "xor" || name == "wi32" || name == "wi8")
        return 2
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

function emit_pop_ebx() {
    emit1(91)
}

function emit_load_param(offset) {
    emit1(139)
    emit1(69)
    emit1(offset)
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

function emit_start() {
    emit1(232)
    start_call_patch = code_len + 1
    emit4(0)
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

function emit_add_eax_imm32(v) {
    emit1(5)
    emit4(v)
}

function emit_add_ebx_imm32(v) {
    emit1(129)
    emit1(195)
    emit4(v)
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
    emit_add_eax_imm32(DATA_BASE)
    emit1(139)
    emit1(0)
}

function emit_read_u8() {
    emit_add_eax_imm32(DATA_BASE)
    emit1(15)
    emit1(182)
    emit1(0)
}

function emit_write_i32() {
    emit_add_ebx_imm32(DATA_BASE)
    emit1(137)
    emit1(3)
}

function emit_write_u8() {
    emit_add_ebx_imm32(DATA_BASE)
    emit1(136)
    emit1(3)
    emit1(15)
    emit1(182)
    emit1(192)
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

function build_binary(    i, base, ehsize, phsize, headers, entry, filesz, memsz, flags, rel) {
    base = 134512640
    ehsize = 52
    phsize = 32
    headers = ehsize + phsize
    entry = base + headers
    filesz = headers + code_len
    memsz = 8192
    flags = 7

    if (filesz > 4096)
        fail("program too large for fixed code page")

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
}

function emit_binary(    i) {
    for (i = 1; i <= bin_len; i++)
        printf "%c", bin[i]
}
