#include "compiler_state.hpp"
#include "test_support.hpp"

int main()
{
    return test_support::run([] {
        mawkcc::ParameterScope parameters;
        parameters.enter({"first", "second"});
        test_support::require(
            parameters.find("first") &&
                parameters.find("first")->stack_offset == 8 &&
                parameters.find("second") &&
                parameters.find("second")->stack_offset == 12 &&
                !parameters.find("missing"),
            "parameter offsets or lookup are incorrect");
        parameters.leave();
        test_support::require(
            !parameters.find("first"), "leaving a parameter scope did not clear it");

        mawkcc::StaticData data;
        data.reset();
        test_support::require(
            data.size() == mawkcc::StaticData::RuntimeSize &&
                data.add_string("ab") == 4 && data.allocate_global() == 8 &&
                data.size() == 12 && data.bytes()[4] == 'a' &&
                data.bytes()[5] == 'b' && data.bytes()[6] == 0,
            "static data layout is incorrect");

        mawkcc::SymbolTable symbols;
        test_support::require(
            symbols.add_global("value", 4) &&
                !symbols.add_global("value", 8),
            "duplicate global handling is incorrect");
        test_support::require(
            symbols.add_function("main", 12, 2) &&
                !symbols.add_function("main", 99, 0),
            "duplicate function handling is incorrect");
        test_support::require(
            symbols.global("value") &&
                symbols.global("value")->data_offset == 4 &&
                symbols.function("main") &&
                symbols.function("main")->arity == 2,
            "symbol lookup returned incorrect records");
        symbols.record_external("external", mawkcc::ElfSymbolType::Function);
        symbols.record_external("external", mawkcc::ElfSymbolType::Function);
        symbols.record_external("main", mawkcc::ElfSymbolType::Function);
        test_support::require(
            symbols.externals().size() == 1U,
            "external symbol deduplication is incorrect");

        mawkcc::FixupTable fixups;
        fixups.add_call("callee", 5, 3);
        fixups.add_relocation(9, "global", mawkcc::RelocationType::Absolute32);
        fixups.add_data_patch(13, 17);
        fixups.add_break(1, 21);
        test_support::require(
            fixups.calls().size() == 1U &&
                fixups.calls()[0].target == "callee" &&
                fixups.relocations().size() == 1U &&
                fixups.data_patches().size() == 1U &&
                fixups.break_patches().size() == 1U,
            "fixup recording is incorrect");

        symbols.reset();
        fixups.reset();
        test_support::require(
            symbols.globals().empty() && symbols.functions().empty() &&
                symbols.externals().empty() && fixups.calls().empty() &&
                fixups.relocations().empty() && fixups.data_patches().empty() &&
                fixups.break_patches().empty(),
            "symbol or fixup reset retained state");
    });
}
