var bytes = new Uint8Array([1, 2, 255, 4]);
assertEqual(bytes.length, 4, "Uint8Array length");
assertEqual(bytes.byteLength, 4, "Uint8Array byteLength");
assertEqual(bytes[2], 255, "Uint8Array indexed read");
bytes[1] = 258;
assertEqual(bytes[1], 2, "Uint8Array indexed conversion");

var words = new Uint32Array([0xffffffff, 7]);
assertEqual(words[0], 4294967295, "Uint32Array unsigned read");
assertEqual(words.BYTES_PER_ELEMENT, 4, "typed array element size");
assertEqual(words.byteLength, 8, "Uint32Array byteLength");
assertEqual(words.buffer.byteLength, 8, "ArrayBuffer byteLength");
assertEqual(words instanceof Uint32Array, true, "typed array instanceof");

var shared = new Uint8Array(words.buffer);
assertEqual(shared.length, 8, "view constructed from ArrayBuffer");
shared[0] = 3;
assertEqual(words[0], 4294967043, "views share an ArrayBuffer");

var middle = bytes.subarray(1, 3);
assertEqual(middle.length, 2, "subarray length");
middle[0] = 19;
assertEqual(bytes[1], 19, "subarray shares its backing store");
bytes.set(new Uint8Array([8, 9]), 2);
assertEqual(bytes[3], 9, "typed array set");

var floats = new Float32Array([1.5, -2.25]);
assertEqual(floats[0], 1.5, "Float32Array positive value");
assertEqual(floats[1], -2.25, "Float32Array negative value");
