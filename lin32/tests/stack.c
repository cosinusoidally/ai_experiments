#include "linux.h"

int main(int argc, char **argv) {
    char buffer[5];
    (void)argc; (void)argv;
    buffer[0] = 's'; buffer[1] = 't'; buffer[2] = 'a'; buffer[3] = 'c'; buffer[4] = 'k';
    return write_bytes(1, buffer, sizeof(buffer)) == sizeof(buffer) ? 0 : 99;
}
