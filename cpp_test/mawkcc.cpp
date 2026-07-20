#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

constexpr unsigned long BrkCurrentOffset = 0UL;
constexpr unsigned long RuntimeBytes = 4UL;

enum class Token {
    Eof = 0,
    Identifier,
    Number,
    String,
    Return,
    Function,
    Var,
    If,
    Else,
    While,
    Break,
    LeftParen,
    RightParen,
    LeftBrace,
    RightBrace,
    Semicolon,
    Comma,
    Assign
};

struct Symbol {
    std::string name;
    long value;
};

struct PendingCall {
    std::string target;
    long patch_offset;
    long argument_count;
};

struct Relocation {
    long offset;
    std::string symbol;
    long type;
};

struct DataPatch {
    long offset;
    unsigned long addend;
};

struct BreakPatch {
    int loop_id;
    long offset;
};

class Compiler {
public:
    int run(int argc, char **argv);

private:
    std::string src;
    std::size_t src_len;
    std::size_t idx_pos;
    std::size_t tok_pos;
    Token tok;
    std::string tok_text;
    unsigned long tok_num;

    std::vector<std::uint8_t> code;
    long code_len;
    std::vector<std::uint8_t> binbuf;
    long bin_len;
    std::vector<std::uint8_t> data_byte;
    unsigned long data_used;
    unsigned long next_data_offset;

    std::vector<Symbol> globals;
    std::vector<Symbol> functions;
    std::vector<Symbol> function_arities;
    std::vector<Symbol> externals;
    std::vector<int> external_types;

    std::vector<Symbol> current_params;

    std::vector<PendingCall> calls;
    std::vector<Relocation> relocations;
    std::vector<DataPatch> data_patches;

    std::vector<int> loop_stack;
    int next_loop_id;
    std::vector<BreakPatch> break_patches;

    unsigned long global_bytes;
    long start_call_patch;
    bool output_object;
    std::string output_path;

    void failf(const char *fmt, ...);
    void ensure_data_capacity(size_t needed);
    void set_tok_text_len(const char *s, size_t n);
    void set_tok_text_cstr(const char *s);
    unsigned long u32(long v);
    void init_lexer();
    void next_tok();
    void read_string_token();
    int is_space_char(int ch);
    int is_digit_char(int ch);
    int is_alpha_char(int ch);
    int is_alnum_char(int ch);
    void skip_ws_and_comments();
    void expect(Token want);
    void parse_program();
    void parse_global();
    void parse_function();
    void enter_function(const std::vector<std::string> &param_names);
    void leave_function();
    void parse_stmt();
    void parse_block();
    void parse_if();
    void parse_while();
    void parse_break();
    void parse_expr();
    void parse_assign_or_primary();
    void parse_primary();
    void parse_builtin_call(const char *name, int argc);
    int parse_user_call_args();
    int builtin_arity(const char *name);
    void emit_user_call(const char *name, int argc);
    void emit_builtin1(const char *name);
    void emit_builtin2(const char *name);
    void emit_builtin3(const char *name);
    void patch_calls();
    void record_external(const char *name, int type);
    void record_reloc(long offset, const char *name, long type);
    void record_data_patch(long offset, unsigned long addend);
    void code_reset();
    void emit1(unsigned long b);
    void emit4(long v);
    void patch4(long pos, long v);
    void emit_mov_eax_imm32(long v);
    void emit_push_eax();
    void emit_push_ebx();
    void emit_pop_ebx();
    void emit_pop_ecx();
    void emit_load_param(long offset);
    void emit_store_param(long offset);
    void emit_load_global(const char *name);
    void emit_store_global(const char *name);
    void emit_mks_literal(const char *text);
    unsigned long register_string(const char *text);
    void emit_prologue();
    void emit_epilogue();
    void emit_test_eax_eax();
    void emit_start();
    void emit_add_esp_imm32(long v);
    void emit_mov_eax_esp();
    void emit_mov_ebx_ptr_esp();
    void emit_mov_eax_stack_disp32(long disp);
    void emit_mov_ebx_stack_disp32(long disp);
    void emit_mov_stack_disp32_ebx(long disp);
    void emit_mov_stack_disp32_eax(long disp);
    void emit_reverse_args(int argc);
    long emit_je_placeholder();
    long emit_jne_placeholder();
    long emit_jmp_placeholder();
    void emit_jmp(long target);
    void patch_rel32(long pos, long target);
    void emit_add_eax_imm32(long v);
    void emit_mov_ebx_eax();
    void emit_mov_edx_eax();
    void emit_mov_ebx_ecx();
    void emit_mov_eax_ecx();
    void emit_xor_ebx_ebx();
    void emit_xor_eax_eax();
    void emit_add_ebx_edx();
    void emit_cmp_eax_ebx();
    void emit_int_80();
    void emit_add_eax_ebx();
    void emit_and_eax_ebx();
    void emit_or_eax_ebx();
    void emit_xor_eax_ebx();
    void emit_shl_ebx_by_eax();
    void emit_shr_ebx_by_eax();
    void emit_sub_from_stack_top();
    void emit_imul_eax_ebx();
    void emit_div_stack_top_by_eax();
    void emit_mod_stack_top_by_eax();
    void emit_cmp_set(int opcode);
    void emit_neg_eax();
    void emit_not_eax();
    void emit_read_i32();
    void emit_read_u8();
    void emit_write_i32();
    void emit_write_u8();
    void emit_brk_alloc();
    void emit_sys_open();
    void emit_sys_read();
    void emit_sys_write();
    void emit_sys_close();
    void emit_sys_exit();
    void bin_reset();
    void bout1(unsigned long b);
    void bout2(unsigned long v);
    void bout4(long v);
    void boutstr(const char *s);
    void pad_to(unsigned long n);
    unsigned long align4(unsigned long n);
    void build_binary();
    void build_object();
    void emit_binary();
    int push_loop();
    void pop_loop();
    void record_break(int loop_id, long patch_pos);
    void patch_breaks(int loop_id, long target);
    int find_symbol(const std::vector<Symbol> &symbols, const char *name);
    long must_find_symbol_value(const std::vector<Symbol> &symbols, const char *name, const char *kind);
    std::string read_file(const char *path);
};

