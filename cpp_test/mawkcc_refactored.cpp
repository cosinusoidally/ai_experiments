#include <algorithm>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "byte_writer.hpp"
#include "compiler_state.hpp"
#include "elf32_builder.hpp"
#include "lexer.hpp"
#include "mawkcc_refactored.hpp"
#include "mawkcc_types.hpp"
#include "x86_emitter.hpp"

using mawkcc::ArgumentCount;
using mawkcc::CodeOffset;
using mawkcc::DataOffset;
using mawkcc::DataPatch;
using mawkcc::ElfSymbolType;
using mawkcc::ExternalSymbol;
using mawkcc::FixupTable;
using mawkcc::FunctionSymbol;
using mawkcc::GlobalSymbol;
using mawkcc::LexToken;
using mawkcc::Lexer;
using mawkcc::LexerError;
using mawkcc::LoopId;
using mawkcc::OutputKind;
using mawkcc::Parameter;
using mawkcc::ParameterScope;
using mawkcc::PendingCall;
using mawkcc::Relocation;
using mawkcc::RelocationType;
using mawkcc::SymbolTable;
using mawkcc::StaticData;
using mawkcc::TargetWord;
using mawkcc::TokenKind;
using mawkcc::token_name;
using mawkcc::X86Emitter;
using mawkcc::X86Condition;

mawkcc::CompileError::CompileError(
    std::string message, std::size_t offset,
    std::size_t line, std::size_t column)
    : std::runtime_error(std::move(message)),
      offset_(offset), line_(line), column_(column)
{
}

std::size_t mawkcc::CompileError::offset() const noexcept { return offset_; }
std::size_t mawkcc::CompileError::line() const noexcept { return line_; }
std::size_t mawkcc::CompileError::column() const noexcept { return column_; }

enum class Builtin {
    Neg, Not, ReadI32, ReadU8, Brk, Close, Exit, MakeString, MakeChar,
    Add, Sub, Mul, Div, Mod, Equal, NotEqual, Less, LessEqual, Greater,
    GreaterEqual, And, Or, Xor, ShiftLeft, ShiftRight, WriteI32, WriteI8,
    Open, Read, Write,
};

struct BuiltinDescriptor {
    std::string_view spelling;
    Builtin operation;
    ArgumentCount arity;
};

constexpr BuiltinDescriptor Builtins[] = {
    {"neg", Builtin::Neg, 1}, {"NEG", Builtin::Neg, 1},
    {"not", Builtin::Not, 1}, {"NOT", Builtin::Not, 1},
    {"ri32", Builtin::ReadI32, 1}, {"ri8", Builtin::ReadU8, 1},
    {"brk", Builtin::Brk, 1}, {"close", Builtin::Close, 1},
    {"exit", Builtin::Exit, 1}, {"mks", Builtin::MakeString, 1},
    {"mkC", Builtin::MakeChar, 1},
    {"add", Builtin::Add, 2}, {"ADD", Builtin::Add, 2},
    {"sub", Builtin::Sub, 2}, {"SUB", Builtin::Sub, 2},
    {"mul", Builtin::Mul, 2}, {"MUL", Builtin::Mul, 2},
    {"div", Builtin::Div, 2}, {"DIV", Builtin::Div, 2},
    {"mod", Builtin::Mod, 2}, {"MOD", Builtin::Mod, 2},
    {"eq", Builtin::Equal, 2}, {"EQ", Builtin::Equal, 2},
    {"ne", Builtin::NotEqual, 2}, {"NE", Builtin::NotEqual, 2},
    {"lt", Builtin::Less, 2}, {"LT", Builtin::Less, 2},
    {"le", Builtin::LessEqual, 2}, {"LE", Builtin::LessEqual, 2},
    {"gt", Builtin::Greater, 2}, {"GT", Builtin::Greater, 2},
    {"ge", Builtin::GreaterEqual, 2}, {"GE", Builtin::GreaterEqual, 2},
    {"and", Builtin::And, 2}, {"AND", Builtin::And, 2},
    {"or", Builtin::Or, 2}, {"OR", Builtin::Or, 2},
    {"xor", Builtin::Xor, 2}, {"XOR", Builtin::Xor, 2},
    {"shl", Builtin::ShiftLeft, 2}, {"SHL", Builtin::ShiftLeft, 2},
    {"shr", Builtin::ShiftRight, 2}, {"SHR", Builtin::ShiftRight, 2},
    {"wi32", Builtin::WriteI32, 2}, {"wi8", Builtin::WriteI8, 2},
    {"open", Builtin::Open, 3}, {"read", Builtin::Read, 3},
    {"write", Builtin::Write, 3},
};

