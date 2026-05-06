# mawkcc human review

See also dated notes [DATED.md](DATED.md)

For more general human review of all of my AI based code see:
[../../human_review/README.md](../../human_review/README.md)

I will gather general observations in this file. I will also provide some of my
more undigested thoughts in date specific files (eg 2026-05-06.md).

General observation is that Codex GPT-5.4 did a pretty good job. It generated
3 versions of the compiler (and awk version. ansi C version and a self hosted
version). All 3 versions produce bit identical output when compiling itself.

The compiler source code is also valid AWK and JavaScript. This means the code
can be built with mawk or the Mozilla Spidermonkey shell (gawk in theory will
also work, but you will likely need to `export LC_ALL=C` before running). It
can also be run in a web browser via the `index.html` file (this part was
written by a human (me)).

Some observed limitations of the code (some of which I will try and fix manually
):

* I'm not convinced the `.o` object code output format is generating correct
  relocations for builtin functions. eg if you compile as follows you will get
  a segfault when you run out.exe:

```
./artifacts/mawkcc.reference-c.exe -c mawkcc_self.c -o artifacts/out.o
gcc -m32 artifacts/mawkcc_gcc_support.o artifacts/out.o
gcc -m32 artifacts/mawkcc_gcc_support.o artifacts/out.o -o artifacts/out.exe
```

* I'm not 100% sure the calling convention is 100% right. I asked it to use the
  System V calling convention. It kind of seemed to do this, but it was not
  correctly preserving the ebx register. It fixed this with a preamble that did
  preserve ebx, but I have broader questions about whether it got that right.
  Maybe a better approach would be to just use the stack rather than ebx, and
  use ecx as a temp (this approach, which is what other compilers do, would
  also mean that ebx would not needs to preserved, as ecx is a scratch register
  that does not need to be preserved across calls).

* there are some magic numbers in the mawkcc_self.c code that do not exist
  in the awk version (or sometimes the ansi C version). I think this is because
  for some early stages in the port it just expanded them as it was easier.
  This harms human understandability.

* I think they way it inlines syscalls is maybe not the best choice (I would
  prefer if it called out to some kind of `syscall` function). This is maybe on
  me as I didn't tell it to do that.

* a lot of the machine code generation uses magic opcode numbers (but not
  consistently). This should be refactored to be clearer which opcodes are
  being generated (potentially with helper functions).

* the implementation doesn't track the current line number, only an offset from
  the start of the file.

* some of the tests are not very good. eg I remember it adding a linking test
  that did not excerise relocations very well. I suspect the linking tests are
  generally not very good as it it missied the fact that the gcc based linking
  is not working correctly.
