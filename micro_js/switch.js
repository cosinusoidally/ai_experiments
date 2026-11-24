function f(x){var s='';switch(x){case 1:s+='a';case 2:s+='b';break;default:s+='d';case 3:s+='c';}return s;}
assert(f(1)==='ab'); assert(f(2)==='b'); assert(f(3)==='c');assert(f(4)==='dc');
var n=0;for(var i=0;i<10;i++){switch(i){case 3:continue;case 5:break;default:n++;}}assert(n===8);
assert('a,b,'.split(',').join(':')==='a:b:');assert([1,2].some(function(x){return x===2;}));
var a=[1,2];assert(a.unshift(3,4)===4);assert(a.shift()===3);assert(a.join(',')==='4,1,2');
print('switch/library tests passed');
