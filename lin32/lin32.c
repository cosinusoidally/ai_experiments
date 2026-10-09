/* Initial native Linux i386 runtime. Build with the supplied TCC 0.9.27. */
#include <windows.h>

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned long u32;

#define MAX_PH 32
#define MAX_ARGS 32
#define MAX_IMAGE (64UL * 1024 * 1024)
#define STACK_SIZE (1024UL * 1024)
#define PF_X 1
#define PF_W 2
#define PF_R 4

typedef struct {
    u8 ident[16];
    u16 type, machine;
    u32 version, entry, phoff, shoff, flags;
    u16 ehsize, phentsize, phnum, shentsize, shnum, shstrndx;
} ElfHeader;
typedef struct {
    u32 type, offset, vaddr, paddr, filesz, memsz, flags, align;
} ProgramHeader;
typedef struct { u32 lo, hi, flags; } Region;
typedef struct { void *previous; void *handler; } SehFrame;
typedef struct { HANDLE handle; int used, readable, writable; } GuestFile;

extern void native_enter(u32 entry, u32 sp, u32 base, u32 limit, SehFrame *frame);
extern int seh_adapter(EXCEPTION_RECORD *, void *, CONTEXT *, void *);

static Region regions[MAX_PH + 2];
static unsigned region_count;
static u32 heap_start, heap_break, heap_reserved;
static int heap_region = -1;
static HANDLE output, errors;
static int tracing;
static GuestFile files[32];

static u32 length(const char *s) { u32 n = 0; while (s[n]) ++n; return n; }
static void copy_bytes(void *dst, const void *src, u32 n) {
    u8 *d = dst; const u8 *s = src; while (n--) *d++ = *s++;
}
static int equal(const char *a, const char *b) {
    while (*a && *a == *b) { ++a; ++b; } return *a == *b;
}
static void text(HANDLE h, const char *s) {
    DWORD n; WriteFile(h, s, length(s), &n, 0);
}
static void hex(HANDLE h, u32 v) {
    char s[11]; int i; s[0] = '0'; s[1] = 'x';
    for (i = 0; i < 8; ++i) s[2+i] = "0123456789abcdef"[(v >> (28-4*i)) & 15];
    s[10] = 0; text(h, s);
}
static void fail(const char *message) {
    text(errors, "lin32: "); text(errors, message); text(errors, "\r\n");
    ExitProcess(125);
}

/* Bounds are logical ELF segment bounds, not merely allocated host pages. */
static int accessible(u32 ptr, u32 size, u32 required) {
    u32 end, next; unsigned i;
    if (size == 0) return 1;
    if (ptr + size < ptr) return 0;
    end = ptr + size;
    while (ptr < end) {
        next = ptr;
        for (i = 0; i < region_count; ++i)
            if ((regions[i].flags & required) == required &&
                regions[i].lo <= ptr && regions[i].hi > next)
                next = regions[i].hi;
        if (next == ptr) return 0;
        ptr = next;
    }
    return 1;
}

static u32 host_errno(void) {
    DWORD e = GetLastError();
    if (e == ERROR_FILE_NOT_FOUND || e == ERROR_PATH_NOT_FOUND) return (u32)-2;
    if (e == ERROR_ACCESS_DENIED || e == ERROR_SHARING_VIOLATION) return (u32)-13;
    if (e == ERROR_INVALID_HANDLE) return (u32)-9;
    if (e == ERROR_FILE_EXISTS || e == ERROR_ALREADY_EXISTS) return (u32)-17;
    if (e == ERROR_DISK_FULL || e == ERROR_HANDLE_DISK_FULL) return (u32)-28;
    if (e == ERROR_WRITE_PROTECT) return (u32)-30;
    if (e == ERROR_TOO_MANY_OPEN_FILES) return (u32)-24;
    if (e == ERROR_NOT_ENOUGH_MEMORY || e == ERROR_OUTOFMEMORY) return (u32)-12;
    if (e == ERROR_INVALID_PARAMETER || e == ERROR_INVALID_NAME) return (u32)-22;
    if (e == ERROR_BROKEN_PIPE) return (u32)-32;
    return (u32)-5;
}

