#pragma once

#include "mawkcc_types.hpp"

#include <cstddef>
#include <stdexcept>
#include <string>
#include <string_view>

namespace mawkcc {

enum class TokenKind {
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
    Assign,
};

[[nodiscard]] std::string_view token_name(TokenKind kind) noexcept;

struct LexToken {
    TokenKind kind = TokenKind::Eof;
    std::string text;
    TargetWord number = 0;
    std::size_t offset = 0;
};

class LexerError : public std::runtime_error {
public:
    LexerError(std::string message, std::size_t offset)
        : std::runtime_error(std::move(message)), offset_(offset)
    {
    }

    [[nodiscard]] std::size_t offset() const noexcept { return offset_; }

private:
    std::size_t offset_;
};

class Lexer {
public:
    void reset(std::string_view source) noexcept;
    [[nodiscard]] LexToken next();

private:
    [[nodiscard]] static bool is_space(char ch) noexcept;
    [[nodiscard]] static bool is_digit(char ch) noexcept;
    [[nodiscard]] static bool is_alpha(char ch) noexcept;
    [[nodiscard]] static bool is_alnum(char ch) noexcept;
    void skip_whitespace_and_comments();
    [[nodiscard]] LexToken read_string(std::size_t token_offset);

    std::string_view source_;
    std::size_t position_ = 0;
};

} // namespace mawkcc
