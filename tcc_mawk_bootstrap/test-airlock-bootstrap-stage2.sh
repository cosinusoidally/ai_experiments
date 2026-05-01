#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts=$root/artifacts/airlock-bootstrap-stage2
rootfs=$artifacts/rootfs
work=$artifacts/work
initrd_gz=$root/../../slackware-10.2/iso/isolinux/initrd.img
seed_bootstrap=$root/artifacts/bootstrap-i386-mawk
seed_tcc=$seed_bootstrap/stage2/tcc
seed_tccdir=$seed_bootstrap/common/lib/tcc
tarball_bz2=$root/tcc-0.9.27.tar.bz2
musl_tarball=$root/musl-1.1.24.tar.gz
bootstrappable_h=/home/foo/src/gpt/lb/target/mescc-tools-extra/M2libc/bootstrappable.h
bootstrappable_c=/home/foo/src/gpt/lb/target/mescc-tools-extra/M2libc/bootstrappable.c
woody_mawk=/home/foo/src/woody_mawk/mawk

if [ ! -x "$seed_tcc" ] || [ ! -d "$seed_tccdir/include" ]; then
  printf 'missing seed stage2 tcc; run bootstrap-i386-mawk.awk first\n' >&2
  exit 1
fi

rm -rf "$artifacts"
mkdir -p "$rootfs" "$work" "$work/musl-bits" "$work/seed-headers/sys" "$work/src/M2libc"

tmp_img=$artifacts/initrd.ext2
gzip -dc "$initrd_gz" > "$tmp_img"
debugfs -R "rdump / $rootfs" "$tmp_img" >/dev/null 2>"$artifacts/debugfs-rdump.err"
mkdir -p "$rootfs/work"

tmp_musl=$artifacts/musl-host
mkdir -p "$tmp_musl"
tar -xzf "$musl_tarball" -C "$tmp_musl"
mkdir -p "$work/musl-bits"
sed -f "$tmp_musl/musl-1.1.24/tools/mkalltypes.sed" \
  "$tmp_musl/musl-1.1.24/arch/i386/bits/alltypes.h.in" \
  "$tmp_musl/musl-1.1.24/include/alltypes.h.in" \
  > "$work/musl-bits/alltypes.h"
cp -f "$tmp_musl/musl-1.1.24/arch/i386/bits/syscall.h.in" "$work/musl-bits/syscall.h"
sed -n -e 's/__NR_/SYS_/p' "$tmp_musl/musl-1.1.24/arch/i386/bits/syscall.h.in" >> "$work/musl-bits/syscall.h"

cp -f "$seed_tcc" "$work/tcc-seed"
mkdir -p "$work/seed-tccdir/include"
cp -f "$seed_tccdir/include/"*.h "$work/seed-tccdir/include/"

cp -f "$root/unbz2.c" "$work/src/unbz2.c"
cp -f "$root/untar.c" "$work/src/untar.c"
cp -f "$bootstrappable_h" "$work/src/M2libc/bootstrappable.h"
cp -f "$bootstrappable_c" "$work/src/M2libc/bootstrappable.c"
cp -f "$tarball_bz2" "$work/tcc-0.9.27.tar.bz2"
cp -f "$musl_tarball" "$work/musl-1.1.24.tar.gz"
mkdir -p "$rootfs/usr/bin"
cp -f "$woody_mawk" "$rootfs/usr/bin/mawk"
chmod 0755 "$rootfs/usr/bin/mawk"

cat > "$work/seed-headers/stddef.h" <<'EOF'
#ifndef SEED_STDDEF_H
#define SEED_STDDEF_H
typedef unsigned int size_t;
#define NULL ((void *)0)
#endif
EOF

cat > "$work/seed-headers/stdio.h" <<'EOF'
#ifndef SEED_STDIO_H
#define SEED_STDIO_H
#include <stddef.h>
typedef struct _IO_FILE FILE;
extern FILE *stdin;
extern FILE *stdout;
extern FILE *stderr;
FILE *fopen(const char *path, const char *mode);
int fclose(FILE *stream);
size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream);
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream);
int fputs(const char *s, FILE *stream);
int fputc(int c, FILE *stream);
int puts(const char *s);
#endif
EOF

