int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
int mul(int a, int b) { return a * b; }
int div(int a, int b) { return a / b; }
int eq(int a, int b) { return a == b; }
int ne(int a, int b) { return a != b; }
int lt(int a, int b) { return a < b; }
int le(int a, int b) { return a <= b; }
int gt(int a, int b) { return a > b; }
int ge(int a, int b) { return a >= b; }
int and(int a, int b) { return a && b; }
int or(int a, int b) { return a || b; }
int xor(int a, int b) { return a ^ b; }
int not(int a) { return !a; }
int neg(int a) { return -a; }

int ri32(int p) { return *(int *)p; }
int ri8(int p) { return *(unsigned char *)p; }
int wi32(int p, int v) { *(int *)p = v; return v; }
int wi8(int p, int v) { *(unsigned char *)p = (unsigned char)v; return v; }
