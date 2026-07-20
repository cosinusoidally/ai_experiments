#include "x86_emitter.hpp"
#include "test_support.hpp"

#include <cstdint>

int main()
{
    return test_support::run([] {
        mawkcc::X86Emitter emitter;
        emitter.reset();
        emitter.mov_eax_immediate(0x12345678L);
        emitter.push_eax();
        emitter.pop_ebx();
        test_support::require_bytes(
            emitter.bytes(),
            {0xb8, 0x78, 0x56, 0x34, 0x12, 0x50, 0x5b},
            "immediate and register-stack operations");

        emitter.reset();
        const mawkcc::CodeOffset patch = emitter.je_placeholder();
        emitter.negate();
        emitter.patch_relative(patch, emitter.offset());
        test_support::require_bytes(
            emitter.bytes(),
            {0x0f, 0x84, 0x02, 0x00, 0x00, 0x00, 0xf7, 0xd8},
            "relative conditional branch");

        emitter.reset();
        emitter.compare_and_set(mawkcc::X86Condition::GreaterEqual);
        test_support::require_bytes(
            emitter.bytes(),
            {0x39, 0xc3, 0x0f, 0x9d, 0xc0, 0x0f, 0xb6, 0xc0},
            "comparison result materialization");

        emitter.reset();
        emitter.prologue();
        emitter.load_parameter(12);
        emitter.store_parameter(-8);
        emitter.epilogue();
        test_support::require_bytes(
            emitter.bytes(),
            {
                0x55, 0x89, 0xe5, 0x53,
                0x8b, 0x45, 0x0c,
                0x89, 0x45, 0xf8,
                0x8b, 0x5d, 0xfc, 0x89, 0xec, 0x5d, 0xc3,
            },
            "function frame and parameter addressing");

        emitter.reset();
        emitter.load_eax_absolute(0x12345678U);
        emitter.store_eax_absolute(0x12345678U);
        emitter.load_ecx_absolute(0x12345678U);
        emitter.store_ebx_absolute(0x12345678U);
        test_support::require_bytes(
            emitter.bytes(),
            {
                0xa1, 0x78, 0x56, 0x34, 0x12,
                0xa3, 0x78, 0x56, 0x34, 0x12,
                0x8b, 0x0d, 0x78, 0x56, 0x34, 0x12,
                0x89, 0x1d, 0x78, 0x56, 0x34, 0x12,
            },
            "absolute memory addressing");

        emitter.reset();
        emitter.reverse_arguments(2);
        test_support::require_bytes(
            emitter.bytes(),
            {
                0x8b, 0x84, 0x24, 0x00, 0x00, 0x00, 0x00,
                0x8b, 0x9c, 0x24, 0x04, 0x00, 0x00, 0x00,
                0x89, 0x9c, 0x24, 0x00, 0x00, 0x00, 0x00,
                0x89, 0x84, 0x24, 0x04, 0x00, 0x00, 0x00,
            },
            "SIB stack addressing");

        emitter.reset();
        emitter.add();
        emitter.subtract();
        emitter.multiply();
        emitter.divide();
        emitter.shift_left();
        emitter.shift_right();
        test_support::require_bytes(
            emitter.bytes(),
            {
                0x01, 0xd8,
                0x89, 0xc1, 0x89, 0xd8, 0x29, 0xc8,
                0x0f, 0xaf, 0xc3,
                0x89, 0xc1, 0x89, 0xd8, 0x99, 0xf7, 0xf9,
                0x89, 0xc1, 0xd3, 0xe3, 0x89, 0xd8,
                0x89, 0xc1, 0xd3, 0xeb, 0x89, 0xd8,
            },
            "arithmetic and shift operations");

        emitter.reset();
        emitter.read_i32();
        emitter.read_u8();
        emitter.write_i32();
        emitter.write_u8();
        test_support::require_bytes(
            emitter.bytes(),
            {
                0x8b, 0x00,
                0x0f, 0xb6, 0x00,
                0x89, 0x03,
                0x88, 0x03, 0x0f, 0xb6, 0xc0,
            },
            "indirect memory operations");

        emitter.reset();
        emitter.sys_current_break();
        emitter.sys_brk();
        test_support::require_bytes(
            emitter.bytes(),
            {
                0xb8, 0x2d, 0x00, 0x00, 0x00, 0x31, 0xdb, 0xcd, 0x80,
                0xb8, 0x2d, 0x00, 0x00, 0x00, 0xcd, 0x80,
            },
            "Linux brk system calls");
    });
}
