var bytes = Buffer.alloc(12);
assertEqual(Buffer.isBuffer(bytes), true, "Buffer.isBuffer");
assertEqual(bytes.length, 12, "Buffer length");

for (var index = 0; index < bytes.length; index++) {
    assertEqual(bytes[index], 0, "Buffer.alloc zero fill");
    bytes[index] = index * 3;
}
assertEqual(bytes[3], 9, "numeric indexed write and read");

var view = bytes.slice(2, 6);
assertEqual(view.length, 4, "slice length");
assertEqual(view[1], 9, "slice initial alias");
view[1] = 201;
assertEqual(bytes[3], 201, "slice shares its backing store");
bytes[4] = 77;
assertEqual(view[2], 77, "parent writes are visible through slice");

bytes.writeUInt32LE(2018915346, 4);
assertEqual(bytes.readUInt32LE(4), 2018915346, "little-endian 32-bit access");
assertEqual(bytes[4], 18, "little-endian low byte");
assertEqual(bytes[7], 120, "little-endian high byte");

bytes.fill(5, 8, 12);
assertEqual(bytes[8], 5, "fill start");
assertEqual(bytes[11], 5, "fill end");

var overlap = Buffer.alloc(6);
for (index = 0; index < overlap.length; index++) overlap[index] = index + 1;
overlap.copy(overlap, 1, 0, 5);
assertEqual(overlap[0], 1, "overlap copy preserves first byte");
assertEqual(overlap[1], 1, "overlap copy moves first source byte");
assertEqual(overlap[5], 5, "overlap copy is memmove-safe");

bytes[99] = 10;
assertEqual(bytes[99], undefined, "out-of-range indexed write is ignored");
