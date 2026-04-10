var path;
var buf;
var fd;

function main() {
    path = brk(19);
    buf = brk(1);

    wi8(add(path, 0), 97);
    wi8(add(path, 1), 114);
    wi8(add(path, 2), 116);
    wi8(add(path, 3), 105);
    wi8(add(path, 4), 102);
    wi8(add(path, 5), 97);
    wi8(add(path, 6), 99);
    wi8(add(path, 7), 116);
    wi8(add(path, 8), 115);
    wi8(add(path, 9), 47);
    wi8(add(path, 10), 105);
    wi8(add(path, 11), 111);
    wi8(add(path, 12), 52);
    wi8(add(path, 13), 50);
    wi8(add(path, 14), 46);
    wi8(add(path, 15), 100);
    wi8(add(path, 16), 97);
    wi8(add(path, 17), 116);
    wi8(add(path, 18), 0);

    fd = open(path, 577, 420);
    write(fd, buf, 0);
    wi8(buf, 42);
    write(fd, buf, 1);
    close(fd);

    fd = open(path, 0, 0);
    wi8(buf, 0);
    read(fd, buf, 1);
    close(fd);

    return ri8(buf);
}
