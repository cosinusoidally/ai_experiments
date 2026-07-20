#include "x86_emitter.hpp"

#include <cstdint>
#include <limits>
#include <stdexcept>

namespace mawkcc {

void X86Emitter::reset()
{
    code_.clear();
    code_.reserve(4096U);
}

CodeOffset X86Emitter::offset() const noexcept { return code_.size(); }
const mawkcc::ByteWriter &X86Emitter::bytes() const noexcept { return code_; }

void X86Emitter::byte(TargetWord value)
{
    code_.append_u8(static_cast<std::uint8_t>(value & 255U));
}

void X86Emitter::word(TargetWord value)
{
    code_.append_u32_le(value);
}

void X86Emitter::patch_word(CodeOffset position, TargetWord value)
{
    code_.patch_u32_le(position, value);
}

void X86Emitter::patch_relative(CodeOffset position, CodeOffset target)
{
    const auto displacement = static_cast<std::int64_t>(target) -
                              static_cast<std::int64_t>(position + 4U);
    if (displacement < std::numeric_limits<TargetSignedWord>::min() ||
        displacement > std::numeric_limits<TargetSignedWord>::max()) {
        throw std::overflow_error{"relative x86 branch exceeds 32-bit range"};
    }
    patch_word(position, static_cast<TargetWord>(
                             static_cast<TargetSignedWord>(displacement)));
}

CodeOffset X86Emitter::mov_eax_immediate(TargetWord value)
{
    byte(184);
    const CodeOffset operand = offset();
    word(value);
    return operand;
}

CodeOffset X86Emitter::load_eax_absolute(TargetWord address)
{
    byte(161); const CodeOffset operand = offset(); word(address); return operand;
}

CodeOffset X86Emitter::store_eax_absolute(TargetWord address)
{
    byte(163); const CodeOffset operand = offset(); word(address); return operand;
}

CodeOffset X86Emitter::load_ecx_absolute(TargetWord address)
{
    byte(139); byte(13); const CodeOffset operand = offset(); word(address); return operand;
}

CodeOffset X86Emitter::store_ebx_absolute(TargetWord address)
{
    byte(137); byte(29); const CodeOffset operand = offset(); word(address); return operand;
}

CodeOffset X86Emitter::call_placeholder()
{
    byte(232); const CodeOffset operand = offset(); word(0); return operand;
}

void X86Emitter::push_eax() { byte(80); }
void X86Emitter::push_ebx() { byte(83); }
void X86Emitter::pop_ebx() { byte(91); }
void X86Emitter::pop_ecx() { byte(89); }
void X86Emitter::load_parameter(TargetSignedWord offset) { byte(139); byte(69); byte(static_cast<TargetWord>(offset)); }
void X86Emitter::store_parameter(TargetSignedWord offset) { byte(137); byte(69); byte(static_cast<TargetWord>(offset)); }
void X86Emitter::prologue() { byte(85); byte(137); byte(229); push_ebx(); }
void X86Emitter::epilogue() { byte(139); byte(93); byte(252); byte(137); byte(236); byte(93); byte(195); }
void X86Emitter::test_eax() { byte(133); byte(192); }

CodeOffset X86Emitter::start()
{
    mov_eax_esp();
    mov_ebx_from_esp();
    add_eax_immediate(4);
    push_eax();
    push_ebx();
    const CodeOffset call_patch = call_placeholder();
    add_esp(8);
    byte(137); byte(195);
    mov_eax_immediate(1);
    interrupt_80();
    return call_patch;
}

void X86Emitter::add_esp(TargetWord value) { byte(129); byte(196); word(value); }
void X86Emitter::mov_eax_esp() { byte(137); byte(224); }
void X86Emitter::mov_ebx_from_esp() { byte(139); byte(28); byte(36); }
void X86Emitter::mov_eax_from_stack(TargetSignedWord d) { byte(139); byte(132); byte(36); word(static_cast<TargetWord>(d)); }
void X86Emitter::mov_ebx_from_stack(TargetSignedWord d) { byte(139); byte(156); byte(36); word(static_cast<TargetWord>(d)); }
void X86Emitter::mov_stack_from_ebx(TargetSignedWord d) { byte(137); byte(156); byte(36); word(static_cast<TargetWord>(d)); }
void X86Emitter::mov_stack_from_eax(TargetSignedWord d) { byte(137); byte(132); byte(36); word(static_cast<TargetWord>(d)); }

void X86Emitter::reverse_arguments(ArgumentCount count)
{
    if (count > static_cast<ArgumentCount>(
                    std::numeric_limits<TargetSignedWord>::max() / 4)) {
        throw std::overflow_error{"argument stack exceeds i386 range"};
    }
    for (ArgumentCount index = 0; index < count / 2U; ++index) {
        const auto low = static_cast<TargetSignedWord>(4U * index);
        const auto high =
            static_cast<TargetSignedWord>(4U * (count - 1U - index));
        mov_eax_from_stack(low);
        mov_ebx_from_stack(high);
        mov_stack_from_ebx(low);
        mov_stack_from_eax(high);
    }
}

CodeOffset X86Emitter::je_placeholder() { byte(15); byte(132); const auto p = offset(); word(0); return p; }
CodeOffset X86Emitter::jne_placeholder() { byte(15); byte(133); const auto p = offset(); word(0); return p; }
CodeOffset X86Emitter::jmp_placeholder() { byte(233); const auto p = offset(); word(0); return p; }
void X86Emitter::jump(CodeOffset target) { const auto p = jmp_placeholder(); patch_relative(p, target); }
void X86Emitter::add_eax_immediate(TargetWord value) { byte(5); word(value); }
void X86Emitter::mov_ebx_eax() { byte(137); byte(195); }
void X86Emitter::mov_edx_eax() { byte(137); byte(194); }
void X86Emitter::mov_ebx_ecx() { byte(137); byte(203); }
void X86Emitter::mov_eax_ecx() { byte(137); byte(200); }
void X86Emitter::xor_ebx() { byte(49); byte(219); }
void X86Emitter::xor_eax() { byte(49); byte(192); }
void X86Emitter::add_ebx_edx() { byte(1); byte(211); }
void X86Emitter::cmp_eax_ebx() { byte(57); byte(216); }
void X86Emitter::interrupt_80() { byte(205); byte(128); }
void X86Emitter::add() { byte(1); byte(216); }
void X86Emitter::bit_and() { byte(33); byte(216); }
void X86Emitter::bit_or() { byte(9); byte(216); }
void X86Emitter::bit_xor() { byte(49); byte(216); }
void X86Emitter::shift_left() { byte(137); byte(193); byte(211); byte(227); byte(137); byte(216); }
void X86Emitter::shift_right() { byte(137); byte(193); byte(211); byte(235); byte(137); byte(216); }
void X86Emitter::subtract() { byte(137); byte(193); byte(137); byte(216); byte(41); byte(200); }
void X86Emitter::multiply() { byte(15); byte(175); byte(195); }
void X86Emitter::divide() { byte(137); byte(193); byte(137); byte(216); byte(153); byte(247); byte(249); }
void X86Emitter::modulo() { divide(); byte(137); byte(208); }
void X86Emitter::compare_and_set(X86Condition condition)
{
    TargetWord opcode = 0;
    switch (condition) {
        case X86Condition::Equal: opcode = 148; break;
        case X86Condition::NotEqual: opcode = 149; break;
        case X86Condition::Less: opcode = 156; break;
        case X86Condition::LessEqual: opcode = 158; break;
        case X86Condition::Greater: opcode = 159; break;
        case X86Condition::GreaterEqual: opcode = 157; break;
    }
    byte(57); byte(195); byte(15); byte(opcode);
    byte(192); byte(15); byte(182); byte(192);
}
void X86Emitter::negate() { byte(247); byte(216); }
void X86Emitter::logical_not() { byte(133); byte(192); byte(15); byte(148); byte(192); byte(15); byte(182); byte(192); }
void X86Emitter::read_i32() { byte(139); byte(0); }
void X86Emitter::read_u8() { byte(15); byte(182); byte(0); }
void X86Emitter::write_i32() { byte(137); byte(3); }
void X86Emitter::write_u8() { byte(136); byte(3); byte(15); byte(182); byte(192); }
void X86Emitter::sys_open() { mov_eax_immediate(5); interrupt_80(); }
void X86Emitter::sys_read() { mov_eax_immediate(3); interrupt_80(); }
void X86Emitter::sys_write() { mov_eax_immediate(4); interrupt_80(); }
void X86Emitter::sys_close() { mov_ebx_eax(); mov_eax_immediate(6); interrupt_80(); }
void X86Emitter::sys_exit() { mov_ebx_eax(); mov_eax_immediate(1); interrupt_80(); }

} // namespace mawkcc
