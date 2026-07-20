#include "lexer.hpp"

#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void require(bool condition, const char *message)
{
    if (!condition) {
        throw std::runtime_error{message};
    }
}

} // namespace

int main()
{
    try {
        mawkcc::Lexer lexer;
        lexer.reset("/* lead */ function name(arg) { // line\n return mkC(\"\\n\"); }");
        require(lexer.next().kind == mawkcc::TokenKind::Function,
                "function keyword was not recognized");
        const auto name = lexer.next();
        require(name.kind == mawkcc::TokenKind::Identifier && name.text == "name",
                "identifier was not recognized");
        require(lexer.next().kind == mawkcc::TokenKind::LeftParen,
                "left parenthesis was not recognized");
        require(lexer.next().text == "arg", "parameter was not recognized");
        require(lexer.next().kind == mawkcc::TokenKind::RightParen,
                "right parenthesis was not recognized");
        require(lexer.next().kind == mawkcc::TokenKind::LeftBrace,
                "left brace was not recognized");
        require(lexer.next().kind == mawkcc::TokenKind::Return,
                "return keyword was not recognized");
        require(lexer.next().text == "mkC", "builtin identifier was not recognized");
        require(lexer.next().kind == mawkcc::TokenKind::LeftParen,
                "builtin parenthesis was not recognized");
        const auto string = lexer.next();
        require(string.kind == mawkcc::TokenKind::String && string.text == "\n",
                "string escape was not decoded");

        lexer.reset("4294967296");
        bool rejected_overflow = false;
        try {
            static_cast<void>(lexer.next());
        } catch (const mawkcc::LexerError &error) {
            rejected_overflow = error.offset() == 0;
        }
        require(rejected_overflow, "32-bit integer overflow was accepted");

        lexer.reset("/* unterminated");
        bool rejected_comment = false;
        try {
            static_cast<void>(lexer.next());
        } catch (const mawkcc::LexerError &error) {
            rejected_comment = error.offset() == 0;
        }
        require(rejected_comment, "unterminated comment was accepted");
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    return 0;
}