cat > "$work/seed-headers/stdlib.h" <<'EOF'
#ifndef SEED_STDLIB_H
#define SEED_STDLIB_H
#include <stddef.h>
#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
void exit(int status);
void abort(void);
void *malloc(size_t size);
void *calloc(size_t nmemb, size_t size);
void *realloc(void *ptr, size_t size);
void free(void *ptr);
long strtol(const char *nptr, char **endptr, int base);
#endif
EOF

cat > "$work/seed-headers/string.h" <<'EOF'
#ifndef SEED_STRING_H
#define SEED_STRING_H
#include <stddef.h>
size_t strlen(const char *s);
char *strcpy(char *dest, const char *src);
int strcmp(const char *s1, const char *s2);
char *strchr(const char *s, int c);
char *strrchr(const char *s, int c);
void *memset(void *s, int c, size_t n);
void *memcpy(void *dest, const void *src, size_t n);
void *memmove(void *dest, const void *src, size_t n);
#endif
EOF

cat > "$work/seed-headers/unistd.h" <<'EOF'
#ifndef SEED_UNISTD_H
#define SEED_UNISTD_H
int read(int fd, void *buf, unsigned int count);
int write(int fd, const void *buf, unsigned int count);
int close(int fd);
int symlink(const char *target, const char *linkpath);
#endif
EOF

cat > "$work/seed-headers/fcntl.h" <<'EOF'
#ifndef SEED_FCNTL_H
#define SEED_FCNTL_H
#define O_RDONLY 0
#define O_WRONLY 1
#define O_CREAT 0100
#define O_TRUNC 01000
int open(const char *path, int flags, int mode);
#endif
EOF

cat > "$work/seed-headers/sys/stat.h" <<'EOF'
#ifndef SEED_SYS_STAT_H
#define SEED_SYS_STAT_H
int mkdir(const char *path, unsigned int mode);
#endif
EOF

cat > "$work/crt.c" <<'EOF'
extern void exit(int status);
extern int main(int argc, char **argv, char **envp);

__asm__(
".text\n"
".globl _start\n"
"_start:\n"
"    mov (%esp), %eax\n"
"    lea 4(%esp), %ebx\n"
"    lea 8(%esp,%eax,4), %ecx\n"
"    push %ecx\n"
"    push %ebx\n"
"    push %eax\n"
"    call main\n"
"    push %eax\n"
"    call exit\n"
);
EOF

cat > "$work/inside-airlock.sh" <<'EOF'
#!/bin/sh
set -eu

cd /work
mkdir -p build extracted/tcc extracted/musl bootstrap/common/lib/tcc/include bootstrap/stage0 bootstrap/stage1 bootstrap/stage2

host_common_tccdir='__HOST_COMMON_TCCDIR__'
host_crt_prefix='__HOST_CRT_PREFIX__'
host_lib_paths='__HOST_LIB_PATHS__'
host_libc_so='__HOST_LIBC_SO__'

seed_cflags='-nostdinc -I/work/seed-headers -I/work/src'
seed_ldflags='-nostdlib -L/lib -L/usr/lib /work/crt.c /lib/libc.so.6'

./tcc-seed -B/work/seed-tccdir $seed_cflags $seed_ldflags /work/src/M2libc/bootstrappable.c /work/src/unbz2.c -o /work/build/unbz2
./tcc-seed -B/work/seed-tccdir $seed_cflags $seed_ldflags /work/src/M2libc/bootstrappable.c /work/src/untar.c -o /work/build/untar

/work/build/unbz2 --file /work/tcc-0.9.27.tar.bz2 --output /work/extracted/tcc.tar
( cd /work/extracted/tcc && /work/build/untar --file /work/extracted/tcc.tar )

gzip -dc /work/musl-1.1.24.tar.gz > /work/extracted/musl.tar
( cd /work/extracted/musl && /work/build/untar --file /work/extracted/musl.tar )

