/* Dense record layouts. Entries are listed in index order.
 * Value: tag, number/index, cell
 * Ins: op, a, v, fn
 * Cell: next, gray, kind, mark (common prefix)
 * Str: Cell..., s, hash, len, idx
 * Obj: Cell..., cap, length, densecap, dense, tab, array, proto,
 *      fun, scope, count, native, host, user
 * Env: Cell..., start, vars, up, end, slots
 * Ref: Cell..., env, base, key, obj
 * Prop: next, value, hidden, -, -, hash, key
 * Fun: next, n, code, mark, cap, vars, name, handlers, argc, nv,
 *      nh, nhd, params, names, cv, ch, cache, hoist, needsargs, reusable
 * Frame: self, prev, code, callee, env, base
 * Handler: target, finish, iter, -, start, -, name, end
 * Loop: br, co, is_switch, -, -, -, up
 * Lex: t, pos, v, line, s, previous
 * Parser: l, f, depth, loop, m, iters, serial
 * VM: op, gray, depth, top, cap, stack, ap, frame, sp, global,
 *     host_result, fp, error, thrown, exception, limit, heap, live,
 *     funs, signal, threshold, remaining, host_base, host_argc,
 *     budgetSignal, output, weakStrings, weakCount
 * Reader: -, pos, -, -, s; Writer: buf, fd
 * '-' denotes an unused slot. Records are explicit guest VM structures,
 * not a replacement of guest objects with host JavaScript objects.
 */
/* Faithful JavaScript port of the C engine. Standalone source. */
var U=0,
NIL=1,
BOOL=2,
NUM=3,
STR=4,
OBJ=5,
REF=6,
LREF=7,
AREF=8,
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
function cint(n) {
    return n<0?Math.ceil(n):Math.floor(n);
}
function val(t,n,p) {
    return [t,n,p];
}
var undefValue=[U,0,0],trueValue=[BOOL,1,0],falseValue=[BOOL,0,0];

