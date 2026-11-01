# Node control failure review

Source review for the completed 2026-11-01 five-second run: **1218 pass,
115 fail, including four timeouts**, all 1333 files executed. The inventory
below covers every failed file in that run. Paths are relative to
`../../js_tests/tests`. Nothing in the corpus has been edited or waived.

These are file outcomes, not assertion counts. A file can mix useful standard
assertions with one proprietary or outdated assertion. A Node failure is not
automatically a SpiderMonkeyism, nor is Node's current behavior automatically
the behavior an ES5.1 interpreter should copy.

## Review conclusions

- **Real edition differences:** old function `length` configurability,
  RegExp own-property layout and constructor behavior, ToUint32-based array
  algorithms, duplicate properties in strict literals, and unescaped U+2028/
  U+2029 in string literals. Several are meaningful ES5.1 expectations which
  modern Node intentionally does not preserve. Retain them for VM coverage.
- **Proprietary facilities/syntax:** `options`, `uneval`, `toSource`, `watch`,
  `newGlobal`, `evalcx`, `evaluate`, `InternalError`, static Array/String
  generics, old Proxy factories, expression closures and guarded catches.
  These are not missing ES5.1 language requirements. Some testing facilities
  could later be supplied by an embedder without becoming VM language APIs.
- **Implementation-specific observations:** exact error messages, the global
  object's class tag and optional non-ISO Date.parse formats. Do not hard-code
  SpiderMonkey's messages or parsing extensions into the VM just for these.
- **Old Unicode expectations:** checked-in tables and whitespace/case mappings
  differ from modern Unicode data. One BOM test also treats U+FFFE like U+FEFF;
  this is not simply a newly added standard whitespace character.
- **Questionable corpus expectations:** one unconditional unimplemented-test
  failure, one Boolean constructor/prototype mix-up, and a sort test with an
  inconsistent comparator. Keep their raw failures, but do not infer a VM bug.
- **Unresolved ordinary-language discrepancy:** `ecma_3/Statements/12.10-01.js`
  expects 4 for `var x=1,o={}; with(o) x=o.x=2; x+o.x`. Node returns 3 even
  outside `vm.Context`; the guest also returns 3. This is a reference-evaluation
  order question requiring specification review, not a proprietary shell API.
  It has not been dismissed or "fixed" by changing the expected result.
- **Resource limits:** four cases still exceed the bounded run. They are
  failures/timeouts, not confirmed semantic defects and not skipped tests.

The first Node run had three context-proxy artifacts involving global
preventExtensions, inherited setters and eval declarations. All three pass
with Node's ordinary realm global and are absent from this failure inventory.

## ecma: 22 failed files

- `ecma/Array/15.4.4.3-1.js` — old nonconfigurable built-in function length.
- `ecma/Array/15.4.4.4-1.js` — same length-attribute expectation.
- `ecma/Array/15.4.4.4-2.js` — same length-attribute expectation.
- `ecma/Array/15.4.4.5-3.js` — `comparefn3` returns -1 in both directions
  for distinct Date objects with equal numeric values; tie-order assertion
  compares identities. An inconsistent comparator is not a portable oracle.
- `ecma/Date/15.9.5.js` — assumes Date.prototype itself has a Date internal
  value and can be passed to Date.prototype.valueOf; historical layout.
- `ecma/GlobalObject/15.1.2.2-1.js` — nonconfigurable parseInt.length.
- `ecma/GlobalObject/15.1.2.3-1.js` — nonconfigurable parseFloat.length.
- `ecma/GlobalObject/15.1.2.4.js` — nonconfigurable escape.length.
- `ecma/GlobalObject/15.1.2.5-1.js` — nonconfigurable unescape.length.
- `ecma/GlobalObject/15.1.2.6.js` — nonconfigurable isNaN.length.
- `ecma/GlobalObject/15.1.2.7.js` — nonconfigurable isFinite.length.
- `ecma/Statements/12.6.3-2.js` — sets Boolean.prototype.foo but enumerates
  the Boolean constructor, expecting that instance-prototype property there.
- `ecma/String/15.5.4.10-1.js` — nonconfigurable substring.length.
- `ecma/String/15.5.4.11-1.js` — nonconfigurable toLowerCase.length.
- `ecma/String/15.5.4.12-3.js` — old Georgian/Cyrillic case expectations.
- `ecma/String/15.5.4.12-5.js` — old Armenian uppercase expectation.
- `ecma/String/15.5.4.6-2.js` — nonconfigurable indexOf.length.
- `ecma/String/15.5.4.7-2.js` — nonconfigurable lastIndexOf.length.
- `ecma/String/15.5.4.8-1.js` — nonconfigurable split.length.
- `ecma/String/15.5.4.9-1.js` — nonconfigurable substring.length.
- `ecma/extensions/15.1.2.1-1.js` — nonconfigurable eval.length.
- `ecma/extensions/errorcolumnblame.js` — proprietary Error.columnNumber.

## ecma_2: 9 failed files

