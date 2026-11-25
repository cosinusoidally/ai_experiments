/* Faithful JavaScript port of the C engine. Standalone source. */
var U=0,
    NIL=1,
    BOOL=2,
    NUM=3,
    STR=4,
    OBJ=5,
    REF=6,
    CSTR=0,
    COBJ=1,
    CENV=2,
    CREF=3,
    KEND=256,
    KID=257,
    KNUM=258,
    KSTR=259,
    KEQ=260,
    KNE=261,
    KSE=262,
    KSNE=263,
    KLE=264,
    KGE=265,
    KAND=266,
    KOR=267,
    KINC=268,
    KDEC=269,
    KADD=270,
    KSUB=271,
    KMUL=272,
    KDIV=273,
    KMOD=274,
    KSHL=275,
    KSHR=276,
    KUSHR=277,
    KBA=278,
    KBO=279,
    KBX=280,
    KVAR=281,
    KFUNCTION=282,
    KRETURN=283,
    KIF=284,
    KELSE=285,
    KWHILE=286,
    KFOR=287,
    KDO=288,
    KBREAK=289,
    KCONTINUE=290,
    KTRUE=291,
    KFALSE=292,
    KNULL=293,
    KTHIS=294,
    KNEW=295,
    KTYPEOF=296,
    KVOID=297,
    KDELETE=298,
    KIN=299,
    KINSTANCE=300,
    KTHROW=301,
    KSWITCH=302,
    KCASE=303,
    KDEFAULT=304,
    KTRY=305,
    KCATCH=306,
    PUSH=0,
    NAME=1,
    GET=2,
    PROP=3,
    SET=4,
    DUP=5,
    DROP=6,
    SWAP=7,
    BIN=8,
    UN=9,
    INC=10,
    JMP=11,
    JF=12,
    JT=13,
    CALL=14,
    NEW=15,
    RET=16,
    CLOSURE=17,
    OBJECT=18,
    ARRAY=19,
    INIT=20,
    HOLE=21,
    THIS=22,
    THROW=23,
    TYPE=24,
    DEL=25,
    PRECALL=26,
    ENUM=27,
    NEXT=28,
    CATCH=29,
    NPRINT=1,
    NARRAY=2,
    NOBJECT=3,
    NNUMBER=4,
    NSTRING=5,
    NBOOLEAN=6,
    NPUSH=7,
    NPOP=8,
    NJOIN=9,
    NSLICE=10,
    NINDEX=11,
    NCHAR=12,
    NKEYS=13,
    NHAS=14,
    NISARRAY=15,
    NFLOOR=16,
    NCEIL=17,
    NABS=18,
    NMAX=19,
    NMIN=20,
    NSQRT=21,
    NPOW=22,
    NRANDOM=23,
    NPARSE=24,
    NISNAN=25,
    NCALL=26,
    NAPPLY=27,
    NFOREACH=28,
    NMAP=29,
    NFILTER=30,
    NREDUCE=31,
    NREVERSE=32,
    NCONCAT=33,
    NCHARCODE=34,
    NSUBSTRING=35,
    NLOWER=36,
    NUPPER=37,
    NASSERT=38,
    NCREATE=39,
    NGETPROTO=40,
    NTOSTRING=41,
    NSHIFT=42,
    NUNSHIFT=43,
    NSPLIT=44,
    NSORT=45,
    NSOME=46,
    NEVERY=47,
    NHOST=48;

/* Faithful record-level port of js.c. Guest objects are not host objects:
 * their properties live in explicitly chained hash buckets. Null pointers are 0.
 * Numeric opcodes/tokens/native IDs are generated from the original C enums. */
