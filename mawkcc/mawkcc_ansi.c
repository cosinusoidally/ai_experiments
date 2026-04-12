#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

#define DATA_BASE 134516736UL
#define BRK_CUR_OFFSET 0UL
#define RUNTIME_BYTES 4UL

#define MAX_CODE 262144
#define MAX_BIN 524288
#define MAX_DATA 4096
#define MAX_SYMS 4096
#define MAX_CALLS 8192
#define MAX_PARAMS 1024
#define MAX_BREAKS 8192
#define MAX_LOOPS 1024
#define MAX_RELOCS 8192

enum {
    TOK_EOF = 0,
    TOK_IDENT,
    TOK_NUM,
    TOK_STR,
    TOK_RETURN,
    TOK_FUNCTION,
    TOK_VAR,
    TOK_IF,
    TOK_ELSE,
    TOK_WHILE,
    TOK_BREAK,
    TOK_LPAREN,
    TOK_RPAREN,
    TOK_LBRACE,
    TOK_RBRACE,
    TOK_SEMI,
    TOK_COMMA,
    TOK_ASSIGN
};

struct Symbol {
    char *name;
    long value;
};

char *src;
static long src_len;
long idx_pos;
static long tok_pos;
int tok;
char *tok_text;
long tok_text_cap;
unsigned long tok_num;

static unsigned char code[MAX_CODE];
long code_len;
unsigned char *code_p = code;
static unsigned char binbuf[MAX_BIN];
static long bin_len;
static unsigned char data_byte[MAX_DATA];
unsigned char *data_byte_p = data_byte;
unsigned long data_used;
unsigned long next_data_offset;

static struct Symbol globals[MAX_SYMS];
int global_count;
struct Symbol *globals_p = globals;
static struct Symbol functions[MAX_SYMS];
static struct Symbol function_arities[MAX_SYMS];
int function_count;
struct Symbol *functions_p = functions;
struct Symbol *function_arities_p = function_arities;
static struct Symbol externals[MAX_SYMS];
static int external_types[MAX_SYMS];
int external_count;
struct Symbol *externals_p = externals;
int *external_types_p = external_types;

static char *current_params[MAX_PARAMS];
static long current_param_offsets[MAX_PARAMS];
int current_param_count;
char **current_params_p = current_params;
long *current_param_offsets_p = current_param_offsets;
static char *current_function;
int current_returned;

static char *call_target[MAX_CALLS];
static long call_pos[MAX_CALLS];
static long call_argc[MAX_CALLS];
int call_count;
char **call_target_p = call_target;
long *call_pos_p = call_pos;
long *call_argc_p = call_argc;

static long reloc_offsets[MAX_RELOCS];
static char *reloc_names[MAX_RELOCS];
static long reloc_types[MAX_RELOCS];
int reloc_count;
long *reloc_offsets_p = reloc_offsets;
char **reloc_names_p = reloc_names;
long *reloc_types_p = reloc_types;

int loop_depth;
int next_loop_id;
int break_patch_loop[MAX_BREAKS];
long break_patch_pos[MAX_BREAKS];
int break_patch_count;
int *loop_stack_p;
int *break_patch_loop_p = break_patch_loop;
long *break_patch_pos_p = break_patch_pos;

unsigned long global_bytes;
long start_call_patch;
int output_object;
char *dash_c;

