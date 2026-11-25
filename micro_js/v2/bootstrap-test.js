function counter(n) { return function() { return ++n; }; }
var c=counter(40);
assert(c()===41);
assert(c()===42);
assert(0.125+0.375===0.5);
try { throw 'caught'; } catch(e) { assert(e==='caught'); }
assert('a\x00b'.length===3);
assert('\u00e9'.length===2);
print('bootstrap execution passed');
