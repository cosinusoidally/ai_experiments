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
