#include "mawkcc_refactored.hpp"

#include <cstdint>
#include <exception>
#include <fstream>
#include <iostream>
#include <iterator>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

class UsageError final : public std::exception {
};

struct CommandLine {
    mawkcc::OutputKind output_kind = mawkcc::OutputKind::Executable;
    std::string source_path;
    std::optional<std::string> output_path;
};

CommandLine parse_command_line(int argc, char **argv)
{
    CommandLine command;
    for (int index = 1; index < argc; ++index) {
        const std::string_view argument{argv[index]};
        if (argument == "-c") {
            command.output_kind = mawkcc::OutputKind::RelocatableObject;
        } else if (argument == "-o") {
            if (++index >= argc) {
                throw UsageError{};
            }
            command.output_path = argv[index];
        } else if (command.source_path.empty()) {
            command.source_path = argument;
        } else {
            throw UsageError{};
        }
    }
    if (command.source_path.empty()) {
        throw UsageError{};
    }
    return command;
}

std::string read_source(const std::string &path)
{
    std::ifstream input{path, std::ios::binary};
    if (!input) {
        throw std::runtime_error{"cannot open " + path};
    }
    std::string source{std::istreambuf_iterator<char>{input},
                       std::istreambuf_iterator<char>{}};
    if (input.bad()) {
        throw std::runtime_error{"cannot read " + path};
    }
    return source;
}

void write_output(const std::vector<std::uint8_t> &image,
                  const std::optional<std::string> &path)
{
    std::ofstream file;
    std::ostream *output = &std::cout;
    if (path) {
        file.open(*path, std::ios::binary);
        if (!file) {
            throw std::runtime_error{"cannot open output " + *path};
        }
        output = &file;
    }
    output->write(reinterpret_cast<const char *>(image.data()),
                  static_cast<std::streamsize>(image.size()));
    if (!*output) {
        throw std::runtime_error{"write failed"};
    }
}

void print_usage(std::string_view program)
{
    std::cerr << "usage: " << program << " [-c] [-o output] source\n";
}

} // namespace

int main(int argc, char **argv)
{
    try {
        const CommandLine command = parse_command_line(argc, argv);
        const std::string source = read_source(command.source_path);
        write_output(mawkcc::compile(source, command.output_kind),
                     command.output_path);
        return 0;
    } catch (const UsageError &) {
        print_usage(argv[0]);
        return 1;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
