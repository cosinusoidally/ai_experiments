#include "linux.h"

static volatile unsigned int bss_word;

static int equal(const char *a, const char *b) {
    while (*a && *a == *b) { ++a; ++b; }
    return *a == *b;
}

int main(int argc, char **argv) {
    static const char message[] = "ABI checks passed\n";
    unsigned int flags;
    int result;
    if (argc != 3 || !equal(argv[1], "alpha") || !equal(argv[2], "two words")) return 99;
    if (argv[argc] || argv[argc + 1] || ((unsigned int)initial_stack & 15)) return 99;
    if (bss_word) return 99;
    bss_word = 123;
    if (syscall3(0x7fffffff, 0, 0, 0) != -38) return 99;
    if (syscall3(4, 9, 0, 1) != -9) return 99;
    if (syscall3(4, 1, 1, 1) != -14) return 99;
    if (syscall3(4, 1, 0xfffffffe, 8) != -14) return 99;
    if (syscall3(4, 1, 0xfffffffe, 0) != 0) return 99;
    __asm__ __volatile__("std" : : : "cc");
    result = write_bytes(2, message, sizeof(message) - 1);
    __asm__ __volatile__("pushfl; popl %0; cld" : "=r"(flags) : : "cc");
    if (!(flags & 0x400) || result != sizeof(message) - 1) return 99;
    return 0;
}