const BuiltinDescriptor *find_builtin(std::string_view name)
{
    for (const BuiltinDescriptor &builtin : Builtins) {
        if (builtin.spelling == name) {
            return &builtin;
        }
    }
    return nullptr;
}

class Compiler {
public:
    std::vector<std::uint8_t> compile(
        std::string_view source, OutputKind output_kind);

private:
    std::string_view src;
    Lexer lexer;
    LexToken current_token;

    X86Emitter x86;
    StaticData static_data;

    SymbolTable symbols;

    ParameterScope parameters;

    FixupTable fixups;

    std::vector<LoopId> loop_stack;
    LoopId next_loop_id = 0;

    CodeOffset start_call_patch = 0;
    OutputKind output_kind = OutputKind::Executable;

    [[noreturn]] void fail(std::string message);
    void init_lexer();
    void next_tok();
    void expect(TokenKind want);
    void parse_program();
    void parse_global();
    void parse_function();
    void parse_stmt();
    void parse_block();
    void parse_if();
    void parse_while();
    void parse_break();
    void parse_expr();
    void parse_assign_or_primary();
    void parse_primary();
    void parse_builtin_call(const BuiltinDescriptor &builtin);
    ArgumentCount parse_user_call_args();
    void emit_user_call(std::string_view name, ArgumentCount argument_count);
    void emit_builtin(Builtin operation);
    void patch_calls();
    void record_external(std::string_view name, ElfSymbolType type);
    void record_reloc(CodeOffset offset, std::string_view name, RelocationType type);
    void record_data_patch(CodeOffset offset, DataOffset addend);
    void reset_compilation();
    void emit_load_global(std::string_view name);
    void emit_store_global(std::string_view name);
    void emit_mks_literal(std::string_view text);
    void emit_brk_alloc();
    std::vector<std::uint8_t> build_binary();
    std::vector<std::uint8_t> build_object();
    LoopId push_loop();
    void pop_loop();
    void record_break(LoopId loop_id, CodeOffset patch_pos);
    void patch_breaks(LoopId loop_id, CodeOffset target);
    const GlobalSymbol &require_global(std::string_view name);
    [[nodiscard]] bool is_object() const noexcept;
};

[[noreturn]] void Compiler::fail(std::string message)
{
    const std::size_t source_end =
        std::min(src.size(), current_token.offset + static_cast<std::size_t>(40));
    std::size_t source_index = current_token.offset;
    std::string excerpt;
    excerpt.reserve(64);
    while (source_index < source_end && excerpt.size() < 62U) {
        const char ch = src[source_index++];
        if (ch == '\n') {
            if (excerpt.size() + 2U > 62U) {
                break;
            }
            excerpt += "\\n";
        } else {
            excerpt += ch;
        }
    }

    std::size_t line = 1;
    std::size_t column = 1;
    for (std::size_t index = 0;
         index < current_token.offset && index < src.size(); ++index) {
        if (src[index] == '\n') {
            ++line;
            column = 1;
        } else {
            ++column;
        }
    }
    throw mawkcc::CompileError{
        "mawkcc_cpp:" + std::to_string(line) + ":" +
            std::to_string(column) + ": " + std::move(message) + " near `" +
            excerpt + "`",
        current_token.offset, line, column};
}

void Compiler::init_lexer()
{
    lexer.reset(src);
}

void Compiler::next_tok()
{
    try {
        current_token = lexer.next();
    } catch (const LexerError &error) {
        current_token.offset = error.offset();
        fail(error.what());
    }
}

void Compiler::expect(TokenKind want)
{
    if (current_token.kind != want) {
        fail("expected `" + std::string{token_name(want)} + "`, got `" +
             std::string{token_name(current_token.kind)} + "`");
    }
    next_tok();
}

const GlobalSymbol &Compiler::require_global(std::string_view name)
{
    const GlobalSymbol *global = symbols.global(name);
    if (!global) {
        fail("unknown global `" + std::string{name} + "`");
    }
    return *global;
}

