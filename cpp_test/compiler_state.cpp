#include "compiler_state.hpp"

#include <utility>
#include <limits>
#include <stdexcept>

namespace mawkcc {

void ParameterScope::enter(const std::vector<std::string> &names)
{
    parameters_.clear();
    parameters_.reserve(names.size());
    for (std::size_t index = 0; index < names.size(); ++index) {
        const std::size_t offset = 8U + 4U * index;
        if (offset > static_cast<std::size_t>(
                         std::numeric_limits<TargetSignedWord>::max())) {
            throw std::overflow_error{"parameter stack offset exceeds i386 range"};
        }
        parameters_.push_back(Parameter{
            names[index], static_cast<TargetSignedWord>(offset)});
    }
}

void ParameterScope::leave() noexcept { parameters_.clear(); }

const Parameter *ParameterScope::find(std::string_view name) const noexcept
{
    for (const Parameter &parameter : parameters_) {
        if (parameter.name == name) {
            return &parameter;
        }
    }
    return nullptr;
}

void StaticData::reset()
{
    bytes_.assign(RuntimeSize, 0);
    used_ = RuntimeSize;
    next_offset_ = RuntimeSize;
    global_end_ = RuntimeSize;
}

void StaticData::ensure_capacity(std::size_t size)
{
    if (bytes_.size() < size) {
        bytes_.resize(size, 0);
    }
}

DataOffset StaticData::allocate_global()
{
    if (global_end_ < next_offset_) {
        const std::uint64_t aligned =
            (static_cast<std::uint64_t>(next_offset_) + 3U) & ~std::uint64_t{3U};
        if (aligned > std::numeric_limits<DataOffset>::max()) {
            throw std::overflow_error{"global data exceeds ELF32 range"};
        }
        global_end_ = static_cast<DataOffset>(aligned);
        next_offset_ = global_end_;
    }
    if (global_end_ > std::numeric_limits<DataOffset>::max() - 4U) {
        throw std::overflow_error{"global data exceeds ELF32 range"};
    }
    const DataOffset offset = global_end_;
    global_end_ += 4U;
    if (next_offset_ < global_end_) next_offset_ = global_end_;
    if (used_ < global_end_) used_ = global_end_;
    ensure_capacity(used_);
    return offset;
}

DataOffset StaticData::add_string(std::string_view text)
{
    const std::uint64_t end = static_cast<std::uint64_t>(next_offset_) +
                              text.size() + 1U;
    if (end > std::numeric_limits<DataOffset>::max()) {
        throw std::overflow_error{"string data exceeds ELF32 range"};
    }
    const DataOffset start = next_offset_;
    ensure_capacity(static_cast<std::size_t>(end));
    for (std::size_t index = 0; index < text.size(); ++index) {
        bytes_[static_cast<std::size_t>(start) + index] =
            static_cast<std::uint8_t>(text[index]);
    }
    bytes_[static_cast<std::size_t>(end - 1U)] = 0;
    next_offset_ = static_cast<DataOffset>(end);
    if (used_ < next_offset_) used_ = next_offset_;
    return start;
}

const std::vector<std::uint8_t> &StaticData::bytes() const noexcept
{
    return bytes_;
}

DataOffset StaticData::size() const noexcept { return used_; }

template <typename Symbol>
std::optional<std::size_t> SymbolTable::find_index(
    const std::vector<Symbol> &symbols, std::string_view name) noexcept
{
    for (std::size_t index = 0; index < symbols.size(); ++index) {
        if (symbols[index].name == name) {
            return index;
        }
    }
    return std::nullopt;
}

void SymbolTable::reset() noexcept
{
    globals_.clear();
    functions_.clear();
    externals_.clear();
}

bool SymbolTable::add_global(std::string name, DataOffset data_offset)
{
    if (global_index(name) || function_index(name)) {
        return false;
    }
    globals_.push_back(GlobalSymbol{std::move(name), data_offset});
    return true;
}

bool SymbolTable::add_function(
    std::string name, CodeOffset code_offset, ArgumentCount arity)
{
    if (function_index(name)) {
        return false;
    }
    functions_.push_back(FunctionSymbol{std::move(name), code_offset, arity});
    return true;
}

void SymbolTable::record_external(std::string_view name, ElfSymbolType type)
{
    if (function_index(name) || external_index(name)) {
        return;
    }
    externals_.push_back(ExternalSymbol{std::string{name}, type});
}

std::optional<std::size_t> SymbolTable::global_index(
    std::string_view name) const noexcept
{
    return find_index(globals_, name);
}

std::optional<std::size_t> SymbolTable::function_index(
    std::string_view name) const noexcept
{
    return find_index(functions_, name);
}

std::optional<std::size_t> SymbolTable::external_index(
    std::string_view name) const noexcept
{
    return find_index(externals_, name);
}

const GlobalSymbol *SymbolTable::global(std::string_view name) const noexcept
{
    const auto index = global_index(name);
    return index ? &globals_[*index] : nullptr;
}

const FunctionSymbol *SymbolTable::function(std::string_view name) const noexcept
{
    const auto index = function_index(name);
    return index ? &functions_[*index] : nullptr;
}

const std::vector<GlobalSymbol> &SymbolTable::globals() const noexcept
{
    return globals_;
}

const std::vector<FunctionSymbol> &SymbolTable::functions() const noexcept
{
    return functions_;
}

const std::vector<ExternalSymbol> &SymbolTable::externals() const noexcept
{
    return externals_;
}

void FixupTable::reset() noexcept
{
    calls_.clear();
    relocations_.clear();
    data_patches_.clear();
    break_patches_.clear();
}

void FixupTable::add_call(std::string_view target, CodeOffset patch_offset,
                          ArgumentCount argument_count)
{
    calls_.push_back(PendingCall{std::string{target}, patch_offset,
                                 argument_count});
}

void FixupTable::add_relocation(
    CodeOffset offset, std::string_view symbol, RelocationType type)
{
    relocations_.push_back(Relocation{offset, std::string{symbol}, type});
}

void FixupTable::add_data_patch(CodeOffset offset, DataOffset addend)
{
    data_patches_.push_back(DataPatch{offset, addend});
}

void FixupTable::add_break(LoopId loop_id, CodeOffset offset)
{
    break_patches_.push_back(BreakPatch{loop_id, offset});
}

const std::vector<PendingCall> &FixupTable::calls() const noexcept { return calls_; }
const std::vector<Relocation> &FixupTable::relocations() const noexcept { return relocations_; }
const std::vector<DataPatch> &FixupTable::data_patches() const noexcept { return data_patches_; }
const std::vector<BreakPatch> &FixupTable::break_patches() const noexcept { return break_patches_; }

} // namespace mawkcc
