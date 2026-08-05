This patch allow cc1 from gcc-4.2.1 to be built in a "unified" way. By that I
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
