function self_main(argc, argv, arg1) {
    if (eq(argc, 2)) {
        return ansi_compile(ri32(add(argv, 4)), 0);
    }
    if (eq(argc, 3)) {
        arg1 = ri32(add(argv, 4));
        if (ansi_is_dash_c(arg1)) {
            return ansi_compile(ri32(add(argv, 8)), 1);
        }
    }
    return ansi_usage(ri32(argv));
}