var smallNumbers=[],smallIndex;
for(smallIndex=0;smallIndex<256;smallIndex++)smallNumbers[smallIndex]=[NUM,smallIndex,0];
function num(n) {
    return n>=0&&n<256&&n===(n|0)?smallNumbers[n]:[NUM,n,0];
}
function boolean(n) {
    return n?trueValue:falseValue;
}
function object(o) {
    return [OBJ,0,o];
}
function die(m,s) {
    m[12]=s.slice(0,250);
    m[13]=0;
    throw m[19];
}
function cell(m,c) {
    m[16]=c;
    m[17]++;
    return c;
}
function strn(m,s,n) {
    return str(m,s.slice(0,n));
}
function str(m,s) {
    var p,v,k;
    if(s.length<=32) {
        k='$'+s;
        v=m[26][k];
        if(v!==undefined)return v;
    }
    p=cell(m,[m[16],0,CSTR,0,s,0,s.length,0]);
    v=[STR,0,p];
    if(k!==undefined) {
        if(m[27]++>=512) {
            m[26]={};
            m[27]=1;
        }
        m[26][k]=v;
    }
    return v;
}
function chars(v) {
    return v[2][4];
}
function slen(v) {
    return v[2][6];
}
function seq(a,b) {
    return a[2]===b[2]||chars(a)===chars(b);
}
function hash(s) {
    var p=s[2],h=p[5],i,k;
    if(h)return h;
    h=5381;
    k=p[4];
    for(i=0;i<p[6];i++)h=(h*33+k.charCodeAt(i))>>>0;
    p[5]=h;
    return h;
}
function iskey(k,s) {
    return k[2][4]===s;
}
function obj(m,proto) {
    return cell(m,[m[16],0,COBJ,0,0,0,0,0,[],0,proto,0,0,0,0,0,0]);
}
function env(m,up) {
    var vars=obj(m,0);
    return cell(m,[m[16],0,CENV,0,0,vars,up,0,0]);
}
function own(o,k) {
    var h=hash(k),p;
    if(!o[4])return 0;
    for(p=o[8][h%o[4]];p;p=p[0])if(p[5]===h&&(p[6][2]===k[2]||p[6][2][4]===k[2][4]))return p;
    return 0;
}
function resize(m,o) {
    var i,n=o[4]?o[4]*2:8,t=[],p,q;
    for(i=0;i<n;i++)t[i]=0;
    for(i=0;i<o[4];i++)for(p=o[8][i];p;p=q) {
        q=p[0];
        p[0]=t[p[5]%n];
        t[p[5]%n]=p;
    }
    o[8]=t;
    o[4]=n;
}
function indexof(k) {
    var p=k[2],s=p[4],n=0,i,c;
    if(p[7])return p[7]-2;
    if(!p[6]||(s.charAt(0)==='0'&&p[6]>1)){
        p[7]=1;
        return -1;
    }
    for(i=0;i<p[6];i++){
        c=s.charCodeAt(i);
        if(c<48||c>57||n>214748363){
            p[7]=1;
            return -1;
        }
        n=n*10+c-48;
    }
    p[7]=n+2;
    return n;
}
var holeValue=[-1,0,0];
function denseindex(o,k) {
    if(!o[9])return -1;
    var i=indexof(k);
    return i>=0&&i<o[6]?i:-1;
}
function ownkey(o,k) {
    var i=denseindex(o,k);
    return (i>=0&&o[7][i][0]!==-1)||own(o,k)!==0;
}
function del(o,k) {
    var p,q=0,j,i=denseindex(o,k);
    if(i>=0)o[7][i]=holeValue;
    if(!o[4])return 1;
    j=hash(k)%o[4];
    for(p=o[8][j];p;q=p,p=p[0])if(seq(p[6],k)) {
        if(q)q[0]=p[0];
        else o[8][j]=p[0];
        o[13]--;
        return 1;
    }
    return 1;
}
function denseput(m,o,i,k,v) {
    var n,j;
    if(i>=o[5]&&i<INT_MAX)o[5]=i+1;
    if(i<o[6]&&o[7][i][0]!==-1) {
        o[7][i]=v;
        return 1;
    }
    if(i>(o[6]?o[6]:3)||(o[13]&&own(o,k)))return 0;
    if(i>=o[6]) {
        n=o[6]?o[6]*2:4;
        if(!o[7])o[7]=[];
        for(j=o[6];j<n;j++)o[7][j]=holeValue;
        o[6]=n;
    }
    o[7][i]=v;
    return 1;
}
function put(m,o,k,v) {
    var p,i,j,q,nextp,n;
    if(o[9]) {
        if(iskey(k,'length')) {
            if(v[0]!==NUM||!(v[1]>=0&&v[1]<=INT_MAX)||v[1]!==cint(v[1]))die(m,'invalid array length');
            o[5]=v[1];
            if(!o[5]) {
                o[7]=0;
                o[6]=0;
            } else {
                n=o[6];
                while(n>4&&o[5]<=n/4)n/=2;
                if(n<o[6]) {
                    o[7].length=n;
                    o[6]=n;
                }
                for(j=o[5];j<o[6];j++)o[7][j]=holeValue;
            }
            for(j=0;j<o[4];j++) {
                q=0;
                p=o[8][j];
                while(p) {
                    nextp=p[0];
                    i=indexof(p[6]);
                    if(i>=o[5]) {
                        if(q)q[0]=nextp;
                        else o[8][j]=nextp;
                        o[13]--;
                    }
                    else q=p;
                    p=nextp;
                }
            }
            return;
        }
        i=indexof(k);
        if(i>=0&&denseput(m,o,i,k,v))return;
    }
    p=own(o,k);
    if(!p) {
        if(o[13]>=o[4]*2||!o[4])resize(m,o);
        p=[0,undefValue,0,0,0,hash(k),k];
        j=p[5]%o[4];
        p[0]=o[8][j];
        o[8][j]=p;
        o[13]++;
    }
    p[1]=v;
}
function nanval() {
    return 0/0;
}
function whitespace(c) {
    return c===32||(c>=9&&c<=13);
}
function trimASCII(s) {
    var a=0,b=s.length;
    while(a<b&&whitespace(s.charCodeAt(a)))a++;
    while(b>a&&whitespace(s.charCodeAt(b-1)))b--;
    return s.slice(a,b);
}
function number(v) {
    var s;
    switch(v[0]) {
        case 3: /* NUM */
        case 2: /* BOOL */
        return v[1];
        case 1: /* NIL */
        return 0;
        case 4: /* STR */
        s=trimASCII(chars(v));
        return s.length?Number(s):0;
        default:
        return nanval();
    }
}
function tostring(m,v) {
    switch(v[0]) {
        case 4: /* STR */
        return v;
        case 0: /* U */
        return str(m,'undefined');
        case 1: /* NIL */
        return str(m,'null');
        case 2: /* BOOL */
        return str(m,v[1]?'true':'false');
        case 3: /* NUM */
        if(v[1]!==v[1])return str(m,'NaN');
        if(v[1]===0)return str(m,'0');
        if(v[1]===1/0)return str(m,'inf');
        if(v[1]===-1/0)return str(m,'-inf');
        return str(m,String(v[1]));
        default:
        return str(m,'[object Object]');
    }
}
function mark(m,c) {
    if(c&&!c[3]) {
        c[3]=1;
        c[1]=m[1];
        m[1]=c;
    }
}
function mv(m,v) {
    if(v[2])mark(m,v[2]);
}
function gc(m) {
    var c,f,r,i,prev,nextp;
    mv(m,m[14]);
    mark(m,m[9]);
    mark(m,m[0]);
    mark(m,m[6]);
    mark(m,m[11]);
    mark(m,m[8]);
    for(i=0;i<m[3];i++)mv(m,m[5][i]);
    for(r=m[7];r;r=r[1]) {
        mark(m,r[4]);
        mv(m,r[0]);
        mv(m,r[3]);
        markfun(m,r[2]);
    }
    while(m[1]) {
        c=m[1];
        m[1]=c[1];
        c[1]=0;
        scan(m,c);
    }
    m[26]={};
    m[27]=0;
    prev=0;
    c=m[16];
    while(c) {
        nextp=c[0];
        if(!c[3]) {
            if(prev)prev[0]=nextp;
            else m[16]=nextp;
            c[0]=0;
            m[17]--;
        }
        else {
            c[3]=0;
            prev=c;
        }
        c=nextp;
    }
    prev=0;
    f=m[18];
    while(f) {
        nextp=f[0];
        if(!f[3]) {
            if(prev)prev[0]=nextp;
            else m[18]=nextp;
            f[0]=0;
        }
        else {
            f[3]=0;
            prev=f;
        }
        f=nextp;
    }
    m[20]=m[17]*2+8192;
    /* JS owns physical memory, but the guest heap/fun lists above are swept
       explicitly. Drop stale operand roots that the C GC would not trace. */
    m[5].length=m[3];
}
function syntax(p,s) {
    die(p[4],'line '+p[0][3]+': '+s);
}
function ident(c) {
    return c>=128||(c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===95||c===36;
}
function digit(c) {
    return c>=48&&c<=57;
}
function hex(c) {
    if(digit(c))return c-48;
    if(c>=97&&c<=102)return c-87;
    if(c>=65&&c<=70)return c-55;
    return -1;
}
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
var keywordMap={},kwIndex;
for(kwIndex=0;kwIndex<keywords.length;kwIndex++)keywordMap["$"+keywords[kwIndex]]=KVAR+kwIndex;
var operators=["==","!=","===","!==","<=",">=","&&","||","++","--",
    "+=","-=","*=","/=","%=","<<",">>",">>>","&=","|=","^="];
var operatorMap={},operatorIndex;
for(operatorIndex=0;operatorIndex<operators.length;operatorIndex++)
    operatorMap[operators[operatorIndex]]=KEQ+operatorIndex;
var charClass=[],ci;
for(ci=0;ci<256;ci++)charClass[ci]=whitespace(ci)?1:digit(ci)?2:ident(ci)?3:0;
function next(p) {
    var l=p[0],s=l[4],pos=l[1],a,b,c,q,i,j,h,escaped,d,ep;
    l[5]=l[3];
    for(;;) {
        while(charClass[s.charCodeAt(pos)]===1) {
            if((s.charCodeAt(pos)||0)===10)l[3]++;
            pos++;
        }
        if(s.slice(pos,pos+2)==='//') {
            while((s.charCodeAt(pos)||0)&&(s.charCodeAt(pos)||0)!==10)pos++;
            continue;
        }
        if(s.slice(pos,pos+2)==='/*') {
            pos+=2;
            while((s.charCodeAt(pos)||0)&&s.slice(pos,pos+2)!=='*/') {
                if((s.charCodeAt(pos)||0)===10)l[3]++;
                pos++;
            }
            if(!(s.charCodeAt(pos)||0))syntax(p,'unterminated comment');
            pos+=2;
            continue;
        }
        break;
    }
    l[2]=undefValue;
    c=(s.charCodeAt(pos)||0);
    if(!c){
        l[0]=KEND;
        l[1]=pos;
        return;
    }
    a=pos++;
    l[0]=c;
    if(charClass[c]===2||(c===46&&(charClass[s.charCodeAt(pos)]===2))) {
        if(c===48&&((s.charCodeAt(pos)||0)===120||(s.charCodeAt(pos)||0)===88)) {
            d=0;
            pos++;
            if(hex((s.charCodeAt(pos)||0))<0)syntax(p,'bad hex literal');
            while((h=hex((s.charCodeAt(pos)||0)))>=0){
                d=d*16+h;
                pos++;
            }
            l[2]=num(d);
        }else {
            pos=a;
            while((charClass[s.charCodeAt(pos)]===2))pos++;
            if((s.charCodeAt(pos)||0)===46){
                pos++;
                while((charClass[s.charCodeAt(pos)]===2))pos++;
            }
            if((s.charCodeAt(pos)||0)===101||(s.charCodeAt(pos)||0)===69) {
                ep=pos++;
                if((s.charCodeAt(pos)||0)===43||(s.charCodeAt(pos)||0)===45)pos++;
                if(!(charClass[s.charCodeAt(pos)]===2))pos=ep;
                else while((charClass[s.charCodeAt(pos)]===2))pos++;
            }
            l[2]=num(Number(s.slice(a,pos)));
        }
        l[0]=KNUM;
    }else if(charClass[c]>=2) {
        while(charClass[s.charCodeAt(pos)]>=2)pos++;
        l[2]=str(p[4],s.slice(a,pos));
        l[0]=KID;
        i=keywordMap["$"+l[2][2][4]];
        if(i!==undefined)l[0]=i;
    }else if(c===39||c===34) {
        q=c;
        b='';
        while((s.charCodeAt(pos)||0)&&(s.charCodeAt(pos)||0)!==q) {
            escaped=0;
            c=(s.charCodeAt(pos++)||0);
            if(c===10||c===13)syntax(p,'unterminated string');
            if(c===92) {
                escaped=1;
                if(!(s.charCodeAt(pos)||0))syntax(p,'unterminated escape');
                c=(s.charCodeAt(pos++)||0);
                i="nrtbfv0".indexOf(s.charAt(pos-1));
                if(i>=0)c="\n\r\t\b\f\v\x00".charCodeAt(i);
                else switch(c) {
                    case 10:
                    l[3]++;
                    continue;
                    case 120:
                    case 117:
                    j=c===120?2:4;
                    c=0;
                    for(i=0;i<j;i++){
                        h=hex((s.charCodeAt(pos)||0));
                        if(h<0)syntax(p,'bad escape');
                        pos++;
                        c=c*16+h;
                    }
                    break;
                    default:
                    break;
                }
            }
            if(!escaped&&c>=128)b+=s.charAt(pos-1);
            else if(c<128)b+=byteChar(c);
            else if(c<2048)b+=byteChar(192|(c>>6))+byteChar(128|(c&63));
            else b+=byteChar(224|(c>>12))+byteChar(128|((c>>6)&63))+byteChar(128|(c&63));
        }
        if(!(s.charCodeAt(pos)||0))syntax(p,'unterminated string');
        pos++;
        l[2]=str(p[4],b);
        l[0]=KSTR;
    }else {
        i=operatorMap[s.slice(a,pos+1)];
        if(i!==undefined) {
            pos++;
            if(i===KEQ||i===KNE||i===KSHR) {
                j=operatorMap[s.slice(a,pos+1)];
                if(j!==undefined) {
                    i=j;
                    pos++;
                }
            }
            l[0]=i;
        }
    }
    l[1]=pos;
}
function fun(m) {
    var f=[m[18],0,[],0,0,[],undefValue,[],0,0,0,0,[],[],0,0,0,[],0,0];
    m[18]=f;
    return f;
}
function emit(p,op,a,v) {
    var f=p[1];
    if(f[1]===f[4])f[4]=f[4]?f[4]*2:64;
    f[2][f[1]]=[op,a,v,0];
    return f[1]++;
}
function variable(p,v) {
    var f=p[1];
    if(f[9]===f[14])f[14]=f[14]?2*f[14]:8;
    f[5][f[9]++]=v;
}
function hoist(p,name,f) {
    var g=p[1];
    if(g[10]===g[15])g[15]=g[15]?2*g[15]:8;
    g[13][g[10]]=name;
    g[17][g[10]++]=f;
}
function forin(p) {
    var l=p[0],saved=[l[0],l[1],l[2],l[3],l[4],l[5]],yes;
    if(p[0][0]===KVAR)next(p);
    if(p[0][0]!==KID){
        p[0]=saved;
        return 0;
    }
    next(p);
    yes=p[0][0]===KIN;
    p[0]=saved;
    return yes;
}
function compile(m,s) {
    var p=[[0,0,undefValue,1,s,0],fun(m),0,0,m,0,0];
    next(p);
    while(p[0][0]!==KEND)stmt(p);
    out(p,PUSH,0);
    out(p,RET,0);
    return p[1];
}
function push(m,v) {
    m[5][m[3]++]=v;
}
function bits(d) {
    return d>>>0;
}
function signedbits(u) {
    return u|0;
}
function binary(m,t,a,b) {
    var x,y,u,v,s,o,c;
    if(t===KEQ||t===KNE||t===KSE||t===KSNE)return boolean(equal(a,b,t===KSE||t===KSNE)^(t===KNE||t===KSNE));
    if(t===KIN){
        if(b[0]!==OBJ)die(m,'in requires object');
        return boolean(has(b[2],tostring(m,a)));
    }
    if(t===KINSTANCE){
        if(!callable(b))die(m,'instanceof requires function');
        s=property(m,b,str(m,'prototype'));
        if(s[0]!==OBJ)die(m,'invalid prototype');
        if(a[0]!==OBJ)return boolean(0);
        for(o=a[2][10];o;o=o[10])if(o===s[2])return boolean(1);
        return boolean(0);
    }
    if(t===43&&(a[0]===STR||b[0]===STR||a[0]===OBJ||b[0]===OBJ))return str(m,chars(tostring(m,a))+chars(tostring(m,b)));
    if(a[0]===STR&&b[0]===STR&&(t===60||t===62||t===KLE||t===KGE)) {
        x=chars(a);
        y=chars(b);
        return boolean(t===60?x<y:t===62?x>y:t===KLE?x<=y:x>=y);
    }
    x=a[0]===NUM?a[1]:number(a);
    y=b[0]===NUM?b[1]:number(b);
    switch(t) {
        case 43:
        return num(x+y);
        case 45:
        return num(x-y);
        case 42:
        return num(x*y);
        case 47:
        return num(x/y);
        case 37:
        return num(x%y);
        case 60:
        return boolean(x<y);
        case 62:
        return boolean(x>y);
        case 264: /* KLE */
        return boolean(x<=y);
        case 265: /* KGE */
        return boolean(x>=y);
        case 38:
        return num(x&y);
        case 124:
        return num(x|y);
        case 94:
        return num(x^y);
        case 275: /* KSHL */
        return num(x<<y);
        case 277: /* KUSHR */
        return num(x>>>y);
        case 276: /* KSHR */
        return num(x>>y);
        default:
        die(m,'unknown operator');
    }
    return undefValue;
}

function get(o,k) {
    var p,i;
    for (; o; o = o[10])
    {
        if(o[9]) {
            if(iskey(k,"length"))return num(o[5]);
            i=indexof(k);
            if(i>=0&&i<o[6]&&o[7][i][0]!==-1)return o[7][i];
        }
        p = own(o, k);
        if (p)
        return p[1];
    }

    return undefValue;
}

function has(o,k) {
    for (; o; o = o[10])
    if (ownkey(o, k) || (o[9] && iskey(k, "length")))
    return 1;

    return 0;
}

function named(m,o,k,v) {
    put(m, o, str(m, k), v);
}

function hidden(m,o,k,v) {
    var key = str(m, k);
    put(m, o, key, v);
    own(o, key)[2] = 1;
}

function binding(e,k) {
    var p;
    for(;e;e=e[6]) {
        p=own(e[5],k);
        if(p)return p;
    }
    return 0;
}
function lookup(m,e,k) {
    var p=binding(e,k);
    if(!p)die(m,"undefined identifier");
    return p[1];
}
function truth(v) {
    switch (v[0])
    {
        case 0: /* U */

        case 1: /* NIL */
        return 0;

        case 3: /* NUM */

        case 2: /* BOOL */
        return (v[1] != 0) && (v[1] == v[1]);

        case 4: /* STR */
        return slen(v) != 0;

        default:
        return 1;

    }

}

function property(m,b,k) {
    var i,o;
    if(k[0]===NUM&&k[1]>=0&&k[1]<=INT_MAX&&k[1]===Math.floor(k[1])) {
        i=k[1];
        if(b[0]===OBJ) {
            o=b[2];
            if(i<o[6]&&o[7][i][0]!==-1)return o[7][i];
        }
        if(b[0]===STR&&i<b[2][6])return str(m,b[2][4].charAt(i));
    }
    if(k[0]!==STR)k=tostring(m,k);
    if (b[0] == OBJ)
    return get((b[2]), k);
    if (b[0] == STR)
    {
        if (iskey(k, "length"))
        return num((slen(b)));
        i = indexof(k);
        if ((i >= 0) && (((i)) < slen(b)))
        return strn(m, chars(b).slice(i), 1);
        return get(m[8], k);
    }
    if ((b[0] == U) || (b[0] == NIL))
    die(m, "property access on null/undefined");
    return undefValue;
}

function reference(m,e,b,k) {
    var r=cell(m,[m[16],0,CREF,0,e,b,k,b[0]===OBJ?b[2]:0]);
    return [REF,0,r];
}
function readval(m,v) {
    var r;
    if(v[0]===LREF)return v[2][8][v[1]][1];
    if(v[0]===AREF)return property(m,object(v[2]),num(v[1]));
    if(v[0]!==REF)return v;
    r=v[2];
    if(r[4])return lookup(m,r[4],r[6]);
    return property(m,r[5],r[6]);
}

function store(m,v,x) {
    var r;
    var e;
    if(v[0]===LREF) {
        v[2][8][v[1]][1]=x;
        return;
    }
    if(v[0]===AREF) {
        var o=v[2],k=o[13]?tostring(m,num(v[1])):undefValue;
        if(!denseput(m,o,v[1],k,x))put(m,o,tostring(m,num(v[1])),x);
        return;
    }
    if (v[0] != REF)
    die(m, "invalid assignment");
    r = (v[2]);
    if (r[4])
    {
        e = binding(r[4], r[6]);
        if(e)e[1]=x;
        else put(m,m[9][5],r[6],x);
    }
    else
    if (r[7])
    put(m, r[7], r[6], x);
    else
    if ((r[5][0] == U) || (r[5][0] == NIL))
    die(m, "invalid property assignment");
}

function equal(a,b,strict) {
    if (a[0] == b[0])
    {
        switch (a[0])
        {
            case 0: /* U */

            case 1: /* NIL */
            return 1;

            case 4: /* STR */
            return seq(a, b);

            case 5: /* OBJ */
            return a[2] == b[2];

            default:
            return a[1] == b[1];

        }

    }
    if (strict)
    return 0;
    if (((a[0] == U) || (a[0] == NIL)) && ((b[0] == U) || (b[0] == NIL)))
    return 1;
    if (a[0] == BOOL)
    a = num(a[1]);
    if (b[0] == BOOL)
    b = num(b[1]);
    if (((a[0] == STR) && (b[0] == NUM)) || ((a[0] == NUM) && (b[0] == STR)))
    return number(a) == number(b);
    if ((a[0] == NUM) && (b[0] == NUM))
    return a[1] == b[1];
    return 0;
}

function markfun(m,f) {
    var i;
    if ((!f) || f[3])
    return;
    f[3] = 1;
    mark(m,f[16]);
    mv(m, f[6]);
    for (i = 0; i < f[1]; i++)
    {
        mv(m, f[2][i][2]);
        markfun(m, f[2][i][3]);
    }

    for (i = 0; i < f[11]; i++)
    mv(m, f[7][i][6]);

    for (i = 0; i < f[8]; i++)
    mv(m, f[12][i]);

    for (i = 0; i < f[9]; i++)
    mv(m, f[5][i]);

    for (i = 0; i < f[10]; i++)
    {
        mv(m, f[13][i]);
        markfun(m, f[17][i]);
    }

}

function scan(m,c) {
    var i;
    var p;
    var o;
    var e;
    var r;
    switch (c[2])
    {
        case 1: /* COBJ */
        o = (c);
        mark(m, (o[10]));
        mark(m, (o[12]));
        markfun(m, o[11]);
        for(i=0;i<o[6];i++)mv(m,o[7][i]);
        for (i = 0; i < o[4]; i++)
        for (p = o[8][i]; p; p = p[0])
        {
            mv(m, p[6]);
            mv(m, p[1]);
        }


        break;

        case 2: /* CENV */
        e = (c);
        mark(m, (e[6]));
        mark(m, (e[5]));
        break;

        case 3: /* CREF */
        r = (c);
        mark(m, (r[4]));
        mv(m, r[5]);
        mv(m, r[6]);
        break;

        default:
        break;

    }

}

function accept(p,t) {
    if (p[0][0] != t)
    return 0;
    next(p);
    return 1;
}

function need(p,t) {
    if (!accept(p, t))
    syntax(p, "unexpected token");
}

function id(p) {
    var v = p[0][2];
    need(p, KID);
    return v;
}

function out(p,op,a) {
    return emit(p, op, a, undefValue);
}

function patch(p,i) {
    p[1][2][i][1] = p[1][1];
}

function chain(p,i,target) {
    var j;
    while (i >= 0)
    {
        j = p[1][2][i][1];
        p[1][2][i][1] = target;
        i = j;
    }

}

function localhints(m,f) {
    var map={},i,ins,n;
    for(i=0;i<f[8];i++)map["$"+f[12][i][2][4]]=i+1;
    for(i=0;i<f[9];i++)map["$"+f[5][i][2][4]]=f[8]+i+1;
    for(i=0;i<f[10];i++)map["$"+f[13][i][2][4]]=f[8]+f[9]+i+1;
    for(i=0;i<f[1];i++) {
        ins=f[2][i];
        if(ins[0]===NAME) {
            n=map["$"+ins[2][2][4]];
            if(n!==undefined)ins[1]=n;
        }
    }
}
function parseFunction(p,name) {
    var old = p[1];
    var f = fun(p[4]);
    var loop = p[3];
    var iters = p[5];
    p[1] = f;
    p[3] = 0;
    p[5] = 0;
    f[6] = name;
    need(p, 40);
    if (p[0][0] != 41)
    do
    {

        f[12][f[8]++] = id(p);
    }
    while (accept(p, 44));
    need(p, 41);
    need(p, 123);
    while ((p[0][0] != 125) && (p[0][0] != KEND))
    stmt(p);

    need(p, 125);
    out(p, PUSH, 0);
    out(p, RET, 0);
    localhints(p[4],f);
    p[1] = old;
    p[3] = loop;
    p[5] = iters;
    return f;
}

var precedence=[],precGroups=[",","=","?","","","|","^","&","","<>","","+-","*/%"],
    precExtended=[9,9,9,9,10,10,5,4,0,0,2,2,2,2,2,11,11,11,2,2,2],pi,pj;
for(pi=0;pi<=KCATCH;pi++)precedence[pi]=0;
for(pi=0;pi<precGroups.length;pi++)
    for(pj=0;pj<precGroups[pi].length;pj++)precedence[precGroups[pi].charCodeAt(pj)]=pi+1;
for(pi=0;pi<precExtended.length;pi++)precedence[KEQ+pi]=precExtended[pi];
precedence[KIN]=precedence[KINSTANCE]=10;

function args(p) {
    var n = 0;
    need(p, 40);
    if (p[0][0] != 41)
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
            k = p[0][2];
            if (k[0] != STR)
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
        if (calls && (p[0][0] == 40))
        {
            out(p, PRECALL, 0);
            out(p, CALL, args(p));
        }
        else
        break;
    }

}

