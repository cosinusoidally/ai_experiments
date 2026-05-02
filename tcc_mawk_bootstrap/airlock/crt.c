extern int main(int argc, char **argv, char **envp);
extern int __libc_start_main(
    int (*main_fn)(int, char **, char **),
    int argc,
    char **argv,
    void (*init)(void),
    void (*fini)(void),
    void (*rtld_fini)(void),
    void *stack_end
);

typedef unsigned int size_t;
char **environ;

extern void (*__preinit_array_start[])(void);
extern void (*__preinit_array_end[])(void);
extern void (*__init_array_start[])(void);
extern void (*__init_array_end[])(void);
extern void (*__fini_array_start[])(void);
extern void (*__fini_array_end[])(void);

/* Match the startup surface that old glibc crt1.o expects. */
unsigned int _fp_hw = 3;
int __data_start = 0;
int data_start __asm__("data_start");
int data_start = 0;

void _init(void)
{
}

void _fini(void)
{
}

static void run_array(void (**start)(void), void (**end)(void))
{
    size_t i;
    size_t count = (size_t)(end - start);
    for (i = 0; i < count; ++i) {
        start[i]();
    }
}

void __libc_csu_init(void)
{
    run_array(__preinit_array_start, __preinit_array_end);
    _init();
    run_array(__init_array_start, __init_array_end);
}

void __libc_csu_fini(void)
{
    size_t i = (size_t)(__fini_array_end - __fini_array_start);
    while (i-- > 0) {
        __fini_array_start[i]();
    }
    _fini();
}

static int tcc_start_main(int argc, char **argv, char **envp)
{
    environ = envp;
    return main(argc, argv, envp);
}

__asm__(
".text\n"
".globl _start\n"
"_start:\n"
"    xor %ebp, %ebp\n"
"    pop %esi\n"
"    mov %esp, %ecx\n"
"    and $-16, %esp\n"
"    push %eax\n"
"    push %esp\n"
"    push %edx\n"
"    push $__libc_csu_fini\n"
"    push $__libc_csu_init\n"
"    push %ecx\n"
"    push %esi\n"
"    push $tcc_start_main\n"
"    call __libc_start_main\n"
"    hlt\n"
);
