/* Native i386 entry and SEH adapter. No instruction emulation. */
.text
.globl native_enter
native_enter:
    movl 4(%esp), %eax       /* Linux entry */
    movl 8(%esp), %edx       /* Linux initial ESP */
    movl 12(%esp), %ecx      /* allocation end / Windows StackBase */
    movl %ecx, %fs:4
    movl 16(%esp), %ecx      /* committed stack bottom / StackLimit */
    movl %ecx, %fs:8
    movl 20(%esp), %ecx      /* SEH registration on the new stack */
    movl %ecx, %fs:0
    movl %edx, %esp
    xorl %ebx, %ebx
    xorl %ecx, %ecx
    xorl %edx, %edx
    xorl %esi, %esi
    xorl %edi, %edi
    xorl %ebp, %ebp
    cld
    fninit
    jmp *%eax

.globl seh_adapter
seh_adapter:
    /* Guest DF must not affect C/Windows code. The saved context retains it. */
    cld
    jmp seh_dispatch
