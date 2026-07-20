#include "lexer.hpp"

#include <charconv>
#include <system_error>

namespace mawkcc {

std::string_view token_name(TokenKind kind) noexcept
{
    switch (kind) {
        case TokenKind::Eof: return "end of file";
        case TokenKind::Identifier: return "identifier";
        case TokenKind::Number: return "number";
        case TokenKind::String: return "string";
        case TokenKind::Return: return "return";
        case TokenKind::Function: return "function";
        case TokenKind::Var: return "var";
        case TokenKind::If: return "if";
        case TokenKind::Else: return "else";
        case TokenKind::While: return "while";
        case TokenKind::Break: return "break";
        case TokenKind::LeftParen: return "(";
        case TokenKind::RightParen: return ")";
        case TokenKind::LeftBrace: return "{";
        case TokenKind::RightBrace: return "}";
        case TokenKind::Semicolon: return ";";
        case TokenKind::Comma: return ",";
        case TokenKind::Assign: return "=";
    }
    return "unknown token";
}

void Lexer::reset(std::string_view source) noexcept
{
    source_ = source;
    position_ = 0;
}

bool Lexer::is_space(char ch) noexcept
{
    return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' ||
           ch == '\f' || ch == '\v';
}

bool Lexer::is_digit(char ch) noexcept
{
    return ch >= '0' && ch <= '9';
}

bool Lexer::is_alpha(char ch) noexcept
{
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
           ch == '_';
}

bool Lexer::is_alnum(char ch) noexcept
{
    return is_alpha(ch) || is_digit(ch);
}

void Lexer::skip_whitespace_and_comments()
{
    while (position_ < source_.size()) {
        if (is_space(source_[position_])) {
            ++position_;
            continue;
        }
        if (position_ + 1 < source_.size() && source_[position_] == '/' &&
            source_[position_ + 1] == '*') {
            const std::size_t comment_offset = position_;
            position_ += 2;
            while (position_ + 1 < source_.size() &&
                   !(source_[position_] == '*' && source_[position_ + 1] == '/')) {
                ++position_;
            }
            if (position_ + 1 >= source_.size()) {
                throw LexerError{"unterminated comment", comment_offset};
            }
            position_ += 2;
            continue;
        }
        if (position_ + 1 < source_.size() && source_[position_] == '/' &&
            source_[position_ + 1] == '/') {
            position_ += 2;
            while (position_ < source_.size() && source_[position_] != '\n') {
                ++position_;
            }
            continue;
        }
        break;
    }
}

LexToken Lexer::read_string(std::size_t token_offset)
{
    ++position_;
    std::string text;
    text.reserve(64);
    while (position_ < source_.size()) {
        char ch = source_[position_++];
        if (ch == '"') {
            return LexToken{TokenKind::String, std::move(text), 0, token_offset};
        }
        if (ch == '\\') {
            if (position_ >= source_.size()) {
                throw LexerError{"unterminated string escape", token_offset};
            }
            ch = source_[position_++];
            switch (ch) {
                case 'n': ch = '\n'; break;
                case 't': ch = '\t'; break;
                case 'r': ch = '\r'; break;
                case 'f': ch = '\f'; break;
                case 'v': ch = '\v'; break;
                case '"': ch = '"'; break;
                case '\\': ch = '\\'; break;
                case '0': ch = '\0'; break;
                default:
                    throw LexerError{
                        std::string{"unsupported string escape `\\"} + ch + "`",
                        token_offset};
            }
        }
        text.push_back(ch);
    }
    throw LexerError{"unterminated string literal", token_offset};
}

LexToken Lexer::next()
{
    skip_whitespace_and_comments();
    const std::size_t token_offset = position_;
    if (position_ >= source_.size()) {
        return LexToken{TokenKind::Eof, {}, 0, token_offset};
    }

    if (is_alpha(source_[position_])) {
        const std::size_t start = position_++;
        while (position_ < source_.size() && is_alnum(source_[position_])) {
            ++position_;
        }
        std::string text{source_.substr(start, position_ - start)};
        TokenKind kind = TokenKind::Identifier;
        if (text == "return") kind = TokenKind::Return;
        else if (text == "function") kind = TokenKind::Function;
        else if (text == "var") kind = TokenKind::Var;
        else if (text == "if") kind = TokenKind::If;
        else if (text == "else") kind = TokenKind::Else;
        else if (text == "while") kind = TokenKind::While;
        else if (text == "break") kind = TokenKind::Break;
        return LexToken{kind, std::move(text), 0, token_offset};
    }

    if (is_digit(source_[position_])) {
        const std::size_t start = position_++;
        while (position_ < source_.size() && is_digit(source_[position_])) {
            ++position_;
        }
        std::string text{source_.substr(start, position_ - start)};
        TargetWord number = 0;
        const auto result = std::from_chars(
            text.data(), text.data() + text.size(), number, 10);
        if (result.ec == std::errc::result_out_of_range) {
            throw LexerError{
                "integer literal is outside the 32-bit target range", token_offset};
        }
        return LexToken{TokenKind::Number, std::move(text), number, token_offset};
    }

    if (source_[position_] == '"') {
        return read_string(token_offset);
    }

    const char punctuation = source_[position_++];
    switch (punctuation) {
        case '(': return LexToken{TokenKind::LeftParen, "(", 0, token_offset};
        case ')': return LexToken{TokenKind::RightParen, ")", 0, token_offset};
        case '{': return LexToken{TokenKind::LeftBrace, "{", 0, token_offset};
        case '}': return LexToken{TokenKind::RightBrace, "}", 0, token_offset};
        case ';': return LexToken{TokenKind::Semicolon, ";", 0, token_offset};
        case ',': return LexToken{TokenKind::Comma, ",", 0, token_offset};
        case '=': return LexToken{TokenKind::Assign, "=", 0, token_offset};
        default:
            throw LexerError{
                std::string{"unexpected character `"} + punctuation + "`",
                token_offset};
    }
}

} // namespace mawkcc
