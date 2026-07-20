#pragma once

#include <cstddef>
#include <cstdint>

namespace mawkcc {

using TargetWord = std::uint32_t;
using TargetSignedWord = std::int32_t;
using CodeOffset = std::size_t;
using DataOffset = std::uint32_t;
using ArgumentCount = std::uint32_t;
using LoopId = std::uint32_t;

} // namespace mawkcc
