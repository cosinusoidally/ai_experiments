"""Emit a reproducible, large, multi-function ES5-style workload."""
import sys
n = 1000
print('var modules=[];')
for i in range(n):
    print('modules.push((function(){')
    print('  var factor=%d;' % (i+1))
    print('  function transform(x){ return x*factor; }')
    print('  function aggregate(data){')
    print('    var total=0;')
    print('    for(var j=0;j<data.length;j++){')
    print('      total+=transform(data[j]);')
    print('    }')
    print('    return total;')
    print('  }')
    print('  return {run:aggregate};')
    print('})());')
print('var input=[];for(var i=0;i<100;i++)input.push(i);')
print('var sum=0;for(var i=0;i<modules.length;i++)sum+=modules[i].run(input);')
print('assert(sum===2477475000);print("large workload passed",sum);')
