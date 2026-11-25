function fib(n) { return n < 2 ? n : fib(n-1)+fib(n-2); }
assert(fib(15) === 610);
function counter(n) { return function() { return ++n; }; }
var c=counter(3); assert(c()===4); assert(c()===5);
function Point(x,y) { this.x=x; this.y=y; }
Point.prototype.sum=function(){return this.x+this.y;};
var p=new Point(2,3); assert(p.sum()===5); assert(p instanceof Point);
var a=[]; for(var i=0;i<10000;i++) { a.push(i); }
assert(a.length===10000); assert(a.reduce(function(s,x){return s+x;},0)===49995000);
assert(a.filter(function(x){return x%2===0;}).length===5000);
assert(a.map(function(x){return x+1;})[9999]===10000);
assert('abc'.slice(1)==='bc'); assert(typeof missing==='undefined');
var o={a:1,b:2}; assert(Object.keys(o).length===2); assert(delete o.a); assert(!('a' in o));
var sum=0; for(var j=0;j<20;j++){if(j===3)continue;if(j===10)break;sum+=j;} assert(sum===42);
assert((function(a,b){return this.x+a+b;}).apply(p,[4,5])===11);
print('smoke tests passed');
var ordered=[5,3,4,1,2]; ordered.sort(function(x,y){return x-y;});
assert(ordered.join('')==='12345');
var root={}; var tail=root;
for(var depth=0;depth<25000;depth++){tail.next={};tail=tail.next;}
tail.value=42; assert(tail.value===42);
root=null;tail=null;
for(var q=0;q<30000;q++){var junk={x:q,y:[q,q+1]};}
assert(junk.x===29999);
print('sort and GC stress passed');
