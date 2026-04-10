# Bootstrap Status

The repository currently contains a stage0 compiler:

- implementation language: `mawk`
- output: ELF32/i386 Linux binaries
- current accepted source subset: a tiny function-based language with
  implicit 32-bit integer arguments and call-only operators

This is not self-hosted yet.

For this project, "self-hosted" means:

1. there is a compiler implementation written in C
2. that C source is restricted to the subset accepted by an earlier
   stage of `mawkcc`
3. `mawkcc` can compile that compiler source into a working next-stage
   compiler binary

That requires the source language to grow far beyond the current subset.
At minimum, stage1 needs:

- global and local variables
- arrays or equivalent linear storage
- string or byte-buffer handling
- multiple functions
- conditionals and loops
- comparisons
- pointer-like memory access or a disciplined substitute
- file output support via Linux syscalls or a runtime layer

Practical bootstrap path:

1. stabilize ELF32 code generation in stage0
2. add statements, variables, and multiple functions
3. add a fixed-memory model suitable for compiler data structures
4. write a C stage1 compiler matching the stage0 behavior
5. compile stage1 with stage0 and compare outputs on sample programs

The next implementation work should therefore focus on expanding the
subset toward a compilable compiler source, not pretending the current
stage0 is already self-hosted.