void Compiler::parse_program()
{
    while (current_token.kind != TokenKind::Eof) {
        if (current_token.kind == TokenKind::Var) {
            parse_global();
        } else {
            parse_function();
        }
    }
    if (!is_object() && !symbols.function_index("main")) {
        fail("missing `main` function");
    }
}

void Compiler::parse_global()
{
    expect(TokenKind::Var);
    if (current_token.kind != TokenKind::Identifier) {
        fail("expected global name");
    }
    const std::string name = current_token.text;
    next_tok();
    if (current_token.kind == TokenKind::Assign) {
        fail("global `" + name + "` cannot be initialized at declaration time");
    }
    expect(TokenKind::Semicolon);
    if (symbols.global_index(name) || symbols.function_index(name)) {
        fail("duplicate global `" + name + "`");
    }
    if (is_object()) {
        static_cast<void>(symbols.add_global(name, 0));
        return;
    }
    static_cast<void>(symbols.add_global(name, static_data.allocate_global()));
}

void Compiler::parse_function()
{
    std::string name;
    std::vector<std::string> param_names;

    expect(TokenKind::Function);
    if (current_token.kind != TokenKind::Identifier) {
        fail("expected function name");
    }
    name = current_token.text;
    next_tok();
    expect(TokenKind::LeftParen);

    if (current_token.kind != TokenKind::RightParen) {
        while (true) {
            if (current_token.kind != TokenKind::Identifier) {
                fail("expected parameter name");
            }
            for (const std::string &parameter : param_names) {
                if (parameter == current_token.text) {
                    fail("duplicate parameter `" + current_token.text + "`");
                }
            }
            param_names.push_back(current_token.text);
            next_tok();
            if (current_token.kind != TokenKind::Comma) {
                break;
            }
            next_tok();
        }
    }
    expect(TokenKind::RightParen);

    if (symbols.function_index(name)) {
        fail("duplicate function `" + name + "`");
    }
    static_cast<void>(symbols.add_function(
        name, x86.offset(), static_cast<ArgumentCount>(param_names.size())));

    x86.prologue();
    parameters.enter(param_names);
    expect(TokenKind::LeftBrace);
    while (current_token.kind != TokenKind::RightBrace && current_token.kind != TokenKind::Eof) {
        parse_stmt();
    }
    expect(TokenKind::RightBrace);
    x86.mov_eax_immediate(0);
    x86.epilogue();
    parameters.leave();

}

void Compiler::parse_stmt()
{
    if (current_token.kind == TokenKind::LeftBrace) {
        parse_block();
        return;
    }
    if (current_token.kind == TokenKind::Return) {
        next_tok();
        parse_expr();
        expect(TokenKind::Semicolon);
        x86.epilogue();
        return;
    }
    if (current_token.kind == TokenKind::If) {
        parse_if();
        return;
    }
    if (current_token.kind == TokenKind::While) {
        parse_while();
        return;
    }
    if (current_token.kind == TokenKind::Break) {
        parse_break();
        return;
    }
    parse_expr();
    expect(TokenKind::Semicolon);
}

void Compiler::parse_block()
{
    expect(TokenKind::LeftBrace);
    while (current_token.kind != TokenKind::RightBrace && current_token.kind != TokenKind::Eof) {
        parse_stmt();
    }
    expect(TokenKind::RightBrace);
}

void Compiler::parse_if()
{
    CodeOffset false_patch;
    CodeOffset end_patch;
    CodeOffset after_then;
    expect(TokenKind::If);
    expect(TokenKind::LeftParen);
    parse_expr();
    expect(TokenKind::RightParen);
    x86.test_eax();
    false_patch = x86.je_placeholder();
    parse_stmt();
    if (current_token.kind == TokenKind::Else) {
        end_patch = x86.jmp_placeholder();
        after_then = x86.offset();
        x86.patch_relative(false_patch, after_then);
        next_tok();
        parse_stmt();
        x86.patch_relative(end_patch, x86.offset());
    } else {
        x86.patch_relative(false_patch, x86.offset());
    }
}

