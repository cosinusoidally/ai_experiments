var path;
var buf;
var fd;

function main() {
    buf = brk(1);
    path = mks("artifacts/io42.dat");

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
