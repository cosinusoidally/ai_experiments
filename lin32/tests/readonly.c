#include "linux.h"

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    *(volatile unsigned char *)(unsigned int)main = 0x90;
    return 99;
}
