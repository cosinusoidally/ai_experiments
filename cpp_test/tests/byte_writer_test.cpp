#include "byte_writer.hpp"
#include "test_support.hpp"

#include <cstdint>
#include <stdexcept>
#include <vector>

int main()
{
    return test_support::run([] {
        mawkcc::ByteWriter writer;
        writer.append_u8(0x12);
        writer.append_u16_le(0x3456);
        writer.append_u32_le(0x789abcde);

        const std::vector<std::uint8_t> expected{
            0x12, 0x56, 0x34, 0xde, 0xbc, 0x9a, 0x78};
        test_support::require_equal(
            std::vector<std::uint8_t>{writer.begin(), writer.end()}, expected,
            "little-endian append");

        writer.patch_u32_le(3, 0x01020304);
        const std::vector<std::uint8_t> patched{
            0x12, 0x56, 0x34, 0x04, 0x03, 0x02, 0x01};
        test_support::require_equal(
            std::vector<std::uint8_t>{writer.begin(), writer.end()}, patched,
            "little-endian patch");

        writer.pad_to(10);
        test_support::require(
            writer.size() == 10, "padding produced the wrong size");

        bool rejected_bad_patch = false;
        try {
            writer.patch_u32_le(8, 0);
        } catch (const std::out_of_range &) {
            rejected_bad_patch = true;
        }
        test_support::require(
            rejected_bad_patch, "out-of-bounds patch was accepted");

        bool rejected_backwards_padding = false;
        try {
            writer.pad_to(9);
        } catch (const std::logic_error &) {
            rejected_backwards_padding = true;
        }
        test_support::require(
            rejected_backwards_padding, "backwards padding was accepted");
    });
}
