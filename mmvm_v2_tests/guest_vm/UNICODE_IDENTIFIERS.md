# Unicode identifier data

The ECMAScript 5.1 lexical grammar defines identifier characters using
Unicode general categories. Those categories are assigned properties: they
cannot be calculated from a code point by an algorithm. A conforming,
host-independent tokenizer must consequently carry a pinned copy of the
relevant Unicode data.

This directory uses Unicode 3.0.0 as its fixed lexical-data baseline. The
authoritative input is `unicode/UnicodeData-3.0.0.txt`, obtained from the
Unicode Consortium's Unicode 3.0 update data. Its SHA-256 digest is:

```
f41d967bc458ee106f0c3948bfad71cd0860d96c49304e3fd02eaf2bbae4b6d9
```

The authoritative input is checked in deliberately. Depending on the host's Unicode library,
regular-expression implementation, C locale, or installed data files would
make guest syntax vary by host and would prevent the VM from becoming
self-contained. The derived `unicode_identifier_data.js` lookup is the
deliberate exception to the normal rule against checked-in generated files;
do not replace either file with whatever Unicode version happens to be
installed locally.

This lexical table does not implement or imply the ECMAScript International-
ization API. ECMAScript 5.1 does not require `Intl`, and this VM does not expose
it. The table supplies only the general-category decisions needed while
tokenizing identifier names; it provides no locale-sensitive services.

## Derived lookup

`unicode_identifier_data.js` is a deterministic derived file. It contains no
Unicode names and no host code. It records two bits per classified character:

- bit 0 means the character is permitted in `IdentifierPart`;
- bit 1 means the character is permitted in `IdentifierStart`.

The representation follows the compact lookup used by the Firefox 1.0.8
SpiderMonkey sources. The BMP is divided into 64-code-point blocks. A
1,024-entry first-level string maps each block to one of the distinct
second-level blocks; identical blocks are stored only once. Tokenization needs
two `charCodeAt` operations and a flag test, without regular expressions or
host callbacks.

Unicode categories `Lu`, `Ll`, `Lt`, `Lm`, `Lo`, and `Nl` are both identifier
start and part characters. `Mn`, `Mc`, `Nd`, and `Pc` are part characters.
ECMAScript's `$` and `_` exceptions are handled explicitly by the tokenizer,
and U+200C and U+200D are explicitly added to `IdentifierPart` as required by
ECMAScript 5.1.

Regenerate the lookup from the repository root containing `mmvm_v2_tests`:

```sh
sha256sum guest_vm/unicode/UnicodeData-3.0.0.txt

LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_vm/tools/generate_unicode_identifier_data.js \
  guest_vm/unicode/UnicodeData-3.0.0.txt \
  > guest_vm/unicode_identifier_data.js
```

Verify the digest before regeneration. The generator is deliberately written
in the ES3-compatible `js_min.exe` dialect and has no Python or Node.js
dependency. A regenerated lookup should be reviewed and tested like executable
source; it must not acquire a build-time or runtime dependency on the external
Test262 tree.
