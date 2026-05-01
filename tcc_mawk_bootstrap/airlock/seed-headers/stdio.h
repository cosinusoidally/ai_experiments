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
