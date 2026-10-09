#include "linux.h"

int main(int argc, char **argv) {
    static const char message[] = "Hello from native Linux i386 on Windows!\n";
    (void)argc; (void)argv;
    return write_bytes(1, message, sizeof(message) - 1) == sizeof(message) - 1 ? 37 : 99;
}