static void failf(const char *fmt, ...);
void *xmalloc(size_t n);
static void *xrealloc(void *p, size_t n);
char *xstrdup(const char *s);
static void set_tok_text_len(const char *s, size_t n);
static void set_tok_text_cstr(const char *s);
static unsigned long u32(long v);
void init_lexer(void);
void next_tok(void);
static void read_string_token(void);
int is_space_char(int ch);
int is_digit_char(int ch);
int is_alpha_char(int ch);
int is_alnum_char(int ch);
static void skip_ws_and_comments(void);
void expect(int want);
void parse_program(void);
void parse_global(void);
void parse_function(void);
static void enter_function(const char *name, int param_count, char **param_names);
static void leave_function(void);
void parse_stmt(void);
void parse_block(void);
void parse_if(void);
void parse_while(void);
void parse_break(void);
void parse_expr(void);
void parse_assign_or_primary(void);
void parse_primary(void);
void parse_builtin_call(const char *name, int argc);
int parse_user_call_args(void);
int builtin_arity(const char *name);
void emit_user_call(const char *name, int argc);
void emit_builtin1(const char *name);
void emit_builtin2(const char *name);
void emit_builtin3(const char *name);
void patch_calls(void);
void record_external(const char *name, int type);
void record_reloc(long offset, const char *name, long type);
void code_reset(void);
void emit1(unsigned long b);
void emit4(long v);
void patch4(long pos, long v);
void emit_mov_eax_imm32(long v);
void emit_push_eax(void);
void emit_push_ebx(void);
void emit_pop_ebx(void);
void emit_pop_ecx(void);
void emit_load_param(long offset);
void emit_store_param(long offset);
void emit_load_global(const char *name);
void emit_store_global(const char *name);
void emit_mks_literal(const char *text);
static unsigned long register_string(const char *text);
void emit_prologue(void);
void emit_epilogue(void);
void emit_test_eax_eax(void);
void emit_start(void);
void emit_add_esp_imm32(long v);
void emit_mov_eax_esp(void);
void emit_mov_ebx_ptr_esp(void);
void emit_mov_eax_stack_disp32(long disp);
void emit_mov_ebx_stack_disp32(long disp);
void emit_mov_stack_disp32_ebx(long disp);
void emit_mov_stack_disp32_eax(long disp);
void emit_reverse_args(int argc);
long emit_je_placeholder(void);
long emit_jne_placeholder(void);
long emit_jmp_placeholder(void);
void emit_jmp(long target);
void patch_rel32(long pos, long target);
void emit_add_eax_imm32(long v);
void emit_mov_ebx_eax(void);
void emit_mov_edx_eax(void);
void emit_mov_ebx_ecx(void);
void emit_mov_eax_ecx(void);
void emit_xor_ebx_ebx(void);
void emit_xor_eax_eax(void);
void emit_add_ebx_edx(void);
void emit_cmp_eax_ebx(void);
void emit_mov_eax_abs(unsigned long addr);
void emit_mov_ecx_abs(unsigned long addr);
void emit_mov_abs_eax(unsigned long addr);
void emit_mov_abs_ebx(unsigned long addr);
void emit_int_80(void);
void emit_add_eax_ebx(void);
void emit_and_eax_ebx(void);
void emit_or_eax_ebx(void);
void emit_xor_eax_ebx(void);
void emit_sub_from_stack_top(void);
void emit_imul_eax_ebx(void);
void emit_div_stack_top_by_eax(void);
void emit_cmp_set(int opcode);
void emit_neg_eax(void);
void emit_not_eax(void);
void emit_read_i32(void);
void emit_read_u8(void);
void emit_write_i32(void);
void emit_write_u8(void);
void emit_brk_alloc(void);
void emit_sys_open(void);
void emit_sys_read(void);
void emit_sys_write(void);
void emit_sys_close(void);
void bin_reset(void);
void bout1(unsigned long b);
void bout2(unsigned long v);
void bout4(long v);
void boutstr(const char *s);
void pad_to(unsigned long n);
static unsigned long align4(unsigned long n);
void build_binary(void);
void build_object(void);
void emit_binary(void);
int push_loop(void);
void pop_loop(void);
void record_break(int loop_id, long patch_pos);
void patch_breaks(int loop_id, long target);
int find_symbol(struct Symbol *arr, int count, const char *name);
static long must_find_symbol_value(struct Symbol *arr, int count, const char *name, const char *kind);
static char *read_file(const char *path, long *len_out);
char *read_source(const char *path);
void fail_expected_token(int want);
void fail_loop_stack_overflow(void);
void fail_break_patch_overflow(void);
void fail_missing_main(void);
void fail_break_outside_loop(void);
int has_main_function(void);
void fail_unknown_unary_builtin(const char *name);
void fail_unknown_binary_builtin(const char *name);
void fail_unknown_ternary_builtin(const char *name);
void fail_mks_expects_string(void);
void fail_unsupported_builtin_arity(void);
void fail_undefined_function(const char *name);
void fail_wrong_arity(const char *name);
void fail_assignment_target(const char *name);
void fail_unknown_identifier(const char *name);
void fail_expected_expression(void);
void fail_external_symbol_overflow(void);
void fail_relocation_overflow(void);
void fail_expected_global_name(void);
void fail_global_initialized(const char *name);
void fail_global_after_function(const char *name);
void fail_duplicate_global(const char *name);
void fail_unknown_relocation_symbol(const char *name);
void fail_code_page_overflow(void);
void fail_data_page_overflow(void);

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