function primary(p) {
    var t = p[0][0];
    var n;
    var v = p[0][2];
    var k;
    var f;
    next(p);
    switch (t)
    {
        case 258: /* KNUM */

        case 259: /* KSTR */
        emit(p, PUSH, 0, v);
        break;

        case 291: /* KTRUE */

        case 292: /* KFALSE */
        emit(p, PUSH, 0, boolean(t == KTRUE));
        break;

        case 293: /* KNULL */
        emit(p, PUSH, 0, val(NIL, 0, 0));
        break;

        case 257: /* KID */
        emit(p, NAME, 0, v);
        break;

        case 294: /* KTHIS */
        out(p, THIS, 0);
        break;

        case 40:
        expr(p, 1);
        need(p, 41);
        break;

        case 282: /* KFUNCTION */
        k = undefValue;
        if (p[0][0] == KID)
        k = id(p);
        f = parseFunction(p, k);
        n = out(p, CLOSURE, 0);
        p[1][2][n][3] = f;
        break;

        case 123:
        out(p, OBJECT, 0);
        if (p[0][0] != 125)
        do
        {
            k = p[0][2];
            if ((k[0] != STR) && (k[0] != NUM))
            syntax(p, "expected object key");
            next(p);
            need(p, 58);
            out(p, DUP, 0);
            emit(p, PUSH, 0, tostring(p[4], k));
            out(p, PROP, 0);
            expr(p, 2);
            out(p, SET, 0);
            out(p, DROP, 0);
        }
        while (accept(p, 44) && (p[0][0] != 125));
        need(p, 125);
        break;

        case 91:
        out(p, ARRAY, 0);
        n = 0;
        while (p[0][0] != 93)
        {
            if (p[0][0] == 44)
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

        case 295: /* KNEW */
        if ((++p[2]) > 512)
        syntax(p, "new nesting limit");
        primary(p);
        p[2]--;
        member(p, 0);
        out(p, PRECALL, 0);
        n = (p[0][0] == 40) ? (args(p)) : (0);
        out(p, NEW, n);
        break;

        default:
        syntax(p, "expected expression");

    }

}

function prefix(p) {
    var t = p[0][0];
    if ((++p[2]) > 512)
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
        t = p[0][0];
        if (((t == KINC) || (t == KDEC)) && (p[0][5] == p[0][3]))
        {
            next(p);
            out(p, INC, (t == KINC) ? (2) : (-2));
        }
    }
    p[2]--;
}

