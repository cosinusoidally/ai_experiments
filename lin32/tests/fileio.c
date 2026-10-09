#include "linux.h"

int main(int argc, char **argv) {
    char buffer[8];
    static const char path[] = "iotest.tmp";
    static const char sample[] = "sample";
    static const char message[] = "File I/O checks passed\n";
    int fd;
    (void)argc; (void)argv;
    if (syscall3(5, 1, 0, 0) != -14) return 99;
    if (syscall3(5, (unsigned int)"cc_missing_file.xyz", 0, 0) != -2) return 99;
    fd = syscall3(5, (unsigned int)path, 577, 384);
    if (fd < 0) return 99;
    if (syscall3(3, fd, (unsigned int)buffer, 1) != -9) return 99;
    if (write_bytes(fd, sample, 6) != 6 || syscall3(6, fd, 0, 0)) return 99;
    if (syscall3(6, fd, 0, 0) != -9) return 99;
    fd = syscall3(5, (unsigned int)path, 0, 0);
    if (fd < 0 || write_bytes(fd, sample, 1) != -9) return 99;
    if (syscall3(3, fd, 1, 1) != -14 || syscall3(3, fd, 1, 0)) return 99;
    if (syscall3(3, fd, (unsigned int)buffer, 2) != 2) return 99;
    if (syscall3(3, fd, (unsigned int)buffer + 2, 4) != 4) return 99;
    if (syscall3(3, fd, (unsigned int)buffer + 6, 1)) return 99;
    if (buffer[0] != 's' || buffer[1] != 'a' || buffer[2] != 'm' || buffer[3] != 'p'
        || buffer[4] != 'l' || buffer[5] != 'e') return 99;
    if (syscall3(6, fd, 0, 0)) return 99;
    return write_bytes(1, message, sizeof(message) - 1) == sizeof(message) - 1 ? 0 : 99;
}