- `ecma_2/Exceptions/lexical-011.js` — options("strict")/options("werror").
- `ecma_2/Exceptions/lexical-014.js` — same warning-mode options.
- `ecma_2/Exceptions/lexical-016.js` — same warning-mode options.
- `ecma_2/Exceptions/lexical-021.js` — same warning-mode options.
- `ecma_2/LexicalConventions/keywords-001.js` — same warning-mode options.
  They are not equivalent to an authored ES5 "use strict" directive.
- `ecma_2/RegExp/constructor-001.js` — requires an empty string for empty
  RegExp.source rather than the modern nonempty representation.
- `ecma_2/RegExp/exec-001.js` — literally adds a failing TestCase named
  "NO TESTS EXIST", expected "PASSED", actual "Test not implemented".
- `ecma_2/RegExp/function-001.js` — same empty-source representation.
- `ecma_2/RegExp/properties-001.js` — same empty-source representation.

## ecma_3: 26 failed files

- `ecma_3/Array/15.4.5.1-01.js` — exact RangeError message capitalization.
- `ecma_3/Array/15.5.4.8-01.js` — nonstandard static Array.lastIndexOf.
- `ecma_3/Array/regress-322135-03.js` — watchdog timeout in native splice
  on a length-4294967295 sparse array; cannot safely rely on a V8 script timer.
- `ecma_3/Array/regress-322135-04.js` — same huge sparse-array resource case.
- `ecma_3/Date/15.9.3.2-1.js` — optional normalization of non-ISO strings
  such as 11/69/2004; implementation-specific Date.parse input.
- `ecma_3/FunExpr/regress-545980.js` — expression-closure body
  `function() doSearch(next)`; not ES5.1 syntax.
- `ecma_3/LexicalConventions/7.8.3-01.js` — exact SyntaxError wording.
- `ecma_3/LexicalConventions/7.9.1.js` — exact SyntaxError wording in its
  invalid-postfix/automatic-semicolon cases.
- `ecma_3/Object/8.6.1-01.js` — options strict/werror and exact warning text.
- `ecma_3/Object/class-001.js` — expects the engine-specific global class tag.
- `ecma_3/RegExp/15.10.4.1-5-n.js` — expects new RegExp(existingRegExp,
  flags) to throw; modern editions allow explicit replacement flags.
- `ecma_3/RegExp/15.10.4.1-6.js` — exact invalid-flags error wording.
- `ecma_3/RegExp/15.10.6.2-2.js` — historical non-global lastIndex reset
  expectations; not a reason to adopt old behavior without ES5.1 review.
- `ecma_3/RegExp/regress-307456.js` — five-second resource timeout.
- `ecma_3/RegExp/regress-330684.js` — five-second resource timeout.
- `ecma_3/RegExp/regress-375711.js` — exact invalid-range SyntaxError text.
- `ecma_3/RegExp/regress-375715-04.js` — exact invalid-range SyntaxError text.
- `ecma_3/Statements/12.10-01.js` — unresolved with-assignment reference
  ordering discrepancy described above; direct Node also returns 3.
- `ecma_3/Statements/regress-121744.js` — unconditional shell quit used
  because this old regression was intentionally disabled.
- `ecma_3/Unicode/regress-352044-01.js` — exact illegal-character error text.
- `ecma_3/Unicode/uc-001.js` — expects U+200E to disappear inside a string;
  historical format-control treatment, not modern string preservation.
- `ecma_3/extensions/10.1.3-2.js` — toSource/uneval; calls quit when absent.
- `ecma_3/extensions/7.9.1.js` — uneval and decompiled-source expectations.
- `ecma_3/extensions/regress-274152.js` — exact illegal-character error text.
- `ecma_3/extensions/regress-368516.js` — expects U+FFFE as well as U+FEFF
  to be usable as whitespace.
- `ecma_3/extensions/regress-385393-03.js` — uneval function round-trip.

## ecma_5: 58 failed files

- `ecma_5/Array/unshift-01.js` — ES5-era ToUint32 length wrap versus modern
  ToLength behavior on a generic object; useful older-edition coverage.
- `ecma_5/Date/15.9.4.2.js` — optional time-only Date.parse forms such as
  T19:53:21; not the required full standard date-time grammar.
- `ecma_5/Function/arguments-caller-callee.js` — old own caller poison-pill
  descriptors and strict-caller introspection.
- `ecma_5/Function/arguments-property-attributes.js` — expects an own caller
  descriptor on strict arguments, absent in modern Node.
- `ecma_5/Function/builtin-no-construct.js` — old builtin-property
  enumeration reaches restricted caller/arguments accessors in modern Node;
  also asserts an engine-specific constructor-error string.
- `ecma_5/Function/function-bind.js` — requires bound length.configurable=false.
- `ecma_5/Function/function-caller.js` — old own caller accessor layout.
- `ecma_5/Global/cross-global-implicit-this.js` — newGlobal/evalcx facilities.
- `ecma_5/Object/15.2.3.14-01.js` — exact Object.keys result for RegExp match
  arrays predates the modern enumerable groups property.
