#include "x86_emitter.hpp"

#include <cstdint>
#include <limits>
#include <stdexcept>

namespace mawkcc {
namespace {

using EncodedByte = std::uint8_t;

constexpr unsigned ModRmModeShift = 6U;
constexpr unsigned ModRmRegisterShift = 3U;
constexpr unsigned SibIndexShift = 3U;
constexpr EncodedByte NoOpcodeExtension = 0;
constexpr TargetWord PlaceholderOperand = 0;
constexpr TargetSignedWord TargetWordSize =
    static_cast<TargetSignedWord>(sizeof(TargetWord));
constexpr std::size_t InitialCodeCapacity = 4096U;

// The three-bit register numbers used by opcode+register, ModR/M, and SIB
// fields. Esp also means "a SIB byte follows" in a ModR/M r/m field; Ebp with
// mod=00 means an absolute disp32 rather than [ebp].
enum class Register : EncodedByte {
    Eax = 0,
    Ecx = 1,
    Edx = 2,
    Ebx = 3,
    Esp = 4,
    Ebp = 5,
};

// ModR/M layout: [ mod:2 | reg/opcode:3 | r/m:3 ]. The reg field either names
// a register or extends a grouped opcode. Direct selects register-to-register
// operands; the other forms describe memory and the displacement that follows.
enum class AddressMode : EncodedByte {
    Indirect = 0,
    Displacement8 = 1,
    Displacement32 = 2,
    Direct = 3,
};

enum class GroupOperation : EncodedByte {
    AddImmediate = 0,
    Negate = 3,
    ShiftLeft = 4,
    ShiftRightLogical = 5,
    SignedDivide = 7,
};

enum class ConditionCode : EncodedByte {
    Equal = 0x4,
    NotEqual = 0x5,
    Less = 0xc,
    GreaterEqual = 0xd,
    LessEqual = 0xe,
    Greater = 0xf,
};

enum class BinaryOperation {
    Add,
    Subtract,
    BitAnd,
    BitOr,
    BitXor,
    Compare,
};

enum class LinuxSyscall : TargetWord {
    Exit = 1,
    Read = 3,
    Write = 4,
    Open = 5,
    Close = 6,
    Break = 45,
};

// Raw opcode bytes are confined to this bottom encoding layer. Multi-byte
// instructions use Escape0F followed by a secondary opcode. Opcodes ending in
// "Base" reserve their low three bits for a Register value. For the subset
// emitted here, an instruction is an opcode followed as required by ModR/M,
// SIB, displacement, and immediate fields; multi-byte numeric fields are
// serialized little-endian by ByteWriter.
enum class Opcode : EncodedByte {
    AddRm32Reg32 = 0x01,
    AddEaxImmediate32 = 0x05,
    BitOrRm32Reg32 = 0x09,
    Escape0F = 0x0f,
    BitAndRm32Reg32 = 0x21,
    SubtractRm32Reg32 = 0x29,
    BitXorRm32Reg32 = 0x31,
    CompareRm32Reg32 = 0x39,
    PushRegisterBase = 0x50,
    PopRegisterBase = 0x58,
    GroupImmediate32 = 0x81,
    TestRm32Reg32 = 0x85,
    MoveRm8FromReg8 = 0x88,
    MoveRm32FromReg32 = 0x89,
    MoveReg32FromRm32 = 0x8b,
    SignExtendEaxIntoEdx = 0x99,
    MoveEaxFromAbsolute = 0xa1,
    MoveAbsoluteFromEax = 0xa3,
    MoveRegisterImmediateBase = 0xb8,
    ReturnNear = 0xc3,
    Interrupt = 0xcd,
    ShiftByCl = 0xd3,
    CallRelative32 = 0xe8,
    JumpRelative32 = 0xe9,
    GroupUnary = 0xf7,
};

enum class SecondaryOpcode : EncodedByte {
    JumpConditionBase = 0x80,
    SetConditionBase = 0x90,
    MoveZeroExtendByte = 0xb6,
    SignedMultiply = 0xaf,
};

constexpr EncodedByte encoded(Register value) noexcept
{
    return static_cast<EncodedByte>(value);
}

constexpr EncodedByte encoded(AddressMode value) noexcept
{
    return static_cast<EncodedByte>(value);
}

constexpr EncodedByte encoded(GroupOperation value) noexcept
{
    return static_cast<EncodedByte>(value);
}

constexpr EncodedByte encoded(ConditionCode value) noexcept
{
    return static_cast<EncodedByte>(value);
}

constexpr EncodedByte encoded(Opcode value) noexcept
{
    return static_cast<EncodedByte>(value);
}

constexpr EncodedByte encoded(SecondaryOpcode value) noexcept
{
    return static_cast<EncodedByte>(value);
}

constexpr EncodedByte with_register(Opcode base, Register reg) noexcept
{
    return static_cast<EncodedByte>(encoded(base) + encoded(reg));
}

constexpr EncodedByte mod_rm(
    AddressMode mode, EncodedByte reg_or_operation, Register rm) noexcept
{
    return static_cast<EncodedByte>((encoded(mode) << ModRmModeShift) |
                                    (reg_or_operation << ModRmRegisterShift) |
                                    encoded(rm));
}

constexpr EncodedByte mod_rm(
    AddressMode mode, Register reg, Register rm) noexcept
{
    return mod_rm(mode, encoded(reg), rm);
}

// SIB layout: [ scale:2 | index:3 | base:3 ]. An index value of Esp means
// "no index", so 00_100_100 encodes the plain [esp] addressing form.
constexpr EncodedByte sib_no_index(Register base) noexcept
{
    return static_cast<EncodedByte>((encoded(Register::Esp) << SibIndexShift) |
                                    encoded(base));
}

ConditionCode encoded_condition(X86Condition condition)
{
    switch (condition) {
        case X86Condition::Equal: return ConditionCode::Equal;
        case X86Condition::NotEqual: return ConditionCode::NotEqual;
        case X86Condition::Less: return ConditionCode::Less;
        case X86Condition::LessEqual: return ConditionCode::LessEqual;
        case X86Condition::Greater: return ConditionCode::Greater;
        case X86Condition::GreaterEqual: return ConditionCode::GreaterEqual;
    }
    throw std::logic_error{"unknown x86 condition"};
}

class Encoder {
public:
    explicit Encoder(ByteWriter &output) : output_(output) {}