function compound(t) {
    switch (t)
    {
        case 270: /* KADD */
        return 43;

        case 271: /* KSUB */
        return 45;

        case 272: /* KMUL */
        return 42;

        case 273: /* KDIV */
        return 47;

        case 274: /* KMOD */
        return 37;

        case 278: /* KBA */
        return 38;

        case 279: /* KBO */
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
    if ((++p[2]) > 512)
    syntax(p, "expression nesting limit");
    prefix(p);
    while ((k = precedence[p[0][0]]||0) >= min)
    {
        t = p[0][0];
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

    p[2]--;
}

function semi(p) {
    if ((((!accept(p, 59)) && (p[0][0] != 125)) && (p[0][0] != KEND)) && (p[0][5] == p[0][3]))
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

function switchtable(p,start,entry,end,def) {
    var map=[],lo=512,hi=-1,n=0,j,k,target,c=p[1][2];
    for(j=c[entry][1];j<end;) {
        if(c[j][0]===JMP) {
            j=c[j][1];
            continue;
        }
        if(j+4>=end||c[j][0]!==NAME||c[j+1][0]!==GET||c[j+2][0]!==PUSH||
           c[j+3][0]!==BIN||c[j+3][1]!==KSE||c[j+4][0]!==JF||c[j+2][2][0]!==NUM)return;
        k=c[j+2][2][1];
        if(!(k>=0&&k<512&&k===(k|0)))return;
        if(!map[k]) {
            map[k]=j+5;
            if(k<lo)lo=k;
            if(k>hi)hi=k;
            n++;
        }
        j=c[j+4][1];
    }
    if(n<3||hi-lo+1>4*n)return;
    c[start][0]=c[entry-2][0]=JMP;
    c[start][1]=start+1;
    c[entry-2][1]=entry-1;
    c[entry-1][0]=JMP;
    c[entry-1][1]=p[1][1];
    target=def>=0?def:p[1][1]+hi-lo+3;
    emit(p,INIT,hi-lo+1,num(lo));
    for(k=lo;k<=hi;k++)out(p,JMP,map[k]?map[k]:target);
    out(p,JMP,target);
}
function stmt(p) {
    var t = p[0][0];
    var j;
    var h;
    var start;
    var update;
    var body;
    var v;
    var f;
    var l = [0,0,0,0,0,0,0];
    if ((++p[2]) > 512)
    syntax(p, "statement nesting limit");
    switch (t)
    {
        case 59:
        next(p);
        break;

        case 123:
        next(p);
        while ((p[0][0] != 125) && (p[0][0] != KEND))
        stmt(p);

        need(p, 125);
        break;

        case 281: /* KVAR */
        next(p);
        vars(p);
        semi(p);
        break;

        case 282: /* KFUNCTION */
        next(p);
        v = id(p);
        f = parseFunction(p, v);
        hoist(p, v, f);
        break;

        case 283: /* KRETURN */
        next(p);
        if ((((p[0][0] == 59) || (p[0][0] == 125)) || (p[0][0] == KEND)) || (p[0][5] != p[0][3]))
        out(p, PUSH, 0);
        else
        {
            expr(p, 1);
            out(p, GET, 0);
        }
        out(p, RET, 0);
        semi(p);
        break;

        case 301: /* KTHROW */
        next(p);
        if (p[0][5] != p[0][3])
        syntax(p, "newline after throw");
        expr(p, 1);
        out(p, THROW, 0);
        semi(p);
        break;

        case 284: /* KIF */
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

        case 305: /* KTRY */
        {
            var h = p[1][11]++;
            var skip;
            var g = p[1];

            g[7][h] = [0,0,0,0,0,0,undefValue,0];
            g[7][h][4] = g[1];
            g[7][h][2] = p[5];
            next(p);
            if (p[0][0] != 123)
            syntax(p, "expected try block");
            stmt(p);
            g[7][h][7] = g[1];
            skip = out(p, JMP, 0);
            need(p, KCATCH);
            need(p, 40);
            g[7][h][6] = id(p);
            need(p, 41);
            g[7][h][0] = g[1];
            out(p, CATCH, h);
            if (p[0][0] != 123)
            syntax(p, "expected catch block");
            stmt(p);
            g[7][h][1] = g[1];
            patch(p, skip);
            break;
        }

        case 302: /* KSWITCH */
        {
            var test = -1;
            var entry;
            var fall = -1;
            var def = -1;
            var skip;
            var bodypc;
            var buf;
            l[6] = p[3];
            l[0] = (l[1] = -1);
            l[2] = 1;
            p[3] = (l);
            next(p);
            need(p, 40);
            buf = "\x01switch" + p[6]++;
            v = str(p[4], buf);
            variable(p, v);
            start = emit(p, NAME, 0, v);
            expr(p, 1);
            out(p, SET, 0);
            out(p, DROP, 0);
            need(p, 41);
            need(p, 123);
            entry = test = out(p, JMP, 0);
            while ((p[0][0] != 125) && (p[0][0] != KEND))
            {
                if (p[0][0] == KCASE)
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
                if (p[0][0] == KDEFAULT)
                {
                    if (def >= 0)
                    syntax(p, "duplicate default");
                    next(p);
                    need(p, 58);
                    patch(p, test);
                    test = out(p, JMP, 0);
                    def = p[1][1];
                }
                else
                syntax(p, "expected case/default");
                bodypc = p[1][1];
                if (fall >= 0)
                p[1][2][fall][1] = bodypc;
                while ((((p[0][0] != KCASE) && (p[0][0] != KDEFAULT)) && (p[0][0] != 125)) && (p[0][0] != KEND))
                stmt(p);

                fall = out(p, JMP, 0);
            }

            need(p, 125);
            patch(p, test);
            skip = out(p, JMP, (def >= 0) ? (def) : (p[1][1] + 1));
            switchtable(p,start,entry,skip,def);
            if (def < 0)
            patch(p, skip);
            if (fall >= 0)
            patch(p, fall);
            chain(p, l[0], p[1][1]);
            p[3] = l[6];
            break;
        }

        case 286: /* KWHILE */

        case 287: /* KFOR */

        case 288: /* KDO */
        l[2] = 0;
        l[6] = p[3];
        l[0] = (l[1] = -1);
        p[3] = (l);
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
                update = p[1][1];
                j = out(p, NEXT, 0);
                emit(p, NAME, 0, v);
                out(p, SWAP, 0);
                out(p, SET, 0);
                out(p, DROP, 0);
                p[5]++;
                stmt(p);
                p[5]--;
                out(p, JMP, update);
                patch(p, j);
                chain(p, l[0], p[1][1]);
                chain(p, l[1], update);
                out(p, DROP, 0);
                out(p, DROP, 0);
                p[3] = l[6];
                break;
            }
            if (accept(p, KVAR))
            vars(p);
            else
            if (p[0][0] != 59)
            {
                expr(p, 1);
                out(p, GET, 0);
                out(p, DROP, 0);
            }
            need(p, 59);
            start = p[1][1];
            if (p[0][0] != 59)
            {
                expr(p, 1);
                j = out(p, JF, 0);
            }
            need(p, 59);
            body = out(p, JMP, 0);
            update = p[1][1];
            if (p[0][0] != 41)
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
            start = p[1][1];
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
            start = p[1][1];
            stmt(p);
            update = p[1][1];
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
        chain(p, l[0], p[1][1]);
        chain(p, l[1], update);
        p[3] = l[6];
        break;

        case 289: /* KBREAK */

        case 290: /* KCONTINUE */
        next(p);
        if (!p[3])
        syntax(p, "not inside loop");
        if (t == KBREAK)
        p[3][0] = out(p, JMP, p[3][0]);
        else
        {
            var q = p[3];
            while (q && q[2])
            q = q[6];

            if (!q)
            syntax(p, "continue outside loop");
            q[1] = out(p, JMP, q[1]);
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

    p[2]--;
}

function pop(m) {
    if (!m[3])
    die(m, "stack underflow");
    return m[5][--m[3]];
}

function take(m) {
    if(!m[3])die(m,"stack underflow");
    var v=m[5][--m[3]];
    return v[0]>=REF?readval(m,v):v;
}

function arr(m) {
    var o = obj(m, m[6]);
    o[9] = 1;
    return object(o);
}

function keynum(m,i) {
    return tostring(m, num(i));
}

function append(m,a,v) {
    var o = (a[2]);
    if (o[5] == INT_MAX)
    die(m, "array too long");
    store(m,[AREF,o[5],o],v);
}

function callable(v) {
    return (v[0] == OBJ) && (((v[2]))[11] || ((v[2]))[14]);
}

function closure(m,f,e) {
    var o = obj(m, m[11]);
    var p = obj(m, m[0]);
    var v = object(o);
    o[11] = f;
    o[12] = e;
    hidden(m, o, "prototype", object(p));
    hidden(m, p, "constructor", v);
    hidden(m, o, "length", num(f[8]));
    return v;
}

function arg(m,base,argc,i) {
    return (i < argc) ? (m[5][base + i]) : (undefValue);
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
        case 48: /* NHOST */
        o = (m[7][3][2]);
        m[22] = base;
        m[23] = argc;
        m[10] = undefValue;
        if (!o[15](m, argc, o[16]))
        die(m, "host callback failed");
        r = m[10];
        m[10] = undefValue;
        return r;

        case 1: /* NPRINT */
        s = '';
        for(i=0;i<argc;i++)s+=(i?' ':'')+chars(tostring(m,arg(m,base,argc,i)));
        m[25](s);
        return undefValue;
        case 38: /* NASSERT */
        if (!truth(a))
        die(m, (b[0] == STR) ? (chars(b)) : ("assertion failed"));
        return undefValue;

        case 2: /* NARRAY */
        r = arr(m);
        if ((argc == 1) && (a[0] == NUM))
        put(m, (r[2]), str(m, "length"), a);
        else
        for (i = 0; i < argc; i++)
        append(m, r, arg(m, base, argc, i));

        return r;

        case 3: /* NOBJECT */
        return (a[0] == OBJ) ? (a) : (object(obj(m, m[0])));

        case 4: /* NNUMBER */
        return num((argc) ? (number(a)) : (0));

        case 5: /* NSTRING */
        return (argc) ? (tostring(m, a)) : (str(m, ""));

        case 6: /* NBOOLEAN */
        return boolean(truth(a));

        case 15: /* NISARRAY */
        return boolean((a[0] == OBJ) && ((a[2]))[9]);

        case 25: /* NISNAN */
        d = number(a);
        return boolean(d != d);

        case 16: /* NFLOOR */
        return num(Math.floor(number(a)));

        case 17: /* NCEIL */
        return num(Math.ceil(number(a)));

        case 18: /* NABS */
        return num(Math.abs(number(a)));

        case 21: /* NSQRT */
        return num(Math.sqrt(number(a)));

        case 22: /* NPOW */
        return num(Math.pow(number(a), number(b)));

        case 23: /* NRANDOM */
        return num(Math.random());

        case 19: /* NMAX */

        case 20: /* NMIN */
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

        case 24: /* NPARSE */
        s=tostring(m,a);
        i=integer(b);
        if(i&&(i<2||i>36))return num(nanval());
        end=trimASCII(chars(s));
        if(!i){
            k=end.charAt(0);
            if(k==='+'||k==='-')end=end.slice(1);
            i=end.slice(0,2)==='0x'||end.slice(0,2)==='0X'?16:10;
        }
        return num(parseInt(chars(s),i));
        case 39: /* NCREATE */
        if ((a[0] != NIL) && (a[0] != OBJ))
        die(m, "invalid prototype");
        return object(obj(m, (a[0] == OBJ) ? ((a[2])) : (0)));

        case 40: /* NGETPROTO */
        if (a[0] != OBJ)
        die(m, "object required");
        o = ((a[2]))[10];
        return (o) ? (object(o)) : (val(NIL, 0, 0));

        case 41: /* NTOSTRING */
        return str(m, (self[0] == U) ? ("[object Undefined]") : ((self[0] == NIL) ? ("[object Null]") : ((self[0] == STR) ? ("[object String]") : ((self[0] == NUM) ? ("[object Number]") : ((self[0] == BOOL) ? ("[object Boolean]") : ((callable(self)) ? ("[object Function]") : ((((self[2]))[9]) ? ("[object Array]") : ("[object Object]"))))))));

        case 13: /* NKEYS */
        if (a[0] != OBJ)
        die(m, "Object.keys requires object");
        r = arr(m);
        o = (a[2]);
        for(u=0;u<o[6];u++)
        if(o[7][u][0]!==-1)append(m,r,keynum(m,u));
        for (u = 0; u < o[4]; u++)
        for (p = o[8][u]; p; p = p[0])
        if (!p[2])
        append(m, r, p[6]);


        return r;

        case 14: /* NHAS */
        if (self[0] != OBJ)
        return boolean(0);
        o = (self[2]);
        k = tostring(m, a);
        return boolean(ownkey(o, k) || (o[9] && iskey(k, "length")));

        case 26: /* NCALL */
        at = m[3];
        for (i = 1; i < argc; i++)
        push(m, arg(m, base, argc, i));

        r = invoke(m, self, a, (argc) ? (argc - 1) : (0), at, 0);
        m[3] = at;
        return r;

        case 27: /* NAPPLY */
        at = m[3];
        n = 0;
        if ((b[0] != NIL) && (b[0] != U))
        {
            n = integer(property(m, b, str(m, "length")));
            if ((n < 0) || (n > 1000000))
            die(m, "apply argument limit");
            for (i = 0; i < n; i++)
            push(m, property(m, b, keynum(m, i)));

        }
        r = invoke(m, self, a, n, at, 0);
        m[3] = at;
        return r;

        default:
        break;

    }

    if (self[0] == STR)
    {
        s = self;
        n = cint(slen(s));
        i = integer(a);
        switch (idn)
        {
            case 44: /* NSPLIT */
            r = arr(m);
            if (b[0] == U)
            d = 4294967295.0;
            else
            d = (bits(number(b)));
            if (!d)
            return r;
            if (a[0] == U)
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
                    if (((r[2]))[5] >= d)
                    return r;
                    i += cint(slen(k));
                    j = i;
                }
                else
                i++;
            }

            append(m, r, strn(m, chars(s).slice(j), n-j));
            return r;

            case 12: /* NCHAR */
            return ((i >= 0) && (i < n)) ? (strn(m, chars(s).slice(i), 1)) : (str(m, ""));

            case 34: /* NCHARCODE */
            return num(((i >= 0) && (i < n)) ? (chars(s).charCodeAt(i)) : (nanval()));

            case 10: /* NSLICE */

            case 35: /* NSUBSTRING */
            j = ((argc > 1) && (b[0] != U)) ? (integer(b)) : (n);
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

            case 11: /* NINDEX */
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

            case 36: /* NLOWER */
            case 37: /* NUPPER */
            return str(m,idn===NLOWER?chars(s).toLowerCase():chars(s).toUpperCase());
            case 33: /* NCONCAT */
            r = s;
            for (i = 0; i < argc; i++)
            r = binary(m, 43, r, tostring(m, arg(m, base, argc, i)));

            return r;

            default:
            die(m, "unsupported string method");

        }

    }
    if ((self[0] != OBJ) || (!((self[2]))[9]))
    {
        die(m, "array method requires array");
    }
    o = (self[2]);
    n = o[5];
    switch (idn)
    {
        case 7: /* NPUSH */
        for (i = 0; i < argc; i++)
        append(m, self, arg(m, base, argc, i));

        return num(o[5]);

        case 42: /* NSHIFT */
        if (!n)
        return undefValue;
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
        o[5] = n - 1;
        return r;

        case 43: /* NUNSHIFT */
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

        o[5] = n + argc;
        return num(o[5]);

        case 8: /* NPOP */
        if (!n)
        return undefValue;
        k = keynum(m, n - 1);
        r = get(o, k);
        del(o, k);
        o[5]--;
        return r;

        case 11: /* NINDEX */
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

        case 10: /* NSLICE */
        r = arr(m);
        i = bound(integer(a), n);
        j = ((argc > 1) && (b[0] != U)) ? (bound(integer(b), n)) : (n);
        for (; i < j; i++)
        {
            k = keynum(m, i);
            if (has(o, k))
            append(m, r, get(o, k));
            else
            ((r[2]))[5]++;
        }

        return r;

        case 9: /* NJOIN */
        s=a[0]===U?str(m,','):tostring(m,a);
        buf='';
        for(i=0;i<n;i++){
            x=get(o,keynum(m,i));
            x=x[0]===U||x[0]===NIL?str(m,''):tostring(m,x);
            buf+=(i?chars(s):'')+chars(x);
        }
        return str(m,buf);
        case 45: /* NSORT */
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
            if ((a[0] != U) && (!callable(a)))
            die(m, "invalid sort comparator");
            at = m[3];
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
                    if (x[0] == U)
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
                            va = get((src[2]), keynum(m, ia));
                            vb = get((src[2]), keynum(m, ib));
                            if (a[0] == U)
                            {
                                s = tostring(m, va);
                                k = tostring(m, vb);
                                j = !truth(binary(m, 62, s, k));
                            }
                            else
                            {
                                h = m[3];
                                push(m, va);
                                push(m, vb);
                                x = invoke(m, a, undefValue, 2, h, 0);
                                m[3] = h;
                                d = number(x);
                                j = !(d > 0);
                            }
                        }
                        x = get((src[2]), keynum(m, (j) ? (ia++) : (ib++)));
                        put(m, (dst[2]), keynum(m, outidx), x);
                    }

                }

                tmp = src;
                src = dst;
                dst = tmp;
            }

            for (i = 0; i < count; i++)
            put(m, o, keynum(m, i), get((src[2]), keynum(m, i)));

            for (; i < (count + undefineds); i++)
            put(m, o, keynum(m, i), undefValue);

            for (; i < n; i++)
            del(o, keynum(m, i));

            m[3] = at;
            return self;
        }

        case 32: /* NREVERSE */
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

        case 33: /* NCONCAT */
        r = arr(m);
        for (i = -1; i < argc; i++)
        {
            x = (i < 0) ? (self) : (arg(m, base, argc, i));
            if ((x[0] == OBJ) && ((x[2]))[9])
            {
                var q = (x[2]);
                for (j = 0; j < q[5]; j++)
                {
                    k = keynum(m, j);
                    if (has(q, k))
                    append(m, r, get(q, k));
                    else
                    ((r[2]))[5]++;
                }

            }
            else
            append(m, r, x);
        }

        return r;

        case 46: /* NSOME */

        case 47: /* NEVERY */

        case 28: /* NFOREACH */

        case 29: /* NMAP */

        case 30: /* NFILTER */

        case 31: /* NREDUCE */
        if (!callable(a))
        die(m, "callback required");
        at = m[3];
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
            m[5][at + 1] = get(o, keynum(m, i++));
        }
        for (; i < n; i++)
        {
            k = keynum(m, i);
            if (!has(o, k))
            {
                if (idn == NMAP)
                ((m[5][at + 1][2]))[5]++;
                continue;
            }
            x = get(o, k);
            j = m[3];
            if (idn == NREDUCE)
            push(m, m[5][at + 1]);
            push(m, x);
            push(m, num(i));
            push(m, self);
            y = invoke(m, a, (idn == NREDUCE) ? (undefValue) : (b), m[3] - j, j, 0);
            m[3] = j;
            r = m[5][at + 1];
            if (((idn == NSOME) && truth(y)) || ((idn == NEVERY) && (!truth(y))))
            {
                m[3] = at;
                return boolean(idn == NSOME);
            }
            if (idn == NMAP)
            append(m, r, y);
            else
            if ((idn == NFILTER) && truth(y))
            append(m, r, x);
            else
            if (idn == NREDUCE)
            m[5][at + 1] = y;
        }

        r = m[5][at + 1];
        m[3] = at;
        return ((idn == NSOME) || (idn == NEVERY)) ? (boolean(idn == NEVERY)) : ((idn == NFOREACH) ? (undefValue) : (r));

        default:
        die(m, "unknown native method");

    }

    return undefValue;
}

