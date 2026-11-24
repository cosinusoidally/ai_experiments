"""Run bytecode parity and nested-host tests without using host JS eval."""
import argparse, json, subprocess, tempfile, time
from pathlib import Path
root=Path(__file__).resolve().parent
engine=(root/'faithful_vm.js').read_text()
serializer=(root/'dump.js').read_text()
cc=['cc','-std=c90','-pedantic-errors','-O2']
parser=argparse.ArgumentParser()
parser.add_argument('--nested',action='store_true',help='also run the whole port under itself (slow)')
args=parser.parse_args()
with tempfile.TemporaryDirectory() as temp:
    temp=Path(temp); c_vm=temp/'jsvm'; c_dump=temp/'dump'; test=temp/'test.js'
    subprocess.run(cc+[str(root.parent/'js.c'),str(root.parent/'main.c'),'-lm','-o',str(c_vm)],check=True)
    subprocess.run(cc+[str(root/'dump.c'),'-lm','-o',str(c_dump)],check=True)
    def run_host(program):
        test.write_text(program)
        return subprocess.check_output([str(c_vm),str(root/'faithful_vm.js'),str(test)],text=True)
    for file in [root.parent/'test.js',root.parent/'switch.js',root.parent/'catch.js',root/'faithful_vm.js']:
        src=file.read_text()
        expected=subprocess.check_output([str(c_dump)],input=src,text=True)
        # Node runs the actual port as a standalone script, not via eval.
        test.write_text(engine+'\n'+serializer+'\nvar m=js_new(console.log);dumpFun(compile(m,'+json.dumps(src)+'),console.log);')
        actual=subprocess.check_output(['node',str(test)],text=True)
        def canonical(text):
            import re
            return re.sub(r"(?<= 3:)[^\n]+",lambda match:float(match.group()).hex(),text)
        if canonical(expected)!=canonical(actual):
            import difflib
            print(''.join(difflib.unified_diff(expected.splitlines(True),actual.splitlines(True)))[:4000])
            raise AssertionError(file.name+' bytecode mismatch')
        print('bytecode parity:',file.name, len(expected.splitlines()),'records',flush=True)
    for filename in ['test.js','switch.js','catch.js']:
        src=(root.parent/filename).read_text()
        test.write_text(engine+'\nvar m=js_new(console.log);if(!js_eval(m,'+json.dumps(src)+'))throw js_error(m);')
        actual=subprocess.check_output(['node',str(test)],text=True)
        expected=subprocess.check_output([str(c_vm),str(root.parent/filename)],text=True)
        assert actual==expected,filename
        print('execution parity:',filename,flush=True)
    payload='function fib(n){return n<2?n:fib(n-1)+fib(n-2);} assert(fib(5)===5); function count(n){return function(){return ++n;};} var c=count(3);assert(c()===4);assert(c()===5);print("guest test passed");'
    start=time.monotonic()
    print(run_host('var m=js_new();if(!js_eval(m,'+json.dumps(payload)+'))throw js_error(m);'),end='',flush=True)
    print('C-hosted port seconds:',round(time.monotonic()-start,3),flush=True)
    if args.nested:
        inner='var inner=js_new();if(!js_eval(inner,'+json.dumps(payload)+'))throw js_error(inner);'
        program='var m=js_new();print("loading port into guest");if(!js_eval(m,'+json.dumps(engine)+'))throw js_error(m);print("port loaded");if(!js_eval(m,'+json.dumps(inner)+'))throw js_error(m);'
        test.write_text(program)
        start=time.monotonic()
        subprocess.run([str(c_vm),str(root/'faithful_vm.js'),str(test)],check=True)
        print('nested seconds:',round(time.monotonic()-start,3),flush=True)