    [[nodiscard]] CodeOffset offset() const noexcept { return output_.size(); }

    void move(Register destination, Register source)
    {
        opcode(Opcode::MoveRm32FromReg32);
        mod_rm(AddressMode::Direct, source, destination);
    }

    [[nodiscard]] CodeOffset move_immediate(
        Register destination, TargetWord value)
    {
        byte(with_register(Opcode::MoveRegisterImmediateBase, destination));
        const CodeOffset operand = offset();
        word(value);
        return operand;
    }

    [[nodiscard]] CodeOffset load_absolute(
        Register destination, TargetWord address)
    {
        if (destination == Register::Eax) {
            opcode(Opcode::MoveEaxFromAbsolute);
        } else {
            opcode(Opcode::MoveReg32FromRm32);
            // mod=00,r/m=101 is the special absolute [disp32] form.
            mod_rm(AddressMode::Indirect, destination, Register::Ebp);
        }
        const CodeOffset operand = offset();
        word(address);
        return operand;
    }

    [[nodiscard]] CodeOffset store_absolute(
        Register source, TargetWord address)
    {
        if (source == Register::Eax) {
            opcode(Opcode::MoveAbsoluteFromEax);
        } else {
            opcode(Opcode::MoveRm32FromReg32);
            mod_rm(AddressMode::Indirect, source, Register::Ebp);
        }
        const CodeOffset operand = offset();
        word(address);
        return operand;
    }

    void load_displacement8(
        Register destination, Register base, TargetSignedWord displacement)
    {
        if (displacement < std::numeric_limits<std::int8_t>::min() ||
            displacement > std::numeric_limits<std::int8_t>::max()) {
            throw std::overflow_error{"x86 disp8 is outside its signed range"};
        }
        opcode(Opcode::MoveReg32FromRm32);
        mod_rm(AddressMode::Displacement8, destination, base);
        byte(static_cast<EncodedByte>(displacement));
    }

    void store_displacement8(
        Register base, TargetSignedWord displacement, Register source)
    {
        if (displacement < std::numeric_limits<std::int8_t>::min() ||
            displacement > std::numeric_limits<std::int8_t>::max()) {
            throw std::overflow_error{"x86 disp8 is outside its signed range"};
        }
        opcode(Opcode::MoveRm32FromReg32);
        mod_rm(AddressMode::Displacement8, source, base);
        byte(static_cast<EncodedByte>(displacement));
    }