static u32 guest_open(u32 path, u32 flags) {
    char name[MAX_PATH];
    u32 i, fd, mode = flags & 3;
    DWORD access, creation;
    HANDLE handle;
    /* Initial filesystem view: relative paths in the launcher's working directory. */
    if (mode == 3 || (flags & ~(3UL | 64 | 128 | 512 | 32768))) return (u32)-22;
    if (mode == 0 && (flags & 512)) return (u32)-22;
    for (i = 0; i < MAX_PATH; ++i) {
        if (path + i < path || !accessible(path + i, 1, PF_R)) return (u32)-14;
        name[i] = *(char *)(path + i);
        if (!name[i]) break;
        if (name[i] == ':') return (u32)-22;
        if (name[i] == '/') name[i] = '\\';
    }
    if (i == MAX_PATH) return (u32)-36;
    if (!i) return (u32)-2;
    if (name[0] == '\\') return (u32)-22;
    for (fd = 0; fd < 32 && files[fd].used; ++fd) {}
    if (fd == 32) return (u32)-24;
    access = mode == 0 ? GENERIC_READ : mode == 1 ? GENERIC_WRITE : GENERIC_READ | GENERIC_WRITE;
    if (flags & 64) creation = flags & 128 ? CREATE_NEW : flags & 512 ? CREATE_ALWAYS : OPEN_ALWAYS;
    else creation = flags & 512 ? TRUNCATE_EXISTING : OPEN_EXISTING;
    handle = CreateFileA(name, access, FILE_SHARE_READ | FILE_SHARE_WRITE, 0,
                         creation, FILE_ATTRIBUTE_NORMAL, 0);
    if (handle == INVALID_HANDLE_VALUE) return host_errno();
    files[fd].handle = handle; files[fd].used = 1;
    files[fd].readable = mode != 1; files[fd].writable = mode != 0;
    /* Linux creation modes are not Windows ACLs; no permission-bit emulation yet. */
    return fd;
}

/* Extend the native heap in Windows allocation-granularity blocks.
 * Failed brk requests return the previous break, as on Linux.
 * Shrinking changes the logical break; committed backing is retained.
 */
static u32 guest_brk(u32 requested) {
    u32 rounded;
    if (!requested) return heap_break;
    if (requested < heap_start || requested >= 0x7fff0000UL) return heap_break;
    rounded = (requested + 65535UL) & ~65535UL;
    if (rounded > heap_reserved) {
        if (VirtualAlloc((void *)heap_reserved, rounded - heap_reserved,
                         MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE) != (void *)heap_reserved)
            return heap_break;
        heap_reserved = rounded;
    }
    heap_break = requested;
    if (heap_region < 0) heap_region = region_count++;
    regions[heap_region].lo = heap_start;
    regions[heap_region].hi = heap_break;
    regions[heap_region].flags = PF_R | PF_W;
    return heap_break;
}

static u32 guest_syscall(u32 number, u32 a, u32 b, u32 c) {
    DWORD transferred;
    if (number == 1) ExitProcess(a & 255);
    if (number == 5) return guest_open(a, b);
    if (number == 45) return guest_brk(a);
    if (number == 3 || number == 4 || number == 6) {
        if (a >= 32 || !files[a].used) return (u32)-9;
        if (number == 6) {
            files[a].used = 0;
            return CloseHandle(files[a].handle) ? 0 : host_errno();
        }
        if (number == 3 && !files[a].readable) return (u32)-9;
        if (number == 4 && !files[a].writable) return (u32)-9;
        if (!accessible(b, c, number == 3 ? PF_W : PF_R)) return (u32)-14;
        if (!c) return 0;
        if (number == 3) {
            if (ReadFile(files[a].handle, (void *)b, c, &transferred, 0)) return transferred;
            if (GetLastError() == ERROR_BROKEN_PIPE) return 0;
        } else if (WriteFile(files[a].handle, (void *)b, c, &transferred, 0)) return transferred;
        return host_errno();
    }
    return (u32)-38;
}

/* Raw x86 SEH disposition: 0 = continue execution, 1 = continue search. */
int seh_dispatch(EXCEPTION_RECORD *record, void *frame, CONTEXT *ctx, void *dispatcher) {
    u32 syscall, result;
    (void)frame; (void)dispatcher;
    if (!(record->ExceptionFlags & EXCEPTION_NONCONTINUABLE) &&
        (record->ExceptionCode == EXCEPTION_ACCESS_VIOLATION ||
         record->ExceptionCode == EXCEPTION_PRIV_INSTRUCTION ||
         record->ExceptionCode == EXCEPTION_ILLEGAL_INSTRUCTION) &&
        accessible(ctx->Eip, 2, PF_R | PF_X) &&
        *(u8 *)ctx->Eip == 0xcd && *(u8 *)(ctx->Eip + 1) == 0x80) {
        syscall = ctx->Eax;
        if (tracing) {
            text(errors, "lin32: int80 exception="); hex(errors, record->ExceptionCode);
            text(errors, " eip="); hex(errors, ctx->Eip);
            text(errors, " syscall="); hex(errors, syscall); text(errors, "\r\n");
        }
        result = guest_syscall(syscall, ctx->Ebx, ctx->Ecx, ctx->Edx);
        ctx->Eax = result;
        ctx->Eip += 2;
        return 0;
    }
    text(errors, "lin32: guest fault exception="); hex(errors, record->ExceptionCode);
    text(errors, " eip="); hex(errors, ctx->Eip); text(errors, "\r\n");
    ExitProcess(125);
    return 1;
}

