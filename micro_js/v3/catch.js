function f(x){if(x)throw {message:'oops'};return 7;}
var e='outer'; var g; try {f(true);assert(false);}catch(e){assert(e.message==='oops');g=function(){return e.message;};}assert(e==='outer');assert(g()==='oops');
var n=0;for(var k in {a:1,b:2,c:3}){try {if(k==='a')throw 2;n++;}catch(e){n+=e;continue;}}assert(n===4);
try{try{throw 1;}catch(e){throw e+1;}}catch(e){assert(e===2);}
try{null.foo;}catch(e){assert(typeof e==='string');}
function h(){try{throw 5;}catch(e){return e;}}assert(h()===5);
print('catch tests passed');