    void load_stack_displacement32(
        Register destination, TargetSignedWord displacement)
    {
        opcode(Opcode::MoveReg32FromRm32);
        mod_rm(AddressMode::Displacement32, destination, Register::Esp);
        byte(sib_no_index(Register::Esp));
        word(static_cast<TargetWord>(displacement));
    }

    void store_stack_displacement32(
        TargetSignedWord displacement, Register source)
    {
        opcode(Opcode::MoveRm32FromReg32);
        mod_rm(AddressMode::Displacement32, source, Register::Esp);
        byte(sib_no_index(Register::Esp));
        word(static_cast<TargetWord>(displacement));
    }

    void load_indirect(Register destination, Register address)
    {
        opcode(Opcode::MoveReg32FromRm32);
        mod_rm(AddressMode::Indirect, destination, address);
        if (address == Register::Esp) {
            byte(sib_no_index(Register::Esp));
        }
    }

    void load_indirect_byte(Register destination, Register address)
    {
        opcode(Opcode::Escape0F);
        secondary_opcode(SecondaryOpcode::MoveZeroExtendByte);
        mod_rm(AddressMode::Indirect, destination, address);
    }

    void store_indirect(Register address, Register source)
    {
        opcode(Opcode::MoveRm32FromReg32);
        mod_rm(AddressMode::Indirect, source, address);
    }

    void store_indirect_byte(Register address, Register source)
    {
        opcode(Opcode::MoveRm8FromReg8);
        mod_rm(AddressMode::Indirect, source, address);
    }

    void push(Register reg)
    {
        byte(with_register(Opcode::PushRegisterBase, reg));
    }

    void pop(Register reg)
    {
        byte(with_register(Opcode::PopRegisterBase, reg));
    }

    void add_immediate(Register destination, TargetWord value)
    {
        if (destination == Register::Eax) {
            opcode(Opcode::AddEaxImmediate32);
        } else {
            opcode(Opcode::GroupImmediate32);
            mod_rm(AddressMode::Direct,
                   encoded(GroupOperation::AddImmediate), destination);
        }
        word(value);
    }

    void binary(BinaryOperation operation, Register destination, Register source)
    {
        switch (operation) {
            case BinaryOperation::Add: opcode(Opcode::AddRm32Reg32); break;
            case BinaryOperation::Subtract:
                opcode(Opcode::SubtractRm32Reg32); break;
            case BinaryOperation::BitAnd: opcode(Opcode::BitAndRm32Reg32); break;
            case BinaryOperation::BitOr: opcode(Opcode::BitOrRm32Reg32); break;
            case BinaryOperation::BitXor: opcode(Opcode::BitXorRm32Reg32); break;
            case BinaryOperation::Compare:
                opcode(Opcode::CompareRm32Reg32); break;
        }
        mod_rm(AddressMode::Direct, source, destination);
    }

    void test(Register left, Register right)
    {
        opcode(Opcode::TestRm32Reg32);
        mod_rm(AddressMode::Direct, right, left);
    }

    void shift_by_cl(GroupOperation operation, Register destination)
    {
        opcode(Opcode::ShiftByCl);
        mod_rm(AddressMode::Direct, encoded(operation), destination);
    }

    void signed_multiply(Register destination, Register source)
    {
        opcode(Opcode::Escape0F);
        secondary_opcode(SecondaryOpcode::SignedMultiply);
        // IMUL reverses the usual r/m,reg destination convention: reg is the
        // destination and r/m is the source.
        mod_rm(AddressMode::Direct, destination, source);
    }

    void sign_extend_eax_into_edx()
    {
        opcode(Opcode::SignExtendEaxIntoEdx);
    }

    void signed_divide(Register divisor)
    {
        opcode(Opcode::GroupUnary);
        mod_rm(AddressMode::Direct,
               encoded(GroupOperation::SignedDivide), divisor);
    }

    void negate(Register destination)
    {
        opcode(Opcode::GroupUnary);
        mod_rm(AddressMode::Direct,
               encoded(GroupOperation::Negate), destination);
    }

    void set_condition(Register byte_destination, ConditionCode condition)
    {
        opcode(Opcode::Escape0F);
        byte(static_cast<EncodedByte>(
            encoded(SecondaryOpcode::SetConditionBase) | encoded(condition)));
        mod_rm(AddressMode::Direct, NoOpcodeExtension, byte_destination);
    }

