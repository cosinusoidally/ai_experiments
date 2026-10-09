#include "linux.h"
int main(int argc, char **argv) {
    unsigned int base = syscall3(45, 0, 0, 0);
    volatile unsigned char *p = (void *)base;
    (void)argc; (void)argv;
    if ((unsigned int)syscall3(45, base + 17, 0, 0) != base + 17) return 99;
    p[0] = 23; p[16] = 41;
    if ((unsigned int)syscall3(45, base + 200000, 0, 0) != base + 200000) return 99;
    p[199999] = 42;
    if (p[0] != 23 || p[16] != 41 || p[199999] != 42) return 99;
    if ((unsigned int)syscall3(45, 0, 0, 0) != base + 200000) return 99;
    return write_bytes(1, "Heap growth checks passed\n", 26) == 26 ? 0 : 99;
}
