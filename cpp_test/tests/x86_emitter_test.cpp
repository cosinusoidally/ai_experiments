#include "x86_emitter.hpp"

#include <cstdint>
#include <cstdlib>
#include <initializer_list>

namespace {

void require_bytes(const mawkcc::X86Emitter &emitter,
                   std::initializer_list<std::uint8_t> expected)
{
    if (emitter.bytes().size() != expected.size()) {
        std::abort();
    }
    auto actual = emitter.bytes().begin();
    for (const std::uint8_t byte : expected) {
        if (*actual++ != byte) {
            std::abort();
        }
    }
}

} // namespace

int main()
{
    mawkcc::X86Emitter emitter;
    emitter.reset();
    emitter.mov_eax_immediate(0x12345678L);
    emitter.push_eax();
    emitter.pop_ebx();
    require_bytes(emitter, {0xb8, 0x78, 0x56, 0x34, 0x12, 0x50, 0x5b});

    emitter.reset();
    const mawkcc::CodeOffset patch = emitter.je_placeholder();
    emitter.negate();
    emitter.patch_relative(patch, emitter.offset());
    require_bytes(emitter, {0x0f, 0x84, 0x02, 0x00, 0x00, 0x00, 0xf7, 0xd8});

    emitter.reset();
    emitter.compare_and_set(mawkcc::X86Condition::GreaterEqual);
    require_bytes(emitter, {0x39, 0xc3, 0x0f, 0x9d, 0xc0, 0x0f, 0xb6, 0xc0});

    return 0;
}
