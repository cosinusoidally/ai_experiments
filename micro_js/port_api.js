/* Host entry points. Output and native callback bindings are host services. */
function js_new(output) {
    var m={heap:0,gray:0,live:0,threshold:0,funs:0,global:0,op:0,ap:0,fp:0,sp:0,
        stack:[],top:0,cap:0,depth:0,frame:0,error:'',thrown:0,exception:undef(),limit:0,remaining:0,
        host_base:0,host_argc:0,host_result:undef(),signal:{},budgetSignal:{},output:output};
    if(!output)m.output=function(s){print(s);};
    init(m);return m;
}
function js_eval(m,source) {
    var f,fr;
    if(!m||m.frame)return 0;
    m.remaining=m.limit;m.error='';
    try {
        f=compile(m,source);fr={prev:0,env:m.global,code:f,self:object(m.global.vars),callee:undef(),base:0};
        m.frame=fr;run(m,f,m.global,fr.self,undef(),0,0);m.frame=0;gc(m);return 1;
    }catch(caught) {
        if(caught!==m.signal&&caught!==m.budgetSignal)throw caught;
        m.frame=0;m.exception=undef();m.host_result=undef();m.thrown=0;m.top=0;m.depth=0;gc(m);return 0;
    }
}
function js_error(m){return m.error;}
function js_set_budget(m,n){if(m&&!m.frame)m.limit=n;}
function js_register(m,name,callback,user){var v;if(!m||m.frame||!name||!callback)return 0;v=builtin(m,m.global.vars,name,NHOST);v.p.host=callback;v.p.user=user;return 1;}
function hostarg(m,i){return i>=0&&i<m.host_argc?m.stack[m.host_base+i]:undef();}
function js_arg_type(m,i){return hostarg(m,i).t;}
function js_arg_number(m,i){return number(hostarg(m,i));}
function js_arg_string(m,i){var v=hostarg(m,i);return v.t===STR?chars(v):null;}
function js_return_number(m,n){m.host_result=num(n);}
function js_return_boolean(m,n){m.host_result=boolean(n);}
function js_return_string(m,s,n){m.host_result=strn(m,s,n);}
function js_return_null(m){m.host_result=val(NIL,0,0);}
function js_free(m){m.heap=0;m.gray=0;m.funs=0;m.global=0;m.op=0;m.ap=0;m.fp=0;m.sp=0;m.stack=[];m.frame=0;m.live=0;}
