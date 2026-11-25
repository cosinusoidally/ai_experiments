/* Dense/sparse coexistence, holes, prototypes, enumeration and truncation. */
var a = [], i, k, seen = {};
a[24] = 100;
a[1000000] = 99;
a.name = 'array';
for (i = 0; i < 40; i++) {
    if (i !== 24) a[i] = i;
}
assert(a.length === 1000001);
assert(a[24] === 100);
a[24] = 200;
assert(a['24'] === 200);
assert(delete a[24]);
assert(!(24 in a));
a[24] = undefined;
assert(a.hasOwnProperty('24'));
assert(a[24] === undefined);
a['01'] = 7;
assert(a[1] === 1 && a['01'] === 7);
for (k in a) {
    assert(!seen[k]);
    seen[k] = true;
}
assert(seen['24'] && seen['1000000'] && seen.name && seen['01']);
var keys = Object.keys(a);
assert(keys.length === 43);
Array.prototype[24] = 'inherited';
assert(a[24] === undefined);
delete a[24];
assert(a[24] === 'inherited');
assert(!a.hasOwnProperty(24) && 24 in a);
delete Array.prototype[24];
a.length = 3;
assert(a.length === 3 && !(24 in a) && !(1000000 in a));
assert(a[2] === 2 && a.name === 'array' && a['01'] === 7);
a.length = 1000001;
assert(!(999999 in a));
a[999999] = 5;
assert(a[999999] === 5);
a.length = 0;
assert(a.length === 0 && !(999999 in a) && !(0 in a));
assert(a['01'] === 7);
var b = [];
for (i = 0; i < 20000; i++) b.push({n: i});
assert(b[12345].n === 12345);
b.length = 9;
assert(b[8].n === 8 && !(9 in b));
for (i = 0; i < 20000; i++) b.push(i);
assert(b[20008] === 19999);
b.length = 0;
assert(b.length === 0);
print('dense/sparse regression passed');
