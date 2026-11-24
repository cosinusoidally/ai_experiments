import json
from pathlib import Path
s=Path(__file__).with_name('selfvm.js').read_text()
p='function fib(n){if(n<2){return n;} return fib(n-1)+fib(n-2);} function counter(n){return function(){n++;return n;};} var c=counter(10); assert(c()===11); assert(c()===12); assert(fib(8)===21); print("nested OK",fib(8));'
print('var payload = '+json.dumps(p)+';')
print('var engine = '+json.dumps(s)+';')
print('selfRun(payload);')
print('selfRun(engine+"\\nselfRun("+ '+json.dumps(json.dumps(p))+' +");");')
