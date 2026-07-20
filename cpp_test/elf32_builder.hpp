#pragma once

#include "byte_writer.hpp"
#include "compiler_state.hpp"
#include "mawkcc_types.hpp"

#include <cstdint>
#include <vector>

namespace mawkcc {

struct ExecutableLayout {
    TargetWord image_base;
    TargetWord header_size;
    TargetWord entry_address;
    TargetWord data_offset;
    TargetWord data_address;
    TargetWord file_size;
};

[[nodiscard]] ExecutableLayout calculate_executable_layout(
    std::size_t code_size, DataOffset data_size);

[[nodiscard]] std::vector<std::uint8_t> build_elf32_executable(
    const ByteWriter &code, const std::vector<std::uint8_t> &data,
    DataOffset data_size, const ExecutableLayout &layout);

[[nodiscard]] std::vector<std::uint8_t> build_elf32_object(
    const ByteWriter &code, const std::vector<std::uint8_t> &data,
    DataOffset data_size, const SymbolTable &symbols,
    const FixupTable &fixups);

} // namespace mawkcc
