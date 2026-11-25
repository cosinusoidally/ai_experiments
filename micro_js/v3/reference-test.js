/* Numeric references must survive GC, reassignment, and dense-buffer movement. */
var a = [1, 2, 3], original = a;
function replace() {
    a = [100];
    var garbage = [], i;
    for (i = 0; i < 30000; i++) garbage.push({x: i});
    original.length = 0;
    return 7;
}
a[1] = replace();
assert(a[0] === 100 && original[1] === 7 && original.length === 2);
assert(!(0 in original));
var b = [4];
function grow() {
    for (var i = 1; i < 1000; i++) b[i] = i;
    return 3;
}
b[0] += grow();
assert(b[0] === 7 && b[999] === 999);
assert(b[0]++ === 7 && ++b[0] === 9);
assert(delete b[0] && !(0 in b));
b[0] = function() { return this[1]; };
assert(b[0]() === 1);
var sparse = [];
sparse[100000] = 5;
sparse[100000]++;
assert(sparse[100000] === 6 && sparse.length === 100001);
assert(delete sparse[100000] && !(100000 in sparse));
print('numeric reference lifetime tests passed');
