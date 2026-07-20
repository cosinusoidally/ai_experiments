#pragma once

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace mawkcc {

class ByteWriter {
public:
    using const_iterator = std::vector<std::uint8_t>::const_iterator;

    [[nodiscard]] std::size_t size() const noexcept { return bytes_.size(); }
    [[nodiscard]] const std::uint8_t *data() const noexcept { return bytes_.data(); }
    [[nodiscard]] const_iterator begin() const noexcept { return bytes_.begin(); }
    [[nodiscard]] const_iterator end() const noexcept { return bytes_.end(); }
    [[nodiscard]] std::vector<std::uint8_t> release() noexcept
    {
        return std::move(bytes_);
    }

    void clear() noexcept { bytes_.clear(); }
    void reserve(std::size_t capacity) { bytes_.reserve(capacity); }

    void append_u8(std::uint8_t value) { bytes_.push_back(value); }

    void append_u16_le(std::uint16_t value)
    {
        append_u8(static_cast<std::uint8_t>(value));
        append_u8(static_cast<std::uint8_t>(value >> 8));
    }

    void append_u32_le(std::uint32_t value)
    {
        append_u8(static_cast<std::uint8_t>(value));
        append_u8(static_cast<std::uint8_t>(value >> 8));
        append_u8(static_cast<std::uint8_t>(value >> 16));
        append_u8(static_cast<std::uint8_t>(value >> 24));
    }

    void patch_u32_le(std::size_t offset, std::uint32_t value)
    {
        if (offset > bytes_.size() || bytes_.size() - offset < 4) {
            throw std::out_of_range("32-bit patch is outside the byte buffer");
        }
        bytes_[offset] = static_cast<std::uint8_t>(value);
        bytes_[offset + 1] = static_cast<std::uint8_t>(value >> 8);
        bytes_[offset + 2] = static_cast<std::uint8_t>(value >> 16);
        bytes_[offset + 3] = static_cast<std::uint8_t>(value >> 24);
    }

    void pad_to(std::size_t offset)
    {
        if (offset < bytes_.size()) {
            throw std::logic_error("cannot pad a byte buffer backwards");
        }
        bytes_.resize(offset, 0);
    }

private:
    std::vector<std::uint8_t> bytes_;
};

} // namespace mawkcc
