var output_object;
var src;
var tok_text;
var tok_text_cap;

function compile(source_path) {
    tok_text = 0;
    tok_text_cap = 0;
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
        if (and(eq(ri8(arg1), 45), and(eq(ri8(add(arg1, 1)), 99), eq(ri8(add(arg1, 2)), 0)))) {
            output_object = 1;
            return compile(ri32(add(argv, 8)));
        }
    }
    return usage(ri32(argv));
}

function main(argc, argv) {
    return main_(argc, argv, 0);
}
