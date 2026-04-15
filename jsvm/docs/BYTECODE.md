# JSVm Initial Bytecode

This file fixes the first bytecode target before interpreter implementation.
The initial VM is bytecode-first: accepted JavaScript source is compiled into
this representation, then executed by a deterministic interpreter. Native code
generation for the mawkcc subset comes later and must share the same value and
call-frame model.

## Scope

The first bytecode only needs to cover the current bootstrap subset used by
`jsvm_self.c`:

- global `var name;`
- `function name(args) { ... }`
- integer and string literals
- identifier loads and assignments
- call expressions
- expression statements
- `return`
- `if` / `else`
- `while`
- `break`
- primitive calls such as `ADD`, `EQ`, `brk`, `ri8`, `wi8`, `mks`, and `mkC`

Unsupported syntax must fail before bytecode execution.

## Value Model

Initial values are signed 32-bit integers. Pointers, string handles, function
indexes, globals, and bytecode offsets are also represented as 32-bit integer
handles. This matches the current mawkcc bootstrap runtime and avoids adding a
tagged JavaScript value representation before it is needed.

## Instruction Encoding

Use fixed-width rows stored in memory-backed tables:

```text
bytecode row = opcode, a, b, c
row width    = 16 bytes
field width  = 4 bytes
```

The fixed row size is intentionally simple. It keeps patching jumps, dumping
bytecode, and table accessors auditable in the mawkcc bootstrap dialect.

## Initial Opcodes

```text
BC_NOP              0
BC_LOAD_INT         1   eax = immediate a
BC_LOAD_STRING      2   eax = string handle a
BC_LOAD_GLOBAL      3   eax = global[a]
BC_STORE_GLOBAL     4   global[a] = eax
BC_LOAD_SLOT        5   eax = frame_slot[a]
BC_STORE_SLOT       6   frame_slot[a] = eax
BC_PUSH             7   push eax
BC_POP              8   pop into eax
BC_POP_DISCARD      9   discard top of stack
BC_CALL_USER       10   call function a with b args
BC_CALL_PRIMITIVE  11   call primitive a with b args
BC_JUMP            12   pc = a
BC_JUMP_IF_ZERO    13   if eax == 0 pc = a
BC_RETURN          14   return eax
```

## Function Table

Function rows should include at least:

```text
name
arity
bytecode_start
bytecode_len
slot_count
flags
```

Parameters are the only local slots at first. Temporary expression values use
the VM operand stack.

## Next Implementation Step

Add table globals and accessors for bytecode rows, function rows, primitive
indexes, and the operand stack in `jsvm_self.c`. Then implement parser emitters
that populate bytecode for a tiny fixture before adding the interpreter loop.
