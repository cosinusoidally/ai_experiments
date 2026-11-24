from pathlib import Path
import re, ast
from pycparser import c_parser,c_ast,c_generator
root=Path(__file__).parent
source=(root.parent/'js.c').read_text()
# Translate the actual C syntax tree for pointer-independent routines.
s=re.sub(r'/\*.*?\*/','',source,flags=re.S)
s=re.sub(r'^#.*$','',s,flags=re.M)
s='typedef unsigned long size_t; typedef int jmp_buf; typedef struct VM VM; typedef int (*js_native)(VM *,int,void *);\n'+s
# 'function' is legal C but reserved JS; 'in' is also reserved.
s=re.sub(r'\bfunction\b(?=\s*\()', 'parseFunction', s)
# Don't change quoted text: AST emitter renames identifiers instead.
tree=c_parser.CParser().parse(s)
funcs={n.decl.name:n for n in tree.ext if isinstance(n,c_ast.FuncDef)}
class JS(c_generator.CGenerator):
    def visit_ID(self,n): return {'in':'ins'}.get(n.name,n.name)
    def visit_Constant(self,n):
        if n.type=='char': return str(ord(ast.literal_eval(n.value)))
        if n.type=='string': return n.value.replace('\\001','\\x01')
        return re.sub(r'(?i)(?<=\d)[ul]+$','',n.value)
    def visit_StructRef(self,n): return self._parenthesize_unless_simple(n.name)+'.'+self.visit(n.field)
    def visit_Cast(self,n):
        typ=n.to_type.type
        if isinstance(typ,c_ast.TypeDecl) and isinstance(typ.type,c_ast.IdentifierType) and typ.type.names==['int']:
            return 'cint('+self.visit(n.expr)+')'
        return '('+self.visit(n.expr)+')'
    def visit_Decl(self,n,no_type=False):
        name={'in':'ins'}.get(n.name,n.name)
        if isinstance(n.type,c_ast.FuncDecl): return ''
        return 'var '+name+(' = '+self.visit(n.init) if n.init else '')
    def visit_DeclList(self,n): return 'var '+', '.join(self.visit(x)[4:] for x in n.decls)
    def visit_UnaryOp(self,n):
        if n.op in ('&','*'): return '('+self.visit(n.expr)+')'
        return super().visit_UnaryOp(n)
    def visit_FuncDef(self,n):
        args=n.decl.type.args.params if n.decl.type.args else []
        return 'function '+n.decl.name+'('+','.join({'in':'ins'}.get(a.name,a.name) for a in args if getattr(a,'name',None))+') '+self.visit(n.body)
    def visit_ExprList(self,n): return ', '.join(self.visit(x) for x in n.exprs)
g=JS()
def gen(name):return g.visit(funcs[name])
# Numeric values are derived directly from C enums, including their explicit starts.
constants=[]
for n in tree.ext:
    if isinstance(n,c_ast.Decl) and isinstance(n.type,c_ast.Enum):
        i=0
        for e in n.type.values.enumerators:
            if e.value:i=int(e.value.value)
            constants.append(e.name+'='+str(i));i+=1