function invoke(m,callee,self,argc,base,construct) {
    var o;
    var r;
    var p;
    var fr = [0,0,0,0,0,0],f,e,i,q;
    var saved = m[3];
    if (!callable(callee))
    die(m, "not a function");
    if ((++m[2]) > 512)
    die(m, "call depth limit");
    o = (callee[2]);
    if (construct)
    {
        p = get(o, str(m, "prototype"));
        self = object(obj(m, (p[0] == OBJ) ? ((p[2])) : (m[0])));
    }
    else
    if ((self[0] == U) || (self[0] == NIL))
    self = object(m[9][5]);
    fr[1] = m[7];
    fr[4] = o[12];
    fr[2] = o[11];
    fr[0] = self;
    fr[3] = callee;
    fr[5] = base;
    m[7] = (fr);
    if (o[14])
    r = native(m, o[14], self, argc, base);
    else
    {
        f=o[11];
        e=f[16];
        f[16]=0;
        if(!e)e=env(m,o[12]);
        else e[6]=o[12];
        fr[4]=e;
        r=run(m,f,e,self,callee,argc,base);
        if(f[19]&&!f[16]) {
            for(i=0;i<e[5][4];i++)
                for(q=e[5][8][i];q;q=q[0])q[1]=undefValue;
            e[6]=0;
            f[16]=e;
        }
    }
    m[7] = fr[1];
    m[2]--;
    m[3] = saved;
    return (construct && (r[0] != OBJ)) ? (self) : (r);
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
    var saved = m[3];
    var depth = m[2];
    var fr = m[7];

    var hd;
    if(callee[0]===OBJ&&f[6][0]===STR)put(m,e[5],f[6],callee);
    for (i = 0; i < f[8]; i++)
    put(m, e[5], f[12][i], arg(m, base, argc, i));

    if (callee[0] == OBJ)
    {
        if(!f[18]){
            f[18]=1;
            f[19]=!f[10];
            for(i=0;i<f[1];i++) {
                if(f[2][i][0]===NAME&&iskey(f[2][i][2],"arguments"))f[18]=2;
                if(f[2][i][0]===CLOSURE)f[19]=0;
            }
        }
        if(f[18]===2){
            r=arr(m);
            for(i=0;i<argc;i++)append(m,r,arg(m,base,argc,i));
            named(m,e[5],"arguments",r);
        }
    }
    for (i = 0; i < f[9]; i++)
    {
        if (!own(e[5], f[5][i]))
        {
            put(m, e[5], f[5][i], undefValue);
            if (chars(f[5][i]).charCodeAt(0) == 1)
            own(e[5], f[5][i])[2] = 1;
        }
    }

    for (i = 0; i < f[10]; i++)
    put(m, e[5], f[13][i], closure(m, f[17][i], e));

    if(callee[0]===OBJ&&!e[8]) {
        e[8]=[];
        for(i=0;i<f[8];i++)e[8][i]=own(e[5],f[12][i]);
        for(i=0;i<f[9];i++)e[8][f[8]+i]=own(e[5],f[5][i]);
        for(i=0;i<f[10];i++)e[8][f[8]+f[9]+i]=own(e[5],f[13][i]);
    }
    while (pc < f[1])
    {
        try {
            if (m[15] && (!(m[21]--)))
            {
                m[12]="instruction limit exceeded";
                throw m[24];
            }
            while ((fr[4] != e) && ((pc < fr[4][4]) || (pc >= fr[4][7])))
            fr[4] = fr[4][6];

            if (m[17] > m[20])
            gc(m);
            ins = (f[2][pc++]);
            t = ins[1];
            switch(ins[0]) {
                case 0: /* PUSH */
                m[5][m[3]++]=ins[2];
                break;

                case 1: /* NAME */
                if(t>0&&fr[4]===e&&e[8]) {
                    if(!m[15]&&pc<f[1]&&(f[2][pc][0]===GET||f[2][pc][0]===PRECALL)) {
                        i=f[2][pc++][0];
                        m[5][m[3]++]=e[8][t-1][1];
                        if(i===PRECALL)m[5][m[3]++]=undefValue;
                    }else m[5][m[3]++]=[LREF,t-1,e];
                    break;
                }
                if(!m[15]&&pc<f[1]&&(f[2][pc][0]===GET||f[2][pc][0]===PRECALL)){
                    i=f[2][pc++][0];
                    m[5][m[3]++]=lookup(m,fr[4],ins[2]);
                    if(i===PRECALL)m[5][m[3]++]=undefValue;
                }else m[5][m[3]++]=reference(m,fr[4],undefValue,ins[2]);
                break;

                case 2: /* GET */
                if(!m[3])die(m,"stack underflow");
                a=m[5][m[3]-1];
                if(a[0]>=REF)m[5][m[3]-1]=readval(m,a);
                break;

                case 3: /* PROP */
                b=take(m);
                a=take(m);
                if(!m[15]&&pc<f[1]&&(f[2][pc][0]===GET||f[2][pc][0]===PRECALL)){
                    i=f[2][pc++][0];
                    m[5][m[3]++]=property(m,a,b);
                    if(i===PRECALL)m[5][m[3]++]=a;
                }else if(a[0]===OBJ&&a[2][9]&&b[0]===NUM&&b[1]>=0&&b[1]<INT_MAX&&b[1]===(b[1]|0))
                    m[5][m[3]++]=[AREF,b[1],a[2]];
                else m[5][m[3]++]=reference(m,0,a,tostring(m,b));
                break;

                case 4: /* SET */
                b = take(m);
                a = pop(m);
                store(m, a, b);
                m[5][m[3]++]=b;
                break;

                case 5: /* DUP */
                a = m[5][m[3] - 1];
                m[5][m[3]++]=a;
                break;

                case 6: /* DROP */
                pop(m);
                break;

                case 7: /* SWAP */
                a = pop(m);
                b = pop(m);
                m[5][m[3]++]=a;
                m[5][m[3]++]=b;
                break;

                case 8: /* BIN */
                b = take(m);
                a = take(m);
                m[5][m[3]++]=binary(m, t, a, b);
                break;

                case 9: /* UN */
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
                    r = undefValue;
                    break;

                }

                m[5][m[3]++]=r;
                break;

                case 10: /* INC */
                a = pop(m);
                b = num(number(readval(m, a)));
                c = num(b[1] + ((t > 0) ? (1) : (-1)));
                store(m, a, c);
                m[5][m[3]++]=((t == 2) || (t == (-2))) ? (b) : (c);
                break;

                case 11: /* JMP */
                pc = t;
                break;

                case 12: /* JF */
                a = take(m);
                if (!truth(a))
                pc = t;
                break;

                case 13: /* JT */
                a = take(m);
                if (truth(a))
                pc = t;
                break;

                case 14: /* CALL */

                case 15: /* NEW */
                at = (m[3] - t) - 2;
                a = m[5][at];
                b = m[5][at + 1];
                r = invoke(m, a, b, t, at + 2, ins[0] == NEW);
                m[3] = at;
                m[5][m[3]++]=r;
                break;

                case 16: /* RET */
                r = take(m);
                m[3] = saved;
                return r;

                case 17: /* CLOSURE */
                m[5][m[3]++]=closure(m, ins[3], fr[4]);
                break;

                case 20: /* INIT */
                a=take(m);
                i=a[1]-ins[2][1];
                if(a[0]!==NUM||!(i>=0&&i<t&&i===(i|0)))i=t;
                pc=f[2][pc+i][1];
                break;

                case 18: /* OBJECT */
                m[5][m[3]++]=object(obj(m, m[0]));
                break;

                case 19: /* ARRAY */
                m[5][m[3]++]=arr(m);
                break;

                case 21: /* HOLE */
                ((m[5][m[3] - 1][2]))[5]++;
                break;

                case 22: /* THIS */
                m[5][m[3]++]=self;
                break;

                case 23: /* THROW */
                a = take(m);
                b = tostring(m, a);
                m[12]=chars(b).slice(0,250);
                m[14] = a;
                m[13] = 1;
                throw m[19];
                break;

                case 24: /* TYPE */
                a = pop(m);
                if (((a[0] == REF) && ((a[2]))[4]) && (!binding(((a[2]))[4], ((a[2]))[6])))
                a = undefValue;
                else
                a = readval(m, a);
                m[5][m[3]++]=str(m, (a[0] == U) ? ("undefined") : ((a[0] == BOOL) ? ("boolean") : ((a[0] == NUM) ? ("number") : ((a[0] == STR) ? ("string") : ((callable(a)) ? ("function") : ("object"))))));
                break;

                case 25: /* DEL */
                a = pop(m);
                i = a[0]!==LREF;
                if(a[0]===AREF)i=del(a[2],tostring(m,num(a[1])));
                if (a[0] == REF)
                {
                    ref = (a[2]);
                    if (ref[4])
                    i = 0;
                    else
                    if (ref[7])
                    i = del(ref[7], ref[6]);
                }
                m[5][m[3]++]=boolean(i);
                break;

                case 26: /* PRECALL */
                a = pop(m);
                b = a[0]===AREF?object(a[2]):undefValue;
                if (a[0] == REF)
                {
                    ref = (a[2]);
                    if (!ref[4])
                    b = ref[5];
                }
                m[5][m[3]++]=readval(m, a);
                m[5][m[3]++]=b;
                break;

                case 27: /* ENUM */
                a = take(m);
                r = arr(m);
                if (a[0] == OBJ)
                {
                    var seen = obj(m, 0);
                    var u;
                    for (o = (a[2]); o; o = o[10]) {
                        for(u=0;u<o[6];u++)if(o[7][u][0]!==-1) {
                            b=keynum(m,u);
                            if(!own(seen,b)) {
                                put(m,seen,b,boolean(1));
                                append(m,r,b);
                            }
                        }
                        for (u = 0; u < o[4]; u++)
                        for (p = o[8][u]; p; p = p[0])
                        if (!own(seen, p[6]))
                        {
                            put(m, seen, p[6], boolean(1));
                            if (!p[2])
                            append(m, r, p[6]);
                        }
                    }
                }
                else
                if (a[0] == STR)
                for (i = 0; i < (cint(slen(a))); i++)
                append(m, r, keynum(m, i));

                m[5][m[3]++]=r;
                m[5][m[3]++]=num(0);
                break;

                case 28: /* NEXT */
                i = cint(m[5][m[3] - 1][1]);
                o = (m[5][m[3] - 2][2]);
                if (i >= o[5])
                pc = t;
                else
                {
                    m[5][m[3] - 1] = num(i + 1);
                    m[5][m[3]++]=get(o, keynum(m, i));
                }
                break;

                case 29: /* CATCH */
                hd = (f[7][t]);
                fr[4] = env(m, fr[4]);
                fr[4][4] = hd[0];
                fr[4][7] = hd[1];
                put(m, fr[4][5], hd[6], m[14]);
                m[14] = undefValue;
                m[13] = 0;
                break;

                default:
                die(m,"bad bytecode");
            }

        } catch (caught) {
            if(caught!==m[19])throw caught;
            m[7]=fr;
            m[2]=depth;
            var best=-1;
            for(i=0;i<f[11];i++)if(pc-1>=f[7][i][4]&&pc-1<f[7][i][7]&&(best<0||f[7][i][4]>=f[7][best][4]))best=i;
            if(best<0)throw caught;
            hd=f[7][best];
            pc=hd[0];
            m[3]=saved+2*hd[2];
            if(!m[13])m[14]=str(m,m[12]);
            m[13]=1;
        }
    }

    m[3] = saved;
    return undefValue;
}

