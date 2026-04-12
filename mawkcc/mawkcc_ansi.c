#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>

struct Symbol {
    char *name;
    long value;
};

char *src;
long src_len;
long idx_pos;
long tok_pos;
int tok;
char *tok_text;
long tok_text_cap;
unsigned long tok_num;

long code_len;
unsigned char *code_p;
long bin_len;
unsigned char *binbuf_p;
unsigned char *data_byte_p;
unsigned long data_used;
unsigned long next_data_offset;

struct Symbol *globals_p;
int global_count;
int function_count;
struct Symbol *functions_p;
struct Symbol *function_arities_p;
struct Symbol *externals_p;
int *external_types_p;
int external_count;

int current_param_count;
char **current_params_p;
long *current_param_offsets_p;
int current_returned;

int call_count;
char **call_target_p;
long *call_pos_p;
long *call_argc_p;

int reloc_count;
long *reloc_offsets_p;
char **reloc_names_p;
long *reloc_types_p;

int loop_depth;
int next_loop_id;
int break_patch_count;
int *loop_stack_p;
int *break_patch_loop_p;
long *break_patch_pos_p;

unsigned long global_bytes;
long start_call_patch;
int output_object;

static void failf(const char *fmt, ...)
{
    va_list ap;
    char msg[1024];
    char nearbuf[64];
    long i;
    long start;
    long n;

    va_start(ap, fmt);
    vsprintf(msg, fmt, ap);
    va_end(ap);

    start = tok_pos;
    if (start < 0) {
        start = 0;
    }
    n = src_len - start;
    if (n > 40) {
        n = 40;
    }
    for (i = 0; i < n; i++) {
        char ch = src[start + i];
        if (ch == '\n') {
            nearbuf[i] = '\\';
            if (i + 1 < (long)sizeof(nearbuf) - 1) {
                i++;
                nearbuf[i] = 'n';
            }
        } else {
            nearbuf[i] = ch;
        }
    }
    nearbuf[n] = '\0';
    fprintf(stderr, "mawkcc_orig.c: %s near `%s`\n", msg, nearbuf);
    exit(1);
}

void *xmalloc(size_t n)
{
    void *p;
    p = malloc(n);
    if (!p) {
        fprintf(stderr, "out of memory\n");
        exit(1);
    }
    return p;
}

void *xrealloc(void *p, size_t n)
{
    void *q;
    q = realloc(p, n);
    if (!q) {
        fprintf(stderr, "out of memory\n");
        exit(1);
    }
    return q;
}

static unsigned long u32(long v)
{
    return ((unsigned long)v) & 0xffffffffUL;
}

int u32_byte(long v, int shift)
{
    return (int)((u32(v) >> shift) & 255U);
}

void fail_code(int code, int arg)
{
    switch (code) {
        case 1: failf("expected token %d, got `%s`", arg, tok_text); break;
        case 2: failf("loop stack overflow"); break;
        case 3: failf("break patch overflow"); break;
        case 4: failf("missing `main` function"); break;
        case 5: failf("`break` used outside of a loop"); break;
        case 6: failf("unknown unary builtin `%s`", (char *)arg); break;
        case 7: failf("unknown binary builtin `%s`", (char *)arg); break;
        case 8: failf("unknown ternary builtin `%s`", (char *)arg); break;
        case 9: failf("`mks` expects a string literal"); break;
        case 10: failf("unsupported builtin arity"); break;
        case 11: failf("call to undefined function `%s`", (char *)arg); break;
        case 12: failf("function `%s` called with wrong arity", (char *)arg); break;
        case 13: failf("assignment target `%s` is not a global or parameter", (char *)arg); break;
        case 14: failf("unknown identifier `%s`", (char *)arg); break;
        case 15: failf("expected expression"); break;
        case 16: failf("external symbol overflow"); break;
        case 17: failf("relocation overflow"); break;
        case 18: failf("expected global name"); break;
        case 19: failf("global `%s` cannot be initialized at declaration time", (char *)arg); break;
        case 20: failf("global `%s` must be declared before functions", (char *)arg); break;
        case 21: failf("duplicate global `%s`", (char *)arg); break;
        case 22: failf("relocation references unknown symbol `%s`", (char *)arg); break;
        case 23: failf("program too large for fixed code page"); break;
        case 24: failf("program data too large for fixed data page"); break;
        case 25: failf("expected function name"); break;
        case 26: failf("expected parameter name"); break;
        case 27: failf("duplicate parameter `%s`", (char *)arg); break;
        case 28: failf("duplicate function `%s`", (char *)arg); break;
        case 29: failf("unterminated comment"); break;
        case 30: failf("unterminated string escape"); break;
        case 31: failf("unterminated string literal"); break;
        case 32: failf("unsupported string escape `\\%c`", arg); break;
        case 33: failf("unexpected character `%c`", arg); break;
        default: failf("internal error %d", code); break;
    }
}

int usage(const char *program)
{
    fprintf(stderr, "usage: %s [-c] source\n", program);
    return 1;
}