var INT_MAX=2147483647, INT_MIN=-2147483648;
function cint(n) { return n<0?Math.ceil(n):Math.floor(n); }
function val(t,n,p) { return {t:t,n:n,p:p}; }
function undef() { return val(U,0,0); }
function num(n) { return val(NUM,n,0); }
function boolean(n) { return val(BOOL,n?1:0,0); }
function object(o) { return val(OBJ,0,o); }
function die(m,s) { m.error=s.slice(0,250); m.thrown=0; throw m.signal; }
function cell(m,kind) {
    var c={next:m.heap,gray:0,kind:kind,mark:0};
    m.heap=c; m.live++; return c;
}
function strn(m,s,n) { return str(m,s.slice(0,n)); }
function str(m,s) { var p=cell(m,CSTR); p.s=s; p.len=s.length; return val(STR,0,p); }
function chars(v) { return v.p.s; }
function slen(v) { return v.p.len; }
function seq(a,b) { return a.p===b.p||chars(a)===chars(b); }
function hash(s) {
    var h=5381,i;
    for(i=0;i<slen(s);i++) h=(h*33+chars(s).charCodeAt(i))>>>0;
    return h;
}
function iskey(k,s) { return chars(k)===s; }
function obj(m,proto) {
    var o=cell(m,COBJ); o.proto=proto; o.tab=[]; o.cap=0; o.count=0;
    o.array=0; o.length=0; o.native=0; o.fun=0; o.scope=0; o.host=0; o.user=0; return o;
}
function env(m,up) { var e=cell(m,CENV); e.up=up; e.vars=obj(m,0); e.start=0; e.end=0; return e; }
function own(o,k) {
    var h=hash(k),p;
    if(!o.cap)return 0;
    for(p=o.tab[h%o.cap];p;p=p.next)if(p.hash===h&&seq(p.key,k))return p;
    return 0;
}
function resize(m,o) {
    var i,n=o.cap?o.cap*2:8,t=[],p,q;
    for(i=0;i<n;i++)t[i]=0;
    for(i=0;i<o.cap;i++)for(p=o.tab[i];p;p=q) {
        q=p.next; p.next=t[p.hash%n]; t[p.hash%n]=p;
    }
    o.tab=t; o.cap=n;
}
function indexof(k) {
    var s=chars(k),n=0,i,c;
    if(!s.length||(s.charAt(0)==='0'&&s.length>1))return -1;
    for(i=0;i<s.length;i++) {
        c=s.charCodeAt(i); if(c<48||c>57||n>214748363)return -1;
        n=n*10+c-48;
    }
    return n;
}
function del(o,k) {
    var p,q=0,j;
    if(!o.cap)return 1;
    j=hash(k)%o.cap;
    for(p=o.tab[j];p;q=p,p=p.next)if(seq(p.key,k)) {
        if(q)q.next=p.next;else o.tab[j]=p.next;
        o.count--; return 1;
    }
    return 1;
}
function put(m,o,k,v) {
    var p,i,j,q,nextp;
    if(o.array) {
        if(iskey(k,'length')) {
            if(v.t!==NUM||!(v.n>=0&&v.n<=INT_MAX)||v.n!==cint(v.n))die(m,'invalid array length');
            o.length=v.n;
            for(j=0;j<o.cap;j++) {
                q=0; p=o.tab[j];
                while(p) {
                    nextp=p.next; i=indexof(p.key);
                    if(i>=o.length) { if(q)q.next=nextp;else o.tab[j]=nextp; o.count--; }
                    else q=p;
                    p=nextp;
                }
            }
            return;
        }
        i=indexof(k); if(i>=o.length&&i<INT_MAX)o.length=i+1;
    }
    p=own(o,k);
    if(!p) {
        if(o.count>=o.cap*2||!o.cap)resize(m,o);
        p={hash:hash(k),hidden:0,key:k,value:undef(),next:0}; j=p.hash%o.cap;
        p.next=o.tab[j]; o.tab[j]=p; o.count++;
    }
    p.value=v;
}
function nanval() { return 0/0; }
function whitespace(c) { return c===32||(c>=9&&c<=13); }
function trimASCII(s) {
    var a=0,b=s.length;
    while(a<b&&whitespace(s.charCodeAt(a)))a++;
    while(b>a&&whitespace(s.charCodeAt(b-1)))b--;
    return s.slice(a,b);
}
function number(v) {
    var s;
    switch(v.t) {
    case NUM:case BOOL:return v.n;
    case NIL:return 0;
    case STR:s=trimASCII(chars(v)); return s.length?Number(s):0;
    default:return nanval();
    }
}
function tostring(m,v) {
    switch(v.t) {
    case STR:return v;
    case U:return str(m,'undefined');
    case NIL:return str(m,'null');
    case BOOL:return str(m,v.n?'true':'false');
    case NUM:if(v.n!==v.n)return str(m,'NaN');
        if(v.n===0)return str(m,'0');
        if(v.n===1/0)return str(m,'inf');
        if(v.n===-1/0)return str(m,'-inf');
        return str(m,String(v.n));
    default:return str(m,'[object Object]');
    }
}
function mark(m,c) { if(c&&!c.mark) { c.mark=1; c.gray=m.gray; m.gray=c; } }
function mv(m,v) { if(v.p)mark(m,v.p); }
function gc(m) {
    var c,f,r,i,prev,nextp;
    mv(m,m.exception); mark(m,m.global); mark(m,m.op); mark(m,m.ap); mark(m,m.fp); mark(m,m.sp);
    for(i=0;i<m.top;i++)mv(m,m.stack[i]);
    for(r=m.frame;r;r=r.prev) {mark(m,r.env); mv(m,r.self); mv(m,r.callee); markfun(m,r.code);}
    while(m.gray) {c=m.gray; m.gray=c.gray; c.gray=0; scan(m,c);}
    prev=0; c=m.heap;
    while(c) {
        nextp=c.next;
        if(!c.mark) { if(prev)prev.next=nextp;else m.heap=nextp; c.next=0; m.live--; }
        else {c.mark=0; prev=c;}
        c=nextp;
    }
    prev=0; f=m.funs;
    while(f) {
        nextp=f.next;
        if(!f.mark) {if(prev)prev.next=nextp;else m.funs=nextp; f.next=0;}
        else {f.mark=0;prev=f;}
        f=nextp;
    }
    m.threshold=m.live*2+4096;
    /* JS owns physical memory, but the guest heap/fun lists above are swept
       explicitly. Drop stale operand roots that the C GC would not trace. */
    m.stack.length=m.top;
}
function syntax(p,s) { die(p.m,'line '+p.l.line+': '+s); }
function ident(c) { return c>=128||(c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===95||c===36; }
function digit(c) { return c>=48&&c<=57; }
function hex(c) { if(digit(c))return c-48;if(c>=97&&c<=102)return c-87;if(c>=65&&c<=70)return c-55;return -1; }
function lexChar(s,i) { return i<s.length?s.charCodeAt(i):0; }
/* Build byte characters without needing String.fromCharCode in the C host.
   The C host exposes bytes of UTF-8, whereas Node exposes UTF-16. */
var asciiChars="\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\x7f";
function byteChar(c) {
    if(c<128)return asciiChars.charAt(c);
    if(typeof byteCharHost==="function")return byteCharHost(c);
    /* The port's verified domain is ASCII source/string escapes. */
    if(typeof String.fromCharCode==='function')return String.fromCharCode(c);
    return '?';
}
var keywords=['var','function','return','if','else','while','for','do','break','continue','true','false','null','this','new','typeof','void','delete','in','instanceof','throw','switch','case','default','try','catch'];
function next(p) {
    var l=p.l,s=l.s,pos=l.pos,a,b,c,q,i,j,h,escaped,d,ep;
    l.previous=l.line;
    for(;;) {
        while(whitespace(lexChar(s,pos))) {if(lexChar(s,pos)===10)l.line++;pos++;}
        if(s.slice(pos,pos+2)==='//') {while(lexChar(s,pos)&&lexChar(s,pos)!==10)pos++;continue;}
        if(s.slice(pos,pos+2)==='/*') {
            pos+=2;while(lexChar(s,pos)&&s.slice(pos,pos+2)!=='*/') {if(lexChar(s,pos)===10)l.line++;pos++;}
            if(!lexChar(s,pos))syntax(p,'unterminated comment');pos+=2;continue;
        }
        break;
    }
    l.v=undef();c=lexChar(s,pos);
    if(!c){l.t=KEND;l.pos=pos;return;}
    a=pos++;l.t=c;
    if(digit(c)||(c===46&&digit(lexChar(s,pos)))) {
        if(c===48&&(lexChar(s,pos)===120||lexChar(s,pos)===88)) {
            d=0;pos++;if(hex(lexChar(s,pos))<0)syntax(p,'bad hex literal');
            while((h=hex(lexChar(s,pos)))>=0){d=d*16+h;pos++;} l.v=num(d);
        }else {
            pos=a;while(digit(lexChar(s,pos)))pos++;
            if(lexChar(s,pos)===46){pos++;while(digit(lexChar(s,pos)))pos++;}
            if(lexChar(s,pos)===101||lexChar(s,pos)===69) {
                ep=pos++;if(lexChar(s,pos)===43||lexChar(s,pos)===45)pos++;
                if(!digit(lexChar(s,pos)))pos=ep;else while(digit(lexChar(s,pos)))pos++;
            }
            l.v=num(Number(s.slice(a,pos)));
        }
        l.t=KNUM;
    }else if(ident(c)) {
        while(ident(lexChar(s,pos)))pos++;
        l.v=str(p.m,s.slice(a,pos));l.t=KID;
        for(i=0;i<keywords.length;i++)if(iskey(l.v,keywords[i])){l.t=KVAR+i;break;}
    }else if(c===39||c===34) {
        q=c;b='';
        while(lexChar(s,pos)&&lexChar(s,pos)!==q) {
            escaped=0;c=lexChar(s,pos++);
            if(c===10||c===13)syntax(p,'unterminated string');
            if(c===92) {
                escaped=1;if(!lexChar(s,pos))syntax(p,'unterminated escape');c=lexChar(s,pos++);
                switch(c) {
                    case 110:c=10;break;case 114:c=13;break;case 116:c=9;break;
                    case 98:c=8;break;case 102:c=12;break;case 118:c=11;break;case 48:c=0;break;
                    case 10:l.line++;continue;
                    case 120:case 117:j=c===120?2:4;c=0;
                        for(i=0;i<j;i++){h=hex(lexChar(s,pos));if(h<0)syntax(p,'bad escape');pos++;c=c*16+h;}break;
                    default:break;
                }
            }
            if(!escaped&&c>=128)b+=s.charAt(pos-1);
            else if(c<128)b+=byteChar(c);
            else if(c<2048)b+=byteChar(192|(c>>6))+byteChar(128|(c&63));
            else b+=byteChar(224|(c>>12))+byteChar(128|((c>>6)&63))+byteChar(128|(c&63));
        }
        if(!lexChar(s,pos))syntax(p,'unterminated string');pos++;l.v=str(p.m,b);l.t=KSTR;
    }else {
        h=lexChar(s,pos);
        switch(c) {
        case 61:if(h===61){pos++;l.t=KEQ;if(lexChar(s,pos)===61){pos++;l.t=KSE;}}break;
        case 33:if(h===61){pos++;l.t=KNE;if(lexChar(s,pos)===61){pos++;l.t=KSNE;}}break;
        case 60:if(h===61){pos++;l.t=KLE;}else if(h===60){pos++;l.t=KSHL;}break;
        case 62:if(h===61){pos++;l.t=KGE;}else if(h===62){pos++;l.t=KSHR;if(lexChar(s,pos)===62){pos++;l.t=KUSHR;}}break;
        case 38:if(h===38){pos++;l.t=KAND;}else if(h===61){pos++;l.t=KBA;}break;
        case 124:if(h===124){pos++;l.t=KOR;}else if(h===61){pos++;l.t=KBO;}break;
        case 94:if(h===61){pos++;l.t=KBX;}break;
        case 43:if(h===43){pos++;l.t=KINC;}else if(h===61){pos++;l.t=KADD;}break;
        case 45:if(h===45){pos++;l.t=KDEC;}else if(h===61){pos++;l.t=KSUB;}break;
        case 42:if(h===61){pos++;l.t=KMUL;}break;
        case 47:if(h===61){pos++;l.t=KDIV;}break;
        case 37:if(h===61){pos++;l.t=KMOD;}break;
        default:break;
        }
    }
    l.pos=pos;
}
function fun(m) {
    var f={next:m.funs,handlers:[],nhd:0,code:[],mark:0,n:0,cap:0,argc:0,nv:0,cv:0,nh:0,ch:0,params:[],vars:[],names:[],hoist:[],name:undef()};
    m.funs=f;return f;
}
function emit(p,op,a,v) {
    var f=p.f;
    if(f.n===f.cap)f.cap=f.cap?f.cap*2:64;
    f.code[f.n]={op:op,a:a,v:v,fn:0};return f.n++;
}
function variable(p,v) {var f=p.f;if(f.nv===f.cv)f.cv=f.cv?2*f.cv:8;f.vars[f.nv++]=v;}
function hoist(p,name,f) {var g=p.f;if(g.nh===g.ch)g.ch=g.ch?2*g.ch:8;g.names[g.nh]=name;g.hoist[g.nh++]=f;}
function forin(p) {
    var l=p.l,saved={s:l.s,pos:l.pos,t:l.t,line:l.line,previous:l.previous,v:l.v},yes;
    if(p.l.t===KVAR)next(p);
    if(p.l.t!==KID){p.l=saved;return 0;}
    next(p);yes=p.l.t===KIN;p.l=saved;return yes;
}
function compile(m,s) {
    var p={m:m,l:{s:s,pos:0,t:0,line:1,previous:0,v:undef()},f:fun(m),loop:0,depth:0,serial:0,iters:0};
    next(p);while(p.l.t!==KEND)stmt(p);out(p,PUSH,0);out(p,RET,0);return p.f;
}
function push(m,v) {if(m.top===m.cap)m.cap=m.cap?m.cap*2:256;m.stack[m.top++]=v;}
function bits(d) {return d>>>0;}
function signedbits(u) {return u|0;}
function binary(m,t,a,b) {
    var x,y,u,v,s,o,c;
    if(t===KEQ||t===KNE||t===KSE||t===KSNE)return boolean(equal(a,b,t===KSE||t===KSNE)^(t===KNE||t===KSNE));
    if(t===KIN){if(b.t!==OBJ)die(m,'in requires object');return boolean(has(b.p,tostring(m,a)));}
    if(t===KINSTANCE){if(!callable(b))die(m,'instanceof requires function');s=property(m,b,str(m,'prototype'));if(s.t!==OBJ)die(m,'invalid prototype');if(a.t!==OBJ)return boolean(0);for(o=a.p.proto;o;o=o.proto)if(o===s.p)return boolean(1);return boolean(0);}
    if(t===43&&(a.t===STR||b.t===STR||a.t===OBJ||b.t===OBJ))return str(m,chars(tostring(m,a))+chars(tostring(m,b)));
    if(a.t===STR&&b.t===STR&&(t===60||t===62||t===KLE||t===KGE)) {x=chars(a);y=chars(b);return boolean(t===60?x<y:t===62?x>y:t===KLE?x<=y:x>=y);}
    x=number(a);y=number(b);
    switch(t) {
    case 43:return num(x+y);case 45:return num(x-y);case 42:return num(x*y);case 47:return num(x/y);case 37:return num(x%y);
    case 60:return boolean(x<y);case 62:return boolean(x>y);case KLE:return boolean(x<=y);case KGE:return boolean(x>=y);
    case 38:return num(x&y);case 124:return num(x|y);case 94:return num(x^y);case KSHL:return num(x<<y);case KUSHR:return num(x>>>y);case KSHR:return num(x>>y);
    default:die(m,'unknown operator');
    }
    return undef();
}

function get(o,k) {
  var p;
  for (; o; o = o.proto)
  {
    if (o.array && iskey(k, "length"))
      return num(o.length);
    p = own(o, k);
    if (p)
      return p.value;
  }

  return undef();
}

function has(o,k) {
  for (; o; o = o.proto)
    if (own(o, k) || (o.array && iskey(k, "length")))
    return 1;

  return 0;
}

function named(m,o,k,v) {
  put(m, o, str(m, k), v);
}

function hidden(m,o,k,v) {
  var key = str(m, k);
  put(m, o, key, v);
  own(o, key).hidden = 1;
}

function lookup(e,k) {
  var p;
  for (; e; e = e.up)
  {
    p = own(e.vars, k);
    if (p)
      return p.value;
  }

  return undef();
}

function binding(e,k) {
  for (; e; e = e.up)
    if (own(e.vars, k))
    return e;

  return 0;
}

function truth(v) {
  switch (v.t)
  {
    case U:

    case NIL:
      return 0;

    case NUM:

    case BOOL:
      return (v.n != 0) && (v.n == v.n);

    case STR:
      return slen(v) != 0;

    default:
      return 1;

  }

}

function property(m,b,k) {
  var i;
  if (b.t == OBJ)
    return get((b.p), k);
  if (b.t == STR)
  {
    if (iskey(k, "length"))
      return num((slen(b)));
    i = indexof(k);
    if ((i >= 0) && (((i)) < slen(b)))
      return strn(m, chars(b).slice(i), 1);
    return get(m.sp, k);
  }
  if ((b.t == U) || (b.t == NIL))
    die(m, "property access on null/undefined");
  return undef();
}

function reference(m,e,b,k) {
  var r = (cell(m, CREF));
  r.env = e;
  r.base = b;
  r.obj = (b.t == OBJ) ? ((b.p)) : (0);
  r.key = k;
  return val(REF, 0, (r));
}

function readval(m,v) {
  var r;
  var e;
  if (v.t != REF)
    return v;
  r = (v.p);
  if (r.env)
  {
    e = binding(r.env, r.key);
    if (!e)
      die(m, "undefined identifier");
    return lookup(e, r.key);
  }
  return property(m, r.base, r.key);
}

function store(m,v,x) {
  var r;
  var e;
  if (v.t != REF)
    die(m, "invalid assignment");
  r = (v.p);
  if (r.env)
  {
    e = binding(r.env, r.key);
    put(m, ((e) ? (e) : (m.global)).vars, r.key, x);
  }
  else
    if (r.obj)
    put(m, r.obj, r.key, x);
  else
    if ((r.base.t == U) || (r.base.t == NIL))
    die(m, "invalid property assignment");
}

function equal(a,b,strict) {
  if (a.t == b.t)
  {
    switch (a.t)
    {
      case U:

      case NIL:
        return 1;

      case STR:
        return seq(a, b);

      case OBJ:
        return a.p == b.p;

      default:
        return a.n == b.n;

    }

  }
  if (strict)
    return 0;
  if (((a.t == U) || (a.t == NIL)) && ((b.t == U) || (b.t == NIL)))
    return 1;
  if (a.t == BOOL)
    a = num(a.n);
  if (b.t == BOOL)
    b = num(b.n);
  if (((a.t == STR) && (b.t == NUM)) || ((a.t == NUM) && (b.t == STR)))
    return number(a) == number(b);
  if ((a.t == NUM) && (b.t == NUM))
    return a.n == b.n;
  return 0;
}

function markfun(m,f) {
  var i;
  if ((!f) || f.mark)
    return;
  f.mark = 1;
  mv(m, f.name);
  for (i = 0; i < f.n; i++)
  {
    mv(m, f.code[i].v);
    markfun(m, f.code[i].fn);
  }

  for (i = 0; i < f.nhd; i++)
    mv(m, f.handlers[i].name);

  for (i = 0; i < f.argc; i++)
    mv(m, f.params[i]);

  for (i = 0; i < f.nv; i++)
    mv(m, f.vars[i]);

  for (i = 0; i < f.nh; i++)
  {
    mv(m, f.names[i]);
    markfun(m, f.hoist[i]);
  }

}

function scan(m,c) {
  var i;
  var p;
  var o;
  var e;
  var r;
  switch (c.kind)
  {
    case COBJ:
      o = (c);
      mark(m, (o.proto));
      mark(m, (o.scope));
      markfun(m, o.fun);
      for (i = 0; i < o.cap; i++)
      for (p = o.tab[i]; p; p = p.next)
    {
      mv(m, p.key);
      mv(m, p.value);
    }


      break;

    case CENV:
      e = (c);
      mark(m, (e.up));
      mark(m, (e.vars));
      break;

    case CREF:
      r = (c);
      mark(m, (r.env));
      mv(m, r.base);
      mv(m, r.key);
      break;

    default:
      break;

  }

}

function accept(p,t) {
  if (p.l.t != t)
    return 0;
  next(p);
  return 1;
}

function need(p,t) {
  if (!accept(p, t))
    syntax(p, "unexpected token");
}

function id(p) {
  var v = p.l.v;
  need(p, KID);
  return v;
}

function out(p,op,a) {
  return emit(p, op, a, undef());
}

function patch(p,i) {
  p.f.code[i].a = p.f.n;
}

function chain(p,i,target) {
  var j;
  while (i >= 0)
  {
    j = p.f.code[i].a;
    p.f.code[i].a = target;
    i = j;
  }

}

function parseFunction(p,name) {
  var old = p.f;
  var f = fun(p.m);
  var loop = p.loop;
  var iters = p.iters;
  p.f = f;
  p.loop = 0;
  p.iters = 0;
  f.name = name;
  need(p, 40);
  if (p.l.t != 41)
    do
  {

    f.params[f.argc++] = id(p);
  }
  while (accept(p, 44));
  need(p, 41);
  need(p, 123);
  while ((p.l.t != 125) && (p.l.t != KEND))
    stmt(p);

  need(p, 125);
  out(p, PUSH, 0);
  out(p, RET, 0);
  p.f = old;
  p.loop = loop;
  p.iters = iters;
  return f;
}

function prec(t) {
  switch (t)
  {
    case 44:
      return 1;

    case 61:

    case KADD:

    case KSUB:

    case KMUL:

    case KDIV:

    case KMOD:

    case KBA:

    case KBO:

    case KBX:
      return 2;

    case 63:
      return 3;

    case KOR:
      return 4;

    case KAND:
      return 5;

    case 124:
      return 6;

    case 94:
      return 7;

    case 38:
      return 8;

    case KEQ:

    case KNE:

    case KSE:

    case KSNE:
      return 9;

    case 60:

    case 62:

    case KLE:

    case KGE:

    case KIN:

    case KINSTANCE:
      return 10;

    case KSHL:

    case KSHR:

    case KUSHR:
      return 11;

    case 43:

    case 45:
      return 12;

    case 42:

    case 47:

    case 37:
      return 13;

    default:
      return 0;

  }

}

function args(p) {
  var n = 0;
  need(p, 40);
  if (p.l.t != 41)
    do
  {
    expr(p, 2);
    out(p, GET, 0);
    n++;
  }
  while (accept(p, 44));
  need(p, 41);
  return n;
}

function member(p,calls) {
  var k;
  for (;;)
  {
    if (accept(p, 46))
    {
      out(p, GET, 0);
      k = p.l.v;
      if (k.t != STR)
        syntax(p, "expected property name");
      next(p);
      emit(p, PUSH, 0, k);
      out(p, PROP, 0);
    }
    else
      if (accept(p, 91))
    {
      out(p, GET, 0);
      expr(p, 1);
      need(p, 93);
      out(p, PROP, 0);
    }
    else
      if (calls && (p.l.t == 40))
    {
      out(p, PRECALL, 0);
      out(p, CALL, args(p));
    }
    else
      break;
  }

}

function primary(p) {
  var t = p.l.t;
  var n;
  var v = p.l.v;
  var k;
  var f;
  next(p);
  switch (t)
  {
    case KNUM:

    case KSTR:
      emit(p, PUSH, 0, v);
      break;

    case KTRUE:

    case KFALSE:
      emit(p, PUSH, 0, boolean(t == KTRUE));
      break;

    case KNULL:
      emit(p, PUSH, 0, val(NIL, 0, 0));
      break;

    case KID:
      emit(p, NAME, 0, v);
      break;

    case KTHIS:
      out(p, THIS, 0);
      break;

    case 40:
      expr(p, 1);
      need(p, 41);
      break;

    case KFUNCTION:
      k = undef();
      if (p.l.t == KID)
      k = id(p);
      f = parseFunction(p, k);
      n = out(p, CLOSURE, 0);
      p.f.code[n].fn = f;
      break;

    case 123:
      out(p, OBJECT, 0);
      if (p.l.t != 125)
      do
    {
      k = p.l.v;
      if ((k.t != STR) && (k.t != NUM))
        syntax(p, "expected object key");
      next(p);
      need(p, 58);
      out(p, DUP, 0);
      emit(p, PUSH, 0, tostring(p.m, k));
      out(p, PROP, 0);
      expr(p, 2);
      out(p, SET, 0);
      out(p, DROP, 0);
    }
    while (accept(p, 44) && (p.l.t != 125));
      need(p, 125);
      break;

    case 91:
      out(p, ARRAY, 0);
      n = 0;
      while (p.l.t != 93)
    {
      if (p.l.t == 44)
      {
        out(p, HOLE, 0);
        n++;
        next(p);
        continue;
      }
      out(p, DUP, 0);
      emit(p, PUSH, 0, num(n++));
      out(p, PROP, 0);
      expr(p, 2);
      out(p, SET, 0);
      out(p, DROP, 0);
      if (!accept(p, 44))
        break;
    }

      need(p, 93);
      break;

    case KNEW:
      if ((++p.depth) > 512)
      syntax(p, "new nesting limit");
      primary(p);
      p.depth--;
      member(p, 0);
      out(p, PRECALL, 0);
      n = (p.l.t == 40) ? (args(p)) : (0);
      out(p, NEW, n);
      break;

    default:
      syntax(p, "expected expression");

  }

}

function prefix(p) {
  var t = p.l.t;
  if ((++p.depth) > 512)
    syntax(p, "prefix nesting limit");
  if (((((((((t == 33) || (t == 126)) || (t == 43)) || (t == 45)) || (t == KTYPEOF)) || (t == KVOID)) || (t == KDELETE)) || (t == KINC)) || (t == KDEC))
  {
    next(p);
    prefix(p);
    if ((t == KINC) || (t == KDEC))
      out(p, INC, (t == KINC) ? (1) : (-1));
    else
      if (t == KTYPEOF)
      out(p, TYPE, 0);
    else
      if (t == KDELETE)
      out(p, DEL, 0);
    else
      out(p, UN, t);
  }
  else
  {
    primary(p);
    member(p, 1);
    t = p.l.t;
    if (((t == KINC) || (t == KDEC)) && (p.l.previous == p.l.line))
    {
      next(p);
      out(p, INC, (t == KINC) ? (2) : (-2));
    }
  }
  p.depth--;
}

function compound(t) {
  switch (t)
  {
    case KADD:
      return 43;

    case KSUB:
      return 45;

    case KMUL:
      return 42;

    case KDIV:
      return 47;

    case KMOD:
      return 37;

    case KBA:
      return 38;

    case KBO:
      return 124;

    default:
      return 94;

  }

}

function expr(p,min) {
  var t;
  var k;
  var j;
  var h;
  if ((++p.depth) > 512)
    syntax(p, "expression nesting limit");
  prefix(p);
  while ((k = prec(p.l.t)) >= min)
  {
    t = p.l.t;
    next(p);
    if (t == 44)
    {
      out(p, GET, 0);
      out(p, DROP, 0);
      expr(p, k + 1);
      out(p, GET, 0);
    }
    else
      if (k == 2)
    {
      if (t != 61)
      {
        out(p, DUP, 0);
        out(p, GET, 0);
      }
      expr(p, k);
      if (t != 61)
        out(p, BIN, compound(t));
      out(p, SET, 0);
    }
    else
      if (t == 63)
    {
      out(p, GET, 0);
      j = out(p, JF, 0);
      expr(p, 2);
      out(p, GET, 0);
      need(p, 58);
      h = out(p, JMP, 0);
      patch(p, j);
      expr(p, 2);
      out(p, GET, 0);
      patch(p, h);
    }
    else
      if ((t == KAND) || (t == KOR))
    {
      out(p, GET, 0);
      out(p, DUP, 0);
      j = out(p, (t == KAND) ? (JF) : (JT), 0);
      out(p, DROP, 0);
      expr(p, k + 1);
      out(p, GET, 0);
      patch(p, j);
    }
    else
    {
      out(p, GET, 0);
      expr(p, k + 1);
      out(p, BIN, t);
    }
  }

  p.depth--;
}

function semi(p) {
  if ((((!accept(p, 59)) && (p.l.t != 125)) && (p.l.t != KEND)) && (p.l.previous == p.l.line))
    syntax(p, "expected semicolon");
}

function vars(p) {
  var v;
  do
  {
    v = id(p);
    variable(p, v);
    if (accept(p, 61))
    {
      emit(p, NAME, 0, v);
      expr(p, 2);
      out(p, SET, 0);
      out(p, DROP, 0);
    }
  }
  while (accept(p, 44));
}

function stmt(p) {
  var t = p.l.t;
  var j;
  var h;
  var start;
  var update;
  var body;
  var v;
  var f;
  var l = {up:0,br:0,co:0,is_switch:0};
  if ((++p.depth) > 512)
    syntax(p, "statement nesting limit");
  switch (t)
  {
    case 59:
      next(p);
      break;

    case 123:
      next(p);
      while ((p.l.t != 125) && (p.l.t != KEND))
      stmt(p);

      need(p, 125);
      break;

    case KVAR:
      next(p);
      vars(p);
      semi(p);
      break;

    case KFUNCTION:
      next(p);
      v = id(p);
      f = parseFunction(p, v);
      hoist(p, v, f);
      break;

    case KRETURN:
      next(p);
      if ((((p.l.t == 59) || (p.l.t == 125)) || (p.l.t == KEND)) || (p.l.previous != p.l.line))
      out(p, PUSH, 0);
    else
    {
      expr(p, 1);
      out(p, GET, 0);
    }
      out(p, RET, 0);
      semi(p);
      break;

    case KTHROW:
      next(p);
      if (p.l.previous != p.l.line)
      syntax(p, "newline after throw");
      expr(p, 1);
      out(p, THROW, 0);
      semi(p);
      break;

    case KIF:
      next(p);
      need(p, 40);
      expr(p, 1);
      need(p, 41);
      j = out(p, JF, 0);
      stmt(p);
      if (accept(p, KELSE))
    {
      h = out(p, JMP, 0);
      patch(p, j);
      stmt(p);
      patch(p, h);
    }
    else
      patch(p, j);
      break;

    case KTRY:
    {
      var h = p.f.nhd++;
      var skip;
      var g = p.f;

      g.handlers[h] = {start:0,end:0,target:0,finish:0,iter:0,name:undef()};
      g.handlers[h].start = g.n;
      g.handlers[h].iter = p.iters;
      next(p);
      if (p.l.t != 123)
        syntax(p, "expected try block");
      stmt(p);
      g.handlers[h].end = g.n;
      skip = out(p, JMP, 0);
      need(p, KCATCH);
      need(p, 40);
      g.handlers[h].name = id(p);
      need(p, 41);
      g.handlers[h].target = g.n;
      out(p, CATCH, h);
      if (p.l.t != 123)
        syntax(p, "expected catch block");
      stmt(p);
      g.handlers[h].finish = g.n;
      patch(p, skip);
      break;
    }

    case KSWITCH:
    {
      var test = -1;
      var fall = -1;
      var def = -1;
      var skip;
      var bodypc;
      var buf;
      l.up = p.loop;
      l.br = (l.co = -1);
      l.is_switch = 1;
      p.loop = (l);
      next(p);
      need(p, 40);
      buf = "\x01switch" + p.serial++;
      v = str(p.m, buf);
      variable(p, v);
      emit(p, NAME, 0, v);
      expr(p, 1);
      out(p, SET, 0);
      out(p, DROP, 0);
      need(p, 41);
      need(p, 123);
      test = out(p, JMP, 0);
      while ((p.l.t != 125) && (p.l.t != KEND))
      {
        if (p.l.t == KCASE)
        {
          next(p);
          patch(p, test);
          emit(p, NAME, 0, v);
          out(p, GET, 0);
          expr(p, 2);
          need(p, 58);
          out(p, BIN, KSE);
          test = out(p, JF, 0);
        }
        else
          if (p.l.t == KDEFAULT)
        {
          if (def >= 0)
            syntax(p, "duplicate default");
          next(p);
          need(p, 58);
          patch(p, test);
          test = out(p, JMP, 0);
          def = p.f.n;
        }
        else
          syntax(p, "expected case/default");
        bodypc = p.f.n;
        if (fall >= 0)
          p.f.code[fall].a = bodypc;
        while ((((p.l.t != KCASE) && (p.l.t != KDEFAULT)) && (p.l.t != 125)) && (p.l.t != KEND))
          stmt(p);

        fall = out(p, JMP, 0);
      }

      need(p, 125);
      patch(p, test);
      skip = out(p, JMP, (def >= 0) ? (def) : (p.f.n + 1));
      if (def < 0)
        patch(p, skip);
      if (fall >= 0)
        patch(p, fall);
      chain(p, l.br, p.f.n);
      p.loop = l.up;
      break;
    }

    case KWHILE:

    case KFOR:

    case KDO:
      l.is_switch = 0;
      l.up = p.loop;
      l.br = (l.co = -1);
      p.loop = (l);
      next(p);
      j = -1;
      update = -1;
      if (t == KFOR)
    {
      need(p, 40);
      if (forin(p))
      {
        var declare = accept(p, KVAR);
        v = id(p);
        if (declare)
          variable(p, v);
        need(p, KIN);
        expr(p, 1);
        need(p, 41);
        out(p, ENUM, 0);
        update = p.f.n;
        j = out(p, NEXT, 0);
        emit(p, NAME, 0, v);
        out(p, SWAP, 0);
        out(p, SET, 0);
        out(p, DROP, 0);
        p.iters++;
        stmt(p);
        p.iters--;
        out(p, JMP, update);
        patch(p, j);
        chain(p, l.br, p.f.n);
        chain(p, l.co, update);
        out(p, DROP, 0);
        out(p, DROP, 0);
        p.loop = l.up;
        break;
      }
      if (accept(p, KVAR))
        vars(p);
      else
        if (p.l.t != 59)
      {
        expr(p, 1);
        out(p, GET, 0);
        out(p, DROP, 0);
      }
      need(p, 59);
      start = p.f.n;
      if (p.l.t != 59)
      {
        expr(p, 1);
        j = out(p, JF, 0);
      }
      need(p, 59);
      body = out(p, JMP, 0);
      update = p.f.n;
      if (p.l.t != 41)
      {
        expr(p, 1);
        out(p, GET, 0);
        out(p, DROP, 0);
      }
      need(p, 41);
      out(p, JMP, start);
      patch(p, body);
      stmt(p);
      out(p, JMP, update);
    }
    else
      if (t == KWHILE)
    {
      start = p.f.n;
      update = start;
      need(p, 40);
      expr(p, 1);
      need(p, 41);
      j = out(p, JF, 0);
      stmt(p);
      out(p, JMP, start);
    }
    else
    {
      start = p.f.n;
      stmt(p);
      update = p.f.n;
      need(p, KWHILE);
      need(p, 40);
      expr(p, 1);
      need(p, 41);
      out(p, JT, start);
      semi(p);
    }
      if (j >= 0)
    {
      patch(p, j);
    }
      chain(p, l.br, p.f.n);
      chain(p, l.co, update);
      p.loop = l.up;
      break;

    case KBREAK:

    case KCONTINUE:
      next(p);
      if (!p.loop)
      syntax(p, "not inside loop");
      if (t == KBREAK)
      p.loop.br = out(p, JMP, p.loop.br);
    else
    {
      var q = p.loop;
      while (q && q.is_switch)
        q = q.up;

      if (!q)
        syntax(p, "continue outside loop");
      q.co = out(p, JMP, q.co);
    }
      semi(p);
      break;

    default:
      expr(p, 1);
      out(p, GET, 0);
      out(p, DROP, 0);
      semi(p);
      break;

  }

  p.depth--;
}

function pop(m) {
  if (!m.top)
    die(m, "stack underflow");
  return m.stack[--m.top];
}

function take(m) {
  return readval(m, pop(m));
}

function arr(m) {
  var o = obj(m, m.ap);
  o.array = 1;
  return object(o);
}

function keynum(m,i) {
  return tostring(m, num(i));
}

function append(m,a,v) {
  var o = (a.p);
  if (o.length == INT_MAX)
    die(m, "array too long");
  put(m, o, keynum(m, o.length), v);
}

function callable(v) {
  return (v.t == OBJ) && (((v.p)).fun || ((v.p)).native);
}

function closure(m,f,e) {
  var o = obj(m, m.fp);
  var p = obj(m, m.op);
  var v = object(o);
  o.fun = f;
  o.scope = e;
  hidden(m, o, "prototype", object(p));
  hidden(m, p, "constructor", v);
  hidden(m, o, "length", num(f.argc));
  return v;
}

function arg(m,base,argc,i) {
  return (i < argc) ? (m.stack[base + i]) : (undef());
}

function integer(a) {
  var n = number(a);
  if (n != n)
    return 0;
  if (n >= INT_MAX)
    return INT_MAX;
  if (n <= INT_MIN)
    return INT_MIN;
  return cint(n);
}

function bound(i,n) {
  if (i < 0)
    i = (i < (-n)) ? (0) : (i + n);
  return (i > n) ? (n) : (i);
}

function native(m,idn,self,argc,base) {
  var a = arg(m, base, argc, 0);
  var b = arg(m, base, argc, 1);
  var r;
  var s;
  var k;
  var x;
  var y;
  var o;
  var i;
  var j;
  var n;
  var h;
  var at;
  var u;
  var d;
  var buf;
  var end;
  var len;
  var cap;
  var z;
  var p;
  switch (idn)
  {
    case NHOST:
      o = (m.frame.callee.p);
      m.host_base = base;
      m.host_argc = argc;
      m.host_result = undef();
      if (!o.host(m, argc, o.user))
      die(m, "host callback failed");
      r = m.host_result;
      m.host_result = undef();
      return r;

    case NPRINT:
        s = '';
        for(i=0;i<argc;i++)s+=(i?' ':'')+chars(tostring(m,arg(m,base,argc,i)));
        m.output(s); return undef();
        case NASSERT:
      if (!truth(a))
      die(m, (b.t == STR) ? (chars(b)) : ("assertion failed"));
      return undef();

    case NARRAY:
      r = arr(m);
      if ((argc == 1) && (a.t == NUM))
      put(m, (r.p), str(m, "length"), a);
    else
      for (i = 0; i < argc; i++)
      append(m, r, arg(m, base, argc, i));

      return r;

    case NOBJECT:
      return (a.t == OBJ) ? (a) : (object(obj(m, m.op)));

    case NNUMBER:
      return num((argc) ? (number(a)) : (0));

    case NSTRING:
      return (argc) ? (tostring(m, a)) : (str(m, ""));

    case NBOOLEAN:
      return boolean(truth(a));

    case NISARRAY:
      return boolean((a.t == OBJ) && ((a.p)).array);

    case NISNAN:
      d = number(a);
      return boolean(d != d);

    case NFLOOR:
      return num(Math.floor(number(a)));

    case NCEIL:
      return num(Math.ceil(number(a)));

    case NABS:
      return num(Math.abs(number(a)));

    case NSQRT:
      return num(Math.sqrt(number(a)));

    case NPOW:
      return num(Math.pow(number(a), number(b)));

    case NRANDOM:
      return num(Math.random());

    case NMAX:

    case NMIN:
      if (!argc)
    {
      var zero = 0;
      return num(((idn == NMAX) ? (-1.0) : (1.0)) / zero);
    }
      d = number(a);
      for (i = 1; i < argc; i++)
    {
      var q = number(arg(m, base, argc, i));
      if (q != q)
        return num(q);
      if (((idn == NMAX) && (q > d)) || ((idn == NMIN) && (q < d)))
        d = q;
    }

      return num(d);

    case NPARSE:
        s=tostring(m,a);i=integer(b);
        if(i&&(i<2||i>36))return num(nanval());
        end=trimASCII(chars(s));
        if(!i){k=end.charAt(0);if(k==='+'||k==='-')end=end.slice(1);i=end.slice(0,2)==='0x'||end.slice(0,2)==='0X'?16:10;}
        return num(parseInt(chars(s),i));
        case NCREATE:
      if ((a.t != NIL) && (a.t != OBJ))
      die(m, "invalid prototype");
      return object(obj(m, (a.t == OBJ) ? ((a.p)) : (0)));

    case NGETPROTO:
      if (a.t != OBJ)
      die(m, "object required");
      o = ((a.p)).proto;
      return (o) ? (object(o)) : (val(NIL, 0, 0));

    case NTOSTRING:
      return str(m, (self.t == U) ? ("[object Undefined]") : ((self.t == NIL) ? ("[object Null]") : ((self.t == STR) ? ("[object String]") : ((self.t == NUM) ? ("[object Number]") : ((self.t == BOOL) ? ("[object Boolean]") : ((callable(self)) ? ("[object Function]") : ((((self.p)).array) ? ("[object Array]") : ("[object Object]"))))))));

    case NKEYS:
      if (a.t != OBJ)
      die(m, "Object.keys requires object");
      r = arr(m);
      o = (a.p);
      for (u = 0; u < o.cap; u++)
      for (p = o.tab[u]; p; p = p.next)
      if (!p.hidden)
      append(m, r, p.key);


      return r;

    case NHAS:
      if (self.t != OBJ)
      return boolean(0);
      o = (self.p);
      k = tostring(m, a);
      return boolean((own(o, k) != 0) || (o.array && iskey(k, "length")));

    case NCALL:
      at = m.top;
      for (i = 1; i < argc; i++)
      push(m, arg(m, base, argc, i));

      r = invoke(m, self, a, (argc) ? (argc - 1) : (0), at, 0);
      m.top = at;
      return r;

    case NAPPLY:
      at = m.top;
      n = 0;
      if ((b.t != NIL) && (b.t != U))
    {
      n = integer(property(m, b, str(m, "length")));
      if ((n < 0) || (n > 1000000))
        die(m, "apply argument limit");
      for (i = 0; i < n; i++)
        push(m, property(m, b, keynum(m, i)));

    }
      r = invoke(m, self, a, n, at, 0);
      m.top = at;
      return r;

    default:
      break;

  }

  if (self.t == STR)
  {
    s = self;
    n = cint(slen(s));
    i = integer(a);
    switch (idn)
    {
      case NSPLIT:
        r = arr(m);
        if (b.t == U)
        d = 4294967295.0;
      else
        d = (bits(number(b)));
        if (!d)
        return r;
        if (a.t == U)
      {
        append(m, r, s);
        return r;
      }
        k = tostring(m, a);
        if (!slen(k))
      {
        for (i = 0; (i < n) && (i < d); i++)
          append(m, r, strn(m, chars(s).slice(i), 1));

        return r;
      }
        j = 0;
        for (i = 0; i <= (n - (cint(slen(k))));)
      {
        if (!(chars(s).slice(i,i+slen(k))===chars(k)?0:1))
        {
          append(m, r, strn(m, chars(s).slice(j), i-j));
          if (((r.p)).length >= d)
            return r;
          i += cint(slen(k));
          j = i;
        }
        else
          i++;
      }

        append(m, r, strn(m, chars(s).slice(j), n-j));
        return r;

      case NCHAR:
        return ((i >= 0) && (i < n)) ? (strn(m, chars(s).slice(i), 1)) : (str(m, ""));

      case NCHARCODE:
        return num(((i >= 0) && (i < n)) ? (chars(s).charCodeAt(i)) : (nanval()));

      case NSLICE:

      case NSUBSTRING:
        j = ((argc > 1) && (b.t != U)) ? (integer(b)) : (n);
        if (idn == NSLICE)
      {
        i = bound(i, n);
        j = bound(j, n);
      }
      else
      {
        i = (i < 0) ? (0) : ((i > n) ? (n) : (i));
        j = (j < 0) ? (0) : ((j > n) ? (n) : (j));
        if (i > j)
        {
          h = i;
          i = j;
          j = h;
        }
      }
        return strn(m, chars(s).slice(i), j>i?j-i:0);

      case NINDEX:
        k = tostring(m, a);
        i = integer(b);
        if (i < 0)
        i = 0;
        if (i > n)
        i = n;
        for (; i <= (n - (cint(slen(k)))); i++)
        if (!(chars(s).slice(i,i+slen(k))===chars(k)?0:1))
        return num(i);

        return num(-1);

      case NLOWER:case NUPPER:
        return str(m,idn===NLOWER?chars(s).toLowerCase():chars(s).toUpperCase());
        case NCONCAT:
        r = s;
        for (i = 0; i < argc; i++)
        r = binary(m, 43, r, tostring(m, arg(m, base, argc, i)));

        return r;

      default:
        die(m, "unsupported string method");

    }

  }
  if ((self.t != OBJ) || (!((self.p)).array))
  {
    die(m, "array method requires array");
  }
  o = (self.p);
  n = o.length;
  switch (idn)
  {
    case NPUSH:
      for (i = 0; i < argc; i++)
      append(m, self, arg(m, base, argc, i));

      return num(o.length);

    case NSHIFT:
      if (!n)
      return undef();
      r = get(o, keynum(m, 0));
      for (i = 1; i < n; i++)
    {
      k = keynum(m, i);
      s = keynum(m, i - 1);
      if (has(o, k))
        put(m, o, s, get(o, k));
      else
        del(o, s);
    }

      del(o, keynum(m, n - 1));
      o.length = n - 1;
      return r;

    case NUNSHIFT:
      if (argc > (INT_MAX - n))
      die(m, "array too long");
      for (i = n - 1; i >= 0; i--)
    {
      k = keynum(m, i);
      s = keynum(m, i + argc);
      if (has(o, k))
        put(m, o, s, get(o, k));
      else
        del(o, s);
    }

      for (i = 0; i < argc; i++)
      put(m, o, keynum(m, i), arg(m, base, argc, i));

      o.length = n + argc;
      return num(o.length);

    case NPOP:
      if (!n)
      return undef();
      k = keynum(m, n - 1);
      r = get(o, k);
      del(o, k);
      o.length--;
      return r;

    case NINDEX:
      i = integer(b);
      if (i < 0)
      i = bound(i, n);
      for (; i < n; i++)
    {
      k = keynum(m, i);
      if (has(o, k) && equal(get(o, k), a, 1))
        return num(i);
    }

      return num(-1);

    case NSLICE:
      r = arr(m);
      i = bound(integer(a), n);
      j = ((argc > 1) && (b.t != U)) ? (bound(integer(b), n)) : (n);
      for (; i < j; i++)
    {
      k = keynum(m, i);
      if (has(o, k))
        append(m, r, get(o, k));
      else
        ((r.p)).length++;
    }

      return r;

    case NJOIN:
        s=a.t===U?str(m,','):tostring(m,a);buf='';
        for(i=0;i<n;i++){x=get(o,keynum(m,i));x=x.t===U||x.t===NIL?str(m,''):tostring(m,x);buf+=(i?chars(s):'')+chars(x);}
        return str(m,buf);
        case NSORT:
    {
      var width;
      var left;
      var mid;
      var right;
      var ia;
      var ib;
      var outidx;
      var count = 0;
      var undefineds = 0;
      var src;
      var dst;
      var tmp;
      var va;
      var vb;
      if ((a.t != U) && (!callable(a)))
        die(m, "invalid sort comparator");
      at = m.top;
      src = arr(m);
      dst = arr(m);
      push(m, src);
      push(m, dst);
      for (i = 0; i < n; i++)
      {
        k = keynum(m, i);
        if (has(o, k))
        {
          x = get(o, k);
          if (x.t == U)
            undefineds++;
          else
          {
            append(m, src, x);
            count++;
          }
        }
      }

      for (width = 1; width < count; width = (width > (count / 2)) ? (count) : (width * 2))
      {
        for (left = 0; left < count; left = right)
        {
          mid = (width > (count - left)) ? (count) : (left + width);
          right = (width > (count - mid)) ? (count) : (mid + width);
          ia = left;
          ib = mid;
          for (outidx = left; outidx < right; outidx++)
          {
            if (ia >= mid)
              j = 0;
            else
              if (ib >= right)
              j = 1;
            else
            {
              va = get((src.p), keynum(m, ia));
              vb = get((src.p), keynum(m, ib));
              if (a.t == U)
              {
                s = tostring(m, va);
                k = tostring(m, vb);
                j = !truth(binary(m, 62, s, k));
              }
              else
              {
                h = m.top;
                push(m, va);
                push(m, vb);
                x = invoke(m, a, undef(), 2, h, 0);
                m.top = h;
                d = number(x);
                j = !(d > 0);
              }
            }
            x = get((src.p), keynum(m, (j) ? (ia++) : (ib++)));
            put(m, (dst.p), keynum(m, outidx), x);
          }

        }

        tmp = src;
        src = dst;
        dst = tmp;
      }

      for (i = 0; i < count; i++)
        put(m, o, keynum(m, i), get((src.p), keynum(m, i)));

      for (; i < (count + undefineds); i++)
        put(m, o, keynum(m, i), undef());

      for (; i < n; i++)
        del(o, keynum(m, i));

      m.top = at;
      return self;
    }

    case NREVERSE:
      for (i = 0; i < Math.floor(n / 2); i++)
    {
      k = keynum(m, i);
      s = keynum(m, (n - i) - 1);
      x = get(o, k);
      y = get(o, s);
      j = has(o, k);
      h = has(o, s);
      if (h)
        put(m, o, k, y);
      else
        del(o, k);
      if (j)
        put(m, o, s, x);
      else
        del(o, s);
    }

      return self;

    case NCONCAT:
      r = arr(m);
      for (i = -1; i < argc; i++)
    {
      x = (i < 0) ? (self) : (arg(m, base, argc, i));
      if ((x.t == OBJ) && ((x.p)).array)
      {
        var q = (x.p);
        for (j = 0; j < q.length; j++)
        {
          k = keynum(m, j);
          if (has(q, k))
            append(m, r, get(q, k));
          else
            ((r.p)).length++;
        }

      }
      else
        append(m, r, x);
    }

      return r;

    case NSOME:

    case NEVERY:

    case NFOREACH:

    case NMAP:

    case NFILTER:

    case NREDUCE:
      if (!callable(a))
      die(m, "callback required");
      at = m.top;
      push(m, self);
      r = (idn == NREDUCE) ? (b) : (arr(m));
      push(m, r);
      i = 0;
      if ((idn == NREDUCE) && (argc < 2))
    {
      while ((i < n) && (!has(o, keynum(m, i))))
        i++;

      if (i == n)
        die(m, "reduce of empty array");
      m.stack[at + 1] = get(o, keynum(m, i++));
    }
      for (; i < n; i++)
    {
      k = keynum(m, i);
      if (!has(o, k))
      {
        if (idn == NMAP)
          ((m.stack[at + 1].p)).length++;
        continue;
      }
      x = get(o, k);
      j = m.top;
      if (idn == NREDUCE)
        push(m, m.stack[at + 1]);
      push(m, x);
      push(m, num(i));
      push(m, self);
      y = invoke(m, a, (idn == NREDUCE) ? (undef()) : (b), m.top - j, j, 0);
      m.top = j;
      r = m.stack[at + 1];
      if (((idn == NSOME) && truth(y)) || ((idn == NEVERY) && (!truth(y))))
      {
        m.top = at;
        return boolean(idn == NSOME);
      }
      if (idn == NMAP)
        append(m, r, y);
      else
        if ((idn == NFILTER) && truth(y))
        append(m, r, x);
      else
        if (idn == NREDUCE)
        m.stack[at + 1] = y;
    }

      r = m.stack[at + 1];
      m.top = at;
      return ((idn == NSOME) || (idn == NEVERY)) ? (boolean(idn == NEVERY)) : ((idn == NFOREACH) ? (undef()) : (r));

    default:
      die(m, "unknown native method");

  }

  return undef();
}

function invoke(m,callee,self,argc,base,construct) {
  var o;
  var r;
  var p;
  var fr = {};
  var saved = m.top;
  if (!callable(callee))
    die(m, "not a function");
  if ((++m.depth) > 512)
    die(m, "call depth limit");
  o = (callee.p);
  if (construct)
  {
    p = get(o, str(m, "prototype"));
    self = object(obj(m, (p.t == OBJ) ? ((p.p)) : (m.op)));
  }
  else
    if ((self.t == U) || (self.t == NIL))
    self = object(m.global.vars);
  fr.prev = m.frame;
  fr.env = o.scope;
  fr.code = o.fun;
  fr.self = self;
  fr.callee = callee;
  fr.base = base;
  m.frame = (fr);
  if (o.native)
    r = native(m, o.native, self, argc, base);
  else
  {
    fr.env = env(m, o.scope);
    r = run(m, o.fun, fr.env, self, callee, argc, base);
  }
  m.frame = fr.prev;
  m.depth--;
  m.top = saved;
  return (construct && (r.t != OBJ)) ? (self) : (r);
}

function run(m,f,e,self,callee,argc,base) {
  var pc = 0;
  var i;
  var t;
  var at;
  var ins;
  var a;
  var b;
  var c;
  var r;
  var ref;
  var o;
  var p;
  var saved = m.top;
  var depth = m.depth;
  var fr = m.frame;

  var hd;
  for (i = 0; i < f.argc; i++)
    put(m, e.vars, f.params[i], arg(m, base, argc, i));

  if (callee.t == OBJ)
  {
    r = arr(m);
    for (i = 0; i < argc; i++)
      append(m, r, arg(m, base, argc, i));

    named(m, e.vars, "arguments", r);
    if ((f.name.t == STR) && (!own(e.vars, f.name)))
      put(m, e.vars, f.name, callee);
  }
  for (i = 0; i < f.nv; i++)
  {
    if (!own(e.vars, f.vars[i]))
    {
      put(m, e.vars, f.vars[i], undef());
      if (chars(f.vars[i]).charCodeAt(0) == 1)
        own(e.vars, f.vars[i]).hidden = 1;
    }
  }

  for (i = 0; i < f.nh; i++)
    put(m, e.vars, f.names[i], closure(m, f.hoist[i], e));

  while (pc < f.n)
  {
    try {
    if (m.limit && (!(m.remaining--)))
    {
      m.error="instruction limit exceeded";
      throw m.budgetSignal;
    }
    while ((fr.env != e) && ((pc < fr.env.start) || (pc >= fr.env.end)))
      fr.env = fr.env.up;

    if (m.live > m.threshold)
      gc(m);
    ins = (f.code[pc++]);
    t = ins.a;
    switch (ins.op)
    {
      case PUSH:
        push(m, ins.v);
        break;

      case NAME:
        push(m, reference(m, fr.env, undef(), ins.v));
        break;

      case GET:
        a = take(m);
        push(m, a);
        break;

      case PROP:
        b = take(m);
        a = take(m);
        push(m, reference(m, 0, a, tostring(m, b)));
        break;

      case SET:
        b = take(m);
        a = pop(m);
        store(m, a, b);
        push(m, b);
        break;

      case DUP:
        a = m.stack[m.top - 1];
        push(m, a);
        break;

      case DROP:
        pop(m);
        break;

      case BIN:
        b = take(m);
        a = take(m);
        push(m, binary(m, t, a, b));
        break;

      case UN:
        a = take(m);
        switch (t)
      {
        case 33:
          r = boolean(!truth(a));
          break;

        case 126:
          r = num(signedbits(~bits(number(a))));
          break;

        case 43:
          r = num(number(a));
          break;

        case 45:
          r = num(-number(a));
          break;

        default:
          r = undef();
          break;

      }

        push(m, r);
        break;

      case TYPE:
        a = pop(m);
        if (((a.t == REF) && ((a.p)).env) && (!binding(((a.p)).env, ((a.p)).key)))
        a = undef();
      else
        a = readval(m, a);
        push(m, str(m, (a.t == U) ? ("undefined") : ((a.t == BOOL) ? ("boolean") : ((a.t == NUM) ? ("number") : ((a.t == STR) ? ("string") : ((callable(a)) ? ("function") : ("object")))))));
        break;

      case DEL:
        a = pop(m);
        i = 1;
        if (a.t == REF)
      {
        ref = (a.p);
        if (ref.env)
          i = 0;
        else
          if (ref.obj)
          i = del(ref.obj, ref.key);
      }
        push(m, boolean(i));
        break;

      case INC:
        a = pop(m);
        b = num(number(readval(m, a)));
        c = num(b.n + ((t > 0) ? (1) : (-1)));
        store(m, a, c);
        push(m, ((t == 2) || (t == (-2))) ? (b) : (c));
        break;

      case JMP:
        pc = t;
        break;

      case JF:
        a = take(m);
        if (!truth(a))
        pc = t;
        break;

      case JT:
        a = take(m);
        if (truth(a))
        pc = t;
        break;

      case PRECALL:
        a = pop(m);
        b = undef();
        if (a.t == REF)
      {
        ref = (a.p);
        if (!ref.env)
          b = ref.base;
      }
        push(m, readval(m, a));
        push(m, b);
        break;

      case CALL:

      case NEW:
        at = (m.top - t) - 2;
        a = m.stack[at];
        b = m.stack[at + 1];
        r = invoke(m, a, b, t, at + 2, ins.op == NEW);
        m.top = at;
        push(m, r);
        break;

      case SWAP:
        a = pop(m);
        b = pop(m);
        push(m, a);
        push(m, b);
        break;

      case ENUM:
        a = take(m);
        r = arr(m);
        if (a.t == OBJ)
      {
        var seen = obj(m, 0);
        var u;
        for (o = (a.p); o; o = o.proto)
          for (u = 0; u < o.cap; u++)
          for (p = o.tab[u]; p; p = p.next)
          if (!own(seen, p.key))
        {
          put(m, seen, p.key, boolean(1));
          if (!p.hidden)
            append(m, r, p.key);
        }



      }
      else
        if (a.t == STR)
        for (i = 0; i < (cint(slen(a))); i++)
        append(m, r, keynum(m, i));

        push(m, r);
        push(m, num(0));
        break;

      case NEXT:
        i = cint(m.stack[m.top - 1].n);
        o = (m.stack[m.top - 2].p);
        if (i >= o.length)
        pc = t;
      else
      {
        m.stack[m.top - 1] = num(i + 1);
        push(m, get(o, keynum(m, i)));
      }
        break;

      case RET:
        r = take(m);
        m.top = saved;
        
        return r;

      case CLOSURE:
        push(m, closure(m, ins.fn, fr.env));
        break;

      case OBJECT:
        push(m, object(obj(m, m.op)));
        break;

      case ARRAY:
        push(m, arr(m));
        break;

      case HOLE:
        ((m.stack[m.top - 1].p)).length++;
        break;

      case THIS:
        push(m, self);
        break;

      case CATCH:
        hd = (f.handlers[t]);
        fr.env = env(m, fr.env);
        fr.env.start = hd.target;
        fr.env.end = hd.finish;
        put(m, fr.env.vars, hd.name, m.exception);
        m.exception = undef();
        m.thrown = 0;
        break;

      case THROW:
        a = take(m);
        b = tostring(m, a);
        m.error=chars(b).slice(0,250);
        m.exception = a;
        m.thrown = 1;
        throw m.signal;
        break;

      default:
        die(m, "bad bytecode");

    }

    } catch (caught) {
      if(caught!==m.signal)throw caught;
      m.frame=fr; m.depth=depth;
      var best=-1;
      for(i=0;i<f.nhd;i++)if(pc-1>=f.handlers[i].start&&pc-1<f.handlers[i].end&&(best<0||f.handlers[i].start>=f.handlers[best].start))best=i;
      if(best<0)throw caught;
      hd=f.handlers[best];pc=hd.target;m.top=saved+2*hd.iter;
      if(!m.thrown)m.exception=str(m,m.error);
      m.thrown=1;
    }
  }

  m.top = saved;
  
  return undef();
}

function builtin(m,target,name,idn) {
  var o = obj(m, m.fp);
  var r = object(o);
  o.native = idn;
  hidden(m, target, name, r);
  return r;
}

function init(m) {
  var g;
  var math;
  var o;
  var v;
  m.threshold = 4096;
  m.op = obj(m, 0);
  m.ap = obj(m, m.op);
  m.ap.array = 1;
  m.fp = obj(m, m.op);
  m.sp = obj(m, m.op);
  m.global = env(m, 0);
  g = m.global.vars;
  g.proto = m.op;
  named(m, g, "undefined", undef());
  named(m, g, "NaN", num(nanval()));
  {
    var z = 0;
    named(m, g, "Infinity", num(1.0 / z));
  }
  named(m, g, "global", object(g));
  builtin(m, g, "print", NPRINT);
  builtin(m, g, "assert", NASSERT);
  builtin(m, g, "parseInt", NPARSE);
  builtin(m, g, "isNaN", NISNAN);
  o = obj(m, m.op);
  named(m, g, "console", object(o));
  builtin(m, o, "log", NPRINT);
  v = builtin(m, g, "Object", NOBJECT);
  hidden(m, (v.p), "prototype", object(m.op));
  hidden(m, m.op, "constructor", v);
  builtin(m, (v.p), "keys", NKEYS);
  builtin(m, m.op, "hasOwnProperty", NHAS);
  builtin(m, m.op, "toString", NTOSTRING);
  builtin(m, (v.p), "create", NCREATE);
  builtin(m, (v.p), "getPrototypeOf", NGETPROTO);
  v = builtin(m, g, "Array", NARRAY);
  hidden(m, (v.p), "prototype", object(m.ap));
  hidden(m, m.ap, "constructor", v);
  builtin(m, (v.p), "isArray", NISARRAY);
  v = builtin(m, g, "String", NSTRING);
  hidden(m, (v.p), "prototype", object(m.sp));
  hidden(m, m.sp, "constructor", v);
  builtin(m, g, "Number", NNUMBER);
  builtin(m, g, "Boolean", NBOOLEAN);
  builtin(m, m.fp, "call", NCALL);
  builtin(m, m.fp, "apply", NAPPLY);
  builtin(m, m.ap, "shift", NSHIFT);
  builtin(m, m.ap, "unshift", NUNSHIFT);
  builtin(m, m.ap, "some", NSOME);
  builtin(m, m.ap, "every", NEVERY);
  builtin(m, m.ap, "push", NPUSH);
  builtin(m, m.ap, "pop", NPOP);
  builtin(m, m.ap, "join", NJOIN);
  builtin(m, m.ap, "slice", NSLICE);
  builtin(m, m.ap, "indexOf", NINDEX);
  builtin(m, m.ap, "forEach", NFOREACH);
  builtin(m, m.ap, "map", NMAP);
  builtin(m, m.ap, "filter", NFILTER);
  builtin(m, m.ap, "reduce", NREDUCE);
  builtin(m, m.ap, "reverse", NREVERSE);
  builtin(m, m.ap, "sort", NSORT);
  builtin(m, m.ap, "concat", NCONCAT);
  builtin(m, m.sp, "split", NSPLIT);
  builtin(m, m.sp, "slice", NSLICE);
  builtin(m, m.sp, "substring", NSUBSTRING);
  builtin(m, m.sp, "indexOf", NINDEX);
  builtin(m, m.sp, "charAt", NCHAR);
  builtin(m, m.sp, "charCodeAt", NCHARCODE);
  builtin(m, m.sp, "toLowerCase", NLOWER);
  builtin(m, m.sp, "toUpperCase", NUPPER);
  builtin(m, m.sp, "concat", NCONCAT);
  math = obj(m, m.op);
  named(m, g, "Math", object(math));
  named(m, math, "PI", num(3.141592653589793));
  builtin(m, math, "floor", NFLOOR);
  builtin(m, math, "ceil", NCEIL);
  builtin(m, math, "abs", NABS);
  builtin(m, math, "min", NMIN);
  builtin(m, math, "max", NMAX);
  builtin(m, math, "sqrt", NSQRT);
  builtin(m, math, "pow", NPOW);
  builtin(m, math, "random", NRANDOM);
}

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

/* JBC1 portable binary codec. Hex is only the host I/O transport. */
var bcHex='0123456789abcdef';
function bcByte(w,n){w.push(bcHex.charAt((n>>>4)&15)+bcHex.charAt(n&15));}
function bcWord(w,n){var i;for(i=0;i<4;i++){bcByte(w,n&255);n=n>>>8;}}
function bcValue(w,v){
    var i,d,e=0,hi;
    bcByte(w,v.t);
    if(v.t===STR){bcWord(w,slen(v));for(i=0;i<slen(v);i++)bcByte(w,chars(v).charCodeAt(i));}
    else if(v.t===BOOL)bcByte(w,v.n);
    else if(v.t===NUM){
        d=v.n;if(d!==d){bcByte(w,3);return;}if(d>0&&d===d/2){bcByte(w,2);return;}if(d<0&&d===d/2){bcByte(w,4);return;}
        bcByte(w,d<0?1:0);d=Math.abs(d);
        if(d){while(d>=1){d=d/2;e++;}while(d<0.5){d=d*2;e--;}}
        d=d*9007199254740992;hi=Math.floor(d/4294967296);
        bcWord(w,e);bcWord(w,hi);bcWord(w,d-hi*4294967296);
    }
}
function bcFun(w,f){
    var i,h,ins;
    bcValue(w,f.name);bcWord(w,f.argc);bcWord(w,f.nv);bcWord(w,f.nh);bcWord(w,f.nhd);bcWord(w,f.n);
    for(i=0;i<f.argc;i++)bcValue(w,f.params[i]);
    for(i=0;i<f.nv;i++)bcValue(w,f.vars[i]);
    for(i=0;i<f.nh;i++){bcValue(w,f.names[i]);bcFun(w,f.hoist[i]);}
    for(i=0;i<f.nhd;i++){h=f.handlers[i];bcWord(w,h.start);bcWord(w,h.end);bcWord(w,h.target);bcWord(w,h.finish);bcWord(w,h.iter);bcValue(w,h.name);}
    for(i=0;i<f.n;i++){ins=f.code[i];bcByte(w,ins.op);bcWord(w,ins.a);bcValue(w,ins.v);if(ins.op===CLOSURE)bcFun(w,ins.fn);}
}
function bcReadByte(r){if(r.pos>=r.s.length)throw 'truncated bytecode';return r.s.charCodeAt(r.pos++);}
function bcReadWord(r){var i,n=0;for(i=0;i<4;i++)n=n+bcReadByte(r)*Math.pow(256,i);return n;}
function bcReadInt(r){return bcReadWord(r)|0;}
function bcCount(r){var n=bcReadInt(r);if(n<0||n>1000000)throw 'invalid bytecode count';return n;}
function bcReadValue(m,r){
    var t=bcReadByte(r),k,n,e,d;
    if(t===STR){n=bcCount(r);if(r.pos+n>r.s.length)throw 'truncated string';d=r.s.slice(r.pos,r.pos+n);r.pos+=n;return str(m,d);}
    if(t===BOOL)return boolean(bcReadByte(r));
    if(t===NUM){k=bcReadByte(r);if(k===2)return num(1/0);if(k===3)return num(0/0);if(k===4)return num(-1/0);
        e=bcReadInt(r);d=bcReadWord(r)*4294967296+bcReadWord(r);d=d/9007199254740992;
        while(e>0){d=d*2;e--;}while(e<0){d=d/2;e++;}return num(k?-d:d);}
    if(t!==U&&t!==NIL)throw 'invalid value';return val(t,0,0);
}
function bcReadFun(m,r,depth){
    var f=fun(m),i,h,ins;
    if(depth>512)throw 'bytecode nesting limit';
    f.name=bcReadValue(m,r);f.argc=bcCount(r);f.nv=f.cv=bcCount(r);f.nh=f.ch=bcCount(r);f.nhd=bcCount(r);f.n=f.cap=bcCount(r);
    for(i=0;i<f.argc;i++)f.params[i]=bcReadValue(m,r);
    for(i=0;i<f.nv;i++)f.vars[i]=bcReadValue(m,r);
    for(i=0;i<f.nh;i++){f.names[i]=bcReadValue(m,r);f.hoist[i]=bcReadFun(m,r,depth+1);}
    for(i=0;i<f.nhd;i++){h={start:bcCount(r),end:bcCount(r),target:bcCount(r),finish:bcCount(r),iter:bcCount(r),name:bcReadValue(m,r)};f.handlers[i]=h;}
    for(i=0;i<f.n;i++){ins={op:bcReadByte(r),a:bcReadInt(r),v:bcReadValue(m,r),fn:0};if(ins.op===CLOSURE)ins.fn=bcReadFun(m,r,depth+1);f.code[i]=ins;}
    return f;
}
function bcLoad(m,s){var r={s:s,pos:4},f;if(s.slice(0,4)!=='JBC1')throw 'invalid magic';f=bcReadFun(m,r,0);if(r.pos!==s.length)throw 'trailing bytes';return f;}
function bcCompile(source,path){var m=js_new(),f=compile(m,source),w=['4a424331'];bcFun(w,f);writeHexFile(path,w.join(''));}
function bcRun(m,f){var fr={prev:0,env:m.global,code:f,self:object(m.global.vars),callee:undef(),base:0};m.frame=fr;run(m,f,m.global,fr.self,undef(),0,0);m.frame=0;gc(m);}
/* Only transport services cross the interpreter boundary. */
function cliMain(args){
    var m,f,i;
    if(args[0]==='-c'&&args.length===4&&args[2]==='-o'){bcCompile(readFile(args[1]),args[3]);return;}
    m=js_new();
    if(args[0]==='-b'&&args.length===2){f=bcLoad(m,readFile(args[1]));bcRun(m,f);return;}
    if(args.length===1){if(!js_eval(m,readFile(args[0])))throw js_error(m);return;}
    throw 'usage: jsvm.js -c source -o output | -b bytecode | source';
}
if(typeof scriptArgs!=='undefined'&&scriptArgs.length)cliMain(scriptArgs);
