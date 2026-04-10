function main(argc, argv) {
    if (eq(argc, 3)) {
        return ri8(ri32(add(argv, 4)));
    }
    return 1;
}
