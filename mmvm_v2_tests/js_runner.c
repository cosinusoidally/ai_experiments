#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>

#define SNAPSHOT_MAGIC 0x32535647U
#define SNAPSHOT_VERSION 2U
#define SNAPSHOT_HEADER_BYTES 128U

typedef int (*snapshot_entry_fn)(int, char **, void *);

static uint32_t image_word(const unsigned char *image, unsigned int offset)
{
    return (uint32_t)image[offset] |
           ((uint32_t)image[offset + 1] << 8) |
           ((uint32_t)image[offset + 2] << 16) |
           ((uint32_t)image[offset + 3] << 24);
}

int main(int argc, char **argv)
{
    int descriptor;
    struct stat status;
    unsigned char *image;
    uint32_t file_length;
    uint32_t entry_offset;
    uint32_t code_offset;
    uint32_t code_length;
    uint32_t heap_offset;
    uint32_t heap_image_length;
    uint32_t heap_capacity;
    void *dlsym_address;
    snapshot_entry_fn entry;
    int result;

    if (argc < 3) {
        fprintf(stderr, "usage: %s snapshot program.js [arguments...]\n",
                argv[0]);
        return 64;
    }
    descriptor = open(argv[1], O_RDONLY);
    if (descriptor < 0 || fstat(descriptor, &status) != 0 ||
        status.st_size < (off_t)SNAPSHOT_HEADER_BYTES) {
        fprintf(stderr, "js_runner: cannot read snapshot %s\n", argv[1]);
        if (descriptor >= 0) close(descriptor);
        return 66;
    }
    image = (unsigned char *)mmap(0, (size_t)status.st_size,
        PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE, descriptor, 0);
    close(descriptor);
    if (image == MAP_FAILED) {
        fprintf(stderr, "js_runner: cannot map snapshot %s\n", argv[1]);
        return 71;
    }
    file_length = image_word(image, 8);
    entry_offset = image_word(image, 12);
    code_offset = image_word(image, 20);
    code_length = image_word(image, 24);
    heap_offset = image_word(image, 28);
    heap_image_length = image_word(image, 32);
    heap_capacity = image_word(image, 36);
    if (image_word(image, 0) != SNAPSHOT_MAGIC ||
        image_word(image, 4) != SNAPSHOT_VERSION ||
        file_length != (uint32_t)status.st_size ||
        entry_offset < SNAPSHOT_HEADER_BYTES || entry_offset >= code_offset ||
        code_offset >= heap_offset || code_length > heap_offset - code_offset ||
        heap_image_length > heap_capacity || heap_offset > file_length ||
        heap_image_length != file_length - heap_offset) {
        fprintf(stderr, "js_runner: incompatible snapshot %s\n", argv[1]);
        munmap(image, (size_t)status.st_size);
        return 65;
    }
    dlsym_address = dlsym(RTLD_DEFAULT, "dlsym");
    if (!dlsym_address) {
        fprintf(stderr, "js_runner: dlsym is unavailable\n");
        munmap(image, (size_t)status.st_size);
        return 69;
    }
    entry = (snapshot_entry_fn)(image + entry_offset);
    result = entry(argc - 2, argv + 2, dlsym_address);
    munmap(image, (size_t)status.st_size);
    return result;
}
