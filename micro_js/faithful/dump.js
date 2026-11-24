/* Same canonical bytecode serialization as dump.c. */
function dumpValue(v){
    var s=String(v.t)+':',i,c,hexDigits='0123456789abcdef';
    if(v.t===NUM||v.t===BOOL)s+=String(v.n);
    if(v.t===STR)for(i=0;i<slen(v);i++){c=chars(v).charCodeAt(i);s+=hexDigits.charAt(c>>4)+hexDigits.charAt(c&15);}
    return s;
}
function dumpFun(f,output){
    var i,h,ins;
    output('F '+dumpValue(f.name)+' '+f.argc+' '+f.nv+' '+f.nh+' '+f.nhd+' '+f.n);
    for(i=0;i<f.argc;i++)output('P '+dumpValue(f.params[i]));
    for(i=0;i<f.nv;i++)output('V '+dumpValue(f.vars[i]));
    for(i=0;i<f.nh;i++){output('H '+dumpValue(f.names[i]));dumpFun(f.hoist[i],output);}
    for(i=0;i<f.nhd;i++){h=f.handlers[i];output('E '+h.start+' '+h.end+' '+h.target+' '+h.finish+' '+h.iter+' '+dumpValue(h.name));}
    for(i=0;i<f.n;i++){ins=f.code[i];output('I '+ins.op+' '+ins.a+' '+dumpValue(ins.v));if(ins.fn)dumpFun(ins.fn,output);}
    output('END');
}
