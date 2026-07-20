#include "elf32_builder.hpp"
#include "test_support.hpp"

#include <cstdint>
#include <stdexcept>
#include <vector>

namespace {

std::uint32_t read_word(const std::vector<std::uint8_t> &bytes,
                        std::size_t offset)
{
    return static_cast<std::uint32_t>(bytes[offset]) |
           (static_cast<std::uint32_t>(bytes[offset + 1U]) << 8U) |
           (static_cast<std::uint32_t>(bytes[offset + 2U]) << 16U) |
           (static_cast<std::uint32_t>(bytes[offset + 3U]) << 24U);
}

} // namespace

int main()
{
    return test_support::run([] {
        mawkcc::ByteWriter code;
        code.append_u8(0xc3);
        const std::vector<std::uint8_t> data{1, 2, 3, 4};
        const auto layout = mawkcc::calculate_executable_layout(code.size(), 4);
        test_support::require(
            layout.header_size == 84U && layout.data_offset == 88U &&
                layout.file_size == 92U,
            "executable layout is incorrect");
        const auto executable =
            mawkcc::build_elf32_executable(code, data, 4, layout);
        test_support::require(
            executable.size() == layout.file_size && executable[16] == 2 &&
                read_word(executable, 24) == layout.entry_address &&
                executable[layout.data_offset] == 1,
            "executable ELF fields are incorrect");

        mawkcc::SymbolTable symbols;
        static_cast<void>(symbols.add_function("answer", 0, 0));
        mawkcc::FixupTable fixups;
        const auto object =
            mawkcc::build_elf32_object(code, data, 4, symbols, fixups);
        test_support::require(
            object.size() >= 52U && object[16] == 1 && object[48] == 8 &&
                read_word(object, 32) != 0,
            "relocatable ELF fields are incorrect");

        fixups.add_relocation(0, "missing", mawkcc::RelocationType::Absolute32);
        bool rejected = false;
        try {
            static_cast<void>(
                mawkcc::build_elf32_object(code, data, 4, symbols, fixups));
        } catch (const std::logic_error &) {
            rejected = true;
        }
        test_support::require(
            rejected, "relocation for an unknown symbol was accepted");
    });
}