void Compiler::parse_while()
{
    CodeOffset loop_start;
    CodeOffset exit_patch;
    LoopId loop_id;
    expect(TokenKind::While);
    expect(TokenKind::LeftParen);
    loop_start = x86.offset();
    parse_expr();
    expect(TokenKind::RightParen);
    x86.test_eax();
    exit_patch = x86.je_placeholder();
    loop_id = push_loop();
    record_break(loop_id, exit_patch);
    parse_stmt();
    x86.jump(loop_start);
    x86.patch_relative(exit_patch, x86.offset());
    patch_breaks(loop_id, x86.offset());
    pop_loop();
}

void Compiler::parse_break()
{
    if (loop_stack.empty()) {
        fail("`break` used outside of a loop");
    }
    expect(TokenKind::Break);
    expect(TokenKind::Semicolon);
    record_break(loop_stack.back(), x86.jmp_placeholder());
}

void Compiler::parse_expr()
{
    if (current_token.kind == TokenKind::Identifier) {
        parse_assign_or_primary();
        return;
    }
    parse_primary();
}

void Compiler::parse_assign_or_primary()
{
    const std::string name = current_token.text;
    next_tok();
    if (current_token.kind == TokenKind::Assign) {
        next_tok();
        parse_expr();
        if (const Parameter *parameter = parameters.find(name)) {
            x86.store_parameter(parameter->stack_offset);
            return;
        }
        if (symbols.global_index(name)) {
            emit_store_global(name);
            return;
        }
        fail("assignment target `" + name +
             "` is not a global or parameter");
    }
    if (current_token.kind == TokenKind::LeftParen) {
        if (const BuiltinDescriptor *builtin = find_builtin(name)) {
            parse_builtin_call(*builtin);
        } else {
            emit_user_call(name, parse_user_call_args());
        }
        return;
    }
    if (const Parameter *parameter = parameters.find(name)) {
        x86.load_parameter(parameter->stack_offset);
        return;
    }
    if (symbols.global_index(name)) {
        emit_load_global(name);
        return;
    }
    fail("unknown identifier `" + name + "`");
}

void Compiler::parse_primary()
{
    if (current_token.kind == TokenKind::Number) {
        x86.mov_eax_immediate(current_token.number);
        next_tok();
        return;
    }
    if (current_token.kind == TokenKind::String) {
        emit_mks_literal(current_token.text);
        next_tok();
        return;
    }
    if (current_token.kind == TokenKind::LeftParen) {
        next_tok();
        parse_expr();
        expect(TokenKind::RightParen);
        return;
    }
    fail("expected expression");
}

void Compiler::parse_builtin_call(const BuiltinDescriptor &builtin)
{
    expect(TokenKind::LeftParen);
    if (builtin.operation == Builtin::MakeString) {
        if (current_token.kind != TokenKind::String) {
            fail("`mks` expects a string literal");
        }
        emit_mks_literal(current_token.text);
        next_tok();
        expect(TokenKind::RightParen);
        return;
    } else if (builtin.operation == Builtin::MakeChar) {
        if (current_token.kind != TokenKind::String) {
            fail("`mkC` expects a string literal");
        }
        if (current_token.text.size() != 1) {
            fail("`mkC` expects exactly one character");
        }
        x86.mov_eax_immediate(static_cast<unsigned char>(current_token.text[0]));
        next_tok();
        expect(TokenKind::RightParen);
        return;
    } else if (builtin.arity == 1) {
        parse_expr();
    } else if (builtin.arity == 2) {
        parse_expr();
        x86.push_eax();
        expect(TokenKind::Comma);
        parse_expr();
        x86.pop_ebx();
    } else if (builtin.arity == 3) {
        parse_expr();
        x86.push_eax();
        expect(TokenKind::Comma);
        parse_expr();
        x86.push_eax();
        expect(TokenKind::Comma);
        parse_expr();
        x86.mov_edx_eax();
        x86.pop_ecx();
        x86.pop_ebx();
    } else {
        fail("unsupported builtin arity");
    }
    expect(TokenKind::RightParen);
    emit_builtin(builtin.operation);
}

ArgumentCount Compiler::parse_user_call_args()
{
    ArgumentCount argument_count = 0;
    expect(TokenKind::LeftParen);
    if (current_token.kind == TokenKind::RightParen) {
        next_tok();
        return 0;
    }
    while (true) {
        parse_expr();
        x86.push_eax();
        if (argument_count == std::numeric_limits<ArgumentCount>::max()) {
            fail("too many function arguments");
        }
        ++argument_count;
        if (current_token.kind != TokenKind::Comma) {
            break;
        }
        next_tok();
    }
    expect(TokenKind::RightParen);
    x86.reverse_arguments(argument_count);
    return argument_count;
}

