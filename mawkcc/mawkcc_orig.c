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

static char *src;
static long src_len;
static long idx_pos;
static long tok_pos;
static int tok;
static char *tok_text;
static long tok_text_cap;
static unsigned long tok_num;

static unsigned char code[MAX_CODE];
static long code_len;
static unsigned char binbuf[MAX_BIN];
static long bin_len;
static unsigned char data_byte[MAX_DATA];
static unsigned long data_used;
static unsigned long next_data_offset;

static struct Symbol globals[MAX_SYMS];
static int global_count;
static struct Symbol functions[MAX_SYMS];
static struct Symbol function_arities[MAX_SYMS];
static int function_count;
static struct Symbol externals[MAX_SYMS];
static int external_types[MAX_SYMS];
static int external_count;

static char *current_params[MAX_PARAMS];
static long current_param_offsets[MAX_PARAMS];
static int current_param_count;
static char *current_function;
static int current_returned;

static char *call_target[MAX_CALLS];
static long call_pos[MAX_CALLS];
static long call_argc[MAX_CALLS];
static int call_count;

static long reloc_offsets[MAX_RELOCS];
static char *reloc_names[MAX_RELOCS];
static long reloc_types[MAX_RELOCS];
static int reloc_count;

static int loop_stack[MAX_LOOPS];
static int loop_depth;
static int next_loop_id;
static int break_patch_loop[MAX_BREAKS];
static long break_patch_pos[MAX_BREAKS];
static int break_patch_count;

static unsigned long global_bytes;
static long start_call_patch;
static int output_object;

static void failf(const char *fmt, ...);
static void *xmalloc(size_t n);
static void *xrealloc(void *p, size_t n);
static char *xstrdup(const char *s);
static void set_tok_text_len(const char *s, size_t n);
static void set_tok_text_cstr(const char *s);
static unsigned long u32(long v);
static void init_lexer(void);
static void next_tok(void);
static void read_string_token(void);
static int is_space_char(int ch);
static int is_digit_char(int ch);
static int is_alpha_char(int ch);
static int is_alnum_char(int ch);
static void skip_ws_and_comments(void);
static void expect(int want);
static void parse_program(void);
static void parse_global(void);
static void parse_function(void);
static void enter_function(const char *name, int param_count, char **param_names);
static void leave_function(void);
static void parse_stmt(void);
static void parse_block(void);
static void parse_if(void);
static void parse_while(void);
static void parse_break(void);
static void parse_expr(void);
static void parse_assign_or_primary(void);
static void parse_primary(void);
static void parse_builtin_call(const char *name, int argc);
static int parse_user_call_args(void);
static int builtin_arity(const char *name);
static void emit_user_call(const char *name, int argc);
static void emit_builtin1(const char *name);
static void emit_builtin2(const char *name);
static void emit_builtin3(const char *name);
static void patch_calls(void);
static void record_external(const char *name, int type);
static void record_reloc(long offset, const char *name, long type);
static void code_reset(void);
static void emit1(unsigned long b);
static void emit4(long v);
static void patch4(long pos, long v);
static void emit_mov_eax_imm32(long v);
static void emit_push_eax(void);
static void emit_push_ebx(void);
static void emit_pop_ebx(void);
static void emit_pop_ecx(void);
static void emit_load_param(long offset);
static void emit_store_param(long offset);
static void emit_load_global(const char *name);
static void emit_store_global(const char *name);
static void emit_mks_literal(const char *text);
static unsigned long register_string(const char *text);
static void emit_prologue(void);
static void emit_epilogue(void);
static void emit_test_eax_eax(void);
static void emit_start(void);
static void emit_add_esp_imm32(long v);
static void emit_mov_eax_esp(void);
static void emit_mov_ebx_ptr_esp(void);
static void emit_mov_eax_stack_disp32(long disp);
static void emit_mov_ebx_stack_disp32(long disp);
static void emit_mov_stack_disp32_ebx(long disp);
static void emit_mov_stack_disp32_eax(long disp);
static void emit_reverse_args(int argc);
static long emit_je_placeholder(void);
static long emit_jne_placeholder(void);
static long emit_jmp_placeholder(void);
static void emit_jmp(long target);
static void patch_rel32(long pos, long target);
static void emit_add_eax_imm32(long v);
static void emit_mov_ebx_eax(void);
static void emit_mov_edx_eax(void);
static void emit_mov_ebx_ecx(void);
static void emit_mov_eax_ecx(void);
static void emit_xor_ebx_ebx(void);
static void emit_xor_eax_eax(void);
static void emit_add_ebx_edx(void);
static void emit_cmp_eax_ebx(void);
static void emit_mov_eax_abs(unsigned long addr);
static void emit_mov_ecx_abs(unsigned long addr);
static void emit_mov_abs_eax(unsigned long addr);
static void emit_mov_abs_ebx(unsigned long addr);
static void emit_int_80(void);
static void emit_add_eax_ebx(void);
static void emit_and_eax_ebx(void);
static void emit_or_eax_ebx(void);
static void emit_xor_eax_ebx(void);
static void emit_sub_from_stack_top(void);
static void emit_imul_eax_ebx(void);
static void emit_div_stack_top_by_eax(void);
static void emit_cmp_set(int opcode);
static void emit_neg_eax(void);
static void emit_not_eax(void);
static void emit_read_i32(void);
static void emit_read_u8(void);
static void emit_write_i32(void);
static void emit_write_u8(void);
static void emit_brk_alloc(void);
static void emit_sys_open(void);
static void emit_sys_read(void);
static void emit_sys_write(void);
static void emit_sys_close(void);
static void bin_reset(void);
static void bout1(unsigned long b);
static void bout2(unsigned long v);
static void bout4(long v);
static void boutstr(const char *s);
static void pad_to(unsigned long n);
static unsigned long align4(unsigned long n);
static void build_binary(void);
static void build_object(void);
static void emit_binary(void);
static int push_loop(void);
static void pop_loop(void);
static void record_break(int loop_id, long patch_pos);
static void patch_breaks(int loop_id, long target);
static int find_symbol(struct Symbol *arr, int count, const char *name);
static long must_find_symbol_value(struct Symbol *arr, int count, const char *name, const char *kind);
static char *read_file(const char *path, long *len_out);

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

