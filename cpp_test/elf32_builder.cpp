#include "elf32_builder.hpp"

#include "elf32_writer.hpp"

#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

namespace mawkcc {
namespace {

constexpr TargetWord ElfHeaderSize = 52;
constexpr TargetWord ProgramHeaderSize = 32;
constexpr TargetWord SectionHeaderSize = 40;
constexpr TargetWord SymbolEntrySize = 16;
constexpr TargetWord RelocationEntrySize = 8;
constexpr TargetWord TargetWordAlignment = 4;
constexpr TargetWord ImageBase = 0x08048000U;
constexpr TargetWord PageAlignment = 4096;
constexpr TargetWord DataSectionSymbolIndex = 1;
constexpr TargetWord FirstNamedSymbolIndex = 2;
constexpr unsigned SymbolBindingShift = 4U;
constexpr unsigned RelocationSymbolShift = 8U;

enum class ElfClass : TargetWord {
    Elf32 = 1,
};

enum class ElfEncoding : TargetWord {
    LittleEndian = 1,
};

enum class ElfVersion : TargetWord {
    Current = 1,
};

enum class ElfAbi : TargetWord {
    SystemV = 0,
};

enum class ElfType : TargetWord {
    Relocatable = 1,
    Executable = 2,
};

enum class ElfMachine : TargetWord {
    I386 = 3,
};

enum class ProgramType : TargetWord {
    Load = 1,
};

enum class ProgramFlags : TargetWord {
    Read = 4,
    Write = 2,
    Execute = 1,
};

enum class SectionType : TargetWord {
    Null = 0,
    ProgramBits = 1,
    SymbolTable = 2,
    StringTable = 3,
    NoBits = 8,
    Relocation = 9,
};

enum class SectionFlags : TargetWord {
    None = 0,
    Write = 1,
    Allocate = 2,
    Executable = 4,
    InfoLink = 64,
};

enum class SectionIndex : TargetWord {
    Undefined = 0,
    Text = 1,
    RelText = 2,
    Data = 3,
    Bss = 4,
    SymbolTable = 5,
    StringTable = 6,
    SectionNameTable = 7,
    Count = 8,
    Common = 0xfff2,
};

enum class SymbolBinding : TargetWord {
    Local = 0,
    Global = 1,
};

enum class SymbolType : TargetWord {
    None = 0,
    Object = 1,
    Function = 2,
    Section = 3,
};

constexpr TargetWord encoded(ElfClass value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(ElfEncoding value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(ElfVersion value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(ElfAbi value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(ElfType value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(ElfMachine value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(ProgramType value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(ProgramFlags value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(SectionType value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(SectionFlags value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(SectionIndex value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(SymbolBinding value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr TargetWord encoded(SymbolType value) noexcept
{
    return static_cast<TargetWord>(value);
}

constexpr ProgramFlags operator|(ProgramFlags left, ProgramFlags right) noexcept
{
    return static_cast<ProgramFlags>(encoded(left) | encoded(right));
}

constexpr SectionFlags operator|(SectionFlags left, SectionFlags right) noexcept
{
    return static_cast<SectionFlags>(encoded(left) | encoded(right));
}

struct ElfHeader {
    ElfType type;
    TargetWord entry = 0;
    TargetWord program_header_offset = 0;
    TargetWord section_header_offset = 0;
    TargetWord program_header_count = 0;
    TargetWord section_header_count = 0;
    SectionIndex section_name_table_index = SectionIndex::Undefined;
};

struct ProgramHeader {
    ProgramType type;
    TargetWord offset;
    TargetWord virtual_address;
    TargetWord physical_address;
    TargetWord file_size;
    TargetWord memory_size;
    ProgramFlags flags;
    TargetWord alignment;
};

struct SectionHeader {
    TargetWord name;
    SectionType type;
    SectionFlags flags;
    TargetWord address;
    TargetWord offset;
    TargetWord size;
    SectionIndex link;
    TargetWord info;
    TargetWord alignment;
    TargetWord entry_size;
};

struct Symbol {
    TargetWord name;
    TargetWord value;
    TargetWord size;
    SymbolBinding binding;
    SymbolType type;
    SectionIndex section;
};

TargetWord to_target(std::size_t value, const char *description)
{
    if (value > std::numeric_limits<TargetWord>::max()) {
        throw std::overflow_error{std::string{description} +
                                  " exceeds the ELF32 target range"};
    }
    return static_cast<TargetWord>(value);
}

class StringTable {
public:
    StringTable() : bytes_(1, '\0') {}

    [[nodiscard]] TargetWord add(std::string_view text)
    {
        const TargetWord offset = to_target(bytes_.size(), "string offset");
        bytes_.append(text);
        bytes_.push_back('\0');
        return offset;
    }

    [[nodiscard]] TargetWord size() const
    {
        return to_target(bytes_.size(), "string table");
    }

    [[nodiscard]] std::string_view bytes() const noexcept { return bytes_; }

private:
    std::string bytes_;
};

struct SectionNames {
    explicit SectionNames(StringTable &table)
        : text(table.add(".text")),
          rel_text(table.add(".rel.text")),
          data(table.add(".data")),
          bss(table.add(".bss")),
          symbol_table(table.add(".symtab")),
          string_table(table.add(".strtab")),
          section_name_table(table.add(".shstrtab"))
    {
    }

    TargetWord text;
    TargetWord rel_text;
    TargetWord data;
    TargetWord bss;
    TargetWord symbol_table;
    TargetWord string_table;
    TargetWord section_name_table;
};

TargetWord align_target_word(std::size_t value)
{
    constexpr std::size_t Alignment = TargetWordAlignment;
    const std::size_t aligned = (value + Alignment - 1U) & ~(Alignment - 1U);
    if (aligned < value) {
        throw std::overflow_error{"ELF32 alignment overflow"};
    }
    return to_target(aligned, "aligned ELF offset");
}

void validate_data(const std::vector<std::uint8_t> &data, DataOffset data_size)
{
    if (data.size() < static_cast<std::size_t>(data_size)) {
        throw std::logic_error{"static data view is shorter than its ELF size"};
    }
}

void write_identification(Elf32Writer &writer)
{
    constexpr TargetWord IdentificationPaddingSize = 8;

    writer.byte(0x7f);
    writer.text("ELF");
    writer.byte(encoded(ElfClass::Elf32));
    writer.byte(encoded(ElfEncoding::LittleEndian));
    writer.byte(encoded(ElfVersion::Current));
    writer.byte(encoded(ElfAbi::SystemV));
    for (TargetWord index = 0; index < IdentificationPaddingSize; ++index) {
        writer.byte(0);
    }
}

void write_header(Elf32Writer &writer, const ElfHeader &header)
{
    write_identification(writer);
    writer.half(encoded(header.type));
    writer.half(encoded(ElfMachine::I386));
    writer.word(encoded(ElfVersion::Current));
    writer.word(header.entry);
    writer.word(header.program_header_offset);
    writer.word(header.section_header_offset);
    writer.word(0); // i386 defines no processor-specific ELF header flags.
    writer.half(ElfHeaderSize);
    writer.half(
        header.program_header_count == 0 ? 0 : ProgramHeaderSize);
    writer.half(header.program_header_count);
    writer.half(
        header.section_header_count == 0 ? 0 : SectionHeaderSize);
    writer.half(header.section_header_count);
    writer.half(encoded(header.section_name_table_index));
}

void write_program_header(Elf32Writer &writer, const ProgramHeader &header)
{
    writer.word(encoded(header.type));
    writer.word(header.offset);
    writer.word(header.virtual_address);
    writer.word(header.physical_address);
    writer.word(header.file_size);
    writer.word(header.memory_size);
    writer.word(encoded(header.flags));
    writer.word(header.alignment);
}

void write_section_header(Elf32Writer &writer, const SectionHeader &section)
{
    writer.word(section.name);
    writer.word(encoded(section.type));
    writer.word(encoded(section.flags));
    writer.word(section.address);
    writer.word(section.offset);
    writer.word(section.size);
    writer.word(encoded(section.link));
    writer.word(section.info);
    writer.word(section.alignment);
    writer.word(section.entry_size);
}

constexpr TargetWord symbol_info(
    SymbolBinding binding, SymbolType type) noexcept
{
    return (encoded(binding) << SymbolBindingShift) | encoded(type);
}

void write_symbol(Elf32Writer &writer, const Symbol &symbol)
{
    writer.word(symbol.name);
    writer.word(symbol.value);
    writer.word(symbol.size);
    writer.byte(symbol_info(symbol.binding, symbol.type));
    writer.byte(0); // st_other: default visibility.
    writer.half(encoded(symbol.section));
}

SymbolType symbol_type(ElfSymbolType type)
{
    switch (type) {
        case ElfSymbolType::Object: return SymbolType::Object;
        case ElfSymbolType::Function: return SymbolType::Function;
    }
    throw std::logic_error{"unknown ELF symbol type"};
}

constexpr TargetWord relocation_info(
    TargetWord symbol_index, RelocationType type) noexcept
{
    return (symbol_index << RelocationSymbolShift) |
           static_cast<TargetWord>(type);
}

SectionHeader null_section()
{
    return SectionHeader{0, SectionType::Null, SectionFlags::None, 0, 0, 0,
                         SectionIndex::Undefined, 0, 0, 0};
}

SectionHeader text_section(
    TargetWord name, TargetWord offset, TargetWord size)
{
    return SectionHeader{
        name,
        SectionType::ProgramBits,
        SectionFlags::Allocate | SectionFlags::Executable,
        0,
        offset,
        size,
        SectionIndex::Undefined,
        0,
        1,
        0,
    };
}

SectionHeader relocation_section(
    TargetWord name, TargetWord offset, TargetWord size)
{
    return SectionHeader{
        name,
        SectionType::Relocation,
        SectionFlags::InfoLink,
        0,
        offset,
        size,
        SectionIndex::SymbolTable,
        encoded(SectionIndex::Text),
        TargetWordAlignment,
        RelocationEntrySize,
    };
}

SectionHeader data_section(
    TargetWord name, TargetWord offset, TargetWord size)
{
    return SectionHeader{
        name,
        SectionType::ProgramBits,
        SectionFlags::Write | SectionFlags::Allocate,
        0,
        offset,
        size,
        SectionIndex::Undefined,
        0,
        1,
        0,
    };
}

SectionHeader bss_section(TargetWord name, TargetWord offset)
{
    return SectionHeader{
        name,
        SectionType::NoBits,
        SectionFlags::Write | SectionFlags::Allocate,
        0,
        offset,
        0,
        SectionIndex::Undefined,
        0,
        1,
        0,
    };
}

SectionHeader symbol_table_section(
    TargetWord name, TargetWord offset, TargetWord size)
{
    return SectionHeader{
        name,
        SectionType::SymbolTable,
        SectionFlags::None,
        0,
        offset,
        size,
        SectionIndex::StringTable,
        FirstNamedSymbolIndex,
        TargetWordAlignment,
        SymbolEntrySize,
    };
}

SectionHeader string_table_section(
    TargetWord name, TargetWord offset, TargetWord size)
{
    return SectionHeader{
        name,
        SectionType::StringTable,
        SectionFlags::None,
        0,
        offset,
        size,
        SectionIndex::Undefined,
        0,
        1,
        0,
    };
}

ElfHeader executable_header(const ExecutableLayout &layout)
{
    ElfHeader header{ElfType::Executable};
    header.entry = layout.entry_address;
    header.program_header_offset = ElfHeaderSize;
    header.program_header_count = 1;
    return header;
}

ElfHeader relocatable_header(TargetWord section_header_offset)
{
    ElfHeader header{ElfType::Relocatable};
    header.section_header_offset = section_header_offset;
    header.section_header_count = encoded(SectionIndex::Count);
    header.section_name_table_index = SectionIndex::SectionNameTable;
    return header;
}

ProgramHeader load_program_header(const ExecutableLayout &layout)
{
    return ProgramHeader{
        ProgramType::Load,
        0,
        layout.image_base,
        layout.image_base,
        layout.file_size,
        layout.file_size,
        ProgramFlags::Read | ProgramFlags::Write | ProgramFlags::Execute,
        PageAlignment,
    };
}

Symbol null_symbol()
{
    return Symbol{0, 0, 0, SymbolBinding::Local, SymbolType::None,
                  SectionIndex::Undefined};
}

Symbol data_section_symbol(DataOffset data_size)
{
    return Symbol{0, 0, data_size, SymbolBinding::Local, SymbolType::Section,
                  SectionIndex::Data};
}

Symbol function_symbol(
    TargetWord name, TargetWord offset, TargetWord size)
{
    return Symbol{name, offset, size, SymbolBinding::Global,
                  SymbolType::Function, SectionIndex::Text};
}

Symbol common_object_symbol(TargetWord name)
{
    return Symbol{name, TargetWordAlignment, TargetWordAlignment,
                  SymbolBinding::Global, SymbolType::Object,
                  SectionIndex::Common};
}

Symbol undefined_symbol(TargetWord name, SymbolType type)
{
    return Symbol{name, 0, 0, SymbolBinding::Global, type,
                  SectionIndex::Undefined};
}

} // namespace

ExecutableLayout calculate_executable_layout(
    std::size_t code_size, DataOffset data_size)
{
    const TargetWord headers = ElfHeaderSize + ProgramHeaderSize;
    const TargetWord data_offset =
        align_target_word(static_cast<std::size_t>(headers) + code_size);
    const std::size_t file_size =
        static_cast<std::size_t>(data_offset) + data_size;
    return ExecutableLayout{
        ImageBase,
        headers,
        ImageBase + headers,
        data_offset,
        ImageBase + data_offset,
        to_target(file_size, "ELF executable"),
    };
}

std::vector<std::uint8_t> build_elf32_executable(
    const ByteWriter &code, const std::vector<std::uint8_t> &data,
    DataOffset data_size, const ExecutableLayout &layout)
{
    validate_data(data, data_size);
    Elf32Writer writer;
    writer.reset();
    write_header(writer, executable_header(layout));
    write_program_header(writer, load_program_header(layout));

    writer.append(code);
    writer.pad_to(layout.data_offset);
    for (std::size_t index = 0; index < data_size; ++index) {
        writer.byte(data[index]);
    }
    return writer.take_image();
}

std::vector<std::uint8_t> build_elf32_object(
    const ByteWriter &code, const std::vector<std::uint8_t> &data,
    DataOffset data_size, const SymbolTable &symbols,
    const FixupTable &fixups)
{
    validate_data(data, data_size);
    const auto &functions = symbols.functions();
    const auto &globals = symbols.globals();
    const auto &externals = symbols.externals();
    const auto &relocations = fixups.relocations();
    const std::size_t function_count = functions.size();
    const std::size_t global_count = globals.size();
    const std::size_t external_count = externals.size();
    const std::size_t named_symbol_count =
        function_count + global_count + external_count;
    std::vector<TargetWord> symbol_name_offsets(named_symbol_count);
    std::vector<TargetWord> symbol_indices(named_symbol_count);

    StringTable symbol_names;
    for (std::size_t index = 0; index < function_count; ++index) {
        symbol_indices[index] = to_target(
            index + FirstNamedSymbolIndex, "function symbol index");
        symbol_name_offsets[index] = symbol_names.add(functions[index].name);
    }
    for (std::size_t index = 0; index < global_count; ++index) {
        const std::size_t combined = function_count + index;
        symbol_indices[combined] =
            to_target(combined + FirstNamedSymbolIndex, "global symbol index");
        symbol_name_offsets[combined] = symbol_names.add(globals[index].name);
    }
    for (std::size_t index = 0; index < external_count; ++index) {
        const std::size_t combined = function_count + global_count + index;
        symbol_indices[combined] = to_target(
            combined + FirstNamedSymbolIndex, "external symbol index");
        symbol_name_offsets[combined] = symbol_names.add(externals[index].name);
    }

    StringTable section_names;
    const SectionNames section_name_offsets{section_names};

    const TargetWord symbol_count =
        to_target(named_symbol_count + FirstNamedSymbolIndex, "symbol count");
    const TargetWord symbol_table_size = symbol_count * SymbolEntrySize;
    const TargetWord relocation_size = to_target(
        relocations.size() * RelocationEntrySize, "relocation table");

    const TargetWord text_offset = ElfHeaderSize;
    const TargetWord data_offset =
        align_target_word(static_cast<std::size_t>(text_offset) + code.size());
    const TargetWord relocation_offset =
        align_target_word(static_cast<std::size_t>(data_offset) + data_size);
    const TargetWord symbol_table_offset = relocation_offset + relocation_size;
    const TargetWord string_table_offset =
        symbol_table_offset + symbol_table_size;
    const TargetWord section_name_offset =
        string_table_offset + symbol_names.size();
    const TargetWord section_header_offset = align_target_word(
        static_cast<std::size_t>(section_name_offset) + section_names.size());

    Elf32Writer writer;
    writer.reset();
    write_header(writer, relocatable_header(section_header_offset));
    writer.append(code);
    writer.pad_to(data_offset);
    for (std::size_t index = 0; index < data_size; ++index) {
        writer.byte(data[index]);
    }

    writer.pad_to(relocation_offset);
    for (const Relocation &relocation : relocations) {
        TargetWord symbol_index = 0;
        if (relocation.symbol == ".data") {
            symbol_index = DataSectionSymbolIndex;
        } else if (const auto function =
                       symbols.function_index(relocation.symbol)) {
            symbol_index = symbol_indices[*function];
        } else if (const auto global =
                       symbols.global_index(relocation.symbol)) {
            symbol_index = symbol_indices[function_count + *global];
        } else if (const auto external =
                       symbols.external_index(relocation.symbol)) {
            symbol_index =
                symbol_indices[function_count + global_count + *external];
        } else {
            throw std::logic_error{"relocation references unknown symbol `" +
                                   relocation.symbol + "`"};
        }
        writer.word(to_target(relocation.offset, "relocation offset"));
        writer.word(relocation_info(symbol_index, relocation.type));
    }

    writer.pad_to(symbol_table_offset);
    write_symbol(writer, null_symbol());
    write_symbol(writer, data_section_symbol(data_size));

    for (std::size_t index = 0; index < function_count; ++index) {
        const CodeOffset start = functions[index].code_offset;
        const CodeOffset end = index + 1U < function_count
            ? functions[index + 1U].code_offset
            : code.size();
        write_symbol(writer, function_symbol(
            symbol_name_offsets[index],
            to_target(start, "function offset"),
            to_target(end - start, "function size")));
    }
    for (std::size_t index = 0; index < global_count; ++index) {
        write_symbol(writer, common_object_symbol(
            symbol_name_offsets[function_count + index]));
    }
    for (std::size_t index = 0; index < external_count; ++index) {
        write_symbol(writer, undefined_symbol(
            symbol_name_offsets[function_count + global_count + index],
            symbol_type(externals[index].type)));
    }

    writer.text(symbol_names.bytes());
    writer.text(section_names.bytes());

    writer.pad_to(section_header_offset);
    write_section_header(writer, null_section());
    write_section_header(writer, text_section(
        section_name_offsets.text, text_offset,
        to_target(code.size(), "generated code")));
    write_section_header(writer, relocation_section(
        section_name_offsets.rel_text, relocation_offset, relocation_size));
    write_section_header(writer, data_section(
        section_name_offsets.data, data_offset, data_size));
    write_section_header(writer, bss_section(
        section_name_offsets.bss, data_offset + data_size));
    write_section_header(writer, symbol_table_section(
        section_name_offsets.symbol_table,
        symbol_table_offset, symbol_table_size));
    write_section_header(writer, string_table_section(
        section_name_offsets.string_table,
        string_table_offset, symbol_names.size()));
    write_section_header(writer, string_table_section(
        section_name_offsets.section_name_table,
        section_name_offset, section_names.size()));

    return writer.take_image();
}

} // namespace mawkcc