srcdir=/work/extracted/tcc/tcc-0.9.27
musl_src=/work/extracted/musl/musl-1.1.24
musl_inc=/work/bootstrap/musl-headers/include
common=/work/bootstrap/common/lib/tcc

mkdir -p "$musl_inc/bits"
cp -Rf "$musl_src/include/." "$musl_inc"
cp -Rf "$musl_src/arch/generic/bits/." "$musl_inc/bits"
cp -Rf "$musl_src/arch/i386/bits/." "$musl_inc/bits"
cp -f /work/musl-bits/alltypes.h "$musl_inc/bits/alltypes.h"
cp -f /work/musl-bits/syscall.h "$musl_inc/bits/syscall.h"

mawk '
  /typedef va_list __gnuc_va_list;/ {
    print;
    print "typedef va_list __isoc_va_list;";
    print "#define __DEFINED_va_list";
    print "#define __DEFINED___isoc_va_list";
    next
  }
  { print }
' "$srcdir/include/stdarg.h" > "$srcdir/include/stdarg.h.new"
mv "$srcdir/include/stdarg.h.new" "$srcdir/include/stdarg.h"

mawk '
  /#include <stdio.h>/ {
    print "#include <stdarg.h>";
    print;
    next
  }
  /#include <stdarg.h>/ { next }
  { print }
' "$srcdir/tcc.h" > "$srcdir/tcc.h.new"
mv "$srcdir/tcc.h.new" "$srcdir/tcc.h"

mawk '
  index($0, "sscanf(TCC_VERSION, \"%d.%d.%d\", &a, &b, &c);") {
    print "        char *p;";
    print "        a = strtol(TCC_VERSION, &p, 10);";
    print "        if (*p == '\''.'\'') {";
    print "            b = strtol(p + 1, &p, 10);";
    print "            if (*p == '\''.'\'')";
    print "                c = strtol(p + 1, 0, 10);";
    print "        }";
    next
  }
  { print }
' "$srcdir/libtcc.c" > "$srcdir/libtcc.c.new"
mv "$srcdir/libtcc.c.new" "$srcdir/libtcc.c"

mawk '
  index($0, "tcc_add_library_err(s1, \"c\");") {
    print "        tcc_add_file(s1, \"__HOST_LIBC_SO__\");"
    next
  }
  index($0, "return tcc_load_alacarte(s1, fd, size, 4);") {
    print "                if (0 && s1->alacarte_link) return tcc_load_alacarte(s1, fd, size, 4);"
    next
  }
  index($0, "return tcc_load_alacarte(s1, fd, size, 8);") {
    print "                if (0 && s1->alacarte_link) return tcc_load_alacarte(s1, fd, size, 8);"
    next
  }
  { print }
' "$srcdir/tccelf.c" > "$srcdir/tccelf.c.new"
mv "$srcdir/tccelf.c.new" "$srcdir/tccelf.c"

mawk '
  index($0, "return tcc_add_file(s1, buf);") {
    print "    if (!strcmp(filename, TCC_LIBTCC1)) {";
    print "        snprintf(buf, sizeof(buf), \"%s/libtcc1.o\", s1->tcc_lib_path);";
    print "        if (tcc_add_file(s1, buf) < 0)";
    print "            return -1;";
    print "        snprintf(buf, sizeof(buf), \"%s/alloca86.o\", s1->tcc_lib_path);";
    print "        if (tcc_add_file(s1, buf) < 0)";
    print "            return -1;";
    print "        return 0;";
    print "    }";
    print;
    next
  }
  { print }
' "$srcdir/tccelf.c" > "$srcdir/tccelf.c.new"
mv "$srcdir/tccelf.c.new" "$srcdir/tccelf.c"

cp -Rf "$srcdir/include/." "$common/include/"
cp -f "$srcdir/tcclib.h" "$common/include/"
version=$(sed -n '1p' "$srcdir/VERSION")

