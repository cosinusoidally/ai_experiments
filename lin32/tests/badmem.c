#include "linux.h"

int main(int argc, char **argv) {
    volatile int value;
    (void)argc; (void)argv;
    value = *(volatile int *)0;
    (void)value;
    return 99;
}
