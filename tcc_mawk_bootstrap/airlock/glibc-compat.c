#include <dirent.h>
#include <sys/stat.h>

/*
 * These wrappers bridge musl i386 headers to old glibc's i386 large-file
 * entry points. The program stays 32-bit; the "64" ABI names are the i386
 * layouts that match musl's struct stat/dirent definitions.
 */

extern int __xstat64(int ver, const char *path, void *buf);
extern int __fxstat64(int ver, int fd, void *buf);
extern int __lxstat64(int ver, const char *path, void *buf);
extern int __sigsetjmp(void *env, int savemask);

#undef readdir64
extern struct dirent *readdir64(DIR *dirp);

int stat(const char *path, struct stat *buf)
{
    return __xstat64(3, path, buf);
}

int fstat(int fd, struct stat *buf)
{
    return __fxstat64(3, fd, buf);
}

int lstat(const char *path, struct stat *buf)
{
    return __lxstat64(3, path, buf);
}

struct dirent *readdir(DIR *dirp)
{
    return readdir64(dirp);
}

int sigsetjmp(void *env, int savemask)
{
    return __sigsetjmp(env, savemask);
}
