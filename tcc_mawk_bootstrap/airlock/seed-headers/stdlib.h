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
