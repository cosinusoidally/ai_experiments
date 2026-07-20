#pragma once

#include <cstdint>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace mawkcc {

enum class OutputKind {
    Executable,
    RelocatableObject,
};

class CompileError : public std::runtime_error {
public:
    CompileError(std::string message, std::size_t offset,
                 std::size_t line, std::size_t column);

    [[nodiscard]] std::size_t offset() const noexcept;
    [[nodiscard]] std::size_t line() const noexcept;
    [[nodiscard]] std::size_t column() const noexcept;

private:
    std::size_t offset_;
    std::size_t line_;
    std::size_t column_;
};

[[nodiscard]] std::vector<std::uint8_t> compile(
    std::string_view source, OutputKind output_kind);

} // namespace mawkcc