static void *xrealloc(void *p, size_t n)
{
    void *q;
    q = realloc(p, n);
    if (!q) {
        fprintf(stderr, "out of memory\n");
        exit(1);
    }
    return q;
}

char *xstrdup(const char *s)
{
    size_t n;
    char *p;
    n = strlen(s);
    p = (char *)xmalloc(n + 1);
    memcpy(p, s, n + 1);
    return p;
}

static void set_tok_text_len(const char *s, size_t n)
{
    if (tok_text_cap < (long)(n + 1)) {
        tok_text_cap = (long)(n + 32);
        tok_text = (char *)xrealloc(tok_text, (size_t)tok_text_cap);
    }
    memcpy(tok_text, s, n);
    tok_text[n] = '\0';
}

static void set_tok_text_cstr(const char *s)
{
    set_tok_text_len(s, strlen(s));
}

static unsigned long u32(long v)
{
    return ((unsigned long)v) & 0xffffffffUL;
}

static void skip_ws_and_comments(void)
{
    while (idx_pos < src_len) {
        char ch;
        ch = src[idx_pos];
        if (is_space_char((unsigned char)ch)) {
            idx_pos++;
            continue;
        }
        if (idx_pos + 1 < src_len && src[idx_pos] == '/' && src[idx_pos + 1] == '*') {
            idx_pos += 2;
            while (idx_pos + 1 < src_len && !(src[idx_pos] == '*' && src[idx_pos + 1] == '/')) {
                idx_pos++;
            }
            if (idx_pos + 1 >= src_len) {
                failf("unterminated comment");
            }
            idx_pos += 2;
            continue;
        }
        if (idx_pos + 1 < src_len && src[idx_pos] == '/' && src[idx_pos + 1] == '/') {
            idx_pos += 2;
            while (idx_pos < src_len && src[idx_pos] != '\n') {
                idx_pos++;
            }
            continue;
        }
        break;
    }
}

static void read_string_token(void)
{
    char *buf;
    long cap;
    long len;

    idx_pos++;
    cap = 64;
    len = 0;
    buf = (char *)xmalloc((size_t)cap);

    while (idx_pos < src_len) {
        char ch;
        ch = src[idx_pos];
        if (ch == '"') {
            idx_pos++;
            set_tok_text_len(buf, (size_t)len);
            free(buf);
            tok = TOK_STR;
            return;
        }
        if (ch == '\\') {
            idx_pos++;
            if (idx_pos >= src_len) {
                free(buf);
                failf("unterminated string escape");
            }
            ch = src[idx_pos];
            if (ch == 'n') {
                ch = '\n';
            } else if (ch == 't') {
                ch = '\t';
            } else if (ch == 'r') {
                ch = '\r';
            } else if (ch == '"') {
                ch = '"';
            } else if (ch == '\\') {
                ch = '\\';
            } else if (ch == '0') {
                ch = '\0';
            } else {
                free(buf);
                failf("unsupported string escape `\\%c`", ch);
            }
        }
        if (len + 2 >= cap) {
            cap *= 2;
            buf = (char *)xrealloc(buf, (size_t)cap);
        }
        buf[len++] = ch;
        idx_pos++;
    }
    free(buf);
    failf("unterminated string literal");
}