void Compiler::failf(const char *fmt, ...)
{
    va_list ap;
    char msg[1024];
    char nearbuf[64];
    std::size_t i;
    std::size_t start;
    std::size_t n;

    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);

    start = tok_pos;
    n = src_len - start;
    if (n > 40) {
        n = 40;
    }
    for (i = 0; i < n; i++) {
        char ch = src[start + i];
        if (ch == '\n') {
            nearbuf[i] = '\\';
            if (i + 1 < sizeof(nearbuf) - 1) {
                i++;
                nearbuf[i] = 'n';
            }
        } else {
            nearbuf[i] = ch;
        }
    }
    nearbuf[n] = '\0';
    fprintf(stderr, "mawkcc_cpp: %s near `%s`\n", msg, nearbuf);
    exit(1);
}

void Compiler::ensure_data_capacity(size_t needed)
{
    if (data_byte.size() < needed) {
        data_byte.resize(needed, 0);
    }
}

void Compiler::set_tok_text_len(const char *s, size_t n)
{
    tok_text.assign(s, n);
}

void Compiler::set_tok_text_cstr(const char *s)
{
    set_tok_text_len(s, strlen(s));
}

unsigned long Compiler::u32(long v)
{
    return ((unsigned long)v) & 0xffffffffUL;
}

int Compiler::is_space_char(int ch)
{
    return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '\f' || ch == '\v';
}

int Compiler::is_digit_char(int ch)
{
    return ch >= '0' && ch <= '9';
}

int Compiler::is_alpha_char(int ch)
{
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_';
}

int Compiler::is_alnum_char(int ch)
{
    return is_alpha_char(ch) || is_digit_char(ch);
}

void Compiler::init_lexer()
{
    idx_pos = 0;
}

void Compiler::skip_ws_and_comments()
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

void Compiler::read_string_token()
{
    std::string buffer;

    idx_pos++;
    buffer.reserve(64);

    while (idx_pos < src_len) {
        char ch;
        ch = src[idx_pos];
        if (ch == '"') {
            idx_pos++;
            tok_text = std::move(buffer);
            tok = Token::String;
            return;
        }
        if (ch == '\\') {
            idx_pos++;
            if (idx_pos >= src_len) {
                failf("unterminated string escape");
            }
            ch = src[idx_pos];
            if (ch == 'n') {
                ch = '\n';
            } else if (ch == 't') {
                ch = '\t';
            } else if (ch == 'r') {
                ch = '\r';
            } else if (ch == 'f') {
                ch = '\f';
            } else if (ch == 'v') {
                ch = '\v';
            } else if (ch == '"') {
                ch = '"';
            } else if (ch == '\\') {
                ch = '\\';
            } else if (ch == '0') {
                ch = '\0';
            } else {
                failf("unsupported string escape `\\%c`", ch);
            }
        }
        buffer.push_back(ch);
        idx_pos++;
    }
    failf("unterminated string literal");
}

void Compiler::next_tok()
{
    std::size_t start;
    skip_ws_and_comments();
    tok_pos = idx_pos;

    if (idx_pos >= src_len) {
        tok = Token::Eof;
        set_tok_text_cstr("");
        return;
    }

    if (is_alpha_char((unsigned char)src[idx_pos])) {
        start = idx_pos;
        idx_pos++;
        while (idx_pos < src_len && is_alnum_char((unsigned char)src[idx_pos])) {
            idx_pos++;
        }
        set_tok_text_len(src.data() + start, (size_t)(idx_pos - start));
        if (strcmp(tok_text.c_str(), "return") == 0) {
            tok = Token::Return;
        } else if (strcmp(tok_text.c_str(), "function") == 0) {
            tok = Token::Function;
        } else if (strcmp(tok_text.c_str(), "var") == 0) {
            tok = Token::Var;
        } else if (strcmp(tok_text.c_str(), "if") == 0) {
            tok = Token::If;
        } else if (strcmp(tok_text.c_str(), "else") == 0) {
            tok = Token::Else;
        } else if (strcmp(tok_text.c_str(), "while") == 0) {
            tok = Token::While;
        } else if (strcmp(tok_text.c_str(), "break") == 0) {
            tok = Token::Break;
        } else {
            tok = Token::Identifier;
        }
        return;
    }

    if (is_digit_char((unsigned char)src[idx_pos])) {
        start = idx_pos;
        idx_pos++;
        while (idx_pos < src_len && is_digit_char((unsigned char)src[idx_pos])) {
            idx_pos++;
        }
        set_tok_text_len(src.data() + start, (size_t)(idx_pos - start));
        tok_num = strtoul(tok_text.c_str(), (char **)0, 10);
        tok = Token::Number;
        return;
    }

    if (src[idx_pos] == '"') {
        read_string_token();
        return;
    }

    switch (src[idx_pos]) {
        case '(':
            tok = Token::LeftParen;
            set_tok_text_cstr("(");
            idx_pos++;
            return;
        case ')':
            tok = Token::RightParen;
            set_tok_text_cstr(")");
            idx_pos++;
            return;
        case '{':
            tok = Token::LeftBrace;
            set_tok_text_cstr("{");
            idx_pos++;
            return;
        case '}':
            tok = Token::RightBrace;
            set_tok_text_cstr("}");
            idx_pos++;
            return;
        case ';':
            tok = Token::Semicolon;
            set_tok_text_cstr(";");
            idx_pos++;
            return;
        case ',':
            tok = Token::Comma;
            set_tok_text_cstr(",");
            idx_pos++;
            return;
        case '=':
            tok = Token::Assign;
            set_tok_text_cstr("=");
            idx_pos++;
            return;
    }

    failf("unexpected character `%c`", src[idx_pos]);
}

void Compiler::expect(Token want)
{
    if (tok != want) {
        failf("expected token %d, got `%s`", want, tok_text.c_str());
    }
    next_tok();
}

int Compiler::find_symbol(const std::vector<Symbol> &symbols, const char *name)
{
    for (std::size_t i = 0; i < symbols.size(); ++i) {
        if (symbols[i].name == name) {
            return static_cast<int>(i);
        }
    }
    return -1;
}

long Compiler::must_find_symbol_value(const std::vector<Symbol> &symbols, const char *name, const char *kind)
{
    int i;
    i = find_symbol(symbols, name);
    if (i < 0) {
        failf("unknown %s `%s`", kind, name);
    }
    return symbols[static_cast<std::size_t>(i)].value;
}