out=['/* Generated faithful port of js.c; regenerate with generate_port.py. */\nvar '+',\n    '.join(constants)+';\n',(root/'port_core.js').read_text()]
names='get has named hidden lookup binding truth property reference readval store equal markfun scan accept need id out patch chain parseFunction prec args member primary prefix compound expr semi vars stmt pop take arr keynum append callable closure arg integer bound native invoke run builtin init'.split()
for name in names:
    t=gen(name)
    # Simple C allocation and string/number substitutions. Pointer-only routines
    # have hand-written counterparts in port_core.js.
    if name=='reference':t=t.replace('cell(m, sizeof(Ref), CREF)','cell(m, CREF)')
    if name=='property':t=t.replace('strn(m, chars(b) + i, 1)','strn(m, chars(b).slice(i), 1)')
    if name=='parseFunction':t=re.sub(r'^\s*f\.params = mem\(.*?;\n','\n',t,flags=re.M)
    if name=='stmt':
        t=t.replace('var l;','var l = {up:0,br:0,co:0,is_switch:0};')
        t=re.sub(r'^\s*g\.handlers = mem\(.*?;\n','\n',t,flags=re.M)
        t=re.sub(r'memset\([^;]+;', 'g.handlers[h] = {start:0,end:0,target:0,finish:0,iter:0,name:undef()};',t)
        t=t.replace('sprintf(buf, "\\x01switch%d", p.serial++);','buf = "\\x01switch" + p.serial++;')
    if name=='native':
        # Replace the few libc/buffer-specific cases by equivalent JS code.
        t=re.sub(r'case NPRINT:.*?(?=case NASSERT:)', '''case NPRINT:
        s = '';
        for(i=0;i<argc;i++)s+=(i?' ':'')+chars(tostring(m,arg(m,base,argc,i)));
        m.output(s); return undef();
        ''',t,flags=re.S)
        t=re.sub(r'case NPARSE:.*?(?=case NCREATE:)', '''case NPARSE:
        s=tostring(m,a);i=integer(b);
        if(i&&(i<2||i>36))return num(nanval());
        end=trimASCII(chars(s));
        if(!i){k=end.charAt(0);if(k==='+'||k==='-')end=end.slice(1);i=end.slice(0,2)==='0x'||end.slice(0,2)==='0X'?16:10;}
        return num(parseInt(chars(s),i));
        ''',t,flags=re.S)
        t=re.sub(r'case NJOIN:.*?(?=case NSORT:)', '''case NJOIN:
        s=a.t===U?str(m,','):tostring(m,a);buf='';
        for(i=0;i<n;i++){x=get(o,keynum(m,i));x=x.t===U||x.t===NIL?str(m,''):tostring(m,x);buf+=(i?chars(s):'')+chars(x);}
        return str(m,buf);
        ''',t,flags=re.S)
        t=re.sub(r'case NLOWER:.*?(?=case NCONCAT:)', '''case NLOWER:case NUPPER:
        return str(m,idn===NLOWER?chars(s).toLowerCase():chars(s).toUpperCase());
        ''',t,flags=re.S)
        t=t.replace('memcmp(chars(s) + i, chars(k), slen(k))','(chars(s).slice(i,i+slen(k))===chars(k)?0:1)')
        t=t.replace('strn(m, chars(s) + i, 1)','strn(m, chars(s).slice(i), 1)').replace('strn(m, chars(s) + j, (i - j))','strn(m, chars(s).slice(j), i-j)').replace('strn(m, chars(s) + j, (n - j))','strn(m, chars(s).slice(j), n-j)').replace('strn(m, chars(s) + i, ((j > i) ? (j - i) : (0)))','strn(m, chars(s).slice(i), j>i?j-i:0)')
        t=t.replace('(chars(s)[i])','chars(s).charCodeAt(i)')
        t=t.replace('rand() / (RAND_MAX + 1.0)','Math.random()')
        t=t.replace('i < (n / 2)','i < floor(n / 2)')
    if name=='invoke':
        t=t.replace('var fr;','var fr = {};')
        # C longjmp restores frames in run; JS unwinding does the same in catch.
    if name=='run':
        # Keep generated instruction dispatch, replace only setjmp machinery.
        a=t.index('  m.trap = '); b=t.index('  while (pc < f.n)',a)
        pre=t[:a]; loop=t[b:]
        pre=re.sub(r'var trap,?[^;]*;', '',pre)
        # remove unused trap declarations individually
        pre=re.sub(r'^\s*var (?:trap|outer)[^;]*;\n','\n',pre,flags=re.M)
        loop=loop.replace('longjmp(m.fail, 1);','throw m.budgetSignal;').replace('longjmp(trap, 1);','throw m.signal;')
        loop=loop.replace('m.trap = outer;','')
        # Catch at each instruction: handler selection uses the same pc-1 range.
        loop=loop.replace('  {\n', '  {\n    try {\n',1)
        tail=loop.rfind('  }\n\n  m.top = saved;')
        assert tail>=0,loop[-300:]
        loop=loop[:tail]+'''    } catch (caught) {
      if(caught!==m.signal)throw caught;
      m.frame=fr; m.depth=depth;
      var best=-1;
      for(i=0;i<f.nhd;i++)if(pc-1>=f.handlers[i].start&&pc-1<f.handlers[i].end&&(best<0||f.handlers[i].start>=f.handlers[best].start))best=i;
      if(best<0)throw caught;
      hd=f.handlers[best];pc=hd.target;m.top=saved+2*hd.iter;
      if(!m.thrown)m.exception=str(m,m.error);
      m.thrown=1;
    }
'''+loop[tail:]
        t=pre+loop
        t=t.replace('strcpy(m.error, "instruction limit exceeded");','m.error="instruction limit exceeded";').replace('sprintf(m.error, "%.250s", chars(b));','m.error=chars(b).slice(0,250);')
        t=t.replace('chars(f.vars[i])[0] == 1','chars(f.vars[i]).charCodeAt(0) == 1')
    # host Math functions where C used libc.
    t=re.sub(r'\b(floor|ceil|sqrt|pow|fabs)\(',lambda m:'Math.'+('abs' if m[1]=='fabs' else m[1])+'(',t)
    out.append(t)
out.append((root/'port_api.js').read_text())
(root/'faithful_vm.js').write_text('\n'.join(out))