static void *xmalloc(size_t n)
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

static char *xstrdup(const char *s)
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

static int is_space_char(int ch)
{
    return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '\f' || ch == '\v';
}

static int is_digit_char(int ch)
{
    return ch >= '0' && ch <= '9';
}

static int is_alpha_char(int ch)
{
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_';
}

static int is_alnum_char(int ch)
{
    return is_alpha_char(ch) || is_digit_char(ch);
}

static void init_lexer(void)
{
    idx_pos = 0;
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

static void next_tok(void)
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

static void expect(int want)
{
    if (tok != want) {
        failf("expected token %d, got `%s`", want, tok_text);
    }
    next_tok();
}

static int find_symbol(struct Symbol *arr, int count, const char *name)
{
    int i;
    for (i = 0; i < count; i++) {
        if (strcmp(arr[i].name, name) == 0) {
            return i;
        }
    }
    return -1;
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

static void parse_program(void)
{
    while (tok != TOK_EOF) {
        if (tok == TOK_VAR) {
            parse_global();
        } else {
            parse_function();
        }
    }
    if (!output_object && find_symbol(functions, function_count, "main") < 0) {
        failf("missing `main` function");
    }
}

static void parse_global(void)
{
    char *name;
    expect(TOK_VAR);
    if (tok != TOK_IDENT) {
        failf("expected global name");
    }
    name = xstrdup(tok_text);
    next_tok();
    if (tok == TOK_ASSIGN) {
        failf("global `%s` cannot be initialized at declaration time", name);
    }
    expect(TOK_SEMI);
    if (function_count > 0) {
        failf("global `%s` must be declared before functions", name);
    }
    if (find_symbol(globals, global_count, name) >= 0 || find_symbol(functions, function_count, name) >= 0) {
        failf("duplicate global `%s`", name);
    }
    globals[global_count].name = name;
    if (output_object) {
        globals[global_count].value = 0;
        global_count++;
        return;
    }
    globals[global_count].value = (long)global_bytes;
    global_count++;
    global_bytes += 4;
    if (next_data_offset < global_bytes) {
        next_data_offset = global_bytes;
    }
    if (data_used < global_bytes) {
        data_used = global_bytes;
    }
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

static void parse_function(void)
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

static void parse_stmt(void)
{
    if (tok == TOK_LBRACE) {
        parse_block();
        return;
    }
    if (tok == TOK_RETURN) {
        next_tok();
        parse_expr();
        expect(TOK_SEMI);
        emit_epilogue();
        current_returned = 1;
        return;
    }
    if (tok == TOK_IF) {
        parse_if();
        return;
    }
    if (tok == TOK_WHILE) {
        parse_while();
        return;
    }
    if (tok == TOK_BREAK) {
        parse_break();
        return;
    }
    parse_expr();
    expect(TOK_SEMI);
}

static void parse_block(void)
{
    expect(TOK_LBRACE);
    while (tok != TOK_RBRACE && tok != TOK_EOF) {
        parse_stmt();
    }
    expect(TOK_RBRACE);
}

static void parse_if(void)
{
    long false_patch;
    long end_patch;
    long after_then;
    expect(TOK_IF);
    expect(TOK_LPAREN);
    parse_expr();
    expect(TOK_RPAREN);
    emit_test_eax_eax();
    false_patch = emit_je_placeholder();
    parse_stmt();
    if (tok == TOK_ELSE) {
        end_patch = emit_jmp_placeholder();
        after_then = code_len;
        patch_rel32(false_patch, after_then);
        next_tok();
        parse_stmt();
        patch_rel32(end_patch, code_len);
    } else {
        patch_rel32(false_patch, code_len);
    }
}

static void parse_while(void)
{
    long loop_start;
    long exit_patch;
    int loop_id;
    expect(TOK_WHILE);
    expect(TOK_LPAREN);
    loop_start = code_len;
    parse_expr();
    expect(TOK_RPAREN);
    emit_test_eax_eax();
    exit_patch = emit_je_placeholder();
    loop_id = push_loop();
    record_break(loop_id, exit_patch);
    parse_stmt();
    emit_jmp(loop_start);
    patch_rel32(exit_patch, code_len);
    patch_breaks(loop_id, code_len);
    pop_loop();
}

static void parse_break(void)
{
    if (loop_depth < 1) {
        failf("`break` used outside of a loop");
    }
    expect(TOK_BREAK);
    expect(TOK_SEMI);
    record_break(loop_stack[loop_depth - 1], emit_jmp_placeholder());
}

static void parse_expr(void)
{
    if (tok == TOK_IDENT) {
        parse_assign_or_primary();
        return;
    }
    parse_primary();
}

static void parse_assign_or_primary(void)
{
    char *name;
    int i;
    name = xstrdup(tok_text);
    next_tok();
    if (tok == TOK_ASSIGN) {
        next_tok();
        parse_expr();
        for (i = 0; i < current_param_count; i++) {
            if (strcmp(current_params[i], name) == 0) {
                emit_store_param(current_param_offsets[i]);
                free(name);
                return;
            }
        }
        if (find_symbol(globals, global_count, name) >= 0) {
            emit_store_global(name);
            free(name);
            return;
        }
        failf("assignment target `%s` is not a global or parameter", name);
    }
    if (tok == TOK_LPAREN) {
        if (builtin_arity(name) > 0) {
            parse_builtin_call(name, builtin_arity(name));
        } else {
            emit_user_call(name, parse_user_call_args());
        }
        free(name);
        return;
    }
    for (i = 0; i < current_param_count; i++) {
        if (strcmp(current_params[i], name) == 0) {
            emit_load_param(current_param_offsets[i]);
            free(name);
            return;
        }
    }
    if (find_symbol(globals, global_count, name) >= 0) {
        emit_load_global(name);
        free(name);
        return;
    }
    failf("unknown identifier `%s`", name);
}

static void parse_primary(void)
{
    if (tok == TOK_NUM) {
        emit_mov_eax_imm32((long)tok_num);
        next_tok();
        return;
    }
    if (tok == TOK_LPAREN) {
        next_tok();
        parse_expr();
        expect(TOK_RPAREN);
        return;
    }
    failf("expected expression");
}

static void parse_builtin_call(const char *name, int argc)
{
    expect(TOK_LPAREN);
    if (strcmp(name, "mks") == 0) {
        if (tok != TOK_STR) {
            failf("`mks` expects a string literal");
        }
        emit_mks_literal(tok_text);
        next_tok();
        expect(TOK_RPAREN);
        return;
    } else if (argc == 1) {
        parse_expr();
    } else if (argc == 2) {
        parse_expr();
        emit_push_eax();
        expect(TOK_COMMA);
        parse_expr();
        emit_pop_ebx();
    } else if (argc == 3) {
        parse_expr();
        emit_push_eax();
        expect(TOK_COMMA);
        parse_expr();
        emit_push_eax();
        expect(TOK_COMMA);
        parse_expr();
        emit_mov_edx_eax();
        emit_pop_ecx();
        emit_pop_ebx();
    } else {
        failf("unsupported builtin arity");
    }
    expect(TOK_RPAREN);
    if (argc == 1) {
        emit_builtin1(name);
    } else if (argc == 2) {
        emit_builtin2(name);
    } else {
        emit_builtin3(name);
    }
}

static int parse_user_call_args(void)
{
    int argc;
    argc = 0;
    expect(TOK_LPAREN);
    if (tok == TOK_RPAREN) {
        next_tok();
        return 0;
    }
    while (1) {
        parse_expr();
        emit_push_eax();
        argc++;
        if (tok != TOK_COMMA) {
            break;
        }
        next_tok();
    }
    expect(TOK_RPAREN);
    emit_reverse_args(argc);
    return argc;
}

static int builtin_arity(const char *name)
{
    if (strcmp(name, "neg") == 0 || strcmp(name, "not") == 0 ||
        strcmp(name, "ri32") == 0 || strcmp(name, "ri8") == 0 ||
        strcmp(name, "brk") == 0 || strcmp(name, "close") == 0 ||
        strcmp(name, "mks") == 0) {
        return 1;
    }
    if (strcmp(name, "add") == 0 || strcmp(name, "sub") == 0 ||
        strcmp(name, "mul") == 0 || strcmp(name, "div") == 0 ||
        strcmp(name, "eq") == 0 || strcmp(name, "ne") == 0 ||
        strcmp(name, "lt") == 0 || strcmp(name, "le") == 0 ||
        strcmp(name, "gt") == 0 || strcmp(name, "ge") == 0 ||
        strcmp(name, "and") == 0 || strcmp(name, "or") == 0 ||
        strcmp(name, "xor") == 0 || strcmp(name, "wi32") == 0 ||
        strcmp(name, "wi8") == 0) {
        return 2;
    }
    if (strcmp(name, "open") == 0 || strcmp(name, "read") == 0 ||
        strcmp(name, "write") == 0) {
        return 3;
    }
    return 0;
}

static void emit_user_call(const char *name, int argc)
{
    emit1(232);
    call_target[call_count] = xstrdup(name);
    call_pos[call_count] = code_len;
    emit4(0);
    if (argc > 0) {
        emit_add_esp_imm32(4 * argc);
    }
    call_argc[call_count] = argc;
    call_count++;
}

static void emit_builtin1(const char *name)
{
    if (strcmp(name, "neg") == 0) {
        emit_neg_eax();
    } else if (strcmp(name, "not") == 0) {
        emit_not_eax();
    } else if (strcmp(name, "ri32") == 0) {
        emit_read_i32();
    } else if (strcmp(name, "ri8") == 0) {
        emit_read_u8();
    } else if (strcmp(name, "brk") == 0) {
        emit_brk_alloc();
    } else if (strcmp(name, "close") == 0) {
        emit_sys_close();
    } else {
        failf("unknown unary builtin `%s`", name);
    }
}

static void emit_builtin2(const char *name)
{
    if (strcmp(name, "add") == 0) emit_add_eax_ebx();
    else if (strcmp(name, "sub") == 0) emit_sub_from_stack_top();
    else if (strcmp(name, "mul") == 0) emit_imul_eax_ebx();
    else if (strcmp(name, "div") == 0) emit_div_stack_top_by_eax();
    else if (strcmp(name, "eq") == 0) emit_cmp_set(148);
    else if (strcmp(name, "ne") == 0) emit_cmp_set(149);
    else if (strcmp(name, "lt") == 0) emit_cmp_set(156);
    else if (strcmp(name, "le") == 0) emit_cmp_set(158);
    else if (strcmp(name, "gt") == 0) emit_cmp_set(159);
    else if (strcmp(name, "ge") == 0) emit_cmp_set(157);
    else if (strcmp(name, "and") == 0) emit_and_eax_ebx();
    else if (strcmp(name, "or") == 0) emit_or_eax_ebx();
    else if (strcmp(name, "xor") == 0) emit_xor_eax_ebx();
    else if (strcmp(name, "wi32") == 0) emit_write_i32();
    else if (strcmp(name, "wi8") == 0) emit_write_u8();
    else failf("unknown binary builtin `%s`", name);
}

static void emit_builtin3(const char *name)
{
    if (strcmp(name, "open") == 0) emit_sys_open();
    else if (strcmp(name, "read") == 0) emit_sys_read();
    else if (strcmp(name, "write") == 0) emit_sys_write();
    else failf("unknown ternary builtin `%s`", name);
}

static void patch_calls(void)
{
    int i;
    for (i = 0; i < call_count; i++) {
        int fi;
        long addr;
        long arity;
        long rel;
        fi = find_symbol(functions, function_count, call_target[i]);
        if (fi < 0) {
            if (output_object) {
                patch4(call_pos[i], -4);
                record_external(call_target[i], 18);
                record_reloc(call_pos[i], call_target[i], 2);
                continue;
            }
            failf("call to undefined function `%s`", call_target[i]);
        }
        addr = functions[fi].value;
        arity = function_arities[fi].value;
        if (arity != call_argc[i]) {
            failf("function `%s` called with wrong arity", call_target[i]);
        }
        rel = addr - (call_pos[i] + 4);
        patch4(call_pos[i], rel);
    }
}

static void record_external(const char *name, int type)
{
    int i;
    if (find_symbol(functions, function_count, name) >= 0) {
        return;
    }
    for (i = 0; i < external_count; i++) {
        if (strcmp(externals[i].name, name) == 0) {
            return;
        }
    }
    if (external_count >= MAX_SYMS) {
        failf("external symbol overflow");
    }
    externals[external_count].name = xstrdup(name);
    externals[external_count].value = external_count;
    external_types[external_count] = type;
    external_count++;
}

static void record_reloc(long offset, const char *name, long type)
{
    if (reloc_count >= MAX_RELOCS) {
        failf("relocation overflow");
    }
    reloc_offsets[reloc_count] = offset;
    reloc_names[reloc_count] = xstrdup(name);
    reloc_types[reloc_count] = type;
    reloc_count++;
}

static void code_reset(void)
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

static void emit1(unsigned long b)
{
    if (code_len >= MAX_CODE) failf("code buffer overflow");
    code[code_len++] = (unsigned char)(u32((long)b) & 255U);
}

static void emit4(long v)
{
    unsigned long n;
    n = u32(v);
    emit1(n & 255U);
    emit1((n >> 8) & 255U);
    emit1((n >> 16) & 255U);
    emit1((n >> 24) & 255U);
}

static void patch4(long pos, long v)
{
    unsigned long n;
    n = u32(v);
    code[pos] = (unsigned char)(n & 255U);
    code[pos + 1] = (unsigned char)((n >> 8) & 255U);
    code[pos + 2] = (unsigned char)((n >> 16) & 255U);
    code[pos + 3] = (unsigned char)((n >> 24) & 255U);
}

static void emit_mov_eax_imm32(long v) { emit1(184); emit4(v); }
static void emit_push_eax(void) { emit1(80); }
static void emit_push_ebx(void) { emit1(83); }
static void emit_pop_ebx(void) { emit1(91); }
static void emit_pop_ecx(void) { emit1(89); }
static void emit_load_param(long offset) { emit1(139); emit1(69); emit1(offset); }
static void emit_store_param(long offset) { emit1(137); emit1(69); emit1(offset); }

static void emit_load_global(const char *name)
{
    long off;
    off = must_find_symbol_value(globals, global_count, name, "global");
    emit1(161);
    if (output_object) {
        record_external(name, 17);
        record_reloc(code_len, name, 1);
        emit4(0);
        return;
    }
    emit4((long)(DATA_BASE + (unsigned long)off));
}

static void emit_store_global(const char *name)
{
    long off;
    off = must_find_symbol_value(globals, global_count, name, "global");
    emit1(163);
    if (output_object) {
        record_external(name, 17);
        record_reloc(code_len, name, 1);
        emit4(0);
        return;
    }
    emit4((long)(DATA_BASE + (unsigned long)off));
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

static void emit_mks_literal(const char *text)
{
    emit_mov_eax_imm32((long)register_string(text));
}

static void emit_prologue(void) { emit1(85); emit1(137); emit1(229); }
static void emit_epilogue(void) { emit1(137); emit1(236); emit1(93); emit1(195); }
static void emit_test_eax_eax(void) { emit1(133); emit1(192); }

static void emit_start(void)
{
    emit_mov_eax_esp();
    emit_mov_ebx_ptr_esp();
    emit_add_eax_imm32(4);
    emit_push_eax();
    emit_push_ebx();
    emit1(232);
    start_call_patch = code_len;
    emit4(0);
    emit_add_esp_imm32(8);
    emit1(137);
    emit1(195);
    emit1(184);
    emit4(1);
    emit1(205);
    emit1(128);
}

static void emit_add_esp_imm32(long v) { emit1(129); emit1(196); emit4(v); }
static void emit_mov_eax_esp(void) { emit1(137); emit1(224); }
static void emit_mov_ebx_ptr_esp(void) { emit1(139); emit1(28); emit1(36); }
static void emit_mov_eax_stack_disp32(long disp) { emit1(139); emit1(132); emit1(36); emit4(disp); }
static void emit_mov_ebx_stack_disp32(long disp) { emit1(139); emit1(156); emit1(36); emit4(disp); }
static void emit_mov_stack_disp32_ebx(long disp) { emit1(137); emit1(156); emit1(36); emit4(disp); }
static void emit_mov_stack_disp32_eax(long disp) { emit1(137); emit1(132); emit1(36); emit4(disp); }

static void emit_reverse_args(int argc)
{
    int i;
    for (i = 0; i < argc / 2; i++) {
        long lo;
        long hi;
        lo = 4 * i;
        hi = 4 * (argc - 1 - i);
        emit_mov_eax_stack_disp32(lo);
        emit_mov_ebx_stack_disp32(hi);
        emit_mov_stack_disp32_ebx(lo);
        emit_mov_stack_disp32_eax(hi);
    }
}
static long emit_je_placeholder(void) { emit1(15); emit1(132); { long p = code_len; emit4(0); return p; } }
static long emit_jne_placeholder(void) { emit1(15); emit1(133); { long p = code_len; emit4(0); return p; } }
static long emit_jmp_placeholder(void) { emit1(233); { long p = code_len; emit4(0); return p; } }
static void emit_jmp(long target) { long p = emit_jmp_placeholder(); patch_rel32(p, target); }
static void patch_rel32(long pos, long target) { patch4(pos, target - (pos + 4)); }
static void emit_add_eax_imm32(long v) { emit1(5); emit4(v); }
static void emit_mov_ebx_eax(void) { emit1(137); emit1(195); }
static void emit_mov_edx_eax(void) { emit1(137); emit1(194); }
static void emit_mov_ebx_ecx(void) { emit1(137); emit1(203); }
static void emit_mov_eax_ecx(void) { emit1(137); emit1(200); }
static void emit_xor_ebx_ebx(void) { emit1(49); emit1(219); }
static void emit_xor_eax_eax(void) { emit1(49); emit1(192); }
static void emit_add_ebx_edx(void) { emit1(1); emit1(211); }
static void emit_cmp_eax_ebx(void) { emit1(57); emit1(216); }
static void emit_mov_eax_abs(unsigned long addr) { emit1(161); emit4((long)addr); }
static void emit_mov_ecx_abs(unsigned long addr) { emit1(139); emit1(13); emit4((long)addr); }
static void emit_mov_abs_eax(unsigned long addr) { emit1(163); emit4((long)addr); }
static void emit_mov_abs_ebx(unsigned long addr) { emit1(137); emit1(29); emit4((long)addr); }
static void emit_int_80(void) { emit1(205); emit1(128); }
static void emit_add_eax_ebx(void) { emit1(1); emit1(216); }
static void emit_and_eax_ebx(void) { emit1(33); emit1(216); }
static void emit_or_eax_ebx(void) { emit1(9); emit1(216); }
static void emit_xor_eax_ebx(void) { emit1(49); emit1(216); }

static void emit_sub_from_stack_top(void)
{
    emit1(137); emit1(193); emit1(137); emit1(216); emit1(41); emit1(200);
}

static void emit_imul_eax_ebx(void) { emit1(15); emit1(175); emit1(195); }

static void emit_div_stack_top_by_eax(void)
{
    emit1(137); emit1(193); emit1(137); emit1(216); emit1(153); emit1(247); emit1(249);
}

static void emit_cmp_set(int opcode)
{
    emit1(57); emit1(195); emit1(15); emit1((unsigned long)opcode); emit1(192); emit1(15); emit1(182); emit1(192);
}

static void emit_neg_eax(void) { emit1(247); emit1(216); }

static void emit_not_eax(void)
{
    emit1(133); emit1(192); emit1(15); emit1(148); emit1(192); emit1(15); emit1(182); emit1(192);
}

static void emit_read_i32(void) { emit1(139); emit1(0); }
static void emit_read_u8(void) { emit1(15); emit1(182); emit1(0); }
static void emit_write_i32(void) { emit1(137); emit1(3); }

static void emit_write_u8(void)
{
    emit1(136); emit1(3); emit1(15); emit1(182); emit1(192);
}

static void emit_brk_alloc(void)
{
    unsigned long cur_addr;
    long init_skip;
    long fail_patch;
    long done_patch;

    cur_addr = DATA_BASE + BRK_CUR_OFFSET;
    emit_mov_edx_eax();
    emit_mov_eax_abs(cur_addr);
    emit_test_eax_eax();
    init_skip = emit_jne_placeholder();
    emit_mov_eax_imm32(45);
    emit_xor_ebx_ebx();
    emit_int_80();
    emit_mov_abs_eax(cur_addr);
    patch_rel32(init_skip, code_len);
    emit_mov_ecx_abs(cur_addr);
    emit_mov_ebx_ecx();
    emit_add_ebx_edx();
    emit_mov_eax_imm32(45);
    emit_int_80();
    emit_cmp_eax_ebx();
    fail_patch = emit_jne_placeholder();
    emit_mov_abs_ebx(cur_addr);
    emit_mov_eax_ecx();
    done_patch = emit_jmp_placeholder();
    patch_rel32(fail_patch, code_len);
    emit_xor_eax_eax();
    patch_rel32(done_patch, code_len);
}

static void emit_sys_open(void) { emit_mov_eax_imm32(5); emit_int_80(); }
static void emit_sys_read(void) { emit_mov_eax_imm32(3); emit_int_80(); }
static void emit_sys_write(void) { emit_mov_eax_imm32(4); emit_int_80(); }

static void emit_sys_close(void)
{
    emit_mov_ebx_eax();
    emit_mov_eax_imm32(6);
    emit_int_80();
}

static void bin_reset(void)
{
    memset(binbuf, 0, sizeof(binbuf));
    bin_len = 0;
}

static void bout1(unsigned long b)
{
    if (bin_len >= MAX_BIN) failf("binary buffer overflow");
    binbuf[bin_len++] = (unsigned char)(u32((long)b) & 255U);
}

static void bout2(unsigned long v)
{
    bout1(v & 255U);
    bout1((v >> 8) & 255U);
}

static void bout4(long v)
{
    unsigned long n;
    n = u32(v);
    bout1(n & 255U);
    bout1((n >> 8) & 255U);
    bout1((n >> 16) & 255U);
    bout1((n >> 24) & 255U);
}

static void boutstr(const char *s)
{
    while (*s) {
        bout1((unsigned char)*s);
        s++;
    }
}

static void pad_to(unsigned long n)
{
    while ((unsigned long)bin_len < n) {
        bout1(0);
    }
}

static unsigned long align4(unsigned long n)
{
    return ((n + 3UL) / 4UL) * 4UL;
}

static void build_binary(void)
{
    unsigned long base;
    unsigned long ehsize;
    unsigned long phsize;
    unsigned long headers;
    unsigned long entry;
    unsigned long filesz;
    unsigned long memsz;
    unsigned long flags;
    long rel;
    long i;
    int main_index;

    base = 134512640UL;
    ehsize = 52UL;
    phsize = 32UL;
    headers = ehsize + phsize;
    entry = base + headers;
    filesz = 4096UL + data_used;
    memsz = 8192UL;
    flags = 7UL;

    if (headers + (unsigned long)code_len > 4096UL) {
        failf("program too large for fixed code page");
    }
    if (data_used > 4096UL) {
        failf("program data too large for fixed data page");
    }

    main_index = find_symbol(functions, function_count, "main");
    if (main_index < 0) {
        failf("missing `main` function");
    }
    rel = functions[main_index].value - (start_call_patch + 4);
    patch4(start_call_patch, rel);

    bin_reset();
    bout1(127); bout1(69); bout1(76); bout1(70);
    bout1(1); bout1(1); bout1(1); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout2(2); bout2(3); bout4(1); bout4((long)entry); bout4((long)ehsize); bout4(0); bout4(0);
    bout2(ehsize); bout2(phsize); bout2(1); bout2(0); bout2(0); bout2(0);
    bout4(1); bout4(0); bout4((long)base); bout4((long)base); bout4((long)filesz); bout4((long)memsz); bout4((long)flags); bout4(4096);

    for (i = 0; i < code_len; i++) {
        bout1(code[i]);
    }
    while (bin_len < 4096) {
        bout1(0);
    }
    for (i = 0; i < (long)data_used; i++) {
        bout1(data_byte[i]);
    }
}

static void build_object(void)
{
    unsigned long ehsize;
    unsigned long shentsize;
    unsigned long shnum;
    unsigned long shstrndx;
    unsigned long text_off;
    unsigned long rel_off;
    unsigned long symtab_off;
    unsigned long strtab_off;
    unsigned long shstrtab_off;
    unsigned long shoff;
    unsigned long strtab_size;
    unsigned long shstrtab_size;
    unsigned long sym_count;
    unsigned long symtab_size;
    unsigned long rel_size;
    unsigned long sym_name_off[MAX_SYMS];
    unsigned long sym_index[MAX_SYMS];
    long start;
    long next_start;
    long size;
    int i;
    int ri;
    int si;

    if (data_used != RUNTIME_BYTES) {
        failf("object output does not support string data yet");
    }

    ehsize = 52UL;
    shentsize = 40UL;
    shnum = 8UL;
    shstrndx = 7UL;
    strtab_size = 1UL;
    for (i = 0; i < function_count; i++) {
        sym_index[i] = (unsigned long)i + 1UL;
        sym_name_off[i] = strtab_size;
        strtab_size += (unsigned long)strlen(functions[i].name) + 1UL;
    }
    for (i = 0; i < external_count; i++) {
        sym_index[function_count + i] = (unsigned long)function_count + (unsigned long)i + 1UL;
        sym_name_off[function_count + i] = strtab_size;
        strtab_size += (unsigned long)strlen(externals[i].name) + 1UL;
    }
    shstrtab_size = 54UL;
    sym_count = (unsigned long)function_count + (unsigned long)external_count + 1UL;
    symtab_size = sym_count * 16UL;
    rel_size = (unsigned long)reloc_count * 8UL;

    text_off = ehsize;
    rel_off = align4(text_off + (unsigned long)code_len);
    symtab_off = rel_off + rel_size;
    strtab_off = symtab_off + symtab_size;
    shstrtab_off = strtab_off + strtab_size;
    shoff = align4(shstrtab_off + shstrtab_size);

    bin_reset();

    bout1(127); bout1(69); bout1(76); bout1(70);
    bout1(1); bout1(1); bout1(1); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout2(1); bout2(3); bout4(1); bout4(0); bout4(0); bout4((long)shoff); bout4(0);
    bout2(ehsize); bout2(0); bout2(0); bout2(shentsize); bout2(shnum); bout2(shstrndx);

    for (i = 0; i < code_len; i++) {
        bout1(code[i]);
    }

    pad_to(rel_off);
    for (ri = 0; ri < reloc_count; ri++) {
        si = find_symbol(functions, function_count, reloc_names[ri]);
        if (si >= 0) {
            bout4(reloc_offsets[ri]);
            bout4((long)(sym_index[si] * 256UL + (unsigned long)reloc_types[ri]));
            continue;
        }
        si = find_symbol(externals, external_count, reloc_names[ri]);
        if (si < 0) {
            failf("relocation references unknown symbol `%s`", reloc_names[ri]);
        }
        bout4(reloc_offsets[ri]);
        bout4((long)(sym_index[function_count + si] * 256UL + (unsigned long)reloc_types[ri]));
    }

    pad_to(symtab_off);

    for (i = 0; i < 16; i++) {
        bout1(0);
    }
    for (i = 0; i < function_count; i++) {
        start = functions[i].value;
        if (i + 1 < function_count) {
            next_start = functions[i + 1].value;
        } else {
            next_start = code_len;
        }
        size = next_start - start;
        bout4((long)sym_name_off[i]);
        bout4(start);
        bout4(size);
        bout1(18);
        bout1(0);
        bout2(1);
    }
    for (i = 0; i < external_count; i++) {
        bout4((long)sym_name_off[function_count + i]);
        bout4(0);
        bout4(0);
        bout1((unsigned long)external_types[i]);
        bout1(0);
        bout2(0);
    }

    bout1(0);
    for (i = 0; i < function_count; i++) {
        boutstr(functions[i].name);
        bout1(0);
    }
    for (i = 0; i < external_count; i++) {
        boutstr(externals[i].name);
        bout1(0);
    }

    bout1(0);
    boutstr(".text"); bout1(0);
    boutstr(".rel.text"); bout1(0);
    boutstr(".data"); bout1(0);
    boutstr(".bss"); bout1(0);
    boutstr(".symtab"); bout1(0);
    boutstr(".strtab"); bout1(0);
    boutstr(".shstrtab"); bout1(0);

    pad_to(shoff);

    for (i = 0; i < 40; i++) {
        bout1(0);
    }

    bout4(1); bout4(1); bout4(6); bout4(0); bout4((long)text_off); bout4(code_len); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(7); bout4(9); bout4(64); bout4(0); bout4((long)rel_off); bout4((long)rel_size); bout4(5); bout4(1); bout4(4); bout4(8);
    bout4(17); bout4(1); bout4(3); bout4(0); bout4((long)(text_off + (unsigned long)code_len)); bout4(0); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(23); bout4(8); bout4(3); bout4(0); bout4((long)(text_off + (unsigned long)code_len)); bout4(0); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(28); bout4(2); bout4(0); bout4(0); bout4((long)symtab_off); bout4((long)symtab_size); bout4(6); bout4(1); bout4(4); bout4(16);
    bout4(36); bout4(3); bout4(0); bout4(0); bout4((long)strtab_off); bout4((long)strtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(44); bout4(3); bout4(0); bout4(0); bout4((long)shstrtab_off); bout4((long)shstrtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
}

static void emit_binary(void)
{
    if (fwrite(binbuf, 1, (size_t)bin_len, stdout) != (size_t)bin_len) {
        fprintf(stderr, "write failed\n");
        exit(1);
    }
}

static int push_loop(void)
{
    int id;
    id = ++next_loop_id;
    if (loop_depth >= MAX_LOOPS) failf("loop stack overflow");
    loop_stack[loop_depth++] = id;
    return id;
}

static void pop_loop(void)
{
    if (loop_depth > 0) loop_depth--;
}

static void record_break(int loop_id, long patch_pos)
{
    if (break_patch_count >= MAX_BREAKS) failf("break patch overflow");
    break_patch_loop[break_patch_count] = loop_id;
    break_patch_pos[break_patch_count] = patch_pos;
    break_patch_count++;
}

static void patch_breaks(int loop_id, long target)
{
    int i;
    for (i = 0; i < break_patch_count; i++) {
        if (break_patch_loop[i] == loop_id) {
            patch_rel32(break_patch_pos[i], target);
        }
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

int main(int argc, char **argv)
{
    const char *source_path;

    output_object = 0;
    if (argc == 3 && strcmp(argv[1], "-c") == 0) {
        output_object = 1;
        source_path = argv[2];
    } else if (argc == 2) {
        source_path = argv[1];
    } else {
        fprintf(stderr, "usage: %s [-c] source\n", argv[0]);
        return 1;
    }

    tok_text = 0;
    tok_text_cap = 0;
    src = read_file(source_path, &src_len);
    init_lexer();
    code_reset();
    next_tok();
    if (!output_object) {
        emit_start();
    }
    parse_program();
    expect(TOK_EOF);
    patch_calls();
    if (output_object) {
        build_object();
    } else {
        build_binary();
    }
    emit_binary();
    return 0;
}
