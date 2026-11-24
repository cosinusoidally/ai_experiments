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
