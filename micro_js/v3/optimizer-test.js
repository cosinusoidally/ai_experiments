/* Regression tests for cached hashes and fused lookups. */
function args(a){return arguments.length*10+arguments[0];}
assert(args(2,4,6)===32);
var a={x:42,m:function(n){return this.x+n;}};
assert(a.m(3)===45);assert(a['m'](8)===50);
function make(x){return function(y){return x+y;};}
assert(make(5)(7)===12);
try{notDefined;}catch(e){assert(e==='undefined identifier');}
try{a=null;a.x;}catch(e){assert(e==='property access on null/undefined');}
var z=[];z[0]=10;z['00']=20;z[1000000]=30;assert(z.length===1000001);assert(z['0']===10);assert(z['00']===20);assert(z[1000000]===30);z.length=1;assert(!(1000000 in z));assert(z['00']===20);
var o={};o['a\x00b']=1;o['a']=2;assert(o['a\x00b']===1);assert(o['a']===2);
assert('ABC'.toLowerCase()==='abc');assert('abc'.toUpperCase()==='ABC');
print('lookup/cache regression passed');