function builtin(m,target,name,idn) {
    var o = obj(m, m[11]);
    var r = object(o);
    o[14] = idn;
    hidden(m, target, name, r);
    return r;
}

function init(m) {
    var g;
    var math;
    var o;
    var v;
    m[20] = 8192;
    m[0] = obj(m, 0);
    m[6] = obj(m, m[0]);
    m[6][9] = 1;
    m[11] = obj(m, m[0]);
    m[8] = obj(m, m[0]);
    m[9] = env(m, 0);
    g = m[9][5];
    g[10] = m[0];
    named(m, g, "undefined", undefValue);
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
    o = obj(m, m[0]);
    named(m, g, "console", object(o));
    builtin(m, o, "log", NPRINT);
    v = builtin(m, g, "Object", NOBJECT);
    hidden(m, (v[2]), "prototype", object(m[0]));
    hidden(m, m[0], "constructor", v);
    builtin(m, (v[2]), "keys", NKEYS);
    builtin(m, m[0], "hasOwnProperty", NHAS);
    builtin(m, m[0], "toString", NTOSTRING);
    builtin(m, (v[2]), "create", NCREATE);
    builtin(m, (v[2]), "getPrototypeOf", NGETPROTO);
    v = builtin(m, g, "Array", NARRAY);
    hidden(m, (v[2]), "prototype", object(m[6]));
    hidden(m, m[6], "constructor", v);
    builtin(m, (v[2]), "isArray", NISARRAY);
    v = builtin(m, g, "String", NSTRING);
    hidden(m, (v[2]), "prototype", object(m[8]));
    hidden(m, m[8], "constructor", v);
    builtin(m, g, "Number", NNUMBER);
    builtin(m, g, "Boolean", NBOOLEAN);
    builtin(m, m[11], "call", NCALL);
    builtin(m, m[11], "apply", NAPPLY);
    builtin(m, m[6], "shift", NSHIFT);
    builtin(m, m[6], "unshift", NUNSHIFT);
    builtin(m, m[6], "some", NSOME);
    builtin(m, m[6], "every", NEVERY);
    builtin(m, m[6], "push", NPUSH);
    builtin(m, m[6], "pop", NPOP);
    builtin(m, m[6], "join", NJOIN);
    builtin(m, m[6], "slice", NSLICE);
    builtin(m, m[6], "indexOf", NINDEX);
    builtin(m, m[6], "forEach", NFOREACH);
    builtin(m, m[6], "map", NMAP);
    builtin(m, m[6], "filter", NFILTER);
    builtin(m, m[6], "reduce", NREDUCE);
    builtin(m, m[6], "reverse", NREVERSE);
    builtin(m, m[6], "sort", NSORT);
    builtin(m, m[6], "concat", NCONCAT);
    builtin(m, m[8], "split", NSPLIT);
    builtin(m, m[8], "slice", NSLICE);
    builtin(m, m[8], "substring", NSUBSTRING);
    builtin(m, m[8], "indexOf", NINDEX);
    builtin(m, m[8], "charAt", NCHAR);
    builtin(m, m[8], "charCodeAt", NCHARCODE);
    builtin(m, m[8], "toLowerCase", NLOWER);
    builtin(m, m[8], "toUpperCase", NUPPER);
    builtin(m, m[8], "concat", NCONCAT);
    math = obj(m, m[0]);
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
    var m=[0,0,0,0,0,[],0,0,0,0,undefValue,0,'',0,undefValue,0,0,0,0,{},0,0,0,0,{},output,{},0];
    if(!output)m[25]=function(s){
        print(s);
    };
    init(m);
    return m;
}
function js_eval(m,source) {
    var f,fr;
    if(!m||m[7])return 0;
    m[21]=m[15];
    m[12]='';
    try {
        f=compile(m,source);
        fr=[object(m[9][5]),0,f,undefValue,m[9],0];
        m[7]=fr;
        run(m,f,m[9],fr[0],undefValue,0,0);
        m[7]=0;
        gc(m);
        return 1;
    }catch(caught) {
        if(caught!==m[19]&&caught!==m[24])throw caught;
        m[7]=0;
        m[14]=undefValue;
        m[10]=undefValue;
        m[13]=0;
        m[3]=0;
        m[2]=0;
        gc(m);
        return 0;
    }
}
function js_error(m){
    return m[12];
}
function js_set_budget(m,n){
    if(m&&!m[7])m[15]=n;
}
function js_register(m,name,callback,user){
    var v;
    if(!m||m[7]||!name||!callback)return 0;
    v=builtin(m,m[9][5],name,NHOST);
    v[2][15]=callback;
    v[2][16]=user;
    return 1;
}
function hostarg(m,i){
    return i>=0&&i<m[23]?m[5][m[22]+i]:undefValue;
}
function js_arg_type(m,i){
    return hostarg(m,i)[0];
}
function js_arg_number(m,i){
    return number(hostarg(m,i));
}
function js_arg_string(m,i){
    var v=hostarg(m,i);
    return v[0]===STR?chars(v):null;
}
function js_return_number(m,n){
    m[10]=num(n);
}
function js_return_boolean(m,n){
    m[10]=boolean(n);
}
function js_return_string(m,s,n){
    m[10]=strn(m,s,n);
}
function js_return_null(m){
    m[10]=val(NIL,0,0);
}
function js_free(m){
    m[16]=0;
    m[1]=0;
    m[18]=0;
    m[9]=0;
    m[0]=0;
    m[6]=0;
    m[11]=0;
    m[8]=0;
    m[5]=[];
    m[7]=0;
    m[17]=0;
}