tcc_cflags="-m32 -DCONFIG_TCCBOOT -DTCC_TARGET_I386 -DONE_SOURCE=0 -nostdinc -I. -I$srcdir -I$srcdir/include -isystem $musl_inc -isystem $musl_inc/bits"
tcc_link="-L/lib -L/usr/lib /work/crt.c $common/libtcc1.o $common/alloca86.o /lib/libm.so.6 /lib/libdl.so.2 /lib/libc.so.6 -nostdlib"

write_config() {
  stage_dir=$1
  cat > "$stage_dir/config.h" <<CFG
/* generated inside airlock */
#ifndef CONFIG_TCCDIR
# define CONFIG_TCCDIR "$host_common_tccdir"
#endif
#ifndef CONFIG_TCC_CRTPREFIX
# define CONFIG_TCC_CRTPREFIX "$host_crt_prefix"
#endif
#ifndef CONFIG_TCC_LIBPATHS
# define CONFIG_TCC_LIBPATHS "$host_lib_paths"
#endif
#undef CONFIG_TCC_BCHECK
#define TCC_VERSION "$version"
CFG
}

build_libtcc1() {
  cc=$1
  obj_dir=/work/bootstrap/libtcc1
  mkdir -p "$obj_dir"
  rm -f "$obj_dir"/*.o "$common/libtcc1.a"

  ( cd "$obj_dir" && sh -c "$cc -c \"$srcdir/lib/libtcc1.c\" -o libtcc1.o $tcc_cflags" )
  ( cd "$obj_dir" && sh -c "$cc -c \"$srcdir/lib/alloca86.S\" -o alloca86.o $tcc_cflags" )
  ( cd "$obj_dir" && sh -c "$cc -c \"$srcdir/lib/alloca86-bt.S\" -o alloca86-bt.o $tcc_cflags" )
  cp -f "$obj_dir/libtcc1.o" "$common/libtcc1.o"
  cp -f "$obj_dir/alloca86.o" "$common/alloca86.o"
  cp -f "$obj_dir/alloca86-bt.o" "$common/alloca86-bt.o"
  /work/tcc-seed -ar rcs "$common/libtcc1.a" "$obj_dir/libtcc1.o" "$obj_dir/alloca86.o" "$obj_dir/alloca86-bt.o"
}

build_stage() {
  stage=$1
  cc=$2
  stage_dir=/work/bootstrap/$stage
  write_config "$stage_dir"
  objs=

  for src in tcc.c libtcc.c tccpp.c tccgen.c tccelf.c tccasm.c tccrun.c i386-gen.c i386-link.c i386-asm.c; do
    base=$(basename "$src")
    obj=${base%.c}.o
    ( cd "$stage_dir" && sh -c "$cc -c \"$srcdir/$src\" -o \"$obj\" $tcc_cflags" )
    objs="$objs $stage_dir/$obj"
  done

  sh -c "$cc $objs -o \"$stage_dir/tcc\" $tcc_link"
}

build_libtcc1 '"/work/tcc-seed" -B/work/seed-tccdir'
build_stage stage0 '"/work/tcc-seed" -B/work/seed-tccdir'
build_stage stage1 '"/work/bootstrap/stage0/tcc" -B/work/bootstrap/common/lib/tcc'
build_stage stage2 '"/work/bootstrap/stage1/tcc" -B/work/bootstrap/common/lib/tcc'

/work/bootstrap/stage2/tcc -v
EOF

chmod 0755 "$work/inside-airlock.sh"
sed -i \
  -e "s|__HOST_COMMON_TCCDIR__|$work/bootstrap/common/lib/tcc|g" \
  -e "s|__HOST_CRT_PREFIX__|/usr/lib32:/lib32:/usr/lib/i386-linux-gnu:/lib/i386-linux-gnu|g" \
  -e "s|__HOST_LIB_PATHS__|/usr/lib32:/lib32:/usr/lib/i386-linux-gnu:/lib/i386-linux-gnu|g" \
  -e "s|__HOST_LIBC_SO__|/usr/lib32/libc.so.6|g" \
  "$work/inside-airlock.sh"

bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/inside-airlock.sh

cmp -s "$work/bootstrap/stage1/tcc" "$work/bootstrap/stage2/tcc"
printf 'airlock stage2-seeded bootstrap complete\n'
