#include "elf32_builder.hpp"

#include "elf32_writer.hpp"

#include <limits>
#include <stdexcept>
#include <string>

namespace mawkcc {
namespace {

constexpr TargetWord ElfHeaderSize = 52;
constexpr TargetWord ProgramHeaderSize = 32;
constexpr TargetWord SectionHeaderSize = 40;
constexpr TargetWord ImageBase = 0x08048000U;
constexpr TargetWord PageAlignment = 4096;
constexpr TargetWord SectionCount = 8;
constexpr TargetWord SectionNameTableIndex = 7;
constexpr TargetWord SectionNameTableSize = 54;

enum class ElfType : TargetWord {
    Relocatable = 1,
    Executable = 2,
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

struct SectionHeader {
    TargetWord name;
    SectionType type;
    SectionFlags flags;
    TargetWord address;
    TargetWord offset;
    TargetWord size;
    TargetWord link;
    TargetWord info;
    TargetWord alignment;
    TargetWord entry_size;
};

TargetWord to_target(std::size_t value, const char *description)
{
    if (value > std::numeric_limits<TargetWord>::max()) {
        throw std::overflow_error{std::string{description} +
                                  " exceeds the ELF32 target range"};
    }
    return static_cast<TargetWord>(value);
}

TargetWord align4(std::size_t value)
{
    const std::size_t aligned = (value + 3U) & ~std::size_t{3U};
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
    writer.byte(0x7f); writer.byte('E'); writer.byte('L'); writer.byte('F');
    writer.byte(1); writer.byte(1); writer.byte(1); writer.byte(0);
    for (int index = 0; index < 8; ++index) {
        writer.byte(0);
    }
}

void write_header(Elf32Writer &writer, ElfType type, TargetWord entry,
                  TargetWord program_header_offset,
                  TargetWord section_header_offset,
                  TargetWord program_header_count,
                  TargetWord section_header_count,
                  TargetWord section_name_table_index)
{
    write_identification(writer);
    writer.half(static_cast<TargetWord>(type));
    writer.half(3); // EM_386
    writer.word(1); // EV_CURRENT
    writer.word(entry);
    writer.word(program_header_offset);
    writer.word(section_header_offset);
    writer.word(0); // architecture flags
    writer.half(ElfHeaderSize);
    writer.half(program_header_count == 0 ? 0 : ProgramHeaderSize);
    writer.half(program_header_count);
    writer.half(section_header_count == 0 ? 0 : SectionHeaderSize);
    writer.half(section_header_count);
    writer.half(section_name_table_index);
}

void write_section_header(Elf32Writer &writer, const SectionHeader &section)
{
    writer.word(section.name);
    writer.word(static_cast<TargetWord>(section.type));
    writer.word(static_cast<TargetWord>(section.flags));
    writer.word(section.address);
    writer.word(section.offset);
    writer.word(section.size);
    writer.word(section.link);
    writer.word(section.info);
    writer.word(section.alignment);
    writer.word(section.entry_size);
}

void write_symbol(Elf32Writer &writer, TargetWord name, TargetWord value,
                  TargetWord size, TargetWord info, TargetWord section_index)
{
    writer.word(name);
    writer.word(value);
    writer.word(size);
    writer.byte(info);
    writer.byte(0);
    writer.half(section_index);
}

} // namespace

ExecutableLayout calculate_executable_layout(
    std::size_t code_size, DataOffset data_size)
{
    const TargetWord headers = ElfHeaderSize + ProgramHeaderSize;
    const TargetWord data_offset =
        align4(static_cast<std::size_t>(headers) + code_size);
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
    write_header(writer, ElfType::Executable, layout.entry_address,
                 ElfHeaderSize, 0, 1, 0, 0);

    writer.word(1); // PT_LOAD
    writer.word(0);
    writer.word(layout.image_base);
    writer.word(layout.image_base);
    writer.word(layout.file_size);
    writer.word(layout.file_size);
    writer.word(7); // PF_R | PF_W | PF_X
    writer.word(PageAlignment);

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

    std::size_t string_table_size = 1;
    for (std::size_t index = 0; index < function_count; ++index) {
        symbol_indices[index] = to_target(index + 2U, "function symbol index");
        symbol_name_offsets[index] =
            to_target(string_table_size, "function name offset");
        string_table_size += functions[index].name.size() + 1U;
    }
    for (std::size_t index = 0; index < global_count; ++index) {
        const std::size_t combined = function_count + index;
        symbol_indices[combined] =
            to_target(combined + 2U, "global symbol index");
        symbol_name_offsets[combined] =
            to_target(string_table_size, "global name offset");
        string_table_size += globals[index].name.size() + 1U;
    }
    for (std::size_t index = 0; index < external_count; ++index) {
        const std::size_t combined = function_count + global_count + index;
        symbol_indices[combined] =
            to_target(combined + 2U, "external symbol index");
        symbol_name_offsets[combined] =
            to_target(string_table_size, "external name offset");
        string_table_size += externals[index].name.size() + 1U;
    }

    const TargetWord symbol_count =
        to_target(named_symbol_count + 2U, "symbol count");
    const TargetWord symbol_table_size = symbol_count * 16U;
    const TargetWord relocation_size =
        to_target(relocations.size() * 8U, "relocation table");
    const TargetWord string_size =
        to_target(string_table_size, "string table");

    const TargetWord text_offset = ElfHeaderSize;
    const TargetWord data_offset =
        align4(static_cast<std::size_t>(text_offset) + code.size());
    const TargetWord relocation_offset =
        align4(static_cast<std::size_t>(data_offset) + data_size);
    const TargetWord symbol_table_offset = relocation_offset + relocation_size;
    const TargetWord string_table_offset = symbol_table_offset + symbol_table_size;
    const TargetWord section_name_offset = string_table_offset + string_size;
    const TargetWord section_header_offset = align4(
        static_cast<std::size_t>(section_name_offset) + SectionNameTableSize);

    Elf32Writer writer;
    writer.reset();
    write_header(writer, ElfType::Relocatable, 0, 0, section_header_offset,
                 0, SectionCount, SectionNameTableIndex);
    writer.append(code);
    writer.pad_to(data_offset);
    for (std::size_t index = 0; index < data_size; ++index) {
        writer.byte(data[index]);
    }

    writer.pad_to(relocation_offset);
    for (const Relocation &relocation : relocations) {
        TargetWord symbol_index = 0;
        if (relocation.symbol == ".data") {
            symbol_index = 1;
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
        writer.word(symbol_index * 256U +
                    static_cast<TargetWord>(relocation.type));
    }

    writer.pad_to(symbol_table_offset);
    for (int index = 0; index < 16; ++index) {
        writer.byte(0);
    }
    write_symbol(writer, 0, 0, data_size, 3, 3); // local .data section

    for (std::size_t index = 0; index < function_count; ++index) {
        const CodeOffset start = functions[index].code_offset;
        const CodeOffset end = index + 1U < function_count
            ? functions[index + 1U].code_offset
            : code.size();
        write_symbol(writer, symbol_name_offsets[index],
                     to_target(start, "function offset"),
                     to_target(end - start, "function size"), 18, 1);
    }
    for (std::size_t index = 0; index < global_count; ++index) {
        write_symbol(writer, symbol_name_offsets[function_count + index],
                     4, 4, 17, 65522); // SHN_COMMON
    }
    for (std::size_t index = 0; index < external_count; ++index) {
        write_symbol(writer,
                     symbol_name_offsets[function_count + global_count + index],
                     0, 0, static_cast<TargetWord>(externals[index].type), 0);
    }

    writer.byte(0);
    for (const FunctionSymbol &function : functions) {
        writer.text(function.name); writer.byte(0);
    }
    for (const GlobalSymbol &global : globals) {
        writer.text(global.name); writer.byte(0);
    }
    for (const ExternalSymbol &external : externals) {
        writer.text(external.name); writer.byte(0);
    }

    writer.byte(0);
    writer.text(".text"); writer.byte(0);
    writer.text(".rel.text"); writer.byte(0);
    writer.text(".data"); writer.byte(0);
    writer.text(".bss"); writer.byte(0);
    writer.text(".symtab"); writer.byte(0);
    writer.text(".strtab"); writer.byte(0);
    writer.text(".shstrtab"); writer.byte(0);

    writer.pad_to(section_header_offset);
    write_section_header(writer, SectionHeader{
        0, SectionType::Null, SectionFlags::None, 0, 0, 0, 0, 0, 0, 0});
    write_section_header(writer, SectionHeader{
        1, SectionType::ProgramBits,
        static_cast<SectionFlags>(static_cast<TargetWord>(SectionFlags::Allocate) |
                                  static_cast<TargetWord>(SectionFlags::Executable)),
        0, text_offset, to_target(code.size(), "generated code"), 0, 0, 1, 0});
    write_section_header(writer, SectionHeader{
        7, SectionType::Relocation, SectionFlags::InfoLink, 0, relocation_offset,
        relocation_size, 5, 1, 4, 8});
    write_section_header(writer, SectionHeader{
        17, SectionType::ProgramBits,
        static_cast<SectionFlags>(static_cast<TargetWord>(SectionFlags::Write) |
                                  static_cast<TargetWord>(SectionFlags::Allocate)),
        0, data_offset, data_size, 0, 0, 1, 0});
    write_section_header(writer, SectionHeader{
        23, SectionType::NoBits,
        static_cast<SectionFlags>(static_cast<TargetWord>(SectionFlags::Write) |
                                  static_cast<TargetWord>(SectionFlags::Allocate)),
        0, data_offset + data_size, 0, 0, 0, 1, 0});
    write_section_header(writer, SectionHeader{
        28, SectionType::SymbolTable, SectionFlags::None, 0,
        symbol_table_offset, symbol_table_size, 6, 2, 4, 16});
    write_section_header(writer, SectionHeader{
        36, SectionType::StringTable, SectionFlags::None, 0,
        string_table_offset, string_size, 0, 0, 1, 0});
    write_section_header(writer, SectionHeader{
        44, SectionType::StringTable, SectionFlags::None, 0,
        section_name_offset, SectionNameTableSize, 0, 0, 1, 0});

    return writer.take_image();
}

} // namespace mawkcc
