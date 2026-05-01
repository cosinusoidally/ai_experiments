#ifndef SEED_UNISTD_H
#define SEED_UNISTD_H
int read(int fd, void *buf, unsigned int count);
int write(int fd, const void *buf, unsigned int count);
int close(int fd);
int symlink(const char *target, const char *linkpath);
#endif
