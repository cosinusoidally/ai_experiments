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
