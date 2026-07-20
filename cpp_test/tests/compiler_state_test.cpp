#include "compiler_state.hpp"

#include <cstdlib>

int main()
{
    mawkcc::ParameterScope parameters;
    parameters.enter({"first", "second"});
    if (!parameters.find("first") || parameters.find("first")->stack_offset != 8 ||
        !parameters.find("second") ||
        parameters.find("second")->stack_offset != 12 ||
        parameters.find("missing")) {
        std::abort();
    }
    parameters.leave();
    if (parameters.find("first")) {
        std::abort();
    }

    mawkcc::StaticData data;
    data.reset();
    if (data.size() != mawkcc::StaticData::RuntimeSize ||
        data.add_string("ab") != 4 || data.allocate_global() != 8 ||
        data.size() != 12 || data.bytes()[4] != 'a' ||
        data.bytes()[5] != 'b' || data.bytes()[6] != 0) {
        std::abort();
    }

    mawkcc::SymbolTable symbols;
    if (!symbols.add_global("value", 4) || symbols.add_global("value", 8)) {
        std::abort();
    }
    if (!symbols.add_function("main", 12, 2) ||
        symbols.add_function("main", 99, 0)) {
        std::abort();
    }
    if (!symbols.global("value") || symbols.global("value")->data_offset != 4 ||
        !symbols.function("main") || symbols.function("main")->arity != 2) {
        std::abort();
    }
    symbols.record_external("external", mawkcc::ElfSymbolType::Function);
    symbols.record_external("external", mawkcc::ElfSymbolType::Function);
    symbols.record_external("main", mawkcc::ElfSymbolType::Function);
    if (symbols.externals().size() != 1U) {
        std::abort();
    }

    mawkcc::FixupTable fixups;
    fixups.add_call("callee", 5, 3);
    fixups.add_relocation(9, "global", mawkcc::RelocationType::Absolute32);
    fixups.add_data_patch(13, 17);
    fixups.add_break(1, 21);
    if (fixups.calls().size() != 1U || fixups.calls()[0].target != "callee" ||
        fixups.relocations().size() != 1U ||
        fixups.data_patches().size() != 1U ||
        fixups.break_patches().size() != 1U) {
        std::abort();
    }

    symbols.reset();
    fixups.reset();
    if (!symbols.globals().empty() || !symbols.functions().empty() ||
        !symbols.externals().empty() || !fixups.calls().empty() ||
        !fixups.relocations().empty() || !fixups.data_patches().empty() ||
        !fixups.break_patches().empty()) {
        std::abort();
    }
    return 0;
}
