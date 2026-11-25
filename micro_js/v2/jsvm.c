/* Compact ES5-style bytecode interpreter. C90, no custom macros. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>
#include <setjmp.h>
#include <limits.h>
#include <stddef.h>
typedef struct VM VM;
typedef int (*js_native)(VM *vm, int argc, void *user);
enum js_type { JS_UNDEFINED, JS_NULL, JS_BOOLEAN, JS_NUMBER, JS_STRING, JS_OBJECT };
VM *js_new(void);
int js_eval(VM *m, const char *source);
const char *js_error(VM *m);
void js_free(VM *m);
void js_set_budget(VM *m, unsigned long instructions);
int js_register(VM *m, const char *name, js_native callback, void *user);
/* The following functions may be used only during a native callback. */
int js_arg_type(VM *m, int i);
double js_arg_number(VM *m, int i);
const char *js_arg_string(VM *m, int i, size_t *length);
void js_return_number(VM *m, double n);
void js_return_boolean(VM *m, int n);
void js_return_string(VM *m, const char *s, size_t n);
void js_return_null(VM *m);
typedef struct Cell Cell;
typedef struct Obj Obj;
typedef struct Fun Fun;
typedef struct Env Env;
typedef struct Ins Ins;
typedef struct Prop Prop;
typedef struct Frame Frame;
typedef struct Handler Handler;
typedef struct Val {
    int t; double n; Cell *p;
} Val;
enum {
    U, NIL, BOOL, NUM, STR, OBJ, REF
};
enum {
    CSTR, COBJ, CENV, CREF
};
struct Cell {
    Cell *next, *gray; int kind, mark;
};
typedef struct Str {
    Cell h; size_t len; char s[1];
} Str;
struct Prop {
    Prop *next; unsigned hash; int hidden; Val key, value;
};
struct Obj {
    Cell h; Obj *proto; Prop **tab; unsigned cap, count; int array, length, native; Fun *fun;
    Env *scope; js_native host; void *user;
};
struct Env {
    Cell h; Env *up; Obj *vars; int start,end;
};
typedef struct Ref {
    Cell h; Env *env; Obj *obj; Val key, base;
} Ref;
struct Ins {
    int op, a; Val v; Fun *fn;
};
struct Handler {
    int start,end,target,finish,iter; Val name;
};
struct Fun {
    Fun *next; Handler *handlers; int nhd; Ins *code; int mark, n, cap, argc, nv, cv, nh, ch;
    Val *params, *vars, *names; Fun **hoist; Val name;
};
struct Frame {
    Frame *prev; Env *env; Fun *code; Val self, callee; int base;
};
struct VM {
    Cell *heap, *gray; size_t live, threshold; Fun *funs; Env *global; Obj *op, *ap, *fp, *sp;
    Val *stack; int top, cap, depth; Frame *frame; jmp_buf fail,*trap; char error[256]; int thrown;
    Val exception; unsigned long limit,remaining; int host_base,host_argc; Val host_result;
};
static Val val(int t, double n, Cell *p) {
    Val v; v.t=t; v.n=n; v.p=p; return v;
}
static Val undef(void) { return val(U,0,0); }
static Val num(double n) { return val(NUM,n,0); }
static Val boolean(int n) { return val(BOOL,n!=0,0); }
static Val object(Obj *o) { return val(OBJ,0,(Cell *)o); }
static void die(VM *m, const char *s) {
    sprintf(m->error,"%.250s",s); m->thrown=0;
    if(m->trap)longjmp(*m->trap,1);
    longjmp(m->fail,1);
}
static void *mem(VM *m, void *p, size_t n) {
    void *q=realloc(p,n?n:1);
    if(!q) die(m,"out of memory");
    return q;
}
static Cell *cell(VM *m, size_t n, int kind) {
    Cell *c=mem(m,0,n); memset(c,0,n); c->kind=kind; c->next=m->heap; m->heap=c; m->live++; return c;
}
static Val strn(VM *m,const char *s,size_t n) {
    Str *p=(Str *)cell(m,sizeof(Str)+n,CSTR); p->len=n; memcpy(p->s,s,n); p->s[n]=0;
    return val(STR,0,(Cell *)p);
}
static Val str(VM *m,const char *s) { return strn(m,s,strlen(s)); }
static char *chars(Val v) { return ((Str *)v.p)->s; }
static size_t slen(Val v) { return ((Str *)v.p)->len; }
static int seq(Val a,Val b) { return a.p==b.p || (slen(a)==slen(b) && !memcmp(chars(a),chars(b),slen(a))); }
static unsigned hash(Val s) {
    unsigned h=5381; size_t i;
    for(i=0;i<slen(s);i++) h=h*33+(unsigned char)chars(s)[i];
    return h;
}
static int iskey(Val k,const char *s) { return slen(k)==strlen(s) && !memcmp(chars(k),s,slen(k)); }
static Obj *obj(VM *m,Obj *proto) {
    Obj *o=(Obj *)cell(m,sizeof(Obj),COBJ); o->proto=proto; return o;
}
static Env *env(VM *m,Env *up) {
    Env *e=(Env *)cell(m,sizeof(Env),CENV); e->up=up; e->vars=obj(m,0); return e;
}
static Prop *own(Obj *o,Val k) {
    unsigned h=hash(k); Prop *p;
    if(!o->cap) return 0;
    for(p=o->tab[h%o->cap];p;p=p->next) if(p->hash==h && seq(p->key,k)) return p;
    return 0;
}
static void resize(VM *m,Obj *o) {
    unsigned i,n=o->cap?o->cap*2:8; Prop **t=mem(m,0,n*sizeof(*t)); Prop *p,*q;
    memset(t,0,n*sizeof(*t));
    for(i=0;i<o->cap;i++) for(p=o->tab[i];p;p=q) {
        q=p->next; p->next=t[p->hash%n]; t[p->hash%n]=p;
    }
    free(o->tab); o->tab=t; o->cap=n;
}
static int indexof(Val k) {
    const char *s=chars(k); int n=0,i;
    if(!*s || strlen(s)!=slen(k) || (*s=='0' && s[1])) return -1;
    for(i=0;s[i];i++) {
        if(s[i]<'0'||s[i]>'9'||n>(INT_MAX-10)/10) return -1;
        n=n*10+s[i]-'0';
    }
    return n;
}
static int del(Obj *o,Val k) {
    Prop **p,*q;
    if(!o->cap) return 1;
    p=&o->tab[hash(k)%o->cap];
    while(*p) {
        if(seq((*p)->key,k)) {
            q=*p; *p=q->next; free(q); o->count--; return 1;
        }
        p=&(*p)->next;
    }
    return 1;
}
static void put(VM *m,Obj *o,Val k,Val v) {
    Prop *p; int i; unsigned j;
    if(o->array) {
        if(iskey(k,"length")) {
            if(v.t!=NUM || !(v.n>=0 && v.n<=INT_MAX) || v.n!=(int)v.n) die(m,"invalid array length");
            o->length=(int)v.n;
            for(j=0;j<o->cap;j++) {
                Prop **q=&o->tab[j];
                while(*q) {
                    i=indexof((*q)->key);
                    if(i>=o->length) {
                        p=*q; *q=p->next; free(p); o->count--;
                    } else q=&(*q)->next;
                }
            }
            return;
        }
        i=indexof(k);
        if(i>=o->length && i<INT_MAX) o->length=i+1;
    }
    p=own(o,k);
    if(!p) {
        if(o->count>=o->cap*2 || !o->cap) resize(m,o);
        p=mem(m,0,sizeof(*p)); p->hash=hash(k); p->hidden=0; p->key=k; j=p->hash%o->cap;
        p->next=o->tab[j]; o->tab[j]=p; o->count++;
    }
    p->value=v;
}
static Val get(Obj *o,Val k) {
    Prop *p;
    for(;o;o=o->proto) {
        if(o->array && iskey(k,"length")) return num(o->length);
        p=own(o,k);
        if(p) return p->value;
    }
    return undef();
}
static int has(Obj *o,Val k) {
    for(;o;o=o->proto) if(own(o,k)||(o->array&&iskey(k,"length"))) return 1;
    return 0;
}
static void named(VM *m,Obj *o,const char *k,Val v) { put(m,o,str(m,k),v); }
static void hidden(VM *m,Obj *o,const char *k,Val v) {
    Val key=str(m,k); put(m,o,key,v); own(o,key)->hidden=1;
}
static Val lookup(Env *e,Val k) {
    Prop *p;
    for(;e;e=e->up) {
        p=own(e->vars,k);
        if(p) return p->value;
    }
    return undef();
}
static Env *binding(Env *e,Val k) {
    for(;e;e=e->up) if(own(e->vars,k)) return e;
    return 0;
}
static int truth(Val v) {
    switch(v.t) {
        case U: case NIL:return 0;
        case NUM:case BOOL:return v.n!=0 && v.n==v.n;
        case STR:return slen(v)!=0;
        default:return 1;
    }
}
static double nanval(void) {
    volatile double z=0; return z/z;
}
static double number(Val v) {
    char *end,*s; double n;
    switch(v.t) {
        case NUM:case BOOL:return v.n;
        case NIL:return 0;
        case STR:s=chars(v);
        while(isspace((unsigned char)*s)) s++;
        if(!*s)return s==chars(v)+(int)slen(v)?0:nanval();
        n=strtod(s,&end);
        if(end==s)return nanval();
        while(isspace((unsigned char)*end))end++;
        return *end||end!=chars(v)+slen(v)?nanval():n;
        default:return nanval();
    }
}
static Val tostring(VM *m,Val v) {
    char b[64];
    switch(v.t) {
        case STR:return v;
        case U:return str(m,"undefined");
        case NIL:return str(m,"null");
        case BOOL:return str(m,v.n?"true":"false");
        case NUM:if(v.n!=v.n)return str(m,"NaN");
        if(v.n==0)return str(m,"0");
        sprintf(b,"%.15g",v.n); return str(m,b);
        default:return str(m,"[object Object]");
    }
}
static Val property(VM *m,Val b,Val k) {
    int i;
    if(b.t==OBJ)return get((Obj *)b.p,k);
    if(b.t==STR) {
        if(iskey(k,"length"))return num((double)slen(b));
        i=indexof(k);
        if(i>=0&&(size_t)i<slen(b))return strn(m,chars(b)+i,1);
        return get(m->sp,k);
    }
    if(b.t==U||b.t==NIL)die(m,"property access on null/undefined");
    return undef();
}
static Val reference(VM *m,Env *e,Val b,Val k) {
    Ref *r=(Ref *)cell(m,sizeof(Ref),CREF); r->env=e; r->base=b; r->obj=b.t==OBJ?(Obj *)b.p:0;
    r->key=k; return val(REF,0,(Cell *)r);
}
static Val readval(VM *m,Val v) {
    Ref *r; Env *e;
    if(v.t!=REF)return v;
    r=(Ref *)v.p;
    if(r->env) {
        e=binding(r->env,r->key);
        if(!e)die(m,"undefined identifier");
        return lookup(e,r->key);
    }
    return property(m,r->base,r->key);
}
static void store(VM *m,Val v,Val x) {
    Ref *r; Env *e;
    if(v.t!=REF)die(m,"invalid assignment");
    r=(Ref *)v.p;
    if(r->env) {
        e=binding(r->env,r->key); put(m,(e?e:m->global)->vars,r->key,x);
    } else if(r->obj)put(m,r->obj,r->key,x);
    else if(r->base.t==U||r->base.t==NIL)die(m,"invalid property assignment");
}
static int equal(Val a,Val b,int strict) {
    if(a.t==b.t) {
        switch(a.t) {
            case U:case NIL:return 1;
            case STR:return seq(a,b);
            case OBJ:return a.p==b.p;
            default:return a.n==b.n;
        }
    }
    if(strict)return 0;
    if((a.t==U||a.t==NIL)&&(b.t==U||b.t==NIL))return 1;
    if(a.t==BOOL)a=num(a.n);
    if(b.t==BOOL)b=num(b.n);
    if((a.t==STR&&b.t==NUM)||(a.t==NUM&&b.t==STR))return number(a)==number(b);
    if(a.t==NUM&&b.t==NUM)return a.n==b.n;
    return 0;
}
static void mark(VM *m,Cell *c) {
    if(c&&!c->mark) {
        c->mark=1; c->gray=m->gray; m->gray=c;
    }
}
static void mv(VM *m,Val v) { if(v.p)mark(m,v.p); }
static void markfun(VM *m,Fun *f) {
    int i;
    if(!f||f->mark)return;
    f->mark=1; mv(m,f->name);
    for(i=0;i<f->n;i++) {
        mv(m,f->code[i].v); markfun(m,f->code[i].fn);
    }
    for(i=0;i<f->nhd;i++)mv(m,f->handlers[i].name);
    for(i=0;i<f->argc;i++)mv(m,f->params[i]);
    for(i=0;i<f->nv;i++)mv(m,f->vars[i]);
    for(i=0;i<f->nh;i++) {
        mv(m,f->names[i]); markfun(m,f->hoist[i]);
    }
}
static void scan(VM *m,Cell *c) {
    unsigned i; Prop *p; Obj *o; Env *e; Ref *r;
    switch(c->kind) {
        case COBJ:o=(Obj *)c;
        mark(m,(Cell *)o->proto); mark(m,(Cell *)o->scope); markfun(m,o->fun);
        for(i=0;i<o->cap;i++)for(p=o->tab[i];p;p=p->next) {
            mv(m,p->key); mv(m,p->value);
        }
        break;
        case CENV:e=(Env *)c;
        mark(m,(Cell *)e->up); mark(m,(Cell *)e->vars); break;
        case CREF:r=(Ref *)c;
        mark(m,(Cell *)r->env); mv(m,r->base); mv(m,r->key); break;
        default:break;
    }
}
static void freefun(Fun *f) {
    free(f->handlers); free(f->code); free(f->params); free(f->vars); free(f->names); free(f->hoist);
    free(f);
}
static void release(Cell *c) {
    Obj *o; unsigned i; Prop *p,*q;
    if(c->kind==COBJ) {
        o=(Obj *)c;
        for(i=0;i<o->cap;i++)for(p=o->tab[i];p;p=q) {
            q=p->next; free(p);
        }
        free(o->tab);
    }
    free(c);
}
static void gc(VM *m) {
    Cell **p,*c; Fun **fp,*f; Frame *r; int i; mv(m,m->exception); mark(m,(Cell *)m->global);
    mark(m,(Cell *)m->op); mark(m,(Cell *)m->ap); mark(m,(Cell *)m->fp); mark(m,(Cell *)m->sp);
    for(i=0;i<m->top;i++)mv(m,m->stack[i]);
    for(r=m->frame;r;r=r->prev) {
        mark(m,(Cell *)r->env); mv(m,r->self); mv(m,r->callee); markfun(m,r->code);
    }
    while(m->gray) {
        c=m->gray; m->gray=c->gray; scan(m,c);
    }
    p=&m->heap;
    while(*p) {
        c=*p;
        if(!c->mark) {
            *p=c->next; release(c); m->live--;
        }else {
            c->mark=0; p=&c->next;
        }
    }
    fp=&m->funs;
    while(*fp) {
        f=*fp;
        if(!f->mark) {
            *fp=f->next; freefun(f);
        }else {
            f->mark=0; fp=&f->next;
        }
    }
    m->threshold=m->live*2+4096;
}
enum {
    KEND=256,KID,KNUM,KSTR,KEQ,KNE,KSE,KSNE,KLE,KGE,KAND,KOR,KINC,KDEC,KADD,KSUB,KMUL,KDIV,KMOD,KSHL,KSHR,KUSHR,KBA,KBO,KBX,
    KVAR,KFUNCTION,KRETURN,KIF,KELSE,KWHILE,KFOR,KDO,KBREAK,KCONTINUE,KTRUE,KFALSE,KNULL,KTHIS,KNEW,KTYPEOF,KVOID,KDELETE,KIN,KINSTANCE,KTHROW,KSWITCH,KCASE,KDEFAULT,KTRY,KCATCH
};
enum {
    PUSH, NAME, GET, PROP, SET, DUP, DROP, SWAP, BIN, UN, INC, JMP, JF, JT, CALL, NEW, RET, CLOSURE, OBJECT, ARRAY, INIT, HOLE, THIS, THROW, TYPE, DEL, PRECALL, ENUM, NEXT, CATCH
};
typedef struct Lex {
    const char *s; int t,line,previous; Val v;
}
Lex;
typedef struct Loop {
    struct Loop *up; int br,co,is_switch;
}
Loop;
typedef struct Parser {
    VM *m; Lex l; Fun *f; Loop *loop; int depth,serial,iters;
}
Parser;
static void syntax(Parser *p,const char *s) {
    char b[256]; sprintf(b,"line %d: %.200s",p->l.line,s); die(p->m,b);
}
static int ident(int c) { return isalnum((unsigned char)c)||c=='_'||c=='$'||(unsigned char)c>=128; }
static int hex(int c) {
    if(c>='0'&&c<='9')return c-'0';
    if(c>='a'&&c<='f')return c-'a'+10;
    if(c>='A'&&c<='F')return c-'A'+10;
    return -1;
}
static void next(Parser *p) {
    Lex *l=&p->l; const char *s=l->s,*a; char *b,*end; int c,q,i,j,h,escaped; size_t n;
    static const char *kw[]= {
        "var","function","return","if","else","while","for","do","break","continue","true","false","null","this","new","typeof","void","delete","in","instanceof","throw","switch","case","default","try","catch"
    };
    l->previous=l->line;
    for(;;) {
        while(isspace((unsigned char)*s)) {
            if(*s=='\n')l->line++;
            s++;
        }
        if(s[0]=='/'&&s[1]=='/') {
            while(*s&&*s!='\n')s++;
            continue;
        }
        if(s[0]=='/'&&s[1]=='*') {
            s+=2;
            while(*s&&!(s[0]=='*'&&s[1]=='/')) {
                if(*s=='\n')l->line++;
                s++;
            }
            if(!*s)syntax(p,"unterminated comment");
            s+=2; continue;
        }
        break;
    }
    l->v=undef(); c=(unsigned char)*s;
    if(!c) {
        l->t=KEND; l->s=s; return;
    }
    a=s++; l->t=c;
    if(isdigit(c)||(c=='.'&&isdigit((unsigned char)*s))) {
        if(c=='0'&&(*s=='x'||*s=='X')) {
            double d=0; s++;
            if(hex(*s)<0)syntax(p,"bad hex literal");
            while((h=hex(*s))>=0) {
                d=d*16+h; s++;
            }
            l->v=num(d);
        }else {
            l->v=num(strtod(a,&end)); s=end;
        }
        l->t=KNUM;
    }
    else if(ident(c)) {
        while(ident(*s))s++;
        l->v=strn(p->m,a,(size_t)(s-a)); l->t=KID;
        for(i=0;i<(int)(sizeof(kw)/sizeof(*kw));i++)if(iskey(l->v,kw[i])) {
            l->t=KVAR+i; break;
        }
    }
    else if(c=='\''||c=='"') {
        q=c; n=0; a=s;
        while(*a&&*a!=q) {
            if(*a=='\\'&&a[1])a++;
            a++;
        }
        b=mem(p->m,0,(size_t)(a-s)+1);
        while(*s&&*s!=q) {
            escaped=0; c=(unsigned char)*s++;
            if(c=='\n'||c=='\r') {
                free(b); syntax(p,"unterminated string");
            }
            if(c=='\\') {
                escaped=1;
                if(!*s) {
                    free(b); syntax(p,"unterminated escape");
                }
                c=(unsigned char)*s++;
                switch(c) {
                    case 'n':c='\n';
                    break;
                    case 'r':c='\r';
                    break;
                    case 't':c='\t';
                    break;
                    case 'b':c='\b';
                    break;
                    case 'f':c='\f';
                    break;
                    case 'v':c='\v';
                    break;
                    case '0':c=0;
                    break;
                    case '\n':l->line++;
                    continue;
                    case 'x':case 'u':j=c=='x'?2:4;
                    c=0;
                    for(i=0;i<j;i++) {
                        h=hex(*s);
                        if(h<0) {
                            free(b); syntax(p,"bad escape");
                        }
                        s++; c=c*16+h;
                    }
                    break;
                    default:break;
                }
            }
            if(c<128)b[n++]=(char)c;
            else if(c<256&&escaped) {
                b[n++]=(char)(192|(c>>6)); b[n++]=(char)(128|(c&63));
            }else if(c>=256) {
                if(c>=2048)b[n++]=(char)(224|(c>>12));
                b[n++]=(char)((c>=2048?128:192)|(c>>6&63)); b[n++]=(char)(128|(c&63));
            }else b[n++]=(char)c;
        }
        if(!*s) {
            free(b); syntax(p,"unterminated string");
        }
        s++; l->v=strn(p->m,b,n); free(b); l->t=KSTR;
    }
    else {
        switch(c) {
            case '=':if(*s=='=') {
                s++; l->t=KEQ;
                if(*s=='=') {
                    s++; l->t=KSE;
                }
            }
            break;
            case '!':if(*s=='=') {
                s++; l->t=KNE;
                if(*s=='=') {
                    s++; l->t=KSNE;
                }
            }
            break;
            case '<':if(*s=='=') {
                s++; l->t=KLE;
            }else if(*s=='<') {
                s++; l->t=KSHL;
            }
            break;
            case '>':if(*s=='=') {
                s++; l->t=KGE;
            }else if(*s=='>') {
                s++; l->t=KSHR;
                if(*s=='>') {
                    s++; l->t=KUSHR;
                }
            }
            break;
            case '&':if(*s=='&') {
                s++; l->t=KAND;
            }else if(*s=='=') {
                s++; l->t=KBA;
            }
            break;
            case '|':if(*s=='|') {
                s++; l->t=KOR;
            }else if(*s=='=') {
                s++; l->t=KBO;
            }
            break;
            case '^':if(*s=='=') {
                s++; l->t=KBX;
            }
            break;
            case '+':if(*s=='+') {
                s++; l->t=KINC;
            }else if(*s=='=') {
                s++; l->t=KADD;
            }
            break;
            case '-':if(*s=='-') {
                s++; l->t=KDEC;
            }else if(*s=='=') {
                s++; l->t=KSUB;
            }
            break;
            case '*':if(*s=='=') {
                s++; l->t=KMUL;
            }
            break;
            case '/':if(*s=='=') {
                s++; l->t=KDIV;
            }
            break;
            case '%':if(*s=='=') {
                s++; l->t=KMOD;
            }
            break;
            default:break;
        }
    }
    l->s=s;
}
static int accept(Parser *p,int t) {
    if(p->l.t!=t)return 0;
    next(p); return 1;
}
static void need(Parser *p,int t) { if(!accept(p,t))syntax(p,"unexpected token"); }
static Val id(Parser *p) {
    Val v=p->l.v; need(p,KID); return v;
}
static Fun *fun(VM *m) {
    Fun *f=mem(m,0,sizeof(*f)); memset(f,0,sizeof(*f)); f->next=m->funs; m->funs=f; return f;
}
static int emit(Parser *p,int op,int a,Val v) {
    Fun *f=p->f; Ins *i;
    if(f->n==f->cap) {
        f->cap=f->cap?f->cap*2:64; f->code=mem(p->m,f->code,f->cap*sizeof(*i));
    }
    i=&f->code[f->n]; i->op=op; i->a=a; i->v=v; i->fn=0; return f->n++;
}
static int out(Parser *p,int op,int a) { return emit(p,op,a,undef()); }
static void patch(Parser *p,int i) { p->f->code[i].a=p->f->n; }
static void chain(Parser *p,int i,int target) {
    int j;
    while(i>=0) {
        j=p->f->code[i].a; p->f->code[i].a=target; i=j;
    }
}
static void variable(Parser *p,Val v) {
    Fun *f=p->f;
    if(f->nv==f->cv) {
        f->cv=f->cv?2*f->cv:8; f->vars=mem(p->m,f->vars,f->cv*sizeof(Val));
    }
    f->vars[f->nv++]=v;
}
static void hoist(Parser *p,Val name,Fun *f) {
    Fun *g=p->f;
    if(g->nh==g->ch) {
        g->ch=g->ch?2*g->ch:8; g->names=mem(p->m,g->names,g->ch*sizeof(Val));
        g->hoist=mem(p->m,g->hoist,g->ch*sizeof(Fun *));
    }
    g->names[g->nh]=name; g->hoist[g->nh++]=f;
}
static void expr(Parser *p,int min);
static void stmt(Parser *p);
static Fun *function(Parser *p,Val name) {
    Fun *old=p->f,*f=fun(p->m); Loop *loop=p->loop; int iters=p->iters; p->f=f; p->loop=0; p->iters=0;
    f->name=name; need(p,'(');
    if(p->l.t!=')')do {
        f->params=mem(p->m,f->params,(f->argc+1)*sizeof(Val)); f->params[f->argc++]=id(p);
    }
    while(accept(p,','));
    need(p,')');
    need(p,'{');
    while(p->l.t!='}'&&p->l.t!=KEND)stmt(p);
    need(p,'}');
    out(p,PUSH,0); out(p,RET,0); p->f=old; p->loop=loop; p->iters=iters; return f;
}
static int prec(int t) {
    switch(t) {
        case ',':return 1;
        case '=':case KADD:case KSUB:case KMUL:case KDIV:case KMOD:case KBA:case KBO:case KBX:return 2;
        case '?':return 3;
        case KOR:return 4;
        case KAND:return 5;
        case '|':return 6;
        case '^':return 7;
        case '&':return 8;
        case KEQ:case KNE:case KSE:case KSNE:return 9;
        case '<':case '>':case KLE:case KGE:case KIN:case KINSTANCE:return 10;
        case KSHL:case KSHR:case KUSHR:return 11;
        case '+':case '-':return 12;
        case '*':case '/':case '%':return 13;
        default:return 0;
    }
}
static int args(Parser *p) {
    int n=0; need(p,'(');
    if(p->l.t!=')')do {
        expr(p,2); out(p,GET,0); n++;
    }
    while(accept(p,','));
    need(p,')'); return n;
}
static void member(Parser *p,int calls) {
    Val k;
    for(;;) {
        if(accept(p,'.')) {
            out(p,GET,0); k=p->l.v;
            if(k.t!=STR)syntax(p,"expected property name");
            next(p); emit(p,PUSH,0,k); out(p,PROP,0);
        }else if(accept(p,'[')) {
            out(p,GET,0); expr(p,1); need(p,']'); out(p,PROP,0);
        }else if(calls&&p->l.t=='(') {
            out(p,PRECALL,0); out(p,CALL,args(p));
        }else break;
    }
}
static void primary(Parser *p) {
    int t=p->l.t,n; Val v=p->l.v,k; Fun *f; next(p);
    switch(t) {
        case KNUM:case KSTR:emit(p,PUSH,0,v);
        break;
        case KTRUE:case KFALSE:emit(p,PUSH,0,boolean(t==KTRUE));
        break;
        case KNULL:emit(p,PUSH,0,val(NIL,0,0));
        break;
        case KID:emit(p,NAME,0,v);
        break;
        case KTHIS:out(p,THIS,0);
        break;
        case '(':expr(p,1);
        need(p,')'); break;
        case KFUNCTION:k=undef();
        if(p->l.t==KID)k=id(p);
        f=function(p,k); n=out(p,CLOSURE,0); p->f->code[n].fn=f; break;
        case '{':out(p,OBJECT,0);
        if(p->l.t!='}')do {
            k=p->l.v;
            if(k.t!=STR&&k.t!=NUM)syntax(p,"expected object key");
            next(p); need(p,':'); out(p,DUP,0); emit(p,PUSH,0,tostring(p->m,k)); out(p,PROP,0);
            expr(p,2); out(p,SET,0); out(p,DROP,0);
        }
        while(accept(p,',')&&p->l.t!='}');
        need(p,'}');
        break;
        case '[':out(p,ARRAY,0);
        n=0;
        while(p->l.t!=']') {
            if(p->l.t==',') {
                out(p,HOLE,0); n++; next(p); continue;
            }
            out(p,DUP,0); emit(p,PUSH,0,num(n++)); out(p,PROP,0); expr(p,2); out(p,SET,0);
            out(p,DROP,0);
            if(!accept(p,','))break;
        }
        need(p,']'); break;
        case KNEW:if(++p->depth>512)syntax(p,"new nesting limit");
        primary(p); p->depth--; member(p,0); out(p,PRECALL,0); n=p->l.t=='('?args(p):0; out(p,NEW,n);
        break;
        default:syntax(p,"expected expression");
    }
}
static void prefix(Parser *p) {
    int t=p->l.t;
    if(++p->depth>512)syntax(p,"prefix nesting limit");
    if(t=='!'||t=='~'||t=='+'||t=='-'||t==KTYPEOF||t==KVOID||t==KDELETE||t==KINC||t==KDEC) {
        next(p); prefix(p);
        if(t==KINC||t==KDEC)out(p,INC,t==KINC?1:-1);
        else if(t==KTYPEOF)out(p,TYPE,0);
        else if(t==KDELETE)out(p,DEL,0);
        else out(p,UN,t);
    }else {
        primary(p); member(p,1); t=p->l.t;
        if((t==KINC||t==KDEC)&&p->l.previous==p->l.line) {
            next(p); out(p,INC,t==KINC?2:-2);
        }
    }
    p->depth--;
}
static int compound(int t) {
    switch(t) {
        case KADD:return '+';
        case KSUB:return '-';
        case KMUL:return '*';
        case KDIV:return '/';
        case KMOD:return '%';
        case KBA:return '&';
        case KBO:return '|';
        default:return '^';
    }
}
static void expr(Parser *p,int min) {
    int t,k,j,h;
    if(++p->depth>512)syntax(p,"expression nesting limit");
    prefix(p);
    while((k=prec(p->l.t))>=min) {
        t=p->l.t; next(p);
        if(t==',') {
            out(p,GET,0); out(p,DROP,0); expr(p,k+1); out(p,GET,0);
        }else if(k==2) {
            if(t!='=') {
                out(p,DUP,0); out(p,GET,0);
            }
            expr(p,k);
            if(t!='=')out(p,BIN,compound(t));
            out(p,SET,0);
        }else if(t=='?') {
            out(p,GET,0); j=out(p,JF,0); expr(p,2); out(p,GET,0); need(p,':'); h=out(p,JMP,0);
            patch(p,j); expr(p,2); out(p,GET,0); patch(p,h);
        }else if(t==KAND||t==KOR) {
            out(p,GET,0); out(p,DUP,0); j=out(p,t==KAND?JF:JT,0); out(p,DROP,0); expr(p,k+1);
            out(p,GET,0); patch(p,j);
        }else {
            out(p,GET,0); expr(p,k+1); out(p,BIN,t);
        }
    }
    p->depth--;
}
static void semi(Parser *p) {
    if(!accept(p,';')&&p->l.t!='}'&&p->l.t!=KEND&&p->l.previous==p->l.line)syntax(p,"expected semicolon");
}
static void vars(Parser *p) {
    Val v;
    do {
        v=id(p); variable(p,v);
        if(accept(p,'=')) {
            emit(p,NAME,0,v); expr(p,2); out(p,SET,0); out(p,DROP,0);
        }
    }
    while(accept(p,','));
}
static int forin(Parser *p) {
    Lex saved=p->l; int yes;
    if(p->l.t==KVAR)next(p);
    if(p->l.t!=KID) {
        p->l=saved; return 0;
    }
    next(p); yes=p->l.t==KIN; p->l=saved; return yes;
}
static void stmt(Parser *p) {
    int t=p->l.t,j,h,start,update,body; Val v; Fun *f; Loop l;
    if(++p->depth>512)syntax(p,"statement nesting limit");
    switch(t) {
        case ';':next(p);
        break;
        case '{':next(p);
        while(p->l.t!='}'&&p->l.t!=KEND)stmt(p);
        need(p,'}');
        break;
        case KVAR:next(p);
        vars(p); semi(p); break;
        case KFUNCTION:next(p);
        v=id(p); f=function(p,v); hoist(p,v,f); break;
        case KRETURN:next(p);
        if(p->l.t==';'||p->l.t=='}'||p->l.t==KEND||p->l.previous!=p->l.line)out(p,PUSH,0);
        else {
            expr(p,1); out(p,GET,0);
        }
        out(p,RET,0); semi(p); break;
        case KTHROW:next(p);
        if(p->l.previous!=p->l.line)syntax(p,"newline after throw");
        expr(p,1); out(p,THROW,0); semi(p); break;
        case KIF:next(p);
        need(p,'('); expr(p,1); need(p,')'); j=out(p,JF,0); stmt(p);
        if(accept(p,KELSE)) {
            h=out(p,JMP,0); patch(p,j); stmt(p); patch(p,h);
        }else patch(p,j);
        break;
        case KTRY: {
            int h=p->f->nhd++,skip; Fun *g=p->f;
            g->handlers=mem(p->m,g->handlers,g->nhd*sizeof(Handler));
            memset(&g->handlers[h],0,sizeof(Handler)); g->handlers[h].start=g->n;
            g->handlers[h].iter=p->iters; next(p);
            if(p->l.t!='{')syntax(p,"expected try block");
            stmt(p); g->handlers[h].end=g->n; skip=out(p,JMP,0); need(p,KCATCH); need(p,'(');
            g->handlers[h].name=id(p); need(p,')'); g->handlers[h].target=g->n; out(p,CATCH,h);
            if(p->l.t!='{')syntax(p,"expected catch block");
            stmt(p); g->handlers[h].finish=g->n; patch(p,skip); break;
        }
        case KSWITCH: {
            int test=-1,fall=-1,def=-1,skip,bodypc; char buf[32]; l.up=p->loop; l.br=l.co=-1;
            l.is_switch=1; p->loop=&l; next(p); need(p,'('); sprintf(buf,"\001switch%d",p->serial++);
            v=str(p->m,buf); variable(p,v); emit(p,NAME,0,v); expr(p,1); out(p,SET,0); out(p,DROP,0);
            need(p,')');
            need(p,'{');
            test=out(p,JMP,0);
            while(p->l.t!='}'&&p->l.t!=KEND) {
                if(p->l.t==KCASE) {
                    next(p); patch(p,test); emit(p,NAME,0,v); out(p,GET,0); expr(p,2); need(p,':');
                    out(p,BIN,KSE); test=out(p,JF,0);
                }else if(p->l.t==KDEFAULT) {
                    if(def>=0)syntax(p,"duplicate default");
                    next(p); need(p,':'); patch(p,test); test=out(p,JMP,0); def=p->f->n;
                }else syntax(p,"expected case/default");
                bodypc=p->f->n;
                if(fall>=0)p->f->code[fall].a=bodypc;
                while(p->l.t!=KCASE&&p->l.t!=KDEFAULT&&p->l.t!='}'&&p->l.t!=KEND)stmt(p);
                fall=out(p,JMP,0);
            }
            need(p,'}');
            patch(p,test); skip=out(p,JMP,def>=0?def:p->f->n+1);
            if(def<0)patch(p,skip);
            if(fall>=0)patch(p,fall);
            chain(p,l.br,p->f->n); p->loop=l.up; break;
        }
        case KWHILE:case KFOR:case KDO:l.is_switch=0;
        l.up=p->loop; l.br=l.co=-1; p->loop=&l; next(p); j=-1; update=-1;
        if(t==KFOR) {
            need(p,'(');
            if(forin(p)) {
                int declare=accept(p,KVAR); v=id(p);
                if(declare)variable(p,v);
                need(p,KIN); expr(p,1); need(p,')'); out(p,ENUM,0); update=p->f->n; j=out(p,NEXT,0);
                emit(p,NAME,0,v); out(p,SWAP,0); out(p,SET,0); out(p,DROP,0); p->iters++; stmt(p);
                p->iters--; out(p,JMP,update); patch(p,j); chain(p,l.br,p->f->n); chain(p,l.co,update);
                out(p,DROP,0); out(p,DROP,0); p->loop=l.up; break;
            }
            if(accept(p,KVAR))vars(p);
            else if(p->l.t!=';') {
                expr(p,1); out(p,GET,0); out(p,DROP,0);
            }
            need(p,';'); start=p->f->n;
            if(p->l.t!=';') {
                expr(p,1); j=out(p,JF,0);
            }
            need(p,';'); body=out(p,JMP,0); update=p->f->n;
            if(p->l.t!=')') {
                expr(p,1); out(p,GET,0); out(p,DROP,0);
            }
            need(p,')'); out(p,JMP,start); patch(p,body); stmt(p); out(p,JMP,update);
        }
        else if(t==KWHILE) {
            start=p->f->n; update=start; need(p,'('); expr(p,1); need(p,')'); j=out(p,JF,0); stmt(p);
            out(p,JMP,start);
        }
        else {
            start=p->f->n; stmt(p); update=p->f->n; need(p,KWHILE); need(p,'('); expr(p,1);
            need(p,')'); out(p,JT,start); semi(p);
        }
        if(j>=0) {
            patch(p,j);
        }
        chain(p,l.br,p->f->n); chain(p,l.co,update); p->loop=l.up; break;
        case KBREAK:case KCONTINUE:next(p);
        if(!p->loop)syntax(p,"not inside loop");
        if(t==KBREAK)p->loop->br=out(p,JMP,p->loop->br);
        else {
            Loop *q=p->loop;
            while(q&&q->is_switch)q=q->up;
            if(!q)syntax(p,"continue outside loop");
            q->co=out(p,JMP,q->co);
        }
        semi(p); break;
        default:expr(p,1);
        out(p,GET,0); out(p,DROP,0); semi(p); break;
    }
    p->depth--;
}
static Fun *compile(VM *m,const char *s) {
    Parser p; memset(&p,0,sizeof(p)); p.m=m; p.l.s=s; p.l.line=1; p.f=fun(m); next(&p);
    while(p.l.t!=KEND)stmt(&p);
    out(&p,PUSH,0); out(&p,RET,0); return p.f;
}
static void push(VM *m,Val v) {
    if(m->top==m->cap) {
        m->cap=m->cap?m->cap*2:256; m->stack=mem(m,m->stack,m->cap*sizeof(Val));
    }
    m->stack[m->top++]=v;
}
static Val pop(VM *m) {
    if(!m->top)die(m,"stack underflow");
    return m->stack[--m->top];
}
static Val take(VM *m) { return readval(m,pop(m)); }
static Val arr(VM *m) {
    Obj *o=obj(m,m->ap); o->array=1; return object(o);
}
static Val keynum(VM *m,int i) { return tostring(m,num(i)); }
static void append(VM *m,Val a,Val v) {
    Obj *o=(Obj *)a.p;
    if(o->length==INT_MAX)die(m,"array too long");
    put(m,o,keynum(m,o->length),v);
}
static int callable(Val v) { return v.t==OBJ&&(((Obj *)v.p)->fun||((Obj *)v.p)->native); }
static Val closure(VM *m,Fun *f,Env *e) {
    Obj *o=obj(m,m->fp),*p=obj(m,m->op); Val v=object(o); o->fun=f; o->scope=e;
    hidden(m,o,"prototype",object(p)); hidden(m,p,"constructor",v); hidden(m,o,"length",num(f->argc));
    return v;
}
static unsigned long bits(double d) {
    if(d!=d||d==0||d>1.7976931348623157e308||d< -1.7976931348623157e308)return 0;
    d=fmod(d<0?ceil(d):floor(d),4294967296.0);
    if(d<0)d+=4294967296.0;
    return (unsigned long)d;
}
static double signedbits(unsigned long u) {
    u&=4294967295UL; return u>=2147483648UL?(double)u-4294967296.0:(double)u;
}
static Val binary(VM *m,int t,Val a,Val b) {
    double x,y; unsigned long u,v; Val s; char *buf; size_t n,k; Obj *o; int c;
    if(t==KEQ||t==KNE||t==KSE||t==KSNE)return boolean(equal(a,b,t==KSE||t==KSNE)^(t==KNE||t==KSNE));
    if(t==KIN) {
        if(b.t!=OBJ)die(m,"in requires object");
        return boolean(has((Obj *)b.p,tostring(m,a)));
    }
    if(t==KINSTANCE) {
        if(!callable(b))die(m,"instanceof requires function");
        s=property(m,b,str(m,"prototype"));
        if(s.t!=OBJ)die(m,"invalid prototype");
        if(a.t!=OBJ)return boolean(0);
        for(o=((Obj *)a.p)->proto;o;o=o->proto)if((Cell *)o==s.p)return boolean(1);
        return boolean(0);
    }
    if(t=='+'&&(a.t==STR||b.t==STR||a.t==OBJ||b.t==OBJ)) {
        a=tostring(m,a); b=tostring(m,b); n=slen(a); k=slen(b); buf=mem(m,0,n+k+1);
        memcpy(buf,chars(a),n); memcpy(buf+n,chars(b),k); s=strn(m,buf,n+k); free(buf); return s;
    }
    if(a.t==STR&&b.t==STR&&(t=='<'||t=='>'||t==KLE||t==KGE)) {
        n=slen(a)<slen(b)?slen(a):slen(b); c=memcmp(chars(a),chars(b),n);
        if(!c)c=slen(a)<slen(b)?-1:slen(a)>slen(b);
        return boolean(t=='<'?c<0:t=='>'?c>0:t==KLE?c<=0:c>=0);
    }
    x=number(a); y=number(b);
    switch(t) {
        case '+':return num(x+y);
        case '-':return num(x-y);
        case '*':return num(x*y);
        case '/':return num(x/y);
        case '%':return num(fmod(x,y));
        case '<':return boolean(x<y);
        case '>':return boolean(x>y);
        case KLE:return boolean(x<=y);
        case KGE:return boolean(x>=y);
        default:break;
    }
    u=bits(x); v=bits(y);
    switch(t) {
        case '&':return num(signedbits(u&v));
        case '|':return num(signedbits(u|v));
        case '^':return num(signedbits(u^v));
        case KSHL:return num(signedbits(u<<(v&31)));
        case KUSHR:return num((double)(u>>(v&31)));
        case KSHR:return num(floor(signedbits(u)/pow(2,(double)(v&31))));
        default:die(m,"unknown operator");
    }
    return undef();
}
enum {
    NPRINT=1,NARRAY,NOBJECT,NNUMBER,NSTRING,NBOOLEAN,NPUSH,NPOP,NJOIN,NSLICE,NINDEX,NCHAR,NKEYS,NHAS,NISARRAY,NFLOOR,NCEIL,NABS,NMAX,NMIN,NSQRT,NPOW,NRANDOM,NPARSE,NISNAN,NCALL,NAPPLY,NFOREACH,NMAP,NFILTER,NREDUCE,NREVERSE,NCONCAT,NCHARCODE,NSUBSTRING,NLOWER,NUPPER,NASSERT,NCREATE,NGETPROTO,NTOSTRING,NSHIFT,NUNSHIFT,NSPLIT,NSORT,NSOME,NEVERY,NHOST
};
static Val run(VM *m,Fun *f,Env *e,Val self,Val callee,int argc,int base);
static Val invoke(VM *m,Val callee,Val self,int argc,int base,int construct);
static Val arg(VM *m,int base,int argc,int i) { return i<argc?m->stack[base+i]:undef(); }
static int integer(Val a) {
    double n=number(a);
    if(n!=n)return 0;
    if(n>=INT_MAX)return INT_MAX;
    if(n<=INT_MIN)return INT_MIN;
    return (int)n;
}
static int bound(int i,int n) {
    if(i<0)i=i< -n?0:i+n;
    return i>n?n:i;
}
static Val native(VM *m,int idn,Val self,int argc,int base) {
    Val a=arg(m,base,argc,0),b=arg(m,base,argc,1),r,s,k,x,y; Obj *o; int i,j,n,h,at; unsigned u;
    double d; char *buf,*end; size_t len,cap,z; Prop *p;
    switch(idn) {
        case NHOST:o=(Obj *)m->frame->callee.p;
        m->host_base=base; m->host_argc=argc; m->host_result=undef();
        if(!o->host(m,argc,o->user))die(m,"host callback failed");
        r=m->host_result; m->host_result=undef(); return r;
        case NPRINT:for(i=0;i<argc;i++) {
            if(i)putchar(' ');
            s=tostring(m,arg(m,base,argc,i)); fwrite(chars(s),1,slen(s),stdout);
        }
        putchar('\n'); return undef();
        case NASSERT:if(!truth(a))die(m,b.t==STR?chars(b):"assertion failed");
        return undef();
        case NARRAY:r=arr(m);
        if(argc==1&&a.t==NUM)put(m,(Obj *)r.p,str(m,"length"),a);
        else for(i=0;i<argc;i++)append(m,r,arg(m,base,argc,i));
        return r;
        case NOBJECT:return a.t==OBJ?a:object(obj(m,m->op));
        case NNUMBER:return num(argc?number(a):0);
        case NSTRING:return argc?tostring(m,a):str(m,"");
        case NBOOLEAN:return boolean(truth(a));
        case NISARRAY:return boolean(a.t==OBJ&&((Obj *)a.p)->array);
        case NISNAN:d=number(a);
        return boolean(d!=d);
        case NFLOOR:return num(floor(number(a)));
        case NCEIL:return num(ceil(number(a)));
        case NABS:return num(fabs(number(a)));
        case NSQRT:return num(sqrt(number(a)));
        case NPOW:return num(pow(number(a),number(b)));
        case NRANDOM:return num(rand()/(RAND_MAX+1.0));
        case NMAX:case NMIN:if(!argc) {
            volatile double zero=0; return num((idn==NMAX?-1.0:1.0)/zero);
        }
        d=number(a);
        for(i=1;i<argc;i++) {
            double q=number(arg(m,base,argc,i));
            if(q!=q)return num(q);
            if((idn==NMAX&&q>d)||(idn==NMIN&&q<d))d=q;
        }
        return num(d);
        case NPARSE:s=tostring(m,a);
        i=integer(b);
        if(i&&(i<2||i>36))return num(nanval());
        end=chars(s);
        while(isspace((unsigned char)*end))end++;
        if(*end=='+'||*end=='-')end++;
        if(!i)i=end[0]=='0'&&(end[1]=='x'||end[1]=='X')?16:10;
        d=(double)strtol(chars(s),&end,i); return num(end==chars(s)?nanval():d);
        case NCREATE:if(a.t!=NIL&&a.t!=OBJ)die(m,"invalid prototype");
        return object(obj(m,a.t==OBJ?(Obj *)a.p:0));
        case NGETPROTO:if(a.t!=OBJ)die(m,"object required");
        o=((Obj *)a.p)->proto; return o?object(o):val(NIL,0,0);
        case NTOSTRING:return str(m,self.t==U?"[object Undefined]":self.t==NIL?"[object Null]":self.t==STR?"[object String]":self.t==NUM?"[object Number]":self.t==BOOL?"[object Boolean]":callable(self)?"[object Function]":((Obj *)self.p)->array?"[object Array]":"[object Object]");
        case NKEYS:if(a.t!=OBJ)die(m,"Object.keys requires object");
        r=arr(m); o=(Obj *)a.p;
        for(u=0;u<o->cap;u++)for(p=o->tab[u];p;p=p->next)if(!p->hidden)append(m,r,p->key);
        return r;
        case NHAS:if(self.t!=OBJ)return boolean(0);
        o=(Obj *)self.p; k=tostring(m,a); return boolean(own(o,k)!=0||(o->array&&iskey(k,"length")));
        case NCALL:at=m->top;
        for(i=1;i<argc;i++)push(m,arg(m,base,argc,i));
        r=invoke(m,self,a,argc?argc-1:0,at,0); m->top=at; return r;
        case NAPPLY:at=m->top;
        n=0;
        if(b.t!=NIL&&b.t!=U) {
            n=integer(property(m,b,str(m,"length")));
            if(n<0||n>1000000)die(m,"apply argument limit");
            for(i=0;i<n;i++)push(m,property(m,b,keynum(m,i)));
        }
        r=invoke(m,self,a,n,at,0); m->top=at; return r;
        default:break;
    }
    if(self.t==STR) {
        s=self; n=(int)slen(s); i=integer(a);
        switch(idn) {
            case NSPLIT:r=arr(m);
            if(b.t==U)d=4294967295.0;
            else d=(double)bits(number(b));
            if(!d)return r;
            if(a.t==U) {
                append(m,r,s); return r;
            }
            k=tostring(m,a);
            if(!slen(k)) {
                for(i=0;i<n&&i<d;i++)append(m,r,strn(m,chars(s)+i,1));
                return r;
            }
            j=0;
            for(i=0;i<=n-(int)slen(k);) {
                if(!memcmp(chars(s)+i,chars(k),slen(k))) {
                    append(m,r,strn(m,chars(s)+j,(size_t)(i-j)));
                    if(((Obj *)r.p)->length>=d)return r;
                    i+=(int)slen(k); j=i;
                }else i++;
            }
            append(m,r,strn(m,chars(s)+j,(size_t)(n-j))); return r;
            case NCHAR:return i>=0&&i<n?strn(m,chars(s)+i,1):str(m,"");
            case NCHARCODE:return num(i>=0&&i<n?(unsigned char)chars(s)[i]:nanval());
            case NSLICE:case NSUBSTRING:j=argc>1&&b.t!=U?integer(b):n;
            if(idn==NSLICE) {
                i=bound(i,n); j=bound(j,n);
            }else {
                i=i<0?0:i>n?n:i; j=j<0?0:j>n?n:j;
                if(i>j) {
                    h=i; i=j; j=h;
                }
            }
            return strn(m,chars(s)+i,(size_t)(j>i?j-i:0));
            case NINDEX:k=tostring(m,a);
            i=integer(b);
            if(i<0)i=0;
            if(i>n)i=n;
            for(;i<=n-(int)slen(k);i++)if(!memcmp(chars(s)+i,chars(k),slen(k)))return num(i);
            return num(-1);
            case NLOWER:case NUPPER:r=strn(m,chars(s),slen(s));
            for(i=0;i<n;i++)chars(r)[i]=(char)(idn==NLOWER?tolower((unsigned char)chars(r)[i]):toupper((unsigned char)chars(r)[i]));
            return r;
            case NCONCAT:r=s;
            for(i=0;i<argc;i++)r=binary(m,'+',r,tostring(m,arg(m,base,argc,i)));
            return r;
            default:die(m,"unsupported string method");
        }
    }
    if(self.t!=OBJ||!((Obj *)self.p)->array) {
        die(m,"array method requires array");
    }
    o=(Obj *)self.p; n=o->length;
    switch(idn) {
        case NPUSH:for(i=0;i<argc;i++)append(m,self,arg(m,base,argc,i));
        return num(o->length);
        case NSHIFT:if(!n)return undef();
        r=get(o,keynum(m,0));
        for(i=1;i<n;i++) {
            k=keynum(m,i); s=keynum(m,i-1);
            if(has(o,k))put(m,o,s,get(o,k));
            else del(o,s);
        }
        del(o,keynum(m,n-1)); o->length=n-1; return r;
        case NUNSHIFT:if(argc>INT_MAX-n)die(m,"array too long");
        for(i=n-1;i>=0;i--) {
            k=keynum(m,i); s=keynum(m,i+argc);
            if(has(o,k))put(m,o,s,get(o,k));
            else del(o,s);
        }
        for(i=0;i<argc;i++)put(m,o,keynum(m,i),arg(m,base,argc,i));
        o->length=n+argc; return num(o->length);
        case NPOP:if(!n)return undef();
        k=keynum(m,n-1); r=get(o,k); del(o,k); o->length--; return r;
        case NINDEX:i=integer(b);
        if(i<0)i=bound(i,n);
        for(;i<n;i++) {
            k=keynum(m,i);
            if(has(o,k)&&equal(get(o,k),a,1))return num(i);
        }
        return num(-1);
        case NSLICE:r=arr(m);
        i=bound(integer(a),n); j=argc>1&&b.t!=U?bound(integer(b),n):n;
        for(;i<j;i++) {
            k=keynum(m,i);
            if(has(o,k))append(m,r,get(o,k));
            else ((Obj *)r.p)->length++;
        }
        return r;
        case NJOIN:s=a.t==U?str(m,","):tostring(m,a);
        len=0; cap=64; buf=mem(m,0,cap);
        for(i=0;i<n;i++) {
            x=get(o,keynum(m,i)); x=x.t==U||x.t==NIL?str(m,""):tostring(m,x); z=slen(x)+(i?slen(s):0);
            if(len+z>=cap) {
                cap=(len+z+1)*2; buf=mem(m,buf,cap);
            }
            if(i) {
                memcpy(buf+len,chars(s),slen(s)); len+=slen(s);
            }
            memcpy(buf+len,chars(x),slen(x)); len+=slen(x);
        }
        r=strn(m,buf,len); free(buf); return r;
        case NSORT: {
            int width,left,mid,right,ia,ib,outidx,count=0,undefineds=0; Val src,dst,tmp,va,vb;
            if(a.t!=U&&!callable(a))die(m,"invalid sort comparator");
            at=m->top; src=arr(m); dst=arr(m); push(m,src); push(m,dst);
            for(i=0;i<n;i++) {
                k=keynum(m,i);
                if(has(o,k)) {
                    x=get(o,k);
                    if(x.t==U)undefineds++;
                    else {
                        append(m,src,x); count++;
                    }
                }
            }
            for(width=1;width<count;width=width>count/2?count:width*2) {
                for(left=0;left<count;left=right) {
                    mid=width>count-left?count:left+width; right=width>count-mid?count:mid+width;
                    ia=left; ib=mid;
                    for(outidx=left;outidx<right;outidx++) {
                        if(ia>=mid)j=0;
                        else if(ib>=right)j=1;
                        else {
                            va=get((Obj *)src.p,keynum(m,ia)); vb=get((Obj *)src.p,keynum(m,ib));
                            if(a.t==U) {
                                s=tostring(m,va); k=tostring(m,vb); j=!truth(binary(m,'>',s,k));
                            }else {
                                h=m->top; push(m,va); push(m,vb); x=invoke(m,a,undef(),2,h,0);
                                m->top=h; d=number(x); j=!(d>0);
                            }
                        }
                        x=get((Obj *)src.p,keynum(m,j?ia++:ib++));
                        put(m,(Obj *)dst.p,keynum(m,outidx),x);
                    }
                }
                tmp=src; src=dst; dst=tmp;
            }
            for(i=0;i<count;i++)put(m,o,keynum(m,i),get((Obj *)src.p,keynum(m,i)));
            for(;i<count+undefineds;i++)put(m,o,keynum(m,i),undef());
            for(;i<n;i++)del(o,keynum(m,i));
            m->top=at; return self;
        }
        case NREVERSE:for(i=0;i<n/2;i++) {
            k=keynum(m,i); s=keynum(m,n-i-1); x=get(o,k); y=get(o,s); j=has(o,k); h=has(o,s);
            if(h)put(m,o,k,y);
            else del(o,k);
            if(j)put(m,o,s,x);
            else del(o,s);
        }
        return self;
        case NCONCAT:r=arr(m);
        for(i=-1;i<argc;i++) {
            x=i<0?self:arg(m,base,argc,i);
            if(x.t==OBJ&&((Obj *)x.p)->array) {
                Obj *q=(Obj *)x.p;
                for(j=0;j<q->length;j++) {
                    k=keynum(m,j);
                    if(has(q,k))append(m,r,get(q,k));
                    else ((Obj *)r.p)->length++;
                }
            }else append(m,r,x);
        }
        return r;
        case NSOME:case NEVERY:case NFOREACH:case NMAP:case NFILTER:case NREDUCE:if(!callable(a))die(m,"callback required");
        at=m->top; push(m,self); r=idn==NREDUCE?b:arr(m); push(m,r); i=0;
        if(idn==NREDUCE&&argc<2) {
            while(i<n&&!has(o,keynum(m,i)))i++;
            if(i==n)die(m,"reduce of empty array");
            m->stack[at+1]=get(o,keynum(m,i++));
        }
        for(;i<n;i++) {
            k=keynum(m,i);
            if(!has(o,k)) {
                if(idn==NMAP)((Obj *)m->stack[at+1].p)->length++;
                continue;
            }
            x=get(o,k); j=m->top;
            if(idn==NREDUCE)push(m,m->stack[at+1]);
            push(m,x); push(m,num(i)); push(m,self); y=invoke(m,a,idn==NREDUCE?undef():b,m->top-j,j,0);
            m->top=j; r=m->stack[at+1];
            if((idn==NSOME&&truth(y))||(idn==NEVERY&&!truth(y))) {
                m->top=at; return boolean(idn==NSOME);
            }
            if(idn==NMAP)append(m,r,y);
            else if(idn==NFILTER&&truth(y))append(m,r,x);
            else if(idn==NREDUCE)m->stack[at+1]=y;
        }
        r=m->stack[at+1]; m->top=at;
        return idn==NSOME||idn==NEVERY?boolean(idn==NEVERY):idn==NFOREACH?undef():r;
        default:die(m,"unknown native method");
    }
    return undef();
}
static Val invoke(VM *m,Val callee,Val self,int argc,int base,int construct) {
    Obj *o; Val r,p; Frame fr; int saved=m->top;
    if(!callable(callee))die(m,"not a function");
    if(++m->depth>512)die(m,"call depth limit");
    o=(Obj *)callee.p;
    if(construct) {
        p=get(o,str(m,"prototype")); self=object(obj(m,p.t==OBJ?(Obj *)p.p:m->op));
    }else if(self.t==U||self.t==NIL)self=object(m->global->vars);
    fr.prev=m->frame; fr.env=o->scope; fr.code=o->fun; fr.self=self; fr.callee=callee; fr.base=base;
    m->frame=&fr;
    if(o->native)r=native(m,o->native,self,argc,base);
    else {
        fr.env=env(m,o->scope); r=run(m,o->fun,fr.env,self,callee,argc,base);
    }
    m->frame=fr.prev; m->depth--; m->top=saved; return construct&&r.t!=OBJ?self:r;
}
static Val run(VM *m,Fun *f,Env *e,Val self,Val callee,int argc,int base) {
    volatile int pc=0; int i,t,at; Ins *in; Val a,b,c,r; Ref *ref; Obj *o; Prop *p;
    int saved=m->top,depth=m->depth; Frame *fr=m->frame; jmp_buf trap,*outer=m->trap; Handler *hd;
    for(i=0;i<f->argc;i++)put(m,e->vars,f->params[i],arg(m,base,argc,i));
    if(callee.t==OBJ) {
        r=arr(m);
        for(i=0;i<argc;i++)append(m,r,arg(m,base,argc,i));
        named(m,e->vars,"arguments",r);
        if(f->name.t==STR&&!own(e->vars,f->name))put(m,e->vars,f->name,callee);
    }
    for(i=0;i<f->nv;i++) {
        if(!own(e->vars,f->vars[i])) {
            put(m,e->vars,f->vars[i],undef());
            if(chars(f->vars[i])[0]==1)own(e->vars,f->vars[i])->hidden=1;
        }
    }
    for(i=0;i<f->nh;i++)put(m,e->vars,f->names[i],closure(m,f->hoist[i],e));
    m->trap=&trap;
    if(setjmp(trap)) {
        int best=-1; m->frame=fr; m->depth=depth;
        for(i=0;i<f->nhd;i++)if(pc-1>=f->handlers[i].start&&pc-1<f->handlers[i].end&&(best<0||f->handlers[i].start>=f->handlers[best].start))best=i;
        if(best<0) {
            m->trap=outer;
            if(outer)longjmp(*outer,1);
            longjmp(m->fail,1);
        }
        hd=&f->handlers[best]; pc=hd->target; m->top=saved+2*hd->iter;
        if(!m->thrown)m->exception=str(m,m->error);
        m->thrown=1;
    }
    while(pc<f->n) {
        if(m->limit&&!m->remaining--) {
            strcpy(m->error,"instruction limit exceeded"); longjmp(m->fail,1);
        }
        while(fr->env!=e&&(pc<fr->env->start||pc>=fr->env->end))fr->env=fr->env->up;
        if(m->live>m->threshold)gc(m);
        in=&f->code[pc++]; t=in->a;
        switch(in->op) {
            case PUSH:push(m,in->v);
            break;
            case NAME:push(m,reference(m,fr->env,undef(),in->v));
            break;
            case GET:a=take(m);
            push(m,a); break;
            case PROP:b=take(m);
            a=take(m); push(m,reference(m,0,a,tostring(m,b))); break;
            case SET:b=take(m);
            a=pop(m); store(m,a,b); push(m,b); break;
            case DUP:a=m->stack[m->top-1];
            push(m,a); break;
            case DROP:pop(m);
            break;
            case BIN:b=take(m);
            a=take(m); push(m,binary(m,t,a,b)); break;
            case UN:a=take(m);
            switch(t) {
                case '!':r=boolean(!truth(a));
                break;
                case '~':r=num(signedbits(~bits(number(a))));
                break;
                case '+':r=num(number(a));
                break;
                case '-':r=num(-number(a));
                break;
                default:r=undef();
                break;
            }
            push(m,r); break;
            case TYPE:a=pop(m);
            if(a.t==REF&&((Ref *)a.p)->env&&!binding(((Ref *)a.p)->env,((Ref *)a.p)->key))a=undef();
            else a=readval(m,a);
            push(m,str(m,a.t==U?"undefined":a.t==BOOL?"boolean":a.t==NUM?"number":a.t==STR?"string":callable(a)?"function":"object"));
            break;
            case DEL:a=pop(m);
            i=1;
            if(a.t==REF) {
                ref=(Ref *)a.p;
                if(ref->env)i=0;
                else if(ref->obj)i=del(ref->obj,ref->key);
            }
            push(m,boolean(i)); break;
            case INC:a=pop(m);
            b=num(number(readval(m,a))); c=num(b.n+(t>0?1:-1)); store(m,a,c); push(m,t==2||t==-2?b:c);
            break;
            case JMP:pc=t;
            break;
            case JF:a=take(m);
            if(!truth(a))pc=t;
            break;
            case JT:a=take(m);
            if(truth(a))pc=t;
            break;
            case PRECALL:a=pop(m);
            b=undef();
            if(a.t==REF) {
                ref=(Ref *)a.p;
                if(!ref->env)b=ref->base;
            }
            push(m,readval(m,a)); push(m,b); break;
            case CALL:case NEW:at=m->top-t-2;
            a=m->stack[at]; b=m->stack[at+1]; r=invoke(m,a,b,t,at+2,in->op==NEW); m->top=at; push(m,r);
            break;
            case SWAP:a=pop(m);
            b=pop(m); push(m,a); push(m,b); break;
            case ENUM:a=take(m);
            r=arr(m);
            if(a.t==OBJ) {
                Obj *seen=obj(m,0); unsigned u;
                for(o=(Obj *)a.p;o;o=o->proto)for(u=0;u<o->cap;u++)for(p=o->tab[u];p;p=p->next)if(!own(seen,p->key)) {
                    put(m,seen,p->key,boolean(1));
                    if(!p->hidden)append(m,r,p->key);
                }
            }else if(a.t==STR)for(i=0;i<(int)slen(a);i++)append(m,r,keynum(m,i));
            push(m,r); push(m,num(0)); break;
            case NEXT:i=(int)m->stack[m->top-1].n;
            o=(Obj *)m->stack[m->top-2].p;
            if(i>=o->length)pc=t;
            else {
                m->stack[m->top-1]=num(i+1); push(m,get(o,keynum(m,i)));
            }
            break;
            case RET:r=take(m);
            m->top=saved; m->trap=outer; return r;
            case CLOSURE:push(m,closure(m,in->fn,fr->env));
            break;
            case OBJECT:push(m,object(obj(m,m->op)));
            break;
            case ARRAY:push(m,arr(m));
            break;
            case HOLE:((Obj *)m->stack[m->top-1].p)->length++;
            break;
            case THIS:push(m,self);
            break;
            case CATCH:hd=&f->handlers[t];
            fr->env=env(m,fr->env); fr->env->start=hd->target; fr->env->end=hd->finish;
            put(m,fr->env->vars,hd->name,m->exception); m->exception=undef(); m->thrown=0; break;
            case THROW:a=take(m);
            b=tostring(m,a); sprintf(m->error,"%.250s",chars(b)); m->exception=a; m->thrown=1;
            longjmp(trap,1); break;
            default:die(m,"bad bytecode");
        }
    }
    m->top=saved; m->trap=outer; return undef();
}
static Val builtin(VM *m,Obj *target,const char *name,int idn) {
    Obj *o=obj(m,m->fp); Val r=object(o); o->native=idn; hidden(m,target,name,r); return r;
}
static void init(VM *m) {
    Obj *g,*math,*o; Val v; m->threshold=4096; m->op=obj(m,0); m->ap=obj(m,m->op); m->ap->array=1;
    m->fp=obj(m,m->op); m->sp=obj(m,m->op); m->global=env(m,0); g=m->global->vars; g->proto=m->op;
    named(m,g,"undefined",undef()); named(m,g,"NaN",num(nanval()));
    {
        volatile double z=0; named(m,g,"Infinity",num(1.0/z));
    }
    named(m,g,"global",object(g)); builtin(m,g,"print",NPRINT); builtin(m,g,"assert",NASSERT);
    builtin(m,g,"parseInt",NPARSE); builtin(m,g,"isNaN",NISNAN); o=obj(m,m->op);
    named(m,g,"console",object(o)); builtin(m,o,"log",NPRINT); v=builtin(m,g,"Object",NOBJECT);
    hidden(m,(Obj *)v.p,"prototype",object(m->op)); hidden(m,m->op,"constructor",v);
    builtin(m,(Obj *)v.p,"keys",NKEYS); builtin(m,m->op,"hasOwnProperty",NHAS);
    builtin(m,m->op,"toString",NTOSTRING); builtin(m,(Obj *)v.p,"create",NCREATE);
    builtin(m,(Obj *)v.p,"getPrototypeOf",NGETPROTO); v=builtin(m,g,"Array",NARRAY);
    hidden(m,(Obj *)v.p,"prototype",object(m->ap)); hidden(m,m->ap,"constructor",v);
    builtin(m,(Obj *)v.p,"isArray",NISARRAY); v=builtin(m,g,"String",NSTRING);
    hidden(m,(Obj *)v.p,"prototype",object(m->sp)); hidden(m,m->sp,"constructor",v);
    builtin(m,g,"Number",NNUMBER); builtin(m,g,"Boolean",NBOOLEAN); builtin(m,m->fp,"call",NCALL);
    builtin(m,m->fp,"apply",NAPPLY); builtin(m,m->ap,"shift",NSHIFT);
    builtin(m,m->ap,"unshift",NUNSHIFT); builtin(m,m->ap,"some",NSOME);
    builtin(m,m->ap,"every",NEVERY); builtin(m,m->ap,"push",NPUSH); builtin(m,m->ap,"pop",NPOP);
    builtin(m,m->ap,"join",NJOIN); builtin(m,m->ap,"slice",NSLICE); builtin(m,m->ap,"indexOf",NINDEX);
    builtin(m,m->ap,"forEach",NFOREACH); builtin(m,m->ap,"map",NMAP);
    builtin(m,m->ap,"filter",NFILTER); builtin(m,m->ap,"reduce",NREDUCE);
    builtin(m,m->ap,"reverse",NREVERSE); builtin(m,m->ap,"sort",NSORT);
    builtin(m,m->ap,"concat",NCONCAT); builtin(m,m->sp,"split",NSPLIT);
    builtin(m,m->sp,"slice",NSLICE); builtin(m,m->sp,"substring",NSUBSTRING);
    builtin(m,m->sp,"indexOf",NINDEX); builtin(m,m->sp,"charAt",NCHAR);
    builtin(m,m->sp,"charCodeAt",NCHARCODE); builtin(m,m->sp,"toLowerCase",NLOWER);
    builtin(m,m->sp,"toUpperCase",NUPPER); builtin(m,m->sp,"concat",NCONCAT); math=obj(m,m->op);
    named(m,g,"Math",object(math)); named(m,math,"PI",num(3.141592653589793));
    builtin(m,math,"floor",NFLOOR); builtin(m,math,"ceil",NCEIL); builtin(m,math,"abs",NABS);
    builtin(m,math,"min",NMIN); builtin(m,math,"max",NMAX); builtin(m,math,"sqrt",NSQRT);
    builtin(m,math,"pow",NPOW); builtin(m,math,"random",NRANDOM);
}
void js_free(VM *m);
/* Public embedding API: an engine retains its global scope between evaluations. */
VM *js_new(void) {
    VM *volatile m=calloc(1,sizeof(*m));
    if(!m)return 0;
    if(setjmp(m->fail)) {
        js_free(m); return 0;
    }
    init(m); return m;
}
int js_eval(VM *m,const char *source) {
    Fun *f; Frame fr;
    if(!m||!source||m->frame)return 0;
    m->remaining=m->limit;
    if(setjmp(m->fail)) {
        m->frame=0; m->trap=0; m->exception=undef(); m->host_result=undef(); m->thrown=0;
        m->top=m->depth=0; gc(m); return 0;
    }
    m->error[0]=0; f=compile(m,source); fr.prev=0; fr.env=m->global; fr.code=f;
    fr.self=object(m->global->vars); fr.callee=undef(); fr.base=0; m->frame=&fr;
    run(m,f,m->global,fr.self,undef(),0,0); m->frame=0; gc(m); return 1;
}
const char *js_error(VM *m) { return m->error; }
void js_set_budget(VM *m,unsigned long instructions) { if(m&&!m->frame)m->limit=instructions; }
int js_register(VM *m,const char *name,js_native callback,void *user) {
    Val v; Obj *o;
    if(!m||m->frame||!name||!callback)return 0;
    if(setjmp(m->fail))return 0;
    v=builtin(m,m->global->vars,name,NHOST); o=(Obj *)v.p; o->host=callback; o->user=user; return 1;
}
static Val hostarg(VM *m,int i) { return i>=0&&i<m->host_argc?m->stack[m->host_base+i]:undef(); }
int js_arg_type(VM *m,int i) { return hostarg(m,i).t; }
double js_arg_number(VM *m,int i) { return number(hostarg(m,i)); }
const char *js_arg_string(VM *m,int i,size_t *length) {
    Val v=hostarg(m,i);
    if(length)*length=v.t==STR?slen(v):0;
    return v.t==STR?chars(v):0;
}
void js_return_number(VM *m,double n) { m->host_result=num(n); }
void js_return_boolean(VM *m,int n) { m->host_result=boolean(n); }
void js_return_string(VM *m,const char *s,size_t n) { m->host_result=strn(m,s,n); }
void js_return_null(VM *m) { m->host_result=val(NIL,0,0); }
void js_free(VM *m) {
    Cell *c; Fun *f;
    if(!m)return;
    while(m->heap) {
        c=m->heap; m->heap=c->next; release(c);
    }
    while(m->funs) {
        f=m->funs; m->funs=f->next; freefun(f);
    }
    free(m->stack); free(m);
}
/* Standalone command line and portable JBC1 codec. Build: gcc -O2 jsvm.c -lm -o jsvm */
static void bc_error(VM *m) { die(m,"invalid or truncated bytecode"); }
static void byteout(VM *m,FILE *s,unsigned n) { if(fputc(n&255,s)==EOF)die(m,"bytecode write failed"); }
static unsigned bytein(VM *m,FILE *s) { int c=fgetc(s); if(c==EOF)bc_error(m); return (unsigned)c; }
static void wordout(VM *m,FILE *s,unsigned long n) { int i; for(i=0;i<4;i++){byteout(m,s,(unsigned)n);n>>=8;} }
static unsigned long wordin(VM *m,FILE *s) { unsigned long n=0; int i; for(i=0;i<4;i++)n|=(unsigned long)bytein(m,s)<<(8*i); return n; }
static int bcinteger(VM *m,FILE *s) { unsigned long n=wordin(m,s); if(n>2147483647UL)return -(int)(4294967295UL-n)-1; return (int)n; }
static int countin(VM *m,FILE *s) { int n=bcinteger(m,s); if(n<0||n>1000000)bc_error(m);return n; }
static void valueout(VM *m,FILE *s,Val v) {
    int e=0; double d,hi; size_t i;
    byteout(m,s,v.t);
    if(v.t==STR){wordout(m,s,(unsigned long)slen(v));for(i=0;i<slen(v);i++)byteout(m,s,(unsigned char)chars(v)[i]);}
    else if(v.t==BOOL)byteout(m,s,(unsigned)v.n);
    else if(v.t==NUM){
        d=v.n; if(d!=d){byteout(m,s,3);return;} if(d>0&&d==d/2){byteout(m,s,2);return;} if(d<0&&d==d/2){byteout(m,s,4);return;}
        byteout(m,s,d<0?1:0); d=frexp(fabs(d),&e)*9007199254740992.0; hi=floor(d/4294967296.0);
        wordout(m,s,(unsigned long)e);wordout(m,s,(unsigned long)hi);wordout(m,s,(unsigned long)(d-hi*4294967296.0));
    }else if(v.t!=U&&v.t!=NIL)bc_error(m);
}
static Val valuein(VM *m,FILE *s) {
    unsigned t=bytein(m,s),k; int e,n,i; double d; Str *p; volatile double zero=0;
    if(t==STR){n=countin(m,s);p=(Str *)cell(m,sizeof(Str)+(size_t)n,CSTR);p->len=n;for(i=0;i<n;i++)p->s[i]=(char)bytein(m,s);p->s[n]=0;return val(STR,0,(Cell *)p);}
    if(t==BOOL){k=bytein(m,s);if(k>1)bc_error(m);return boolean(k);}
    if(t==NUM){k=bytein(m,s);if(k==2)return num(1.0/zero);if(k==3)return num(nanval());if(k==4)return num(-1.0/zero);if(k>1)bc_error(m);
        e=bcinteger(m,s);d=(double)wordin(m,s)*4294967296.0;d+=(double)wordin(m,s);if(e< -1073||e>1024||d>=9007199254740992.0)bc_error(m);d=ldexp(d,e-53);return num(k?-d:d);}
    if(t!=U&&t!=NIL)bc_error(m);
    return val((int)t,0,0);
}
static void funout(VM *m,FILE *s,Fun *f) {
    int i; Handler *h; Ins *in;
    valueout(m,s,f->name);wordout(m,s,f->argc);wordout(m,s,f->nv);wordout(m,s,f->nh);wordout(m,s,f->nhd);wordout(m,s,f->n);
    for(i=0;i<f->argc;i++)valueout(m,s,f->params[i]);
    for(i=0;i<f->nv;i++)valueout(m,s,f->vars[i]);
    for(i=0;i<f->nh;i++){valueout(m,s,f->names[i]);funout(m,s,f->hoist[i]);}
    for(i=0;i<f->nhd;i++){h=&f->handlers[i];wordout(m,s,h->start);wordout(m,s,h->end);wordout(m,s,h->target);wordout(m,s,h->finish);wordout(m,s,h->iter);valueout(m,s,h->name);}
    for(i=0;i<f->n;i++){in=&f->code[i];byteout(m,s,in->op);wordout(m,s,(unsigned long)in->a);valueout(m,s,in->v);if(in->op==CLOSURE)funout(m,s,in->fn);}
}
static void *bcarray(VM *m,int n,size_t size) { void *p=mem(m,0,(size_t)n*size);memset(p,0,(size_t)n*size);return p; }
static Val namein(VM *m,FILE *s) { Val v=valuein(m,s);if(v.t!=STR)bc_error(m);return v; }
static Fun *funin(VM *m,FILE *s,int depth) {
    Fun *f=fun(m); int i; Handler *h; Ins *in;
    if(depth>512)bc_error(m);
    f->name=valuein(m,s);if(f->name.t!=STR&&f->name.t!=U)bc_error(m);
    f->argc=countin(m,s);f->nv=f->cv=countin(m,s);f->nh=f->ch=countin(m,s);f->nhd=countin(m,s);f->n=f->cap=countin(m,s);
    f->params=bcarray(m,f->argc,sizeof(Val));f->vars=bcarray(m,f->nv,sizeof(Val));f->names=bcarray(m,f->nh,sizeof(Val));f->hoist=bcarray(m,f->nh,sizeof(Fun *));f->handlers=bcarray(m,f->nhd,sizeof(Handler));f->code=bcarray(m,f->n,sizeof(Ins));
    for(i=0;i<f->argc;i++)f->params[i]=namein(m,s);
    for(i=0;i<f->nv;i++)f->vars[i]=namein(m,s);
    for(i=0;i<f->nh;i++){f->names[i]=namein(m,s);f->hoist[i]=funin(m,s,depth+1);}
    for(i=0;i<f->nhd;i++){h=&f->handlers[i];h->start=countin(m,s);h->end=countin(m,s);h->target=countin(m,s);h->finish=countin(m,s);h->iter=countin(m,s);h->name=namein(m,s);if(h->start>h->end||h->end>f->n||h->target>=f->n||h->finish>f->n)bc_error(m);}
    for(i=0;i<f->n;i++){in=&f->code[i];in->op=bytein(m,s);in->a=bcinteger(m,s);in->v=valuein(m,s);if(in->op>CATCH||in->op==INIT)bc_error(m);if(in->op==CLOSURE)in->fn=funin(m,s,depth+1);if(in->op==NAME&&in->v.t!=STR)bc_error(m);if((in->op==JMP||in->op==JF||in->op==JT||in->op==NEXT)&&(in->a<0||in->a>f->n))bc_error(m);}
    return f;
}
static char *readfile(const char *path,size_t *len) {
    FILE *s=fopen(path,"rb");char *p=0,*q;size_t n=0,cap=0;int c;if(!s)return 0;
    while((c=fgetc(s))!=EOF){if(n+1>=cap){cap=cap?cap*2:4096;q=realloc(p,cap);if(!q){free(p);fclose(s);return 0;}p=q;}p[n++]=(char)c;}
    if(ferror(s)){free(p);p=0;}else if(!p)p=malloc(1);if(p){p[n]=0;*len=n;}fclose(s);return p;
}
static int hostread(VM *m,int argc,void *user) { const char *path=js_arg_string(m,0,0);size_t n;char *p;(void)argc;(void)user;if(!path||!(p=readfile(path,&n)))return 0;js_return_string(m,p,n);free(p);return 1; }
static int hostwrite(VM *m,int argc,void *user) {
    const char *path=js_arg_string(m,0,0),*data;size_t n,i;FILE *s;int a,b,ok=1;(void)argc;(void)user;
    data=js_arg_string(m,1,&n);if(!path||!data||n%2)return 0;s=fopen(path,"wb");if(!s)return 0;
    for(i=0;i<n;i+=2){a=hex(data[i]);b=hex(data[i+1]);if(a<0||b<0||fputc(a*16+b,s)==EOF){ok=0;break;}}return fclose(s)==0&&ok;
}
static int hostchar(VM *m,int argc,void *user) { char c=(char)(unsigned)js_arg_number(m,0);(void)argc;(void)user;js_return_string(m,&c,1);return 1; }
static int runfile(VM *m,const char *path,int binary,const char *output,int argc,char **argv) {
    FILE *volatile s=0;char *volatile source=0;size_t n;Fun *f;Frame fr;Val args;int i;
    if(setjmp(m->fail)){if(s)fclose(s);free(source);m->frame=0;m->trap=0;return 0;}
    args=arr(m);for(i=0;i<argc;i++)append(m,args,str(m,argv[i]));named(m,m->global->vars,"scriptArgs",args);
    if(binary){s=fopen(path,"rb");if(!s)die(m,"cannot open bytecode");if(wordin(m,s)!=0x3143424aUL)bc_error(m);f=funin(m,s,0);if(fgetc(s)!=EOF)bc_error(m);fclose(s);s=0;}
    else {source=readfile(path,&n);if(!source)die(m,"cannot read source");f=compile(m,source);free(source);source=0;}
    if(output){s=fopen(output,"wb");if(!s)die(m,"cannot open output");wordout(m,s,0x3143424aUL);funout(m,s,f);i=fclose(s);s=0;if(i)die(m,"bytecode write failed");}
    else {fr.prev=0;fr.env=m->global;fr.code=f;fr.self=object(m->global->vars);fr.callee=undef();fr.base=0;m->frame=&fr;run(m,f,m->global,fr.self,undef(),0,0);m->frame=0;}
    gc(m);return 1;
}
int main(int argc,char **argv) {
    VM *m;int ok=0,i;if(argc<2){fprintf(stderr,"usage: jsvm [-b] script [args...] | jsvm -c source -o output\n");return 1;}
    m=js_new();if(!m)return 1;js_register(m,"readFile",hostread,0);js_register(m,"writeHexFile",hostwrite,0);js_register(m,"byteCharHost",hostchar,0);
    if(!strcmp(argv[1],"-c")){if(argc==5&&!strcmp(argv[3],"-o"))ok=runfile(m,argv[2],0,argv[4],0,0);}
    else if(!strcmp(argv[1],"-b")){if(argc>=3)ok=runfile(m,argv[2],1,0,argc-3,argv+3);}
    else {for(i=2;i<argc;i++)if(argv[i][0]=='-')break;if(i<argc)ok=runfile(m,argv[1],0,0,argc-2,argv+2);else {ok=1;for(i=1;i<argc&&ok;i++)ok=runfile(m,argv[i],0,0,0,0);}}
    if(!ok)fprintf(stderr,"%s\n",m->error[0]?m->error:"invalid arguments");
    js_free(m);return !ok;
}
