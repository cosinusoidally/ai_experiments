# JSVM — compact ES5-style bytecode interpreter

A small, embeddable JavaScript subset implementation in C90. No external
runtime dependencies and no custom C preprocessor macros. It is not an
ES5.1-conforming engine or a security sandbox.

## Build and run

```sh
cc -std=c90 -pedantic-errors -Wall -Wextra -O2 js.c main.c -lm -o jsvm
./jsvm script.js
./jsvm first.js second.js  # shared global scope, in order
./jsvm < script.js
```

`make check` runs the JS tests, a native embedding test, and a generated
12,004-line workload. Python 3 is needed only to generate the workload.
The runtime requires a conventional platform with IEEE-style double
arithmetic, non-trapping NaN/infinity, and an unsigned long of at least 32 bits.
The code uses C90 syntax and the standard C library.

## Embedding

```c
#include "js.h"
#include <stdio.h>

int main(void) {
    VM *vm = js_new();
    if (!vm) return 1;
    js_set_budget(vm, 1000000UL);
    if (!js_eval(vm, "print(6 * 7);")) {
        fprintf(stderr, "%s\n", js_error(vm));
        js_free(vm);
        return 1;
    }
    js_free(vm);
    return 0;
}
```

`js_eval` returns 1 on success and 0 on failure; `js_error` provides the
last error message. Global variables and reachable closures persist across
calls. A failed script may have already modified the global state.
`js_set_budget(vm, n)` limits bytecode instructions per evaluation; zero
means unlimited. The budget does not bound parsing, allocation, or every
operation inside native functions. It is not a wall-clock or memory limit.

Register a host callback with `js_register(vm, name, callback, userdata)`.
The callback returns 1 on success, 0 on failure, and can read arguments and
return primitive values using the functions declared in js.h. A missing
return value is undefined. Argument string pointers are borrowed and only
valid during the callback. The callback must not reenter evaluation, register
functions, destroy its VM, or retain internal pointers. The VM has no built-in
thread synchronization. See host_test.c for a working example.

## Supported subset

- Numbers, booleans, null, undefined, strings, objects and sparse arrays.
- Function declarations/expressions, var hoisting, lexical closures,
  recursion, this, constructors/new, prototype lookup, arguments (unmapped).
- Property reads/writes/deletion, computed keys, in, instanceof, typeof.
- Arithmetic, comparisons, equality, bitwise operators, logical operators,
  conditional expressions, assignment and most compound assignments.
- if/else, while, do/while, for, for-in (identifier targets), switch,
  break/continue, return, throw and try/catch (no finally).
- Basic newline-based automatic semicolon insertion and line/block comments.
- Array: push, pop, shift, unshift, join, slice, indexOf, map, filter,
  reduce, forEach, some, every, reverse, concat, sort; Array.isArray.
- String: charAt, charCodeAt, indexOf, slice, substring, split (string
  separator), concat, toLowerCase, toUpperCase.
- Object: keys, create (without descriptors), getPrototypeOf,
  hasOwnProperty, toString (limited); Function: call and apply.
- Math: PI, floor, ceil, abs, min, max, sqrt, pow, random.
- Number/String/Boolean conversions, parseInt, isNaN, print, console.log,
  assert. Object/Array constructors are available.

## Architecture

The lexer and precedence parser compile directly into per-function bytecode.
The VM evaluates bytecode using a growable operand stack; C call frames
implement function invocation (bounded to 512 nested calls). Name/property
references preserve assignment targets and method receivers. Environments
are heap objects captured by closures; object properties use chained hash
buckets and dynamically sized tables. The mark/sweep collector traverses
objects using an intrusive worklist, handles cycles, and reclaims unreachable
compiled function metadata. GC runs at bytecode safe points. Native functions
that call JS keep scratch arrays and arguments on the rooted operand stack.

## Deliberate limits and known deviations

This is an initial implementation of a subset, not a drop-in replacement for
V8, SpiderMonkey, QuickJS, Duktape or an ES5.1 reference implementation.
It has not been tested against Test262 or an independent third-party JS library.
The large workload is synthetic, and is evidence of basic scaling, not general
compatibility. The engine has not been fuzzed or security-audited.

- No regular expressions, JSON, Date, eval, Function constructor, strict
  mode, with, debugger, labels, finally, or ES2015+ syntax. Some common
  standard library methods are absent (e.g. splice, bind, replace).
- No getters/setters, descriptor APIs, boxed primitive constructors,
  Error constructors, full ToPrimitive coercion or complete ES5 equality
  and conversion rules. Runtime errors caught by JS are strings, not Error
  objects; explicit throw preserves the supplied value.
- Strings are byte sequences, not UTF-16. Unicode escapes are translated to
  UTF-8 on a best-effort basis; string indexes, length and case mapping are
  byte-oriented. Identifier and numeric-literal grammars are simplified.
- For-in snapshots keys, does not accept arbitrary assignment targets, and
  property enumeration order follows hash buckets. No complete property
  attribute semantics, including writability/configurability.
- Arguments is an array rather than the ES5 exotic mapped arguments object;
  non-strict this/primitive boxing is approximate. Function declarations in
  blocks, named function binding, ASI and syntax-error checking are simplified.
- Arrays use signed-int length/index limits and have approximate sparse-array
  semantics; native array methods generally require an actual array.
- Some pathological input sizes can exhaust memory or overflow implementation
  limits. The budget is instruction-only; avoid untrusted code. C recursion
  limits and a count-based GC threshold are conservative, not hard resource
  limits. Native operations can allocate large amounts between GC safe points.
- No claim of complete out-of-memory recovery or exact ES5 number formatting.

## Validation

Built with GCC using `-std=c90 -pedantic-errors -Wall -Wextra`. Functional tests
cover recursive calls, closure capture, prototypes, array callbacks, sort,
for-in, switch, exception propagation and catch environments. The tests also
allocate a 25,000-object chain, exercise GC, and create temporary objects.
The host test exercises a registered C callback, error recovery, instruction
limits and 1,000 evaluations. The generated workload defines 1,000 modules
and performs 100,000 nested transformation calls; its expected aggregate is
2,477,475,000. AddressSanitizer and UndefinedBehaviorSanitizer runs of the
functional and generated workload tests completed without diagnostics.

Core: js.c, js.h, main.c. Tests: test.js, switch.js, catch.js, host_test.c,
generate_stress.py. Source is compact, with related straight-line operations
sometimes sharing a line to preserve the 2 KLOC budget.