    void move_zero_extended_byte(Register destination, Register byte_source)
    {
        opcode(Opcode::Escape0F);
        secondary_opcode(SecondaryOpcode::MoveZeroExtendByte);
        mod_rm(AddressMode::Direct, destination, byte_source);
    }

    [[nodiscard]] CodeOffset call_placeholder()
    {
        opcode(Opcode::CallRelative32);
        return placeholder_word();
    }

    [[nodiscard]] CodeOffset jump_placeholder()
    {
        opcode(Opcode::JumpRelative32);
        return placeholder_word();
    }

    [[nodiscard]] CodeOffset conditional_jump_placeholder(
        ConditionCode condition)
    {
        opcode(Opcode::Escape0F);
        byte(static_cast<EncodedByte>(
            encoded(SecondaryOpcode::JumpConditionBase) | encoded(condition)));
        return placeholder_word();
    }

    void interrupt(EncodedByte vector)
    {
        opcode(Opcode::Interrupt);
        byte(vector);
    }

    void return_near() { opcode(Opcode::ReturnNear); }

private:
    void byte(EncodedByte value) { output_.append_u8(value); }
    void word(TargetWord value) { output_.append_u32_le(value); }
    void opcode(Opcode value) { byte(encoded(value)); }
    void secondary_opcode(SecondaryOpcode value) { byte(encoded(value)); }

    void mod_rm(AddressMode mode, Register reg, Register rm)
    {
        byte(::mawkcc::mod_rm(mode, reg, rm));
    }

    void mod_rm(AddressMode mode, EncodedByte operation, Register rm)
    {
        byte(::mawkcc::mod_rm(mode, operation, rm));
    }

    [[nodiscard]] CodeOffset placeholder_word()
    {
        const CodeOffset operand = offset();
        word(PlaceholderOperand);
        return operand;
    }

    ByteWriter &output_;
};

constexpr EncodedByte LinuxSoftwareInterrupt = 0x80;

} // namespace

void X86Emitter::reset()
{
    code_.clear();
    code_.reserve(InitialCodeCapacity);
}

CodeOffset X86Emitter::offset() const noexcept { return code_.size(); }
const ByteWriter &X86Emitter::bytes() const noexcept { return code_; }

void X86Emitter::patch_word(CodeOffset position, TargetWord value)
{
    code_.patch_u32_le(position, value);
}

void X86Emitter::patch_relative(CodeOffset position, CodeOffset target)
{
    // rel32 is measured from the end of its own four-byte operand.
    const auto displacement = static_cast<std::int64_t>(target) -
                              static_cast<std::int64_t>(
                                  position + sizeof(TargetWord));
    if (displacement < std::numeric_limits<TargetSignedWord>::min() ||
        displacement > std::numeric_limits<TargetSignedWord>::max()) {
        throw std::overflow_error{"relative x86 branch exceeds 32-bit range"};
    }
    patch_word(position, static_cast<TargetWord>(
                             static_cast<TargetSignedWord>(displacement)));
}

CodeOffset X86Emitter::mov_eax_immediate(TargetWord value)
{
    return Encoder{code_}.move_immediate(Register::Eax, value);
}

CodeOffset X86Emitter::load_eax_absolute(TargetWord address)
{
    return Encoder{code_}.load_absolute(Register::Eax, address);
}

CodeOffset X86Emitter::store_eax_absolute(TargetWord address)
{
    return Encoder{code_}.store_absolute(Register::Eax, address);
}

CodeOffset X86Emitter::load_ecx_absolute(TargetWord address)
{
    return Encoder{code_}.load_absolute(Register::Ecx, address);
}

CodeOffset X86Emitter::store_ebx_absolute(TargetWord address)
{
    return Encoder{code_}.store_absolute(Register::Ebx, address);
}

CodeOffset X86Emitter::call_placeholder()
{
    return Encoder{code_}.call_placeholder();
}

void X86Emitter::push_eax() { Encoder{code_}.push(Register::Eax); }
void X86Emitter::push_ebx() { Encoder{code_}.push(Register::Ebx); }
void X86Emitter::pop_ebx() { Encoder{code_}.pop(Register::Ebx); }
void X86Emitter::pop_ecx() { Encoder{code_}.pop(Register::Ecx); }

void X86Emitter::load_parameter(TargetSignedWord stack_offset)
{
    Encoder{code_}.load_displacement8(
        Register::Eax, Register::Ebp, stack_offset);
}

void X86Emitter::store_parameter(TargetSignedWord stack_offset)
{
    Encoder{code_}.store_displacement8(
        Register::Ebp, stack_offset, Register::Eax);
}

void X86Emitter::prologue()
{
    Encoder encoder{code_};
    encoder.push(Register::Ebp);
    encoder.move(Register::Ebp, Register::Esp);
    encoder.push(Register::Ebx);
}

void X86Emitter::epilogue()
{
    Encoder encoder{code_};
    // ebx was pushed immediately below the new frame pointer.
    encoder.load_displacement8(Register::Ebx, Register::Ebp, -TargetWordSize);
    encoder.move(Register::Esp, Register::Ebp);
    encoder.pop(Register::Ebp);
    encoder.return_near();
}

void X86Emitter::test_eax()
{
    Encoder{code_}.test(Register::Eax, Register::Eax);
}

CodeOffset X86Emitter::start()
{
    // Linux enters _start with argc at [esp] followed by argv pointers. Pass
    // main(argc, argv), restore the stack, then exit with main's return value.
    mov_eax_esp();
    mov_ebx_from_esp();
    Encoder{code_}.add_immediate(
        Register::Eax, static_cast<TargetWord>(TargetWordSize));
    push_eax();
    push_ebx();
    const CodeOffset call_patch = call_placeholder();
    add_esp(static_cast<TargetWord>(2 * TargetWordSize));
    mov_ebx_eax();
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Exit));
    interrupt_80();
    return call_patch;
}