static u8 *read_image(const char *path, u32 *size) {
    HANDLE file; DWORD hi, n; u8 *data;
    file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, 0, OPEN_EXISTING, 0, 0);
    if (file == INVALID_HANDLE_VALUE) fail("cannot open ELF file");
    *size = GetFileSize(file, &hi);
    if (hi || *size == INVALID_FILE_SIZE || *size > 16UL * 1024 * 1024)
        fail("ELF file exceeds initial 16 MiB limit");
    if (*size < sizeof(ElfHeader)) fail("truncated ELF header");
    data = VirtualAlloc(0, *size, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
    if (!data) fail("cannot allocate ELF input buffer");
    if (!ReadFile(file, data, *size, &n, 0) || n != *size) fail("cannot read ELF file");
    CloseHandle(file); return data;
}

static u32 load_image(u8 *data, u32 size, u32 *phdr) {
    ElfHeader *e = (ElfHeader *)data;
    ProgramHeader *p;
    u32 lo = 0xffffffffUL, hi = 0, start, end, page, flags, prot, old;
    unsigned i, j;
    if (e->ident[0] != 0x7f || e->ident[1] != 'E' || e->ident[2] != 'L' ||
        e->ident[3] != 'F' || e->ident[4] != 1 || e->ident[5] != 1 ||
        e->ident[6] != 1 || e->type != 2 || e->machine != 3 || e->version != 1)
        fail("expected little-endian static ELF32/i386 ET_EXEC");
    if (e->ehsize != sizeof(ElfHeader) || e->phentsize != sizeof(ProgramHeader) ||
        !e->phnum || e->phnum > MAX_PH || e->phoff > size ||
        e->phnum * sizeof(ProgramHeader) > size - e->phoff)
        fail("invalid ELF program header table");
    p = (ProgramHeader *)(data + e->phoff);
    for (i = 0; i < e->phnum; ++i) {
        if (p[i].type == 3) fail("dynamic ELF interpreter not supported yet");
        if (p[i].type == 7) fail("Linux TLS not supported yet");
        if (p[i].type != 1) continue;
        if (p[i].filesz > p[i].memsz || p[i].offset > size ||
            p[i].filesz > size - p[i].offset || p[i].vaddr < 0x10000 ||
            p[i].vaddr >= 0x80000000UL || p[i].memsz > 0x80000000UL - p[i].vaddr)
            fail("invalid ELF load segment bounds");
        if (p[i].align > 1 && ((p[i].align & (p[i].align - 1)) ||
            ((p[i].vaddr - p[i].offset) & (p[i].align - 1))))
            fail("invalid ELF load segment alignment");
        if ((p[i].vaddr & 4095) != (p[i].offset & 4095))
            fail("ELF load segment is not page congruent");
        if (!p[i].memsz) continue;
        end = p[i].vaddr + p[i].memsz;
        for (j = 0; j < region_count; ++j)
            if (p[i].vaddr < regions[j].hi && end > regions[j].lo)
                fail("overlapping ELF load segments not supported");
        regions[region_count].lo = p[i].vaddr;
        regions[region_count].hi = end;
        regions[region_count++].flags = p[i].flags & 7;
        if (p[i].vaddr < lo) lo = p[i].vaddr;
        if (end > hi) hi = end;
    }
    if (!region_count || !accessible(e->entry, 1, PF_R | PF_X))
        fail("ELF entry is outside a readable executable segment");
    start = lo & ~65535UL; end = (hi + 4095) & ~4095UL;
    if (end - start > MAX_IMAGE) fail("ELF mapped span exceeds initial 64 MiB limit");
    if (VirtualAlloc((void *)start, end - start, MEM_RESERVE | MEM_COMMIT,
                     PAGE_READWRITE) != (void *)start)
        fail("ELF virtual address range is unavailable");
    heap_start = heap_break = heap_reserved = (end + 65535UL) & ~65535UL;
    *phdr = 0;
    for (i = 0; i < e->phnum; ++i) if (p[i].type == 1 && p[i].memsz) {
        copy_bytes((void *)p[i].vaddr, data + p[i].offset, p[i].filesz);
        /* VirtualAlloc zeroed the rest, including BSS. */
        if (e->phoff >= p[i].offset && e->phoff - p[i].offset <= p[i].filesz &&
            e->phnum * sizeof(ProgramHeader) <= p[i].filesz - (e->phoff - p[i].offset))
            *phdr = p[i].vaddr + e->phoff - p[i].offset;
    }
    /* Shared boundary pages get the union of the segments' permissions. */
    for (page = start; page < end; page += 4096) {
        flags = 0;
        for (j = 0; j < region_count; ++j)
            if (page < regions[j].hi && page + 4096 > regions[j].lo)
                flags |= regions[j].flags;
        if (flags & PF_X) prot = flags & PF_W ? PAGE_EXECUTE_READWRITE : PAGE_EXECUTE_READ;
        else if (flags & PF_W) prot = PAGE_READWRITE;
        else prot = flags & PF_R ? PAGE_READONLY : PAGE_NOACCESS;
        if (!VirtualProtect((void *)page, 4096, prot, &old)) fail("cannot protect ELF page");
    }
    if (!FlushInstructionCache(GetCurrentProcess(), (void *)start, end - start))
        fail("cannot synchronize loaded instructions");
    return e->entry;
}

