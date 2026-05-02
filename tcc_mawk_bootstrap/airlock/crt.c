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
"    push $0\n"
"    push $0\n"
"    push %ecx\n"
"    push %esi\n"
"    push $main\n"
"    call __libc_start_main\n"
"    hlt\n"
);
