cmake_minimum_required(VERSION 3.16)

project(mawkcc_cpp LANGUAGES CXX)

option(MAWKCC_ENABLE_SANITIZERS
       "Build with AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
option(MAWKCC_DEVELOPER_MODE
       "Enable maintained-code warnings as errors and additional audits" OFF)

if(MSVC)
    set(MAWKCC_UNOPTIMIZED_FLAGS "/Od")
else()
    set(MAWKCC_UNOPTIMIZED_FLAGS "-O0")
endif()
if(CMAKE_CXX_FLAGS_UNOPTIMIZED STREQUAL "")
    set(CMAKE_CXX_FLAGS_UNOPTIMIZED "${MAWKCC_UNOPTIMIZED_FLAGS}" CACHE STRING
        "Compiler flags for an unoptimized build without Debug's implied symbols"
        FORCE)
endif()
mark_as_advanced(CMAKE_CXX_FLAGS_UNOPTIMIZED)

function(configure_mawkcc_target target)
    target_compile_features(${target} PRIVATE cxx_std_17)
    set_target_properties(${target} PROPERTIES
        CXX_STANDARD_REQUIRED YES
        CXX_EXTENSIONS NO
    )
    if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(${target} PRIVATE
            -Wall
            -Wextra
            -Wpedantic
            -Wconversion
            -Wsign-conversion
        )
    elseif(MSVC)
        target_compile_options(${target} PRIVATE /W4 /permissive-)
    endif()

    if(MAWKCC_ENABLE_SANITIZERS AND
       CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(${target} PRIVATE
            -fsanitize=address,undefined
            -fno-omit-frame-pointer
        )
        target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endif()
endfunction()

function(configure_mawkcc_maintained_target target)
    configure_mawkcc_target(${target})
    if(MAWKCC_DEVELOPER_MODE AND CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(${target} PRIVATE
            -Werror
            -Wshadow
            -Wold-style-cast
            -Wformat=2
            -Wundef
            -Wnull-dereference
            -Wdouble-promotion
        )
    endif()
endfunction()

add_library(mawkcc_core STATIC
    mawkcc_refactored.cpp
    compiler_state.cpp
    elf32_builder.cpp
    elf32_writer.cpp
    lexer.cpp
    x86_emitter.cpp
)
target_include_directories(mawkcc_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(mawkcc_core PUBLIC cxx_std_17)
configure_mawkcc_maintained_target(mawkcc_core)

add_executable(mawkcc_cpp mawkcc_refactored_main.cpp)
target_link_libraries(mawkcc_cpp PRIVATE mawkcc_core)
configure_mawkcc_maintained_target(mawkcc_cpp)

add_executable(mawkcc_cpp_original mawkcc.cpp)
configure_mawkcc_target(mawkcc_cpp_original)

add_executable(byte_writer_test EXCLUDE_FROM_ALL tests/byte_writer_test.cpp)
target_include_directories(byte_writer_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
configure_mawkcc_maintained_target(byte_writer_test)

add_executable(lexer_test EXCLUDE_FROM_ALL tests/lexer_test.cpp lexer.cpp)
target_include_directories(lexer_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
configure_mawkcc_maintained_target(lexer_test)

add_executable(x86_emitter_test EXCLUDE_FROM_ALL
    tests/x86_emitter_test.cpp
    x86_emitter.cpp
)
target_include_directories(x86_emitter_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
configure_mawkcc_maintained_target(x86_emitter_test)

add_executable(elf32_writer_test EXCLUDE_FROM_ALL
    tests/elf32_writer_test.cpp
    elf32_writer.cpp
)
target_include_directories(elf32_writer_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
configure_mawkcc_maintained_target(elf32_writer_test)

add_executable(compiler_api_test EXCLUDE_FROM_ALL tests/compiler_api_test.cpp)
target_link_libraries(compiler_api_test PRIVATE mawkcc_core)
configure_mawkcc_maintained_target(compiler_api_test)

add_executable(compiler_state_test EXCLUDE_FROM_ALL
    tests/compiler_state_test.cpp
    compiler_state.cpp
)
target_include_directories(compiler_state_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
configure_mawkcc_maintained_target(compiler_state_test)

add_executable(elf32_builder_test EXCLUDE_FROM_ALL
    tests/elf32_builder_test.cpp
    compiler_state.cpp
    elf32_builder.cpp
    elf32_writer.cpp
)
target_include_directories(elf32_builder_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
configure_mawkcc_maintained_target(elf32_builder_test)

add_custom_target(mawkcc_test_binaries DEPENDS
    byte_writer_test
    lexer_test
    x86_emitter_test
    elf32_writer_test
    compiler_api_test
    compiler_state_test
    elf32_builder_test
)

enable_testing()
add_test(
    NAME refactored_self_host_identity
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/verify-self-host.sh
            $<TARGET_FILE:mawkcc_cpp>
)
add_test(NAME byte_writer_unit COMMAND byte_writer_test)
add_test(NAME lexer_unit COMMAND lexer_test)
add_test(NAME x86_emitter_unit COMMAND x86_emitter_test)
add_test(NAME elf32_writer_unit COMMAND elf32_writer_test)
add_test(NAME compiler_api_unit COMMAND compiler_api_test)
add_test(NAME compiler_state_unit COMMAND compiler_state_test)
add_test(NAME elf32_builder_unit COMMAND elf32_builder_test)
add_test(
    NAME refactored_cli
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/test-cli.sh $<TARGET_FILE:mawkcc_cpp>
)
add_test(
    NAME refactored_runtime
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/test-runtime.sh $<TARGET_FILE:mawkcc_cpp>
)
add_test(
    NAME refactored_regressions
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/test-refactored.sh
            $<TARGET_FILE:mawkcc_cpp>
)
add_test(
    NAME original_self_host_identity
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/verify-self-host.sh
            $<TARGET_FILE:mawkcc_cpp_original>
)

set_tests_properties(
    byte_writer_unit
    lexer_unit
    x86_emitter_unit
    elf32_writer_unit
    compiler_api_unit
    compiler_state_unit
    elf32_builder_unit
    PROPERTIES LABELS "unit"
)
set_tests_properties(refactored_cli PROPERTIES LABELS "cli")
set_tests_properties(refactored_runtime PROPERTIES LABELS "runtime")
set_tests_properties(
    refactored_regressions
    PROPERTIES LABELS "reference;regression"
)
set_tests_properties(
    refactored_self_host_identity
    original_self_host_identity
    PROPERTIES LABELS "reference;self-host"
)
