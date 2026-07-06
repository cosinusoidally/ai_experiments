The aim of the game here is to port mawkcc to postscript. It must run under
ghostscript and must be written in a fairly conservative dialect of postscript
no weird version specific hacks. If possible it should be possible to build
mawkcc by invoking pscc (postscript cc) with the following invocation:

cat ../mawkcc/mawkcc_self.c | gs pscc.ps > artifacts/mawkcc.pscc.exe
chmod +x artifacts/mawkcc.pscc.exe
artifacts/mawkcc.pscc.exe ../mawkcc/mawkcc_self.c -o artifacts/mawkcc.self.exe

The following files should then be identical:

artifacts/mawkcc.self.exe and ../artifacts/mawkcc.self.exe

In an ideal world iartifacts/mawkcc.pscc.exe and artifacts/mawkcc.self.exe will
also be identical.

Use a similar directory structure and build scripts to the original mawkcc.
When testing first trigger a build of mawkcc self from ../mawkcc so you have
an artifact to compare to.

In terms of the postscript dialect make sure you keep the code fairly simple
in terms of language usage as I want it to also work on older versions of
postscript. At a later point I will want you to write a postscript
implementation in the mawkcc dialect of C so its worth keeping thing relatively
simple now.
