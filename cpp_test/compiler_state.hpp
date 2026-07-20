#pragma once

#include "mawkcc_types.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace mawkcc {

struct FunctionSymbol {
    std::string name;
    CodeOffset code_offset;
    ArgumentCount arity;
};

struct GlobalSymbol {
    std::string name;
    DataOffset data_offset;
};

struct Parameter {
    std::string name;
    TargetSignedWord stack_offset;
};

class ParameterScope {
public:
    void enter(const std::vector<std::string> &names);
    void leave() noexcept;
    [[nodiscard]] const Parameter *find(std::string_view name) const noexcept;

private:
    std::vector<Parameter> parameters_;
};

class StaticData {
public:
    static constexpr DataOffset RuntimeSize = 4;
    static constexpr DataOffset BreakPointerOffset = 0;

    void reset();
    [[nodiscard]] DataOffset allocate_global();
    [[nodiscard]] DataOffset add_string(std::string_view text);

    [[nodiscard]] const std::vector<std::uint8_t> &bytes() const noexcept;
    [[nodiscard]] DataOffset size() const noexcept;

private:
    void ensure_capacity(std::size_t size);

    std::vector<std::uint8_t> bytes_;
    DataOffset used_ = RuntimeSize;
    DataOffset next_offset_ = RuntimeSize;
    DataOffset global_end_ = RuntimeSize;
};

enum class ElfSymbolType : std::uint8_t {
    Object = 1,
    Function = 2,
};

struct ExternalSymbol {
    std::string name;
    ElfSymbolType type;
};

class SymbolTable {
public:
    void reset() noexcept;
    [[nodiscard]] bool add_global(std::string name, DataOffset data_offset);
    [[nodiscard]] bool add_function(
        std::string name, CodeOffset code_offset, ArgumentCount arity);
    void record_external(std::string_view name, ElfSymbolType type);

    [[nodiscard]] std::optional<std::size_t> global_index(
        std::string_view name) const noexcept;
    [[nodiscard]] std::optional<std::size_t> function_index(
        std::string_view name) const noexcept;
    [[nodiscard]] std::optional<std::size_t> external_index(
        std::string_view name) const noexcept;
    [[nodiscard]] const GlobalSymbol *global(std::string_view name) const noexcept;
    [[nodiscard]] const FunctionSymbol *function(
        std::string_view name) const noexcept;

    [[nodiscard]] const std::vector<GlobalSymbol> &globals() const noexcept;
    [[nodiscard]] const std::vector<FunctionSymbol> &functions() const noexcept;
    [[nodiscard]] const std::vector<ExternalSymbol> &externals() const noexcept;

private:
    template <typename Symbol>
    [[nodiscard]] static std::optional<std::size_t> find_index(
        const std::vector<Symbol> &symbols, std::string_view name) noexcept;

    std::vector<GlobalSymbol> globals_;
    std::vector<FunctionSymbol> functions_;
    std::vector<ExternalSymbol> externals_;
};

struct PendingCall {
    std::string target;
    CodeOffset patch_offset;
    ArgumentCount argument_count;
};

enum class RelocationType : std::uint8_t {
    Absolute32 = 1,
    PcRelative32 = 2,
};

struct Relocation {
    CodeOffset offset;
    std::string symbol;
    RelocationType type;
};

struct DataPatch {
    CodeOffset offset;
    DataOffset addend;
};

struct BreakPatch {
    LoopId loop_id;
    CodeOffset offset;
};

class FixupTable {
public:
    void reset() noexcept;
    void add_call(std::string_view target, CodeOffset patch_offset,
                  ArgumentCount argument_count);
    void add_relocation(CodeOffset offset, std::string_view symbol,
                        RelocationType type);
    void add_data_patch(CodeOffset offset, DataOffset addend);
    void add_break(LoopId loop_id, CodeOffset offset);

    [[nodiscard]] const std::vector<PendingCall> &calls() const noexcept;
    [[nodiscard]] const std::vector<Relocation> &relocations() const noexcept;
    [[nodiscard]] const std::vector<DataPatch> &data_patches() const noexcept;
    [[nodiscard]] const std::vector<BreakPatch> &break_patches() const noexcept;

private:
    std::vector<PendingCall> calls_;
    std::vector<Relocation> relocations_;
    std::vector<DataPatch> data_patches_;
    std::vector<BreakPatch> break_patches_;
};

} // namespace mawkcc
