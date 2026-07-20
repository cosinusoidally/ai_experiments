#include "lexer.hpp"
#include "test_support.hpp"

#include <stdexcept>
#include <string>

int main()
{
    return test_support::run([] {
        mawkcc::Lexer lexer;
        lexer.reset("/* lead */ function name(arg) { // line\n return mkC(\"\\n\"); }");
        test_support::require(
            lexer.next().kind == mawkcc::TokenKind::Function,
            "function keyword was not recognized");
        const auto name = lexer.next();
        test_support::require(
            name.kind == mawkcc::TokenKind::Identifier && name.text == "name",
            "identifier was not recognized");
        test_support::require(
            lexer.next().kind == mawkcc::TokenKind::LeftParen,
            "left parenthesis was not recognized");
        test_support::require(
            lexer.next().text == "arg", "parameter was not recognized");
        test_support::require(
            lexer.next().kind == mawkcc::TokenKind::RightParen,
            "right parenthesis was not recognized");
        test_support::require(
            lexer.next().kind == mawkcc::TokenKind::LeftBrace,
            "left brace was not recognized");
        test_support::require(
            lexer.next().kind == mawkcc::TokenKind::Return,
            "return keyword was not recognized");
        test_support::require(
            lexer.next().text == "mkC", "builtin identifier was not recognized");
        test_support::require(
            lexer.next().kind == mawkcc::TokenKind::LeftParen,
            "builtin parenthesis was not recognized");
        const auto string = lexer.next();
        test_support::require(
            string.kind == mawkcc::TokenKind::String && string.text == "\n",
            "string escape was not decoded");

        lexer.reset("4294967296");
        bool rejected_overflow = false;
        try {
            static_cast<void>(lexer.next());
        } catch (const mawkcc::LexerError &error) {
            rejected_overflow = error.offset() == 0;
        }
        test_support::require(
            rejected_overflow, "32-bit integer overflow was accepted");

        lexer.reset("/* unterminated");
        bool rejected_comment = false;
        try {
            static_cast<void>(lexer.next());
        } catch (const mawkcc::LexerError &error) {
            rejected_comment = error.offset() == 0;
        }
        test_support::require(
            rejected_comment, "unterminated comment was accepted");
    });
}
