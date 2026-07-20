#include "elf32_writer.hpp"

#include <cstdint>

namespace mawkcc {

void Elf32Writer::reset()
{
    image_.clear();
    image_.reserve(4096U);
}

void Elf32Writer::byte(TargetWord value)
{
    image_.append_u8(static_cast<std::uint8_t>(value & 255U));
}

void Elf32Writer::half(TargetWord value)
{
    image_.append_u16_le(static_cast<std::uint16_t>(value));
}

void Elf32Writer::word(TargetWord value) { image_.append_u32_le(value); }

void Elf32Writer::text(std::string_view value)
{
    for (const char character : value) {
        byte(static_cast<unsigned char>(character));
    }
}

void Elf32Writer::append(const ByteWriter &bytes)
{
    for (const std::uint8_t value : bytes) {
        byte(value);
    }
}

void Elf32Writer::pad_to(TargetWord offset)
{
    image_.pad_to(static_cast<std::size_t>(offset));
}

std::vector<std::uint8_t> Elf32Writer::take_image() noexcept
{
    return image_.release();
}

} // namespace mawkcc
