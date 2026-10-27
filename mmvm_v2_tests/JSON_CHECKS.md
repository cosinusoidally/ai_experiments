# Everyday JSON checks

The standalone VM now runs the same character-by-character JSON parser and
serializer as the embedding implementation, using an adapter for ordinary
guest values rather than host callbacks. No host JSON implementation is used
by guest execution. Parsing validates number grammar, strings/escapes, arrays,
objects, whitespace and trailing input; duplicate object keys are defined as
ordinary writable/enumerable/configurable own data properties. Serialization
handles ordinary data, escaping, omitted functions/undefined, array nulls,
non-finite numbers and cycles.

This is deliberately not a complete JSON conformance project. Optional
reviver/replacer/space behavior, boxed-value/toJSON handling and exhaustive
number-to-string conformance remain outstanding; existing general VM numeric
formatting limitations are not claimed fixed by this work. There are no
SpiderMonkey-specific JSON semantics or modern JSON extensions.

## Running the bounded checks

Run from `mmvm_v2_tests`:

```sh
# Black-box reference using stock Node's JSON implementation.
node json_runner.js --reference

# Our codec, in fresh Node contexts using the same unchanged assertions.
node json_runner.js

# Guest execution, without requiring Node.
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js json_runner.js

# Standalone execution using a freshly built current snapshot.
./artifacts/js_runner.exe artifacts/snap json_runner.js
```

The default selection is 12 modest JSON integration files from the read-only
`../../js_tests/tests/ecma_5/JSON` directory: primitives and nested data,
invalid numeric/octal syntax, truncated arrays/objects/escapes, trailing
commas, control characters, escaping, omitted elements and missing arguments.
Stock Node and our codec each pass **908 assertions** in those files.
This is a selected subset, not a claim that all 36 external test files pass.
The multi-million-element stress test and optional JSON-feature tests are
not part of this milestone. Individual external filenames may be supplied
to the runner to investigate additional cases; failures are reported, not
silently treated as passing.

The adapter supplies `assertEq`, `reportCompare`, and `testJSON`. The latter
preserves the external harness's four whitespace variants and exact
parse/SyntaxError acceptance checks, but does not stringify caught Error
objects solely to construct messages for successful assertions. This avoids
turning JSON rejection checks into unrelated native Error coercion checks.
External test sources are loaded unchanged; no files under `js_tests` are
rewritten. No SpiderMonkey GC hooks or extensions are emulated. The local
Test262 import only has chapters 6, 7 and 9–13; it does not include ES5.1's
JSON chapter 15.12.

Node is an optional reference and test host, not an implementation dependency.
Its modern behavior is not the specification for ES5.1 differences such as
lone-surrogate serialization. The functional checks use ES3-compatible
source and need no npm packages, Python or downloads.
