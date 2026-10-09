#include "linux.h"

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    __asm__ __volatile__("ud2");
    return 99;
}