void next_tok(void)
{
    long start;
    skip_ws_and_comments();
    tok_pos = idx_pos;

    if (idx_pos >= src_len) {
        tok = TOK_EOF;
        set_tok_text_cstr("");
        return;
    }

    if (is_alpha_char((unsigned char)src[idx_pos])) {
        start = idx_pos;
        idx_pos++;
        while (idx_pos < src_len && is_alnum_char((unsigned char)src[idx_pos])) {
            idx_pos++;
        }
        set_tok_text_len(src + start, (size_t)(idx_pos - start));
        if (strcmp(tok_text, "return") == 0) {
            tok = TOK_RETURN;
        } else if (strcmp(tok_text, "function") == 0) {
            tok = TOK_FUNCTION;
        } else if (strcmp(tok_text, "var") == 0) {
            tok = TOK_VAR;
        } else if (strcmp(tok_text, "if") == 0) {
            tok = TOK_IF;
        } else if (strcmp(tok_text, "else") == 0) {
            tok = TOK_ELSE;
        } else if (strcmp(tok_text, "while") == 0) {
            tok = TOK_WHILE;
        } else if (strcmp(tok_text, "break") == 0) {
            tok = TOK_BREAK;
        } else {
            tok = TOK_IDENT;
        }
        return;
    }

    if (is_digit_char((unsigned char)src[idx_pos])) {
        start = idx_pos;
        idx_pos++;
        while (idx_pos < src_len && is_digit_char((unsigned char)src[idx_pos])) {
            idx_pos++;
        }
        set_tok_text_len(src + start, (size_t)(idx_pos - start));
        tok_num = strtoul(tok_text, (char **)0, 10);
        tok = TOK_NUM;
        return;
    }

    if (src[idx_pos] == '"') {
        read_string_token();
        return;
    }

    switch (src[idx_pos]) {
        case '(':
            tok = TOK_LPAREN;
            set_tok_text_cstr("(");
            idx_pos++;
            return;
        case ')':
            tok = TOK_RPAREN;
            set_tok_text_cstr(")");
            idx_pos++;
            return;
        case '{':
            tok = TOK_LBRACE;
            set_tok_text_cstr("{");
            idx_pos++;
            return;
        case '}':
            tok = TOK_RBRACE;
            set_tok_text_cstr("}");
            idx_pos++;
            return;
        case ';':
            tok = TOK_SEMI;
            set_tok_text_cstr(";");
            idx_pos++;
            return;
        case ',':
            tok = TOK_COMMA;
            set_tok_text_cstr(",");
            idx_pos++;
            return;
        case '=':
            tok = TOK_ASSIGN;
            set_tok_text_cstr("=");
            idx_pos++;
            return;
    }

    failf("unexpected character `%c`", src[idx_pos]);
}

void fail_expected_token(int want)
{
    failf("expected token %d, got `%s`", want, tok_text);
}

void fail_loop_stack_overflow(void)
{
    failf("loop stack overflow");
}

void fail_break_patch_overflow(void)
{
    failf("break patch overflow");
}

void fail_missing_main(void)
{
    failf("missing `main` function");
}

void fail_break_outside_loop(void)
{
    failf("`break` used outside of a loop");
}

int has_main_function(void)
{
    return find_symbol(functions, function_count, "main") >= 0;
}

void fail_unknown_unary_builtin(const char *name)
{
    failf("unknown unary builtin `%s`", name);
}

void fail_unknown_binary_builtin(const char *name)
{
    failf("unknown binary builtin `%s`", name);
}

void fail_unknown_ternary_builtin(const char *name)
{
    failf("unknown ternary builtin `%s`", name);
}

void fail_mks_expects_string(void)
{
    failf("`mks` expects a string literal");
}

void fail_unsupported_builtin_arity(void)
{
    failf("unsupported builtin arity");
}

void fail_undefined_function(const char *name)
{
    failf("call to undefined function `%s`", name);
}

void fail_wrong_arity(const char *name)
{
    failf("function `%s` called with wrong arity", name);
}

void fail_assignment_target(const char *name)
{
    failf("assignment target `%s` is not a global or parameter", name);
}

void fail_unknown_identifier(const char *name)
{
    failf("unknown identifier `%s`", name);
}

