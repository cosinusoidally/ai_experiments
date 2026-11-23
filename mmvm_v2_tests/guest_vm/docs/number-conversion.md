# Number conversion and decimal formatting

This describes contracts 120–122 with the complete guest standard library
installed. The implementation is ES3-source JavaScript; the language policy
runs in guest frames, and the numeric kernels compile through the shared
JS/i386 pipeline. No outer host Number method implements standalone semantics.

## Numeric strings and parseInt

`stringNumericValueKernel` recognizes StringNumericLiteral whitespace and
special forms before using guest FFI `strtod` for correctly rounded decimal
conversion. Hexadecimal conversion is independent of libc's optional hex
grammar: `hexadecimalStringNumberKernel` checks its prefix and delegates to
`powerOfTwoIntegerStringKernel`.

`parseIntIntrinsicKernel` retains the allocation-free signed-int32 path. A
wider decimal prefix goes to `decimalPrefixNumberKernel` after the guest has
recognized radix, sign and the complete digit prefix. The temporary native
ASCII buffer is freed before return; it is not host VM state or a persistent
guest reference. Prefix recognition, trailing junk and signed zero are the
VM's responsibility, not libc's grammar.

Radices 2/4/8/16/32 use the same significant/guard/sticky-bit conversion as
hexadecimal Number conversion. They retain 53 significant bits, round once
ties-to-even and publish conventional tagged binary64 words. Arbitrarily long
input needs no proportional scratch allocation for these radices. Wide
accumulation for the other radices remains approximate, as ES5.1 permits for
those bases; it must not be advertised as a general exact integer parser.

## Decimal Number-to-string

`shortestDoubleAsciiKernel` owns shortest round-tripping decimal formatting
and ES5 fixed/scientific presentation thresholds. Both explicit String
conversion and ADD's double/string concatenation use it. The old independent
hard-coded 15-digit concatenation formatter has been removed. Each operand
has its own bounded scratch region, using the shared size constant.

String conversion's unsigned-word shortcut applies only to positive values
in that range; a negative double must not be decoded as a positive uint32.
Negative zero, infinities and NaN use the established canonical spellings.

## Branded Number methods and exact decimal rounding

`number_runtime.js` owns `toFixed`, `toPrecision` and `toExponential` policy:

- Validate the receiver's actual Number value, not an arbitrary object's
  overridden numeric conversion. `NUMBER_VALUE_OF` supplies the primitive;
  the complete guest continuation also works on the portable interpreter.
- Apply ToInteger to the precision argument in specification order, including
  user callbacks and the methods' differing non-finite/range precedence.
- Retain ES5 precision limits: fixed/exponential fractional digits 0–20,
  precision significant digits 1–21. No newer extended ranges are assumed.
- Preserve significant trailing zeros, negative results that round to zero,
  positive-zero spelling and scientific exponent syntax/thresholds.

The common rounding implementation first expands the stored binary64 value
to its exact terminating decimal. It obtains an integer coefficient divided
by a power of two, extracts base-2^16 limbs and accumulates base-10^7 limbs.
Multiplication by the appropriate power of five supplies decimal digits.
Every intermediate limb product is below 2^53 and is therefore exact.

The resulting `{digits, point}` pair separates coefficient and decimal-point
position. Precision/fractional rounding happens once, with the larger decimal
coefficient selected at a tie as ES5 requires. Presentation then selects
fixed or scientific output. This avoids both double rounding through
`value * 10^digits` and printf's different tie policy. Subnormal expansion is
bounded by the binary64 exponent range, not by unbounded user precision.

An omitted exponential precision uses the existing shortest spelling before
scientific presentation; explicit precision uses the exact expansion.
Ordinary primitive `toString` calls keep their numeric kernel path. Its guest
continuation handles receiver/radix conversion and range errors around a
private primitive with no recursive fallback.

## Installation and boundaries

`vm.js` captures pristine call/conversion functions and private Number
primitives before installing the public guest algorithms. Temporary globals
are deleted after capture. Closures, scratch arrays, strings and continuations
are normal traced guest values. Public prototype changes do not replace the
captured Number.valueOf primitive or the shared internal Call operation.

Bare minimal runtimes without standard-library installation still expose
limited numeric kernel operations and bootstrap callbacks. They are not a
second complete implementation of these Number algorithms. In particular,
the old finite precision primitive is not the complete installed `toPrecision`.
Non-decimal fractional/large-radix `toString` coverage remains separate work;
passing the current Number corpus is not a claim of full ES5.1 compliance.

See [the feature-family status](../../ECMA_FEATURE_GROUPS.md) for focused and
broad acceptance results. External corpus sources are never rewritten.
