#pragma once

#include "byte_writer.hpp"
#include "mawkcc_types.hpp"

#include <cstdint>

namespace mawkcc {

enum class X86Condition {
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
};

class X86Emitter {
public:
    void reset();
    CodeOffset offset() const noexcept;
    const mawkcc::ByteWriter &bytes() const noexcept;

    void patch_word(CodeOffset position, TargetWord value);
    void patch_relative(CodeOffset position, CodeOffset target);

    CodeOffset mov_eax_immediate(TargetWord value);
    CodeOffset load_eax_absolute(TargetWord address = 0);
    CodeOffset store_eax_absolute(TargetWord address = 0);
    CodeOffset load_ecx_absolute(TargetWord address = 0);
    CodeOffset store_ebx_absolute(TargetWord address = 0);
    CodeOffset call_placeholder();
    void push_eax();
    void push_ebx();
    void pop_ebx();
    void pop_ecx();
    void load_parameter(TargetSignedWord stack_offset);
    void store_parameter(TargetSignedWord stack_offset);
    void prologue();
    void epilogue();
    void test_eax();
    CodeOffset start();
    void add_esp(TargetWord value);
    void mov_eax_esp();
    void mov_ebx_from_esp();
    void reverse_arguments(ArgumentCount argument_count);

    CodeOffset je_placeholder();
    CodeOffset jne_placeholder();
    CodeOffset jmp_placeholder();
    void jump(CodeOffset target);

    void mov_ebx_eax();
    void mov_edx_eax();
    void mov_ebx_ecx();
    void mov_eax_ecx();
    void xor_ebx();
    void xor_eax();
    void add_ebx_edx();
    void cmp_eax_ebx();
    void interrupt_80();
    void add();
    void bit_and();
    void bit_or();
    void bit_xor();
    void shift_left();
    void shift_right();
    void subtract();
    void multiply();
    void divide();
    void modulo();
    void compare_and_set(X86Condition condition);
    void negate();
    void logical_not();
    void read_i32();
    void read_u8();
    void write_i32();
    void write_u8();
    void sys_current_break();
    void sys_brk();
    void sys_open();
    void sys_read();
    void sys_write();
    void sys_close();
    void sys_exit();

private:
    mawkcc::ByteWriter code_;
};

} // namespace mawkcc