static void launch(u32 entry, ElfHeader *e, u32 phdr, int argc, char **argv) {
    u8 *stack;
    u32 top, sp, pointers[MAX_ARGS], n, words, *v, old;
    SehFrame *frame;
    int i;
    stack = VirtualAlloc(0, STACK_SIZE, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
    if (!stack) fail("cannot allocate Linux stack");
    if (!VirtualProtect(stack, 4096, PAGE_NOACCESS, &old)) fail("cannot protect stack bottom");
    top = (u32)stack + STACK_SIZE;
    frame = (SehFrame *)(top - sizeof(SehFrame));
    frame->previous = (void *)0xffffffffUL; frame->handler = seh_adapter;
    /* Keep registration above all guest data and leave exception headroom. */
    sp = top - 4096;
    for (i = argc - 1; i >= 0; --i) {
        n = length(argv[i]) + 1;
        if (n > sp - ((u32)stack + 65536)) fail("Linux arguments exceed stack capacity");
        sp -= n; copy_bytes((void *)sp, argv[i], n); pointers[i] = sp;
    }
    words = 1 + argc + 1 + 1 + 2 * (phdr ? 11 : 8);
    sp = (sp - words * 4) & ~15UL;
    v = (u32 *)sp; *v++ = argc;
    for (i = 0; i < argc; ++i) *v++ = pointers[i];
    *v++ = 0; *v++ = 0; /* argv terminator; empty environment */
#define AUX(k, val) do { *v++ = (k); *v++ = (val); } while (0)
    if (phdr) { AUX(3, phdr); AUX(4, e->phentsize); AUX(5, e->phnum); }
    AUX(6, 4096); AUX(7, 0); AUX(9, entry);
    AUX(11, 0); AUX(12, 0); AUX(13, 0); AUX(14, 0); AUX(0, 0);
#undef AUX
    regions[region_count].lo = (u32)stack + 4096;
    regions[region_count].hi = (u32)frame;
    regions[region_count++].flags = PF_R | PF_W;
    if (tracing) {
        text(errors, "lin32: native entry="); hex(errors, entry);
        text(errors, " esp="); hex(errors, sp); text(errors, "\r\n");
    }
    native_enter(entry, sp, top, (u32)stack + 4096, frame);
    fail("Linux entry unexpectedly returned");
}

int main(int argc, char **argv) {
    int first = 1;
    u8 *data; u32 size, entry, phdr;
    output = GetStdHandle(STD_OUTPUT_HANDLE); errors = GetStdHandle(STD_ERROR_HANDLE);
    files[0].handle = GetStdHandle(STD_INPUT_HANDLE); files[0].used = 1; files[0].readable = 1;
    files[1].handle = output; files[1].used = 1; files[1].writable = 1;
    files[2].handle = errors; files[2].used = 1; files[2].writable = 1;
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    if (argc > MAX_ARGS) fail("too many arguments (maximum 32 including launcher)");
    if (argc > 1 && equal(argv[1], "--trace")) { tracing = 1; ++first; }
    if (argc <= first) {
        text(errors, "usage: lin32.exe [--trace] program.elf [arguments...]\r\n");
        return 2;
    }
    data = read_image(argv[first], &size);
    entry = load_image(data, size, &phdr);
    launch(entry, (ElfHeader *)data, phdr, argc - first, argv + first);
    return 125;
}
