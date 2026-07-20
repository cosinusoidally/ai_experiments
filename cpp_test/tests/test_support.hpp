#pragma once

#include <cstdint>
#include <cstddef>
#include <exception>
#include <initializer_list>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace test_support {

[[noreturn]] inline void fail(std::string message)
{
    throw std::runtime_error{std::move(message)};
}

inline void require(bool condition, std::string_view message)
{
    if (!condition) {
        fail(std::string{message});
    }
}

template <typename Actual, typename Expected>
void require_equal(const Actual &actual, const Expected &expected,
                   std::string_view context)
{
    if (!(actual == expected)) {
        fail(std::string{context} + ": values differ");
    }
}

template <typename Bytes>
void require_bytes(const Bytes &actual,
                   std::initializer_list<std::uint8_t> expected,
                   std::string_view context)
{
    if (actual.size() != expected.size()) {
        std::ostringstream message;
        message << context << ": expected " << expected.size()
                << " bytes, got " << actual.size();
        fail(message.str());
    }

    auto actual_byte = actual.begin();
    std::size_t offset = 0;
    for (const std::uint8_t expected_byte : expected) {
        if (*actual_byte != expected_byte) {
            std::ostringstream message;
            message << context << ": byte " << offset << " differs; expected 0x"
                    << std::hex << static_cast<unsigned>(expected_byte)
                    << ", got 0x" << static_cast<unsigned>(*actual_byte);
            fail(message.str());
        }
        ++actual_byte;
        ++offset;
    }
}

template <typename TestBody>
int run(TestBody &&body)
{
    try {
        body();
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "failure: " << error.what() << '\n';
        return 1;
    }
}

} // namespace test_support
