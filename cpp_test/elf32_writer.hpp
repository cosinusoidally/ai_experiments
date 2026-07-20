#pragma once

#include "byte_writer.hpp"
#include "mawkcc_types.hpp"

#include <cstdint>
#include <string_view>
#include <vector>

namespace mawkcc {

class Elf32Writer {
public:
    void reset();
    void byte(TargetWord value);
    void half(TargetWord value);
    void word(TargetWord value);
    void text(std::string_view value);
    void append(const ByteWriter &bytes);
    void pad_to(TargetWord offset);
    [[nodiscard]] std::vector<std::uint8_t> take_image() noexcept;

private:
    ByteWriter image_;
};

} // namespace mawkcc
