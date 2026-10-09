/* Minimal static Linux/i386 startup and syscall support for the C fixtures. */
#ifndef LIN32_TEST_LINUX_H
#define LIN32_TEST_LINUX_H

unsigned int *initial_stack;
int main(int argc, char **argv);

/* Capture the ELF entry stack and pass its argc/argv to the C program. */
__asm__(
    ".text\n"
    ".globl _start\n"
    "_start:\n"
    "movl %esp, initial_stack\n"
    "movl (%esp), %eax\n"
    "leal 4(%esp), %edx\n"
    "pushl %edx\n"
    "pushl %eax\n"
    "call main\n"
    "movl %eax, %ebx\n"
    "movl $1, %eax\n"
    "int $0x80\n"
    "ud2\n"
);

static int syscall3(int number, unsigned int a, unsigned int b, unsigned int c) {
    int result;
    __asm__ __volatile__("int $0x80" : "=a"(result)
                         : "0"(number), "b"(a), "c"(b), "d"(c) : "memory", "cc");
    return result;
}

static int write_bytes(int fd, const void *buffer, unsigned int size) {
    return syscall3(4, fd, (unsigned int)buffer, size);
}

#endif
