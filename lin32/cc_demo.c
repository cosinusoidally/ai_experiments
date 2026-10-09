/* Independent program exercising the supported subset and emitted ELF. */
int hits;
int values[4];
char text[4];

int touch(int value) { hits = hits + 1; return value; }

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int combine(int a, int b, int c, int d) { return a + b * 10 + c * 100 + d * 1000; }

int main(int argc, int argv) {
    int i;
    int sum;
    i = 0;
    sum = 0;
    while (i < 4) {
        values[i] = i + 1;
        sum = sum + values[i];
        i = i + 1;
    }
    if (sum != 10 || factorial(5) != 120 || combine(1, 2, 3, 4) != 4321) return 99;
    if (0 && touch(1)) return 99;
    if (hits) return 99;
    if (!(1 || touch(0))) return 99;
    if (hits) return 99;
    if (-17 / 5 != -3 || -17 % 5 != -2) return 99;
    if ((-16 >> 2) != -4 || (3 << 4) != 48) return 99;
    if ((13 & 7) != 5 || (4 | 3) != 7 || (7 ^ 3) != 4 || ~0 != -1) return 99;
    text[0] = 'o'; text[1] = 'k'; text[2] = '\n'; text[3] = 0;
    if (load8((int)text) != 'o' || load32((int)values) != 1) return 99;
    if (syscall3(4, 1, (int)text, 3) != 3) return 99;
    if (syscall3(4, 1, (int)"cc_min generated program OK\n", 28) != 28) return 99;
    return 42;
}