void Compiler::parse_program()
{
    while (tok != Token::Eof) {
        if (tok == Token::Var) {
            parse_global();
        } else {
            parse_function();
        }
    }
    if (!output_object && find_symbol(functions, "main") < 0) {
        failf("missing `main` function");
    }
}

void Compiler::parse_global()
{
    expect(Token::Var);
    if (tok != Token::Identifier) {
        failf("expected global name");
    }
    const std::string name = tok_text;
    next_tok();
    if (tok == Token::Assign) {
        failf("global `%s` cannot be initialized at declaration time", name.c_str());
    }
    expect(Token::Semicolon);
    if (find_symbol(globals, name.c_str()) >= 0 || find_symbol(functions, name.c_str()) >= 0) {
        failf("duplicate global `%s`", name.c_str());
    }
    if (output_object) {
        globals.push_back(Symbol{name, 0});
        return;
    }
    if (global_bytes < next_data_offset) {
        global_bytes = align4(next_data_offset);
        next_data_offset = global_bytes;
    }
    globals.push_back(Symbol{name, static_cast<long>(global_bytes)});
    global_bytes += 4;
    if (next_data_offset < global_bytes) {
        next_data_offset = global_bytes;
    }
    if (data_used < global_bytes) {
        data_used = global_bytes;
    }
    ensure_data_capacity((size_t)data_used);
}

void Compiler::enter_function(const std::vector<std::string> &param_names)
{
    current_params.clear();
    for (std::size_t i = 0; i < param_names.size(); ++i) {
        current_params.push_back(Symbol{param_names[i], 8 + 4 * static_cast<long>(i)});
    }
}

void Compiler::leave_function()
{
    current_params.clear();
}

void Compiler::parse_function()
{
    std::string name;
    std::vector<std::string> param_names;

    expect(Token::Function);
    if (tok != Token::Identifier) {
        failf("expected function name");
    }
    name = tok_text;
    next_tok();
    expect(Token::LeftParen);

    if (tok != Token::RightParen) {
        while (1) {
            if (tok != Token::Identifier) {
                failf("expected parameter name");
            }
            for (const std::string &parameter : param_names) {
                if (parameter == tok_text) {
                    failf("duplicate parameter `%s`", tok_text.c_str());
                }
            }
            param_names.push_back(tok_text);
            next_tok();
            if (tok != Token::Comma) {
                break;
            }
            next_tok();
        }
    }
    expect(Token::RightParen);

    if (find_symbol(functions, name.c_str()) >= 0) {
        failf("duplicate function `%s`", name.c_str());
    }
    functions.push_back(Symbol{name, code_len});
    function_arities.push_back(Symbol{name, static_cast<long>(param_names.size())});

    emit_prologue();
    enter_function(param_names);
    expect(Token::LeftBrace);
    while (tok != Token::RightBrace && tok != Token::Eof) {
        parse_stmt();
    }
    expect(Token::RightBrace);
    emit_mov_eax_imm32(0);
    emit_epilogue();
    leave_function();

}

void Compiler::parse_stmt()
{
    if (tok == Token::LeftBrace) {
        parse_block();
        return;
    }
    if (tok == Token::Return) {
        next_tok();
        parse_expr();
        expect(Token::Semicolon);
        emit_epilogue();
        return;
    }
    if (tok == Token::If) {
        parse_if();
        return;
    }
    if (tok == Token::While) {
        parse_while();
        return;
    }
    if (tok == Token::Break) {
        parse_break();
        return;
    }
    parse_expr();
    expect(Token::Semicolon);
}

void Compiler::parse_block()
{
    expect(Token::LeftBrace);
    while (tok != Token::RightBrace && tok != Token::Eof) {
        parse_stmt();
    }
    expect(Token::RightBrace);
}