void fail_expected_expression(void)
{
    failf("expected expression");
}

void fail_external_symbol_overflow(void)
{
    failf("external symbol overflow");
}

void fail_relocation_overflow(void)
{
    failf("relocation overflow");
}

void fail_expected_global_name(void)
{
    failf("expected global name");
}

void fail_global_initialized(const char *name)
{
    failf("global `%s` cannot be initialized at declaration time", name);
}

void fail_global_after_function(const char *name)
{
    failf("global `%s` must be declared before functions", name);
}

void fail_duplicate_global(const char *name)
{
    failf("duplicate global `%s`", name);
}

void fail_unknown_relocation_symbol(const char *name)
{
    failf("relocation references unknown symbol `%s`", name);
}

void fail_code_page_overflow(void)
{
    failf("program too large for fixed code page");
}

void fail_data_page_overflow(void)
{
    failf("program data too large for fixed data page");
}

static long must_find_symbol_value(struct Symbol *arr, int count, const char *name, const char *kind)
{
    int i;
    i = find_symbol(arr, count, name);
    if (i < 0) {
        failf("unknown %s `%s`", kind, name);
    }
    return arr[i].value;
}

static void enter_function(const char *name, int param_count, char **param_names)
{
    int i;
    current_function = (char *)name;
    current_param_count = param_count;
    current_returned = 0;
    for (i = 0; i < param_count; i++) {
        current_params[i] = xstrdup(param_names[i]);
        current_param_offsets[i] = 8 + 4 * i;
    }
}

static void leave_function(void)
{
    int i;
    for (i = 0; i < current_param_count; i++) {
        free(current_params[i]);
        current_params[i] = 0;
        current_param_offsets[i] = 0;
    }
    current_param_count = 0;
    current_function = 0;
    current_returned = 0;
}

void parse_function(void)
{
    char *name;
    int param_count;
    char *param_names[MAX_PARAMS];

    expect(TOK_FUNCTION);
    if (tok != TOK_IDENT) {
        failf("expected function name");
    }
    name = xstrdup(tok_text);
    next_tok();
    expect(TOK_LPAREN);

    param_count = 0;
    if (tok != TOK_RPAREN) {
        while (1) {
            int i;
            if (tok != TOK_IDENT) {
                failf("expected parameter name");
            }
            for (i = 0; i < param_count; i++) {
                if (strcmp(param_names[i], tok_text) == 0) {
                    failf("duplicate parameter `%s`", tok_text);
                }
            }
            param_names[param_count++] = xstrdup(tok_text);
            next_tok();
            if (tok != TOK_COMMA) {
                break;
            }
            next_tok();
        }
    }
    expect(TOK_RPAREN);

    if (find_symbol(functions, function_count, name) >= 0) {
        failf("duplicate function `%s`", name);
    }
    functions[function_count].name = name;
    functions[function_count].value = code_len;
    function_arities[function_count].name = xstrdup(name);
    function_arities[function_count].value = param_count;
    function_count++;

    emit_prologue();
    enter_function(name, param_count, param_names);
    expect(TOK_LBRACE);
    while (tok != TOK_RBRACE && tok != TOK_EOF) {
        parse_stmt();
    }
    expect(TOK_RBRACE);
    if (!current_returned) {
        emit_mov_eax_imm32(0);
        emit_epilogue();
    }
    leave_function();

    {
        int i;
        for (i = 0; i < param_count; i++) {
            free(param_names[i]);
        }
    }
}

void code_reset(void)
{
    memset(code, 0, sizeof(code));
    memset(data_byte, 0, sizeof(data_byte));
    code_len = 0;
    call_count = 0;
    global_count = 0;
    function_count = 0;
    external_count = 0;
    reloc_count = 0;
    global_bytes = RUNTIME_BYTES;
    next_data_offset = RUNTIME_BYTES;
    data_used = RUNTIME_BYTES;
    loop_depth = 0;
    next_loop_id = 0;
    break_patch_count = 0;
    current_function = 0;
    current_param_count = 0;
    current_returned = 0;
}