void Compiler::emit_user_call(
    std::string_view name, ArgumentCount argument_count)
{
    const CodeOffset patch_offset = x86.call_placeholder();
    if (argument_count > 0) {
        x86.add_esp(4U * argument_count);
    }
    fixups.add_call(name, patch_offset, argument_count);
}

void Compiler::emit_builtin(Builtin operation)
{
    switch (operation) {
        case Builtin::Neg: x86.negate(); return;
        case Builtin::Not: x86.logical_not(); return;
        case Builtin::ReadI32: x86.read_i32(); return;
        case Builtin::ReadU8: x86.read_u8(); return;
        case Builtin::Brk: emit_brk_alloc(); return;
        case Builtin::Close: x86.sys_close(); return;
        case Builtin::Exit: x86.sys_exit(); return;
        case Builtin::Add: x86.add(); return;
        case Builtin::Sub: x86.subtract(); return;
        case Builtin::Mul: x86.multiply(); return;
        case Builtin::Div: x86.divide(); return;
        case Builtin::Mod: x86.modulo(); return;
        case Builtin::Equal: x86.compare_and_set(X86Condition::Equal); return;
        case Builtin::NotEqual: x86.compare_and_set(X86Condition::NotEqual); return;
        case Builtin::Less: x86.compare_and_set(X86Condition::Less); return;
        case Builtin::LessEqual: x86.compare_and_set(X86Condition::LessEqual); return;
        case Builtin::Greater: x86.compare_and_set(X86Condition::Greater); return;
        case Builtin::GreaterEqual: x86.compare_and_set(X86Condition::GreaterEqual); return;
        case Builtin::And: x86.bit_and(); return;
        case Builtin::Or: x86.bit_or(); return;
        case Builtin::Xor: x86.bit_xor(); return;
        case Builtin::ShiftLeft: x86.shift_left(); return;
        case Builtin::ShiftRight: x86.shift_right(); return;
        case Builtin::WriteI32: x86.write_i32(); return;
        case Builtin::WriteI8: x86.write_u8(); return;
        case Builtin::Open: x86.sys_open(); return;
        case Builtin::Read: x86.sys_read(); return;
        case Builtin::Write: x86.sys_write(); return;
        case Builtin::MakeString:
        case Builtin::MakeChar:
            fail("literal builtin reached runtime dispatch");
    }
    fail("unknown builtin operation");
}

void Compiler::patch_calls()
{
    for (const PendingCall &call : fixups.calls()) {
        const auto function_index = symbols.function_index(call.target);
        if (!function_index) {
            if (is_object()) {
                x86.patch_word(call.patch_offset, static_cast<TargetWord>(-4));
                record_external(call.target, ElfSymbolType::Function);
                record_reloc(call.patch_offset, call.target,
                             RelocationType::PcRelative32);
                continue;
            }
            fail("call to undefined function `" + call.target + "`");
        }
        const FunctionSymbol &function = symbols.functions()[*function_index];
        if (function.arity != call.argument_count) {
            fail("function `" + call.target + "` called with wrong arity");
        }
        x86.patch_relative(call.patch_offset, function.code_offset);
    }
}

void Compiler::record_external(std::string_view name, ElfSymbolType type)
{
    symbols.record_external(name, type);
}

void Compiler::record_reloc(
    CodeOffset offset, std::string_view name, RelocationType type)
{
    fixups.add_relocation(offset, name, type);
}

void Compiler::record_data_patch(CodeOffset offset, DataOffset addend)
{
    fixups.add_data_patch(offset, addend);
}

void Compiler::reset_compilation()
{
    x86.reset();
    static_data.reset();
    symbols.reset();
    fixups.reset();
    parameters.leave();
    loop_stack.clear();
    next_loop_id = 0;
}

void Compiler::emit_load_global(std::string_view name)
{
    const DataOffset offset = require_global(name).data_offset;
    const CodeOffset operand = x86.load_eax_absolute();
    if (is_object()) {
        record_reloc(operand, name, RelocationType::Absolute32);
        return;
    }
    record_data_patch(operand, offset);
}