void X86Emitter::add_esp(TargetWord value)
{
    Encoder{code_}.add_immediate(Register::Esp, value);
}

void X86Emitter::mov_eax_esp()
{
    Encoder{code_}.move(Register::Eax, Register::Esp);
}

void X86Emitter::mov_ebx_from_esp()
{
    Encoder{code_}.load_indirect(Register::Ebx, Register::Esp);
}

void X86Emitter::reverse_arguments(ArgumentCount count)
{
    if (count > static_cast<ArgumentCount>(
                    std::numeric_limits<TargetSignedWord>::max() /
                        TargetWordSize)) {
        throw std::overflow_error{"argument stack exceeds i386 range"};
    }
    Encoder encoder{code_};
    for (ArgumentCount index = 0; index < count / 2U; ++index) {
        const auto low = static_cast<TargetSignedWord>(TargetWordSize * index);
        const auto high =
            static_cast<TargetSignedWord>(
                TargetWordSize * (count - 1U - index));
        encoder.load_stack_displacement32(Register::Eax, low);
        encoder.load_stack_displacement32(Register::Ebx, high);
        encoder.store_stack_displacement32(low, Register::Ebx);
        encoder.store_stack_displacement32(high, Register::Eax);
    }
}

CodeOffset X86Emitter::je_placeholder()
{
    return Encoder{code_}.conditional_jump_placeholder(ConditionCode::Equal);
}

CodeOffset X86Emitter::jne_placeholder()
{
    return Encoder{code_}.conditional_jump_placeholder(ConditionCode::NotEqual);
}

CodeOffset X86Emitter::jmp_placeholder()
{
    return Encoder{code_}.jump_placeholder();
}

void X86Emitter::jump(CodeOffset target)
{
    const CodeOffset operand = jmp_placeholder();
    patch_relative(operand, target);
}

void X86Emitter::mov_ebx_eax()
{
    Encoder{code_}.move(Register::Ebx, Register::Eax);
}

void X86Emitter::mov_edx_eax()
{
    Encoder{code_}.move(Register::Edx, Register::Eax);
}

void X86Emitter::mov_ebx_ecx()
{
    Encoder{code_}.move(Register::Ebx, Register::Ecx);
}

void X86Emitter::mov_eax_ecx()
{
    Encoder{code_}.move(Register::Eax, Register::Ecx);
}

void X86Emitter::xor_ebx()
{
    Encoder{code_}.binary(
        BinaryOperation::BitXor, Register::Ebx, Register::Ebx);
}

void X86Emitter::xor_eax()
{
    Encoder{code_}.binary(
        BinaryOperation::BitXor, Register::Eax, Register::Eax);
}

void X86Emitter::add_ebx_edx()
{
    Encoder{code_}.binary(
        BinaryOperation::Add, Register::Ebx, Register::Edx);
}

