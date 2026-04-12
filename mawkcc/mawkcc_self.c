var output_object;
var src;
var tok_text;
var tok_text_cap;
var dash_c;

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