void emit1(unsigned long b)
{
    if (code_len >= MAX_CODE) failf("code buffer overflow");
    code[code_len++] = (unsigned char)(u32((long)b) & 255U);
}

void emit4(long v)
{
    unsigned long n;
    n = u32(v);
    emit1(n & 255U);
    emit1((n >> 8) & 255U);
    emit1((n >> 16) & 255U);
    emit1((n >> 24) & 255U);
}

void patch4(long pos, long v)
{
    unsigned long n;
    n = u32(v);
    code[pos] = (unsigned char)(n & 255U);
    code[pos + 1] = (unsigned char)((n >> 8) & 255U);
    code[pos + 2] = (unsigned char)((n >> 16) & 255U);
    code[pos + 3] = (unsigned char)((n >> 24) & 255U);
}

static unsigned long register_string(const char *text)
{
    unsigned long start;
    size_t len;
    size_t i;
    len = strlen(text);
    start = next_data_offset;
    if (start + len + 1 > MAX_DATA) {
        failf("program data too large for fixed data page");
    }
    for (i = 0; i < len; i++) {
        data_byte[start + i] = (unsigned char)text[i];
    }
    data_byte[start + len] = 0;
    next_data_offset = start + (unsigned long)len + 1UL;
    if (data_used < next_data_offset) {
        data_used = next_data_offset;
    }
    return DATA_BASE + start;
}

void emit_mks_literal(const char *text)
{
    unsigned long addr;
    addr = register_string(text);
    emit1(184);
    if (output_object) {
        record_reloc(code_len, ".data", 1);
        emit4((long)(addr - DATA_BASE));
        return;
    }
    emit4((long)addr);
}

void bin_reset(void)
{
    memset(binbuf, 0, sizeof(binbuf));
    bin_len = 0;
}

void bout1(unsigned long b)
{
    if (bin_len >= MAX_BIN) failf("binary buffer overflow");
    binbuf[bin_len++] = (unsigned char)(u32((long)b) & 255U);
}

void bout2(unsigned long v)
{
    bout1(v & 255U);
    bout1((v >> 8) & 255U);
}

void bout4(long v)
{
    unsigned long n;
    n = u32(v);
    bout1(n & 255U);
    bout1((n >> 8) & 255U);
    bout1((n >> 16) & 255U);
    bout1((n >> 24) & 255U);
}

void boutstr(const char *s)
{
    while (*s) {
        bout1((unsigned char)*s);
        s++;
    }
}

void pad_to(unsigned long n)
{
    while ((unsigned long)bin_len < n) {
        bout1(0);
    }
}

static unsigned long align4(unsigned long n)
{
    return ((n + 3UL) / 4UL) * 4UL;
}

void emit_binary(void)
{
    if (fwrite(binbuf, 1, (size_t)bin_len, stdout) != (size_t)bin_len) {
        fprintf(stderr, "write failed\n");
        exit(1);
    }
}

static char *read_file(const char *path, long *len_out)
{
    FILE *fp;
    long len;
    char *buf;
    size_t got;
    fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "cannot open %s\n", path);
        exit(1);
    }
    if (fseek(fp, 0, SEEK_END) != 0) {
        fprintf(stderr, "seek failed\n");
        exit(1);
    }
    len = ftell(fp);
    if (len < 0) {
        fprintf(stderr, "tell failed\n");
        exit(1);
    }
    if (fseek(fp, 0, SEEK_SET) != 0) {
        fprintf(stderr, "seek failed\n");
        exit(1);
    }
    buf = (char *)xmalloc((size_t)len + 2U);
    got = fread(buf, 1, (size_t)len, fp);
    if (got != (size_t)len) {
        fprintf(stderr, "read failed\n");
        exit(1);
    }
    fclose(fp);
    buf[len] = '\n';
    buf[len + 1] = '\0';
    *len_out = len + 1;
    return buf;
}

char *read_source(const char *path)
{
    return read_file(path, &src_len);
}

char *dash_c_string(void)
{
    static char s[] = "-c";
    return s;
}


int usage(const char *program)
{
    fprintf(stderr, "usage: %s [-c] source\n", program);
    return 1;
}
