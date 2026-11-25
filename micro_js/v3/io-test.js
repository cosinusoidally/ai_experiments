/* All 256 byte values, embedded NULs, buffered I/O, EOF and short reads. */
var fd=fopen('io-test.bin','wb'),i,s='',r;
assert(fd>0);
for(i=0;i<256;i++){
    assert(fputc(i,fd)===i);
    s+=byteCharHost(i);
}
assert(s.length===256);
assert(fwrite(fd,s)===256);
assert(fwrite(fd,'a\x00b')===3);
assert(fclose(fd)===0);
fd=fopen('io-test.bin','rb');assert(fd>0);
for(i=0;i<256;i++)assert(fgetc(fd)===i);
r=fread(fd,17);assert(r.length===17);
for(i=0;i<17;i++)assert(r.charCodeAt(i)===i);
r=fread(fd,4096);assert(r.length===242);
for(i=0;i<239;i++)assert(r.charCodeAt(i)===i+17);
assert(r.slice(239)==='a\x00b');
assert(fgetc(fd)===-1);assert(fread(fd,16)==='');
assert(fclose(fd)===0);
assert(readFile('io-test.bin')===s+s+'a\x00b');
print('binary I/O: all 256 byte values passed');
