/* Original static Linux/i386 fixtures. CASE is supplied by build.sh. */
.section .rodata
message: .ascii "Hello from native Linux i386 on Windows!\n"
message_end:
checks_message: .ascii "ABI checks passed\n"
checks_end:
.section .bss
.align 4
bss_word: .skip 4

.section .text
.globl _start
_start:
#if CASE == 1
    movl $4, %eax
    movl $1, %ebx
    movl $message, %ecx
    movl $message_end-message, %edx
    int $0x80
    cmpl $message_end-message, %eax
    jne failed
    movl $37, %ebx
    jmp exit
#elif CASE == 2
    /* Startup stack, quote parsing, BSS, and syscall errno checks. */
    cmpl $3, (%esp)
    jne failed
    movl 8(%esp), %esi
    cmpl $0x68706c61, (%esi) /* alpha */
    jne failed
    cmpw $0x0061, 4(%esi)
    jne failed
    movl 12(%esp), %esi
    cmpl $0x206f7774, (%esi) /* two words */
    jne failed
    cmpl $0x64726f77, 4(%esi)
    jne failed
    cmpw $0x0073, 8(%esi)
    jne failed
    cmpl $0, 16(%esp)       /* argv end */
    jne failed
    cmpl $0, 20(%esp)       /* empty env */
    jne failed
    testl $15, %esp
    jne failed
    cmpl $0, bss_word
    jne failed
    movl $123, bss_word
    movl $0x7fffffff, %eax
    int $0x80
    cmpl $-38, %eax
    jne failed
    movl $4, %eax
    movl $9, %ebx
    xorl %ecx, %ecx
    movl $1, %edx
    int $0x80
    cmpl $-9, %eax
    jne failed
    movl $4, %eax
    movl $1, %ebx
    movl $1, %ecx
    int $0x80
    cmpl $-14, %eax
    jne failed
    movl $4, %eax
    movl $0xfffffffe, %ecx
    movl $8, %edx
    int $0x80
    cmpl $-14, %eax
    jne failed
    movl $4, %eax
    xorl %edx, %edx
    int $0x80
    testl %eax, %eax
    jne failed
    /* DF is guest state; bridge clears it for C but restores it on resume. */
    std
    movl $4, %eax
    movl $2, %ebx
    movl $checks_message, %ecx
    movl $checks_end-checks_message, %edx
    int $0x80
    pushfl
    popl %esi
    testl $0x400, %esi
    jz failed
    cld
    cmpl $checks_end-checks_message, %eax
    jne failed
    xorl %ebx, %ebx
    jmp exit
#elif CASE == 3
    movl $0, %eax
    movl (%eax), %eax
    jmp failed
#elif CASE == 4
    ud2
    jmp failed
#elif CASE == 5
    /* Host-enforced read-only text protection. */
    movb $0x90, _start
    jmp failed
#elif CASE == 6
    /* Anonymous non-executable stack on XP without DEP: writable guest data. */
    subl $16, %esp
    movl $0x63617473, (%esp)
    movl $0x6b, 4(%esp)
    movl $4, %eax
    movl $1, %ebx
    movl %esp, %ecx
    movl $5, %edx
    int $0x80
    cmpl $5, %eax
    jne failed
    xorl %ebx, %ebx
    jmp exit
#endif
failed:
    movl $99, %ebx
exit:
    movl $1, %eax
    int $0x80
    ud2
