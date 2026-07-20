#include "mawkcc_refactored.hpp"

#include <cstdint>
#include <cstdlib>
#include <string>
#include <string_view>
#include <vector>

namespace {

void require_elf_type(const std::vector<std::uint8_t> &image,
                      std::uint8_t expected_type)
{
    if (image.size() < 18U || image[0] != 0x7f || image[1] != 'E' ||
        image[2] != 'L' || image[3] != 'F' || image[16] != expected_type ||
        image[17] != 0) {
        std::abort();
    }
}

void require_error(std::string_view source, std::string_view expected)
{
    try {
        static_cast<void>(
            mawkcc::compile(source, mawkcc::OutputKind::Executable));
    } catch (const mawkcc::CompileError &error) {
        if (std::string_view{error.what()}.find(expected) ==
            std::string_view::npos) {
            std::abort();
        }
        return;
    }
    std::abort();
}

} // namespace

int main()
{
    constexpr std::string_view source = "function main() { return 42; }";
    const auto first = mawkcc::compile(source, mawkcc::OutputKind::Executable);
    const auto second = mawkcc::compile(source, mawkcc::OutputKind::Executable);
    if (first != second) {
        std::abort();
    }
    require_elf_type(first, 2);

    const auto object = mawkcc::compile(
        "function answer() { return 42; }",
        mawkcc::OutputKind::RelocatableObject);
    require_elf_type(object, 1);

    bool located = false;
    try {
        static_cast<void>(mawkcc::compile(
            "function main() {\n  break;\n}",
            mawkcc::OutputKind::Executable));
    } catch (const mawkcc::CompileError &error) {
        if (error.line() != 2U || error.column() != 3U || error.offset() == 0U) {
            std::abort();
        }
        located = true;
    }
    if (!located) {
        std::abort();
    }

    require_error("var value; var value; function main() { return 0; }",
                  "duplicate global");
    require_error("function main() { return 0; } function main() { return 1; }",
                  "duplicate function");
    require_error("function main(value, value) { return value; }",
                  "duplicate parameter");
    require_error("function one(value) { return value; } function main() { return one(); }",
                  "wrong arity");
    require_error("function main() { return missing(); }", "undefined function");
    require_error("function main() { unknown = 1; return 0; }",
                  "not a global or parameter");
    require_error("function main() { return unknown; }", "unknown identifier");
    require_error("function helper() { return 0; }", "missing `main`");
    require_error("function main() { return 4294967296; }", "32-bit target range");
    require_error("function main() { return mks(\"unterminated); }",
                  "unterminated string literal");
    require_error("/* unterminated", "unterminated comment");
    return 0;
}
