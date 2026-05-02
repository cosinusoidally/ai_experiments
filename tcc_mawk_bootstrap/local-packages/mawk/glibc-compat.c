#include <sys/stat.h>

extern int __xstat(int ver, const char *path, void *buf);
extern int __fxstat(int ver, int fd, void *buf);
extern int __lxstat(int ver, const char *path, void *buf);

char **environ;

int stat(const char *path, struct stat *buf)
{
    return __xstat(3, path, buf);
}

int fstat(int fd, struct stat *buf)
{
    return __fxstat(3, fd, buf);
}

int lstat(const char *path, struct stat *buf)
{
    return __lxstat(3, path, buf);
}