/* JBC1 portable binary codec, using length-aware byte strings. */
var bcChars=asciiChars,bcIndex;
for(bcIndex=128;bcIndex<256;bcIndex++)bcChars+=byteChar(bcIndex);
function bcBytes(w,s){
    w[0]+=s;
    if(w[0].length>=4096)bcFlush(w);
}
function bcByte(w,n){
    bcBytes(w,bcChars.charAt(n&255));
}
function bcFlush(w){
    if(fwrite(w[1],w[0])!==w[0].length)throw 'bytecode write failed';
    w[0]='';
}
function bcWord(w,n){
    bcBytes(w,bcChars.charAt(n&255)+bcChars.charAt((n>>>8)&255)+bcChars.charAt((n>>>16)&255)+bcChars.charAt(n>>>24));
}
function bcValue(w,v){
    var i,d,e=0,hi;
    bcByte(w,v[0]);
    if(v[0]===STR){
        bcWord(w,slen(v));
        bcBytes(w,chars(v));
    }
    else if(v[0]===BOOL)bcByte(w,v[1]);
    else if(v[0]===NUM){
        d=v[1];
        if(d!==d){
            bcByte(w,3);
            return;
        }
        if(d>0&&d===d/2){
            bcByte(w,2);
            return;
        }
        if(d<0&&d===d/2){
            bcByte(w,4);
            return;
        }
        bcByte(w,d<0?1:0);
        d=Math.abs(d);
        if(d){
            while(d>=1){
                d=d/2;
                e++;
            }while(d<0.5){
                d=d*2;
                e--;
            }
        }
        d=d*9007199254740992;
        hi=Math.floor(d/4294967296);
        bcWord(w,e);
        bcWord(w,hi);
        bcWord(w,d-hi*4294967296);
    }
}
function bcFun(w,f){
    var i,h,ins;
    bcValue(w,f[6]);
    bcWord(w,f[8]);
    bcWord(w,f[9]);
    bcWord(w,f[10]);
    bcWord(w,f[11]);
    bcWord(w,f[1]);
    for(i=0;i<f[8];i++)bcValue(w,f[12][i]);
    for(i=0;i<f[9];i++)bcValue(w,f[5][i]);
    for(i=0;i<f[10];i++){
        bcValue(w,f[13][i]);
        bcFun(w,f[17][i]);
    }
    for(i=0;i<f[11];i++){
        h=f[7][i];
        bcWord(w,h[4]);
        bcWord(w,h[7]);
        bcWord(w,h[0]);
        bcWord(w,h[1]);
        bcWord(w,h[2]);
        bcValue(w,h[6]);
    }
    for(i=0;i<f[1];i++){
        ins=f[2][i];
        bcByte(w,ins[0]);
        bcWord(w,ins[1]);
        bcValue(w,ins[2]);
        if(ins[0]===CLOSURE)bcFun(w,ins[3]);
    }
}
function bcReadByte(r){
    if(r[1]>=r[4].length)throw 'truncated bytecode';
    return r[4].charCodeAt(r[1]++);
}
function bcReadWord(r){
    return bcReadByte(r)+bcReadByte(r)*256+bcReadByte(r)*65536+bcReadByte(r)*16777216;
}
function bcReadInt(r){
    return bcReadWord(r)|0;
}
function bcCount(r){
    var n=bcReadInt(r);
    if(n<0||n>1000000)throw 'invalid bytecode count';
    return n;
}
function bcReadValue(m,r){
    var t=bcReadByte(r),k,n,e,d;
    if(t===STR){
        n=bcCount(r);
        if(r[1]+n>r[4].length)throw 'truncated string';
        d=r[4].slice(r[1],r[1]+n);
        r[1]+=n;
        return str(m,d);
    }
    if(t===BOOL)return boolean(bcReadByte(r));
    if(t===NUM){
        k=bcReadByte(r);
        if(k===2)return num(1/0);
        if(k===3)return num(0/0);
        if(k===4)return num(-1/0);
        e=bcReadInt(r);
        d=bcReadWord(r)*4294967296+bcReadWord(r);
        d=d/9007199254740992;
        while(e>0){
            d=d*2;
            e--;
        }while(e<0){
            d=d/2;
            e++;
        }
        return num(k?-d:d);
    }
    if(t!==U&&t!==NIL)throw 'invalid value';
    return val(t,0,0);
}
function readHandler(m,r) {
    var start=bcCount(r),end=bcCount(r),target=bcCount(r),finish=bcCount(r),iter=bcCount(r),name=bcReadValue(m,r);
    return [target,finish,iter,0,start,0,name,end];
}
function readInstruction(m,r) {
    var op=bcReadByte(r),a=bcReadInt(r),v=bcReadValue(m,r);
    return [op,a,v,0];
}
function bcReadFun(m,r,depth){
    var f=fun(m),i,h,ins;
    if(depth>512)throw 'bytecode nesting limit';
    f[6]=bcReadValue(m,r);
    f[8]=bcCount(r);
    f[9]=f[14]=bcCount(r);
    f[10]=f[15]=bcCount(r);
    f[11]=bcCount(r);
    f[1]=f[4]=bcCount(r);
    for(i=0;i<f[8];i++)f[12][i]=bcReadValue(m,r);
    for(i=0;i<f[9];i++)f[5][i]=bcReadValue(m,r);
    for(i=0;i<f[10];i++){
        f[13][i]=bcReadValue(m,r);
        f[17][i]=bcReadFun(m,r,depth+1);
    }
    for(i=0;i<f[11];i++){
        h=readHandler(m,r);
        f[7][i]=h;
    }
    for(i=0;i<f[1];i++){
        ins=readInstruction(m,r);
        if(ins[0]===CLOSURE)ins[3]=bcReadFun(m,r,depth+1);
        f[2][i]=ins;
    }
    return f;
}
function bcLoad(m,s){
    var r=[0,4,0,0,s],f;
    if(s.slice(0,4)!=='JBC1')throw 'invalid magic';
    f=bcReadFun(m,r,0);
    if(r[1]!==s.length)throw 'trailing bytes';
    return f;
}
function bcCompile(source,path){
    var m=js_new(),f=compile(m,source),w=['JBC1',fopen(path,'wb')];
    if(!w[1])throw 'cannot open output';
    bcFun(w,f);
    bcFlush(w);
    if(fclose(w[1])!==0)throw 'close failed';
}
function bcRun(m,f){
    var fr=[object(m[9][5]),0,f,undefValue,m[9],0];
    m[7]=fr;
    run(m,f,m[9],fr[0],undefValue,0,0);
    m[7]=0;
    gc(m);
}
/* Only generic host services cross the interpreter boundary. */
function forward(m,name,fn){
    js_register(m,name,function(vm,argc){
        var a=[],i,v,r;
        for(i=0;i<argc;i++){
            v=hostarg(vm,i);a.push(v[0]===STR?chars(v):v[1]);
        }
        r=fn.apply(null,a);
        if(typeof r==='string')js_return_string(vm,r,r.length);
        else if(typeof r==='number')js_return_number(vm,r);
        return 1;
    },0);
}
function cliVM(args){
    var m=js_new(),a=arr(m),i;
    forward(m,'readFile',readFile);
    forward(m,'byteCharHost',byteCharHost);
    forward(m,'fopen',fopen);
    forward(m,'fclose',fclose);
    forward(m,'fgetc',fgetc);
    forward(m,'fputc',fputc);
    forward(m,'fread',fread);
    forward(m,'fwrite',fwrite);
    for(i=0;i<args.length;i++)append(m,a,str(m,args[i]));
    named(m,m[9][5],'scriptArgs',a);
    return m;
}
function cliMain(args){
    var m,f,i,j;
    if(args[0]==='-c'&&args.length===4&&args[2]==='-o'){
        bcCompile(readFile(args[1]),args[3]);
        return;
    }
    if(args[0]==='-b'&&args.length>=2){
        m=cliVM(args.slice(2));
        f=bcLoad(m,readFile(args[1]));
        bcRun(m,f);
        return;
    }
    if(args.length&&args[0]!=='-c'&&args[0]!=='-b'){
        for(i=1;i<args.length;i++)if(args[i].charAt(0)==='-')break;
        if(i<args.length){
            m=cliVM(args.slice(1));
            if(!js_eval(m,readFile(args[0])))throw js_error(m);
        }
        else {
            m=cliVM([]);
            for(j=0;j<args.length;j++)if(!js_eval(m,readFile(args[j])))throw js_error(m);
        }
        return;
    }
    throw 'usage: jsvm.js -c source -o output | -b bytecode [args...] | source [args...]';
}
if(typeof scriptArgs!=='undefined'&&scriptArgs.length)cliMain(scriptArgs);