void Compiler::parse_if()
{
    long false_patch;
    long end_patch;
    long after_then;
    expect(Token::If);
    expect(Token::LeftParen);
    parse_expr();
    expect(Token::RightParen);
    emit_test_eax_eax();
    false_patch = emit_je_placeholder();
    parse_stmt();
    if (tok == Token::Else) {
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

void Compiler::parse_while()
{
    long loop_start;
    long exit_patch;
    int loop_id;
    expect(Token::While);
    expect(Token::LeftParen);
    loop_start = code_len;
    parse_expr();
    expect(Token::RightParen);
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

void Compiler::parse_break()
{
    if (loop_stack.empty()) {
        failf("`break` used outside of a loop");
    }
    expect(Token::Break);
    expect(Token::Semicolon);
    record_break(loop_stack.back(), emit_jmp_placeholder());
}

void Compiler::parse_expr()
{
    if (tok == Token::Identifier) {
        parse_assign_or_primary();
        return;
    }
    parse_primary();
}

void Compiler::parse_assign_or_primary()
{
    const std::string name = tok_text;
    next_tok();
    if (tok == Token::Assign) {
        next_tok();
        parse_expr();
        for (const Symbol &parameter : current_params) {
            if (parameter.name == name) {
                emit_store_param(parameter.value);
                return;
            }
        }
        if (find_symbol(globals, name.c_str()) >= 0) {
            emit_store_global(name.c_str());
            return;
        }
        failf("assignment target `%s` is not a global or parameter", name.c_str());
    }
    if (tok == Token::LeftParen) {
        if (builtin_arity(name.c_str()) > 0) {
            parse_builtin_call(name.c_str(), builtin_arity(name.c_str()));
        } else {
            emit_user_call(name.c_str(), parse_user_call_args());
        }
        return;
    }
    for (const Symbol &parameter : current_params) {
        if (parameter.name == name) {
            emit_load_param(parameter.value);
            return;
        }
    }
    if (find_symbol(globals, name.c_str()) >= 0) {
        emit_load_global(name.c_str());
        return;
    }
    failf("unknown identifier `%s`", name.c_str());
}

void Compiler::parse_primary()
{
    if (tok == Token::Number) {
        emit_mov_eax_imm32((long)tok_num);
        next_tok();
        return;
    }
    if (tok == Token::String) {
        emit_mks_literal(tok_text.c_str());
        next_tok();
        return;
    }
    if (tok == Token::LeftParen) {
        next_tok();
        parse_expr();
        expect(Token::RightParen);
        return;
    }
    failf("expected expression");
}

void Compiler::parse_builtin_call(const char *name, int argc)
{
    expect(Token::LeftParen);
    if (strcmp(name, "mks") == 0) {
        if (tok != Token::String) {
            failf("`mks` expects a string literal");
        }
        emit_mks_literal(tok_text.c_str());
        next_tok();
        expect(Token::RightParen);
        return;
    } else if (strcmp(name, "mkC") == 0) {
        if (tok != Token::String) {
            failf("`mkC` expects a string literal");
        }
        emit_mov_eax_imm32((unsigned char)tok_text[0]);
        next_tok();
        expect(Token::RightParen);
        return;
    } else if (argc == 1) {
        parse_expr();
    } else if (argc == 2) {
        parse_expr();
        emit_push_eax();
        expect(Token::Comma);
        parse_expr();
        emit_pop_ebx();
    } else if (argc == 3) {
        parse_expr();
        emit_push_eax();
        expect(Token::Comma);
        parse_expr();
        emit_push_eax();
        expect(Token::Comma);
        parse_expr();
        emit_mov_edx_eax();
        emit_pop_ecx();
        emit_pop_ebx();
    } else {
        failf("unsupported builtin arity");
    }
    expect(Token::RightParen);
    if (argc == 1) {
        emit_builtin1(name);
    } else if (argc == 2) {
        emit_builtin2(name);
    } else {
        emit_builtin3(name);
    }
}

int Compiler::parse_user_call_args()
{
    int argc;
    argc = 0;
    expect(Token::LeftParen);
    if (tok == Token::RightParen) {
        next_tok();
        return 0;
    }
    while (1) {
        parse_expr();
        emit_push_eax();
        argc++;
        if (tok != Token::Comma) {
            break;
        }
        next_tok();
    }
    expect(Token::RightParen);
    emit_reverse_args(argc);
    return argc;
}

int Compiler::builtin_arity(const char *name)
{
    if (strcmp(name, "neg") == 0 || strcmp(name, "NEG") == 0 ||
        strcmp(name, "not") == 0 || strcmp(name, "NOT") == 0 ||
        strcmp(name, "ri32") == 0 || strcmp(name, "ri8") == 0 ||
        strcmp(name, "brk") == 0 || strcmp(name, "close") == 0 ||
        strcmp(name, "exit") == 0 || strcmp(name, "mks") == 0 ||
        strcmp(name, "mkC") == 0) {
        return 1;
    }
    if (strcmp(name, "add") == 0 || strcmp(name, "ADD") == 0 ||
        strcmp(name, "sub") == 0 || strcmp(name, "SUB") == 0 ||
        strcmp(name, "mul") == 0 || strcmp(name, "MUL") == 0 ||
        strcmp(name, "div") == 0 || strcmp(name, "DIV") == 0 ||
        strcmp(name, "mod") == 0 || strcmp(name, "MOD") == 0 ||
        strcmp(name, "eq") == 0 || strcmp(name, "EQ") == 0 ||
        strcmp(name, "ne") == 0 || strcmp(name, "NE") == 0 ||
        strcmp(name, "lt") == 0 || strcmp(name, "LT") == 0 ||
        strcmp(name, "le") == 0 || strcmp(name, "LE") == 0 ||
        strcmp(name, "gt") == 0 || strcmp(name, "GT") == 0 ||
        strcmp(name, "ge") == 0 || strcmp(name, "GE") == 0 ||
        strcmp(name, "and") == 0 || strcmp(name, "AND") == 0 ||
        strcmp(name, "or") == 0 || strcmp(name, "OR") == 0 ||
        strcmp(name, "xor") == 0 || strcmp(name, "XOR") == 0 ||
        strcmp(name, "shl") == 0 || strcmp(name, "SHL") == 0 ||
        strcmp(name, "shr") == 0 || strcmp(name, "SHR") == 0 ||
        strcmp(name, "wi32") == 0 ||
        strcmp(name, "wi8") == 0) {
        return 2;
    }
    if (strcmp(name, "open") == 0 || strcmp(name, "read") == 0 ||
        strcmp(name, "write") == 0) {
        return 3;
    }
    return 0;
}

void Compiler::emit_user_call(const char *name, int argc)
{
    emit1(232);
    const long patch_offset = code_len;
    emit4(0);
    if (argc > 0) {
        emit_add_esp_imm32(4 * argc);
    }
    calls.push_back(PendingCall{name, patch_offset, argc});
}

void Compiler::emit_builtin1(const char *name)
{
    if (strcmp(name, "neg") == 0 || strcmp(name, "NEG") == 0) {
        emit_neg_eax();
    } else if (strcmp(name, "not") == 0 || strcmp(name, "NOT") == 0) {
        emit_not_eax();
    } else if (strcmp(name, "ri32") == 0) {
        emit_read_i32();
    } else if (strcmp(name, "ri8") == 0) {
        emit_read_u8();
    } else if (strcmp(name, "brk") == 0) {
        emit_brk_alloc();
    } else if (strcmp(name, "close") == 0) {
        emit_sys_close();
    } else if (strcmp(name, "exit") == 0) {
        emit_sys_exit();
    } else {
        failf("unknown unary builtin `%s`", name);
    }
}

void Compiler::emit_builtin2(const char *name)
{
    if (strcmp(name, "add") == 0 || strcmp(name, "ADD") == 0) emit_add_eax_ebx();
    else if (strcmp(name, "sub") == 0 || strcmp(name, "SUB") == 0) emit_sub_from_stack_top();
    else if (strcmp(name, "mul") == 0 || strcmp(name, "MUL") == 0) emit_imul_eax_ebx();
    else if (strcmp(name, "div") == 0 || strcmp(name, "DIV") == 0) emit_div_stack_top_by_eax();
    else if (strcmp(name, "mod") == 0 || strcmp(name, "MOD") == 0) emit_mod_stack_top_by_eax();
    else if (strcmp(name, "eq") == 0 || strcmp(name, "EQ") == 0) emit_cmp_set(148);
    else if (strcmp(name, "ne") == 0 || strcmp(name, "NE") == 0) emit_cmp_set(149);
    else if (strcmp(name, "lt") == 0 || strcmp(name, "LT") == 0) emit_cmp_set(156);
    else if (strcmp(name, "le") == 0 || strcmp(name, "LE") == 0) emit_cmp_set(158);
    else if (strcmp(name, "gt") == 0 || strcmp(name, "GT") == 0) emit_cmp_set(159);
    else if (strcmp(name, "ge") == 0 || strcmp(name, "GE") == 0) emit_cmp_set(157);
    else if (strcmp(name, "and") == 0 || strcmp(name, "AND") == 0) emit_and_eax_ebx();
    else if (strcmp(name, "or") == 0 || strcmp(name, "OR") == 0) emit_or_eax_ebx();
    else if (strcmp(name, "xor") == 0 || strcmp(name, "XOR") == 0) emit_xor_eax_ebx();
    else if (strcmp(name, "shl") == 0 || strcmp(name, "SHL") == 0) emit_shl_ebx_by_eax();
    else if (strcmp(name, "shr") == 0 || strcmp(name, "SHR") == 0) emit_shr_ebx_by_eax();
    else if (strcmp(name, "wi32") == 0) emit_write_i32();
    else if (strcmp(name, "wi8") == 0) emit_write_u8();
    else failf("unknown binary builtin `%s`", name);
}

void Compiler::emit_builtin3(const char *name)
{
    if (strcmp(name, "open") == 0) emit_sys_open();
    else if (strcmp(name, "read") == 0) emit_sys_read();
    else if (strcmp(name, "write") == 0) emit_sys_write();
    else failf("unknown ternary builtin `%s`", name);
}

void Compiler::patch_calls()
{
    for (const PendingCall &call : calls) {
        int fi;
        long addr;
        long arity;
        long rel;
        fi = find_symbol(functions, call.target.c_str());
        if (fi < 0) {
            if (output_object) {
                patch4(call.patch_offset, -4);
                record_external(call.target.c_str(), 18);
                record_reloc(call.patch_offset, call.target.c_str(), 2);
                continue;
            }
            failf("call to undefined function `%s`", call.target.c_str());
        }
        addr = functions[static_cast<std::size_t>(fi)].value;
        arity = function_arities[static_cast<std::size_t>(fi)].value;
        if (arity != call.argument_count) {
            failf("function `%s` called with wrong arity", call.target.c_str());
        }
        rel = addr - (call.patch_offset + 4);
        patch4(call.patch_offset, rel);
    }
}

void Compiler::record_external(const char *name, int type)
{
    if (find_symbol(functions, name) >= 0) {
        return;
    }
    for (const Symbol &external : externals) {
        if (external.name == name) {
            return;
        }
    }
    externals.push_back(Symbol{name, static_cast<long>(externals.size())});
    external_types.push_back(type);
}

void Compiler::record_reloc(long offset, const char *name, long type)
{
    relocations.push_back(Relocation{offset, name, type});
}

void Compiler::record_data_patch(long offset, unsigned long addend)
{
    data_patches.push_back(DataPatch{offset, addend});
}

void Compiler::code_reset()
{
    code.clear();
    code.reserve(4096U);
    binbuf.clear();
    binbuf.reserve(4096U);
    data_byte.assign(RuntimeBytes, 0);
    code_len = 0;
    calls.clear();
    globals.clear();
    functions.clear();
    function_arities.clear();
    externals.clear();
    external_types.clear();
    relocations.clear();
    data_patches.clear();
    global_bytes = RuntimeBytes;
    next_data_offset = RuntimeBytes;
    data_used = RuntimeBytes;
    loop_stack.clear();
    next_loop_id = 0;
    break_patches.clear();
}

void Compiler::emit1(unsigned long b)
{
    code.push_back(static_cast<std::uint8_t>(u32(static_cast<long>(b)) & 255U));
    code_len = static_cast<long>(code.size());
}

void Compiler::emit4(long v)
{
    unsigned long n;
    n = u32(v);
    emit1(n & 255U);
    emit1((n >> 8) & 255U);
    emit1((n >> 16) & 255U);
    emit1((n >> 24) & 255U);
}

void Compiler::patch4(long pos, long v)
{
    unsigned long n;
    const std::size_t index = static_cast<std::size_t>(pos);
    n = u32(v);
    code[index] = static_cast<std::uint8_t>(n & 255U);
    code[index + 1] = static_cast<std::uint8_t>((n >> 8) & 255U);
    code[index + 2] = static_cast<std::uint8_t>((n >> 16) & 255U);
    code[index + 3] = static_cast<std::uint8_t>((n >> 24) & 255U);
}

void Compiler::emit_mov_eax_imm32(long v) { emit1(184); emit4(v); }
void Compiler::emit_push_eax() { emit1(80); }
void Compiler::emit_push_ebx() { emit1(83); }
void Compiler::emit_pop_ebx() { emit1(91); }
void Compiler::emit_pop_ecx() { emit1(89); }
void Compiler::emit_load_param(long offset) { emit1(139); emit1(69); emit1(static_cast<unsigned long>(offset)); }
void Compiler::emit_store_param(long offset) { emit1(137); emit1(69); emit1(static_cast<unsigned long>(offset)); }

void Compiler::emit_load_global(const char *name)
{
    long off;
    off = must_find_symbol_value(globals, name, "global");
    emit1(161);
    if (output_object) {
        record_reloc(code_len, name, 1);
        emit4(0);
        return;
    }
    record_data_patch(code_len, (unsigned long)off);
    emit4(0);
}

void Compiler::emit_store_global(const char *name)
{
    long off;
    off = must_find_symbol_value(globals, name, "global");
    emit1(163);
    if (output_object) {
        record_reloc(code_len, name, 1);
        emit4(0);
        return;
    }
    record_data_patch(code_len, (unsigned long)off);
    emit4(0);
}

unsigned long Compiler::register_string(const char *text)
{
    unsigned long start;
    size_t len;
    size_t i;
    len = strlen(text);
    start = next_data_offset;
    ensure_data_capacity((size_t)(start + len + 1U));
    for (i = 0; i < len; i++) {
        data_byte[start + i] = (unsigned char)text[i];
    }
    data_byte[start + len] = 0;
    next_data_offset = start + (unsigned long)len + 1UL;
    if (data_used < next_data_offset) {
        data_used = next_data_offset;
    }
    return start;
}

void Compiler::emit_mks_literal(const char *text)
{
    unsigned long off;
    off = register_string(text);
    emit1(184);
    if (output_object) {
        record_reloc(code_len, ".data", 1);
        emit4((long)off);
        return;
    }
    record_data_patch(code_len, off);
    emit4(0);
}

void Compiler::emit_prologue() { emit1(85); emit1(137); emit1(229); emit_push_ebx(); }
void Compiler::emit_epilogue() { emit1(139); emit1(93); emit1(252); emit1(137); emit1(236); emit1(93); emit1(195); }
void Compiler::emit_test_eax_eax() { emit1(133); emit1(192); }

void Compiler::emit_start()
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

void Compiler::emit_add_esp_imm32(long v) { emit1(129); emit1(196); emit4(v); }
void Compiler::emit_mov_eax_esp() { emit1(137); emit1(224); }
void Compiler::emit_mov_ebx_ptr_esp() { emit1(139); emit1(28); emit1(36); }
void Compiler::emit_mov_eax_stack_disp32(long disp) { emit1(139); emit1(132); emit1(36); emit4(disp); }
void Compiler::emit_mov_ebx_stack_disp32(long disp) { emit1(139); emit1(156); emit1(36); emit4(disp); }
void Compiler::emit_mov_stack_disp32_ebx(long disp) { emit1(137); emit1(156); emit1(36); emit4(disp); }
void Compiler::emit_mov_stack_disp32_eax(long disp) { emit1(137); emit1(132); emit1(36); emit4(disp); }

void Compiler::emit_reverse_args(int argc)
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
long Compiler::emit_je_placeholder() { emit1(15); emit1(132); { long p = code_len; emit4(0); return p; } }
long Compiler::emit_jne_placeholder() { emit1(15); emit1(133); { long p = code_len; emit4(0); return p; } }
long Compiler::emit_jmp_placeholder() { emit1(233); { long p = code_len; emit4(0); return p; } }
void Compiler::emit_jmp(long target) { long p = emit_jmp_placeholder(); patch_rel32(p, target); }
void Compiler::patch_rel32(long pos, long target) { patch4(pos, target - (pos + 4)); }
void Compiler::emit_add_eax_imm32(long v) { emit1(5); emit4(v); }
void Compiler::emit_mov_ebx_eax() { emit1(137); emit1(195); }
void Compiler::emit_mov_edx_eax() { emit1(137); emit1(194); }
void Compiler::emit_mov_ebx_ecx() { emit1(137); emit1(203); }
void Compiler::emit_mov_eax_ecx() { emit1(137); emit1(200); }
void Compiler::emit_xor_ebx_ebx() { emit1(49); emit1(219); }
void Compiler::emit_xor_eax_eax() { emit1(49); emit1(192); }
void Compiler::emit_add_ebx_edx() { emit1(1); emit1(211); }
void Compiler::emit_cmp_eax_ebx() { emit1(57); emit1(216); }
void Compiler::emit_int_80() { emit1(205); emit1(128); }
void Compiler::emit_add_eax_ebx() { emit1(1); emit1(216); }
void Compiler::emit_and_eax_ebx() { emit1(33); emit1(216); }
void Compiler::emit_or_eax_ebx() { emit1(9); emit1(216); }
void Compiler::emit_xor_eax_ebx() { emit1(49); emit1(216); }
void Compiler::emit_shl_ebx_by_eax() { emit1(137); emit1(193); emit1(211); emit1(227); emit1(137); emit1(216); }
void Compiler::emit_shr_ebx_by_eax() { emit1(137); emit1(193); emit1(211); emit1(235); emit1(137); emit1(216); }

void Compiler::emit_sub_from_stack_top()
{
    emit1(137); emit1(193); emit1(137); emit1(216); emit1(41); emit1(200);
}

void Compiler::emit_imul_eax_ebx() { emit1(15); emit1(175); emit1(195); }

void Compiler::emit_div_stack_top_by_eax()
{
    emit1(137); emit1(193); emit1(137); emit1(216); emit1(153); emit1(247); emit1(249);
}

void Compiler::emit_mod_stack_top_by_eax()
{
    emit1(137); emit1(193); emit1(137); emit1(216); emit1(153); emit1(247); emit1(249); emit1(137); emit1(208);
}

void Compiler::emit_cmp_set(int opcode)
{
    emit1(57); emit1(195); emit1(15); emit1((unsigned long)opcode); emit1(192); emit1(15); emit1(182); emit1(192);
}

void Compiler::emit_neg_eax() { emit1(247); emit1(216); }

void Compiler::emit_not_eax()
{
    emit1(133); emit1(192); emit1(15); emit1(148); emit1(192); emit1(15); emit1(182); emit1(192);
}

void Compiler::emit_read_i32() { emit1(139); emit1(0); }
void Compiler::emit_read_u8() { emit1(15); emit1(182); emit1(0); }
void Compiler::emit_write_i32() { emit1(137); emit1(3); }

void Compiler::emit_write_u8()
{
    emit1(136); emit1(3); emit1(15); emit1(182); emit1(192);
}

void Compiler::emit_brk_alloc()
{
    long init_skip;
    long fail_patch;
    long done_patch;

    emit_mov_edx_eax();
    emit1(161);
    record_data_patch(code_len, BrkCurrentOffset);
    emit4(0);
    emit_test_eax_eax();
    init_skip = emit_jne_placeholder();
    emit_mov_eax_imm32(45);
    emit_xor_ebx_ebx();
    emit_int_80();
    emit1(163);
    record_data_patch(code_len, BrkCurrentOffset);
    emit4(0);
    patch_rel32(init_skip, code_len);
    emit1(139);
    emit1(13);
    record_data_patch(code_len, BrkCurrentOffset);
    emit4(0);
    emit_mov_ebx_ecx();
    emit_add_ebx_edx();
    emit_mov_eax_imm32(45);
    emit_int_80();
    emit_cmp_eax_ebx();
    fail_patch = emit_jne_placeholder();
    emit1(137);
    emit1(29);
    record_data_patch(code_len, BrkCurrentOffset);
    emit4(0);
    emit_mov_eax_ecx();
    done_patch = emit_jmp_placeholder();
    patch_rel32(fail_patch, code_len);
    emit_xor_eax_eax();
    patch_rel32(done_patch, code_len);
}

void Compiler::emit_sys_open() { emit_mov_eax_imm32(5); emit_int_80(); }
void Compiler::emit_sys_read() { emit_mov_eax_imm32(3); emit_int_80(); }
void Compiler::emit_sys_write() { emit_mov_eax_imm32(4); emit_int_80(); }

void Compiler::emit_sys_close()
{
    emit_mov_ebx_eax();
    emit_mov_eax_imm32(6);
    emit_int_80();
}

void Compiler::emit_sys_exit()
{
    emit_mov_ebx_eax();
    emit_mov_eax_imm32(1);
    emit_int_80();
}

void Compiler::bin_reset()
{
    binbuf.clear();
    binbuf.reserve(4096U);
    bin_len = 0;
}

void Compiler::bout1(unsigned long b)
{
    binbuf.push_back(static_cast<std::uint8_t>(u32(static_cast<long>(b)) & 255U));
    bin_len = static_cast<long>(binbuf.size());
}

void Compiler::bout2(unsigned long v)
{
    bout1(v & 255U);
    bout1((v >> 8) & 255U);
}

void Compiler::bout4(long v)
{
    unsigned long n;
    n = u32(v);
    bout1(n & 255U);
    bout1((n >> 8) & 255U);
    bout1((n >> 16) & 255U);
    bout1((n >> 24) & 255U);
}

void Compiler::boutstr(const char *s)
{
    while (*s) {
        bout1((unsigned char)*s);
        s++;
    }
}

void Compiler::pad_to(unsigned long n)
{
    while ((unsigned long)bin_len < n) {
        bout1(0);
    }
}

unsigned long Compiler::align4(unsigned long n)
{
    return ((n + 3UL) / 4UL) * 4UL;
}

void Compiler::build_binary()
{
    unsigned long base;
    unsigned long ehsize;
    unsigned long phsize;
    unsigned long headers;
    unsigned long entry;
    unsigned long filesz;
    unsigned long memsz;
    unsigned long flags;
    unsigned long data_off;
    unsigned long data_base;
    long rel;
    int main_index;

    base = 134512640UL;
    ehsize = 52UL;
    phsize = 32UL;
    headers = ehsize + phsize;
    entry = base + headers;
    data_off = align4(headers + (unsigned long)code_len);
    data_base = base + data_off;
    filesz = data_off + data_used;
    memsz = filesz;
    flags = 7UL;

    main_index = find_symbol(functions, "main");
    if (main_index < 0) {
        failf("missing `main` function");
    }
    rel = functions[static_cast<std::size_t>(main_index)].value - (start_call_patch + 4);
    patch4(start_call_patch, rel);
    for (const DataPatch &patch : data_patches) {
        patch4(patch.offset, static_cast<long>(data_base + patch.addend));
    }

    bin_reset();
    bout1(127); bout1(69); bout1(76); bout1(70);
    bout1(1); bout1(1); bout1(1); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout1(0); bout1(0); bout1(0); bout1(0);
    bout2(2); bout2(3); bout4(1); bout4((long)entry); bout4((long)ehsize); bout4(0); bout4(0);
    bout2(ehsize); bout2(phsize); bout2(1); bout2(0); bout2(0); bout2(0);
    bout4(1); bout4(0); bout4((long)base); bout4((long)base); bout4((long)filesz); bout4((long)memsz); bout4((long)flags); bout4(4096);

    for (std::uint8_t byte : code) {
        bout1(byte);
    }
    pad_to(data_off);
    for (std::size_t i = 0; i < data_used; ++i) {
        bout1(data_byte[i]);
    }
}

void Compiler::build_object()
{
    unsigned long ehsize;
    unsigned long shentsize;
    unsigned long shnum;
    unsigned long shstrndx;
    unsigned long text_off;
    unsigned long data_off;
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
    long start;
    long next_start;
    long size;
    int i;
    int si;
    const int function_count = static_cast<int>(functions.size());
    const int global_count = static_cast<int>(globals.size());
    const int external_count = static_cast<int>(externals.size());
    const std::size_t named_symbol_count =
        functions.size() + globals.size() + externals.size();
    std::vector<unsigned long> sym_name_off(named_symbol_count);
    std::vector<unsigned long> sym_index(named_symbol_count);
    const auto index_of = [](int index) { return static_cast<std::size_t>(index); };

    ehsize = 52UL;
    shentsize = 40UL;
    shnum = 8UL;
    shstrndx = 7UL;
    strtab_size = 1UL;
    for (i = 0; i < function_count; i++) {
        sym_index[index_of(i)] = (unsigned long)i + 2UL;
        sym_name_off[index_of(i)] = strtab_size;
        strtab_size += static_cast<unsigned long>(functions[static_cast<std::size_t>(i)].name.size()) + 1UL;
    }
    for (i = 0; i < global_count; i++) {
        sym_index[index_of(function_count + i)] = (unsigned long)function_count + (unsigned long)i + 2UL;
        sym_name_off[index_of(function_count + i)] = strtab_size;
        strtab_size += static_cast<unsigned long>(globals[static_cast<std::size_t>(i)].name.size()) + 1UL;
    }
    for (i = 0; i < external_count; i++) {
        sym_index[index_of(function_count + global_count + i)] = (unsigned long)function_count + (unsigned long)global_count + (unsigned long)i + 2UL;
        sym_name_off[index_of(function_count + global_count + i)] = strtab_size;
        strtab_size += static_cast<unsigned long>(externals[static_cast<std::size_t>(i)].name.size()) + 1UL;
    }
    shstrtab_size = 54UL;
    sym_count = (unsigned long)function_count + (unsigned long)global_count + (unsigned long)external_count + 2UL;
    symtab_size = sym_count * 16UL;
    rel_size = static_cast<unsigned long>(relocations.size()) * 8UL;

    text_off = ehsize;
    data_off = align4(text_off + (unsigned long)code_len);
    rel_off = align4(data_off + data_used);
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

    for (std::uint8_t byte : code) {
        bout1(byte);
    }

    pad_to(data_off);
    for (std::size_t data_index = 0; data_index < data_used; ++data_index) {
        bout1(data_byte[data_index]);
    }

    pad_to(rel_off);
    for (const Relocation &relocation : relocations) {
        if (relocation.symbol == ".data") {
            bout4(relocation.offset);
            bout4(static_cast<long>(1UL * 256UL + static_cast<unsigned long>(relocation.type)));
            continue;
        }
        si = find_symbol(functions, relocation.symbol.c_str());
        if (si >= 0) {
            bout4(relocation.offset);
            bout4(static_cast<long>(sym_index[index_of(si)] * 256UL + static_cast<unsigned long>(relocation.type)));
            continue;
        }
        si = find_symbol(globals, relocation.symbol.c_str());
        if (si >= 0) {
            bout4(relocation.offset);
            bout4(static_cast<long>(sym_index[index_of(function_count + si)] * 256UL + static_cast<unsigned long>(relocation.type)));
            continue;
        }
        si = find_symbol(externals, relocation.symbol.c_str());
        if (si < 0) {
            failf("relocation references unknown symbol `%s`", relocation.symbol.c_str());
        }
        bout4(relocation.offset);
        bout4(static_cast<long>(sym_index[index_of(function_count + global_count + si)] * 256UL + static_cast<unsigned long>(relocation.type)));
    }

    pad_to(symtab_off);

    for (i = 0; i < 16; i++) {
        bout1(0);
    }
    bout4(0);
    bout4(0);
    bout4((long)data_used);
    bout1(3);
    bout1(0);
    bout2(3);
    for (i = 0; i < function_count; i++) {
        start = functions[static_cast<std::size_t>(i)].value;
        if (i + 1 < function_count) {
            next_start = functions[static_cast<std::size_t>(i + 1)].value;
        } else {
            next_start = code_len;
        }
        size = next_start - start;
        bout4((long)sym_name_off[index_of(i)]);
        bout4(start);
        bout4(size);
        bout1(18);
        bout1(0);
        bout2(1);
    }
    for (i = 0; i < global_count; i++) {
        bout4((long)sym_name_off[index_of(function_count + i)]);
        bout4(4);
        bout4(4);
        bout1(17);
        bout1(0);
        bout2(65522);
    }
    for (i = 0; i < external_count; i++) {
        bout4((long)sym_name_off[index_of(function_count + global_count + i)]);
        bout4(0);
        bout4(0);
        bout1(static_cast<unsigned long>(external_types[static_cast<std::size_t>(i)]));
        bout1(0);
        bout2(0);
    }

    bout1(0);
    for (i = 0; i < function_count; i++) {
        boutstr(functions[static_cast<std::size_t>(i)].name.c_str());
        bout1(0);
    }
    for (i = 0; i < global_count; i++) {
        boutstr(globals[static_cast<std::size_t>(i)].name.c_str());
        bout1(0);
    }
    for (i = 0; i < external_count; i++) {
        boutstr(externals[static_cast<std::size_t>(i)].name.c_str());
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
    bout4(17); bout4(1); bout4(3); bout4(0); bout4((long)data_off); bout4((long)data_used); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(23); bout4(8); bout4(3); bout4(0); bout4((long)(data_off + data_used)); bout4(0); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(28); bout4(2); bout4(0); bout4(0); bout4((long)symtab_off); bout4((long)symtab_size); bout4(6); bout4(2); bout4(4); bout4(16);
    bout4(36); bout4(3); bout4(0); bout4(0); bout4((long)strtab_off); bout4((long)strtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
    bout4(44); bout4(3); bout4(0); bout4(0); bout4((long)shstrtab_off); bout4((long)shstrtab_size); bout4(0); bout4(0); bout4(1); bout4(0);
}

void Compiler::emit_binary()
{
    std::ofstream output_file;
    std::ostream *output = &std::cout;
    if (!output_path.empty()) {
        output_file.open(output_path, std::ios::binary);
        output = &output_file;
    }
    output->write(reinterpret_cast<const char *>(binbuf.data()),
                  static_cast<std::streamsize>(binbuf.size()));
    if (!*output) {
        fprintf(stderr, "write failed\n");
        exit(1);
    }
}

int Compiler::push_loop()
{
    const int id = ++next_loop_id;
    loop_stack.push_back(id);
    return id;
}

void Compiler::pop_loop()
{
    if (!loop_stack.empty()) {
        loop_stack.pop_back();
    }
}

void Compiler::record_break(int loop_id, long patch_pos)
{
    break_patches.push_back(BreakPatch{loop_id, patch_pos});
}

void Compiler::patch_breaks(int loop_id, long target)
{
    for (const BreakPatch &patch : break_patches) {
        if (patch.loop_id == loop_id) {
            patch_rel32(patch.offset, target);
        }
    }
}

std::string Compiler::read_file(const char *path)
{
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        fprintf(stderr, "cannot open %s\n", path);
        exit(1);
    }
    std::string contents(std::istreambuf_iterator<char>{input},
                         std::istreambuf_iterator<char>{});
    if (input.bad()) {
        fprintf(stderr, "read failed\n");
        exit(1);
    }
    contents.push_back('\n');
    return contents;
}

int Compiler::run(int argc, char **argv)
{
    const char *source_path;
    int argi;

    output_object = false;
    output_path.clear();
    source_path = 0;
    argi = 1;
    while (argi < argc) {
        if (strcmp(argv[argi], "-c") == 0) {
            output_object = true;
        } else if (strcmp(argv[argi], "-o") == 0) {
            argi++;
            if (argi >= argc) {
                fprintf(stderr, "usage: %s [-c] [-o output] source\n", argv[0]);
                return 1;
            }
            output_path = argv[argi];
        } else {
            if (source_path) {
                fprintf(stderr, "usage: %s [-c] [-o output] source\n", argv[0]);
                return 1;
            }
            source_path = argv[argi];
        }
        argi++;
    }
    if (!source_path) {
        fprintf(stderr, "usage: %s [-c] [-o output] source\n", argv[0]);
        return 1;
    }

    tok_text.clear();
    src = read_file(source_path);
    src_len = src.size();
    init_lexer();
    code_reset();
    next_tok();
    if (!output_object) {
        emit_start();
    }
    parse_program();
    expect(Token::Eof);
    patch_calls();
    if (output_object) {
        build_object();
    } else {
        build_binary();
    }
    emit_binary();
    return 0;
}

int main(int argc, char **argv)
{
    Compiler compiler{};
    return compiler.run(argc, argv);
}
