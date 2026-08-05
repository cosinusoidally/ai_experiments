Building a unified version of gcc-4.2.1
=======================================

This patch allows cc1 from gcc-4.2.1 to be built in a "unified" way. By that I
mean that there essentially exists a `cc1_unified.c` file that `#include` every
file from cc1, approximately this:

```
#include "c-lang.c"
#include "c-lex.c"
#include "c-pragma.c"
#include "c-decl.c"
...
```
This allows cc1 to be built with a single invocation of the system c compiler:
```
gcc cc1_unified.c -o cc1_unified
```
Note it's a bit more complicated that this in practice (since cc1 relies on
several build tools that generate some C code at compile time, plus the above
command omits stuff like the include directory).

For now the best way to build cc1_unfied is from within a Debian Etch i386
debootstrap buildd chroot. To set that up run:

```
sudo debootstrap --arch=i386 --variant=buildd etch etch_32_buildd
```

Note if you want to avoid using sudo then you can use something like mmdebstrap
https://packages.debian.org/search?keywords=mmdebstrap (this relies on proot,
also available in the debian repos). There's probably also tricks you can do
with stuff like bwrap. Or you could use a VM. Either way, there is obviously
room for improvement in this process and I'm planning to come up with an easy
rootless way of setting up the build system. For now, a chroot is the easiest
way forward.

Then enter the chroot:
```
cd etch_32_buildd
sudo chroot .
```
Add a user:
```
useradd foo
mkdir /home/foo
chown foo: /home/foo
```
Check you can switch to the foo user in the chroot:
```
su foo
cd
pwd
```
expect to see:
```
/home/foo
```
check you are the right user with whoami

Exit the chroot (with exit or ctrl-d)

Before you re-enter the chroot you need to make sure you run:
```
setarch i686
```
on the host. This is because the chroot itself does not have the setarch
command.

Enter the chroot, become the foo user, and then run:
```
uname -a
```
Expect something like:
```
Linux 5.15.0-186-generic #196-Ubuntu SMP Sat Jun 20 16:09:34 UTC 2026 i686 GNU/Linux
```
Note it mentions i686 (outside of the setarch env it will likely say x86_64).

Next you can get the gcc-4.2.1 tarball. Obtain the tarball from here:
https://ftp.gnu.org/pub/gnu/gcc/gcc-4.2.1/ (or via a mirror).

I'd recommend checking the sig too (`gpg --verify ...` ). For reference the
sha256sum of the file I used is:

```
ca0a12695b3bccfa8628509e08cb9ed7d8ed48deff0a299e4cb8de87d2c1fced  gcc-4.2.1.tar.bz2
```

Place the tarball in `/home/foo/src` in
the chroot. Note you cannot extract the tarball inside the chroot since the
chroot does not contain bunzip2. Extract the tarball before entering the chroot
again.

Inside the chroot create yourself a build directory (eg, call it build).
Place the `gcc-4.2.1_unified.patch` in the chroot. Your `/home/foo/src/`
directory should look as follows:
```
$ ls
build  gcc-4.2.1  gcc-4.2.1.tar.bz2  gcc-4.2.1_unified.patch
```
next enter the `gcc-4.2.1` directory and apply the patch (do this inside the
chroot).

```
patch -p1 < ../gcc-4.2.1_unified.patch
```

Mark the build script as executable:

```
chmod +x build-cc1-unified.sh
```

Now move over into your empty build directory:
```
~/src/gcc-4.2.1$ cd ../build
~/src/build$ ls ..
build  gcc-4.2.1  gcc-4.2.1.tar.bz2  gcc-4.2.1_unified.patch
```
Now run the build:
```
time ../gcc-4.2.1/build-cc1-unified.sh
```
On my system the above command take about 40 seconds. If it is sucessful you
will find the cc1 binary in `./unified-artifacts/cc1_unified`:
```
~/src/build$ ./unified-artifacts/cc1_unified --version
GNU C version 4.2.1 (i686-pc-linux-gnu)
	compiled by GNU C version 4.1.2 20061115 (prerelease) (Debian 4.1.1-21).
GGC heuristics: --param ggc-min-expand=30 --param ggc-min-heapsize=4096
```
Note at this point the script will only build cc1 (which is the C compiler
proper). It does not build the `gcc` "compiler driver" (the `gcc` command that
will run the compiler (`cc1`), assembler (`as`), and linker (`ld`, via the
`collect2` wrapper) in turn). My plan is to add some kind of driver, but for
now  you'll have to run something like:

```
cc1_unified -I /usr/lib/gcc/i486-linux-gnu/4.1.2/include/ foo.c -o foo.s
gcc foo.s -o foo.exe
```
Note the reason to include `/usr/lib/gcc/i486-linux-gnu/4.1.2/include/` above
is for stuff like `stddef.h`. You should also be able to use the gcc-4.2.1
includes if you have them installed somewhere (they might work directly from
the source tree, but I've not tried).
