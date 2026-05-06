# mawkcc human review

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