void X86Emitter::cmp_eax_ebx()
{
    Encoder{code_}.binary(
        BinaryOperation::Compare, Register::Eax, Register::Ebx);
}

void X86Emitter::interrupt_80()
{
    Encoder{code_}.interrupt(LinuxSoftwareInterrupt);
}

void X86Emitter::add()
{
    Encoder{code_}.binary(
        BinaryOperation::Add, Register::Eax, Register::Ebx);
}

void X86Emitter::bit_and()
{
    Encoder{code_}.binary(
        BinaryOperation::BitAnd, Register::Eax, Register::Ebx);
}

void X86Emitter::bit_or()
{
    Encoder{code_}.binary(
        BinaryOperation::BitOr, Register::Eax, Register::Ebx);
}

void X86Emitter::bit_xor()
{
    Encoder{code_}.binary(
        BinaryOperation::BitXor, Register::Eax, Register::Ebx);
}

void X86Emitter::shift_left()
{
    Encoder encoder{code_};
    encoder.move(Register::Ecx, Register::Eax);
    encoder.shift_by_cl(GroupOperation::ShiftLeft, Register::Ebx);
    encoder.move(Register::Eax, Register::Ebx);
}

void X86Emitter::shift_right()
{
    Encoder encoder{code_};
    encoder.move(Register::Ecx, Register::Eax);
    encoder.shift_by_cl(GroupOperation::ShiftRightLogical, Register::Ebx);
    encoder.move(Register::Eax, Register::Ebx);
}

void X86Emitter::subtract()
{
    Encoder encoder{code_};
    encoder.move(Register::Ecx, Register::Eax);
    encoder.move(Register::Eax, Register::Ebx);
    encoder.binary(BinaryOperation::Subtract, Register::Eax, Register::Ecx);
}

void X86Emitter::multiply()
{
    Encoder{code_}.signed_multiply(Register::Eax, Register::Ebx);
}

void X86Emitter::divide()
{
    Encoder encoder{code_};
    encoder.move(Register::Ecx, Register::Eax);
    encoder.move(Register::Eax, Register::Ebx);
    encoder.sign_extend_eax_into_edx();
    encoder.signed_divide(Register::Ecx);
}

void X86Emitter::modulo()
{
    divide();
    Encoder{code_}.move(Register::Eax, Register::Edx);
}

void X86Emitter::compare_and_set(X86Condition condition)
{
    Encoder encoder{code_};
    encoder.binary(BinaryOperation::Compare, Register::Ebx, Register::Eax);
    encoder.set_condition(Register::Eax, encoded_condition(condition));
    encoder.move_zero_extended_byte(Register::Eax, Register::Eax);
}

void X86Emitter::negate()
{
    Encoder{code_}.negate(Register::Eax);
}

void X86Emitter::logical_not()
{
    Encoder encoder{code_};
    encoder.test(Register::Eax, Register::Eax);
    encoder.set_condition(Register::Eax, ConditionCode::Equal);
    encoder.move_zero_extended_byte(Register::Eax, Register::Eax);
}

void X86Emitter::read_i32()
{
    Encoder{code_}.load_indirect(Register::Eax, Register::Eax);
}

void X86Emitter::read_u8()
{
    Encoder{code_}.load_indirect_byte(Register::Eax, Register::Eax);
}

void X86Emitter::write_i32()
{
    Encoder{code_}.store_indirect(Register::Ebx, Register::Eax);
}

void X86Emitter::write_u8()
{
    Encoder encoder{code_};
    encoder.store_indirect_byte(Register::Ebx, Register::Eax);
    encoder.move_zero_extended_byte(Register::Eax, Register::Eax);
}

void X86Emitter::sys_brk()
{
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Break));
    interrupt_80();
}

void X86Emitter::sys_current_break()
{
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Break));
    xor_ebx();
    interrupt_80();
}

void X86Emitter::sys_open()
{
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Open));
    interrupt_80();
}

void X86Emitter::sys_read()
{
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Read));
    interrupt_80();
}

void X86Emitter::sys_write()
{
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Write));
    interrupt_80();
}

void X86Emitter::sys_close()
{
    mov_ebx_eax();
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Close));
    interrupt_80();
}

void X86Emitter::sys_exit()
{
    mov_ebx_eax();
    mov_eax_immediate(static_cast<TargetWord>(LinuxSyscall::Exit));
    interrupt_80();
}

} // namespace mawkcc