- `ecma_5/Object/15.2.3.3-01.js` — explicitly requires false configurability
  for ordinary and builtin function length descriptors.
- `ecma_5/Object/15.2.3.4-04.js` — old own source/global/ignoreCase/multiline
  RegExp properties, now inherited accessors.
- `ecma_5/Object/15.2.3.6-function-length.js` — same length configurability.
- `ecma_5/Object/freeze-global-eval-const.js` — evalcx, old const syntax and
  exact SpiderMonkey nonextensible-global error text.
- `ecma_5/RegExp/instance-property-storage-introspection.js` — old own
  nonconfigurable RegExp metadata rather than modern prototype accessors.
- `ecma_5/RegExp/regexp-space-character-class.js` — old Unicode space table.
- `ecma_5/String/string-object-length.js` — expects proprietary InternalError.
- `ecma_5/String/string-space-trim.js` — old Unicode whitespace data.
- `ecma_5/String/string-upper-lower-mapping.js` — old 65536-entry case table.
- `ecma_5/eval/line-terminator-paragraph-terminator.js` — requires U+2028/
  U+2029 rejection in string literals, changed by later JSON-superset syntax.
- `ecma_5/eval/strict-eval-json-object-repeated-property-name.js` — strict
  duplicate-property rejection, relaxed in later ECMAScript editions.
- `ecma_5/extensions/8.12.5-01.js` — options strict/werror controls.
- `ecma_5/extensions/Boolean-toSource.js` — proprietary toSource.
- `ecma_5/extensions/Number-toSource.js` — proprietary toSource.
- `ecma_5/extensions/String-methods-infinite-recursion.js` — InternalError.
- `ecma_5/extensions/String-toSource.js` — proprietary toSource.
- `ecma_5/extensions/array-toString-recursion.js` — InternalError.
- `ecma_5/extensions/bug496985.js` — uneval function round-trip.
- `ecma_5/extensions/bug566661.js` — uneval function round-trip.
- `ecma_5/extensions/cross-global-eval-is-indirect.js` — newGlobal facilities.
- `ecma_5/extensions/cross-global-getPrototypeOf.js` — newGlobal facilities.
- `ecma_5/extensions/eval-native-callback-is-indirect.js` — obsolete static
  String.replace (the file also defines an Array.map generic variant).
- `ecma_5/extensions/function-definition-with.js` — nonstandard function
  declaration directly as a with body.
- `ecma_5/extensions/getOwnPropertyNames-__proto__.js` — legacy magic-proto
  assumptions rather than modern Object.prototype.__proto__ accessor layout.
- `ecma_5/extensions/iterator-in-catch.js` — guarded catch syntax and Iterator.
- `ecma_5/extensions/nested-delete-name-in-evalcode.js` — let bindings and
  their historical deletion behavior; not ES5.1 syntax.
- `ecma_5/extensions/preventExtensions-cross-global.js` — newGlobal facilities.
- `ecma_5/extensions/proxy-__proto__.js` — old Proxy factories.
- `ecma_5/extensions/proxy-strict.js` — old Proxy.createFunction.
- `ecma_5/extensions/regress-bug567606.js` — uneval/serialization regression.
- `ecma_5/extensions/strict-function-statements.js` — strict block-function
  grammar expectations predating standardized block-scoped functions.
- `ecma_5/extensions/strict-function-toSource.js` — options, uneval and decompiler.
- `ecma_5/extensions/strict-option-redeclared-parameter.js` — warning-mode options.
- `ecma_5/extensions/toLocaleString-infinite-recursion.js` — InternalError.
- `ecma_5/extensions/toSource-infinite-recursion.js` — toSource/InternalError.
- `ecma_5/extensions/uneval-strict-functions.js` — uneval and expression closures.
- `ecma_5/extensions/watch-array-length.js` — watch extension.
- `ecma_5/extensions/watch-inherited-property.js` — watch extension.
- `ecma_5/extensions/watch-replaced-setter.js` — watch extension.
- `ecma_5/extensions/watch-setter-become-setter.js` — watch extension.
- `ecma_5/extensions/watch-value-prop-becoming-setter.js` — watch extension.
- `ecma_5/extensions/watchpoint-deletes-JSPropertyOp-setter.js` — watch extension.
- `ecma_5/misc/function-definition-evaluate.js` — shell evaluate facility.
- `ecma_5/misc/new-with-non-constructor.js` — old Proxy.create factories.
- `ecma_5/strict/11.1.5.js` — strict duplicate-property early errors.
- `ecma_5/strict/13.1.js` — standard duplicate-parameter checks are mixed with
  SpiderMonkey expression-closure forms such as `(function (x,x) 2)`.
- `ecma_5/strict/15.10.7.js` — old own RegExp metadata deletion rules.
- `ecma_5/strict/15.3.5.1.js` — nonconfigurable function length.
- `ecma_5/strict/function-name.js` — old function name deletion behavior;
  name was not a required ES5.1 function property.
