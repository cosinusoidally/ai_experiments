int add(int a, int b) { return a + b; }
int ADD(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
int SUB(int a, int b) { return a - b; }
int mul(int a, int b) { return a * b; }
int MUL(int a, int b) { return a * b; }
int div(int a, int b) { return a / b; }
int DIV(int a, int b) { return a / b; }
int mod(int a, int b) { return a % b; }
int MOD(int a, int b) { return a % b; }
int eq(int a, int b) { return a == b; }
int EQ(int a, int b) { return a == b; }
int ne(int a, int b) { return a != b; }
int NE(int a, int b) { return a != b; }
int lt(int a, int b) { return a < b; }
int LT(int a, int b) { return a < b; }
int le(int a, int b) { return a <= b; }
int LE(int a, int b) { return a <= b; }
int gt(int a, int b) { return a > b; }
int GT(int a, int b) { return a > b; }
int ge(int a, int b) { return a >= b; }
int GE(int a, int b) { return a >= b; }
int and(int a, int b) { return a & b; }
int AND(int a, int b) { return a & b; }
int or(int a, int b) { return a | b; }
int OR(int a, int b) { return a | b; }
int xor(int a, int b) { return a ^ b; }
int XOR(int a, int b) { return a ^ b; }
int shl(int a, int b) { return a << b; }
int SHL(int a, int b) { return a << b; }
int shr(int a, int b) { return a >> b; }
int SHR(int a, int b) { return a >> b; }
int not(int a) { return !a; }
int NOT(int a) { return !a; }
int neg(int a) { return -a; }
int NEG(int a) { return -a; }

int ri32(int p) { return *(int *)p; }
int ri8(int p) { return *(unsigned char *)p; }
int wi32(int p, int v) { *(int *)p = v; return v; }
int wi8(int p, int v) { *(unsigned char *)p = (unsigned char)v; return v; }
int mks(int p) { return p; }
int mkC(int p) { return *(unsigned char *)p; }
int brk(int n) { return (int)malloc(n); }