void Compiler::emit_store_global(std::string_view name)
{
    const DataOffset offset = require_global(name).data_offset;
    const CodeOffset operand = x86.store_eax_absolute();
    if (is_object()) {
        record_reloc(operand, name, RelocationType::Absolute32);
        return;
    }
    record_data_patch(operand, offset);
}

void Compiler::emit_mks_literal(std::string_view text)
{
    const DataOffset offset = static_data.add_string(text.substr(0, text.find('\0')));
    const CodeOffset operand = x86.mov_eax_immediate(
        is_object() ? static_cast<TargetWord>(offset) : 0U);
    if (is_object()) {
        record_reloc(operand, ".data", RelocationType::Absolute32);
        return;
    }
    record_data_patch(operand, offset);
}

void Compiler::emit_brk_alloc()
{
    CodeOffset init_skip;
    CodeOffset fail_patch;
    CodeOffset done_patch;

    x86.mov_edx_eax();
    record_data_patch(
        x86.load_eax_absolute(), StaticData::BreakPointerOffset);
    x86.test_eax();
    init_skip = x86.jne_placeholder();
    x86.mov_eax_immediate(45);
    x86.xor_ebx();
    x86.interrupt_80();
    record_data_patch(
        x86.store_eax_absolute(), StaticData::BreakPointerOffset);
    x86.patch_relative(init_skip, x86.offset());
    record_data_patch(
        x86.load_ecx_absolute(), StaticData::BreakPointerOffset);
    x86.mov_ebx_ecx();
    x86.add_ebx_edx();
    x86.mov_eax_immediate(45);
    x86.interrupt_80();
    x86.cmp_eax_ebx();
    fail_patch = x86.jne_placeholder();
    record_data_patch(
        x86.store_ebx_absolute(), StaticData::BreakPointerOffset);
    x86.mov_eax_ecx();
    done_patch = x86.jmp_placeholder();
    x86.patch_relative(fail_patch, x86.offset());
    x86.xor_eax();
    x86.patch_relative(done_patch, x86.offset());
}

std::vector<std::uint8_t> Compiler::build_binary()
{
    const mawkcc::ExecutableLayout layout =
        mawkcc::calculate_executable_layout(x86.offset(), static_data.size());
    const auto main_index = symbols.function_index("main");
    if (!main_index) {
        fail("missing `main` function");
    }
    x86.patch_relative(
        start_call_patch, symbols.functions()[*main_index].code_offset);
    for (const DataPatch &patch : fixups.data_patches()) {
        x86.patch_word(patch.offset, layout.data_address + patch.addend);
    }
    return mawkcc::build_elf32_executable(
        x86.bytes(), static_data.bytes(), static_data.size(), layout);
}

std::vector<std::uint8_t> Compiler::build_object()
{
    return mawkcc::build_elf32_object(
        x86.bytes(), static_data.bytes(), static_data.size(), symbols, fixups);
}

LoopId Compiler::push_loop()
{
    const LoopId id = ++next_loop_id;
    loop_stack.push_back(id);
    return id;
}

void Compiler::pop_loop()
{
    if (!loop_stack.empty()) {
        loop_stack.pop_back();
    }
}

void Compiler::record_break(LoopId loop_id, CodeOffset patch_pos)
{
    fixups.add_break(loop_id, patch_pos);
}

void Compiler::patch_breaks(LoopId loop_id, CodeOffset target)
{
    for (const auto &patch : fixups.break_patches()) {
        if (patch.loop_id == loop_id) {
            x86.patch_relative(patch.offset, target);
        }
    }
}

bool Compiler::is_object() const noexcept
{
    return output_kind == OutputKind::RelocatableObject;
}

std::vector<std::uint8_t> Compiler::compile(
    std::string_view source, OutputKind requested_output_kind)
{
    src = source;
    output_kind = requested_output_kind;
    init_lexer();
    reset_compilation();
    next_tok();
    if (!is_object()) {
        start_call_patch = x86.start();
    }
    parse_program();
    expect(TokenKind::Eof);
    patch_calls();
    return is_object() ? build_object() : build_binary();
}

std::vector<std::uint8_t> mawkcc::compile(
    std::string_view source, OutputKind output_kind)
{
    Compiler compiler;
    return compiler.compile(source, output_kind);
}
