#include "elf32_writer.hpp"

#include <cstdlib>
#include <cstdint>
#include <vector>

int main()
{
    mawkcc::Elf32Writer writer;
    writer.reset();
    writer.byte(0x7f);
    writer.text("ELF");
    writer.half(0x1234);
    writer.word(0x89abcdefU);
    writer.pad_to(12);

    const std::vector<std::uint8_t> expected{
        0x7f, 'E', 'L', 'F', 0x34, 0x12, 0xef, 0xcd, 0xab, 0x89, 0, 0};
    if (writer.take_image() != expected) {
        std::abort();
    }
    return 0;
}
