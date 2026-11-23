# Shared RegExp grammar and String conversion

## Scope and ownership

`regexp_parser.js` contains one ES3-source grammar implementation. It does
not use host RegExp parsing, regular expressions for tokenization, generated
machine-code blobs, Unicode/locale services or platform-specific libraries.
`parser.js` uses it to validate RegExp literals before returning their AST
nodes, including flags. `regexp_runtime.js` uses the same grammar for dynamic
construction and execution-plan compilation. Grammar extraction removes the
former coupling from character-class parsing to matcher optimizations.

The source parser may run on the bootstrap host or inside the standalone
guest. The runtime matcher, its syntax trees, cached programs, typed-array
state and continuations execute as guest code and are traced by the runtime.
Portable standard-library installation now creates the same RegExp prototype
and installs the same library as the compiled interpreter. The former
`heapNativeBuiltins` backend-dependent prototype flag is removed.

## Grammar interface

- CommonJS: `require("./regexp_parser.js")`; shell loading publishes
  `GuestVMRegExpParser`. The single guest-VM shell entry loads it before the
  language parser; direct parser tools can resolve this dependency through
  their existing shell load operation.
- `new RegExpParser(patternString).parse()` returns alternatives, sequences,
  atoms and the capture count, or throws its captured SyntaxError constructor.
  Callers perform observable ToString conversion before passing the string.
- `RegExpParser.validateFlags(flagString)` rejects unknown or duplicate
  flags; the supported ES5 flags are `g`, `i`, `m`.
- `RegExpParser.SyntaxError` identifies grammar errors to the source parser,
  which adds filename/line/column. Other exceptions are not mislabeled as
  grammar errors. `decimal` is the shared code-unit predicate used by the
  matcher as well as the parser.

Groups record the contiguous capture interval they contain. Brace-quantifier
speculation owns its cursor and bounds: a failed parse restores both, and a
valid quantifier without an atom is rejected. Character-class execution
predicates and caches belong to lowering, not to grammar construction.
Legacy non-Unicode identity escapes remain accepted: incomplete hexadecimal
escapes rewind speculative digits, and an invalid control-letter escape
preserves its backslash without consuming the next atom. Earlier constructor
validation must not narrow the accepted literal grammar; the exhaustive
Test262 escaped-code-unit case is part of the acceptance check.

## Constructor entry

RegExp remains the original native callable record, preserving its intrinsic
identity, prototype and metadata. Standard-library setup installs a guest
constructor implementation and a separate private allocation-only callable.
The private callable has no guest implementation and cannot recurse into
the public constructor. Only normalized strings reach it.

`Runtime.setGuestConstructorImplementation` and the compiled
`enterGuestConstructorKernel` use one internal convention: the strict guest
implementation receives a boolean `this`, true for Construct and false for
Call; original arguments are unchanged. This is an internal adapter, not a
new public constructor API or altered JavaScript syntax. Currently RegExp
uses the compiled adapter; other constructors require their dispatch entry
to opt into it. The entry uses ordinary guest frames and the correct caller
instruction width for Call versus Construct.

The algorithm handles identity return for `RegExp(existing)`, copying for
`new RegExp(existing)`, flag restrictions, ordered conversions, syntax checks
and allocation. New copies start with lastIndex zero. No host language call
implements this behavior in the standalone interpreter.

## Validation, compilation and cache lifetime

A bounded 256-entry runtime cache records immutable source spellings and
validated entries. Construction validates syntax immediately but does not
allocate an execution workspace for an unused pattern. First execution lowers
the validated syntax into a matcher program and releases the complete syntax
tree; the program retains only the predicates it needs. Later constructions
and matches can reuse the validated/compiled entry. Empty source uses the
same canonical spelling as the allocation primitive.

Cache entries, syntax and programs are ordinary guest values. Eviction drops
their guest edges; GC owns reclamation. Workspaces use the existing typed-array
snapshot/backtracking machinery. This cache is bounded by entry count, not
total pattern bytes; it is not claimed to be an optimal large-pattern memory
policy. Source-literal validation and runtime construction share a grammar,
not an untraced host AST or a disk cache.

## Match state and String algorithms

RepeatMatcher clears the repeated atom's capture interval before each attempt.
Existing backtracking snapshots restore the preceding captures when an attempt
fails, including rejected optional empty iterations. Named packed operands
describe the interval; unrelated capture slots are not cleared.

`string_runtime.js` owns common receiver and argument conversion. It captures
pristine calls and conversion primitives. Primitive identity paths stay cheap;
callback-capable ToPrimitive/ToString/ToNumber runs in normal traced guest
frames. Kernel primitive String fast paths remain available; unsupported
conversion cases enter the guest algorithm instead of a host semantic exit.
The RegExp String methods use these same conversion functions and strict
receivers. Locale case variants retain the existing default case policy;
no Intl implementation is introduced.

Split treats empty input and terminal empty matches according to ES5 and uses
a private matcher so separator lastIndex is unchanged. Replacement accepts
valid two-digit capture references with leading zero and uses captured Call/
Apply primitives for callbacks. Match/replace/search/split do not resolve a
replacement global String or RegExp constructor as their internal operation.

## Limits and validation

This is not a claim of complete RegExp or String compliance. Unicode case
mapping, legacy escape forms and static RegExp capture globals are separate
issues; no SpiderMonkey-specific facilities are added by this cutover.
Bare minimal runtimes without standard-library installation remain a separate
embedding configuration; the complete guest algorithms described here are
installed by the standard-library path on both execution backends.

The feature inventory and acceptance receipts are tracked in
[ECMA_FEATURE_GROUPS.md](../../ECMA_FEATURE_GROUPS.md). Existing high-level
integration coverage exercises callback order, constructor identity/copying,
construction-time errors and separator-state preservation on portable,
compiled JS and predecoded configurations. External corpus files are unchanged.
