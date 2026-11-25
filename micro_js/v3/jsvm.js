/* Standalone ES5-style VM, with the same compiler and execution model as jsvm.c.
 * VM, Frame, Fun, Parser, Lexer and Handler use named fields.
 * Values, instructions and managed heap records use dense arrays with named
 * field indices to avoid the overhead of thousands of tiny hash tables.
 * VAL_NUM also carries the slot/index for LREF and AREF.
 * Literal case values in the dense switches are annotated with enum names:
 * the compiler's jump-table optimization requires numeric literal cases.
 */
// VALUE record
var VAL_TAG = 0,
    VAL_NUM = 1,
    VAL_CELL = 2;

// INSTRUCTION record
var INS_OP = 0,
    INS_ARG = 1,
    INS_VALUE = 2,
    INS_FN = 3;

// CELL record
var CELL_NEXT = 0,
    CELL_GRAY = 1,
    CELL_KIND = 2,
    CELL_MARK = 3;

// STRING record
var STR_TEXT = 4,
    STR_HASH = 5,
    STR_LEN = 6,
    STR_INDEX = 7;

// OBJECT record
var OBJ_CAP = 4,
    OBJ_LENGTH = 5,
    OBJ_DENSE_CAP = 6,
    OBJ_DENSE = 7,
    OBJ_TABLE = 8,
    OBJ_ARRAY = 9,
    OBJ_PROTO = 10,
    OBJ_FUN = 11,
    OBJ_SCOPE = 12,
    OBJ_COUNT = 13,
    OBJ_NATIVE = 14,
    OBJ_HOST = 15,
    OBJ_USER = 16;

// ENV record
var ENV_START = 4,
    ENV_VARS = 5,
    ENV_UP = 6,
    ENV_END = 7,
    ENV_SLOTS = 8;

// REFERENCE record
var REF_ENV = 4,
    REF_BASE = 5,
    REF_KEY = 6,
    REF_OBJ = 7;

// PROPERTY record
var PROP_NEXT = 0,
    PROP_VALUE = 1,
    PROP_HIDDEN = 2,
    PROP_HASH = 3,
    PROP_KEY = 4;

/* Faithful JavaScript port of the C engine. Standalone source. */
// Value tags
var U = 0,
    NIL = 1,
    BOOL = 2,
    NUM = 3,
    STR = 4,
    OBJ = 5,
    REF = 6,
    LREF = 7,
    AREF = 8;

// Heap cell kinds
var CSTR = 0,
    COBJ = 1,
    CENV = 2,
    CREF = 3;

// Lexer tokens
var KEND = 256,
    KID = 257,
    KNUM = 258,
    KSTR = 259,
    KEQ = 260,
    KNE = 261,
    KSE = 262,
    KSNE = 263,
    KLE = 264,
    KGE = 265,
    KAND = 266,
    KOR = 267,
    KINC = 268,
    KDEC = 269,
    KADD = 270,
    KSUB = 271,
    KMUL = 272,
    KDIV = 273,
    KMOD = 274,
    KSHL = 275,
    KSHR = 276,
    KUSHR = 277,
    KBA = 278,
    KBO = 279,
    KBX = 280,
    KVAR = 281,
    KFUNCTION = 282,
    KRETURN = 283,
    KIF = 284,
    KELSE = 285,
    KWHILE = 286,
    KFOR = 287,
    KDO = 288,
    KBREAK = 289,
    KCONTINUE = 290,
    KTRUE = 291,
    KFALSE = 292,
    KNULL = 293,
    KTHIS = 294,
    KNEW = 295,
    KTYPEOF = 296,
    KVOID = 297,
    KDELETE = 298,
    KIN = 299,
    KINSTANCE = 300,
    KTHROW = 301,
    KSWITCH = 302,
    KCASE = 303,
    KDEFAULT = 304,
    KTRY = 305,
    KCATCH = 306;

// Bytecode opcodes
var PUSH = 0,
    NAME = 1,
    GET = 2,
    PROP = 3,
    SET = 4,
    DUP = 5,
    DROP = 6,
    SWAP = 7,
    BIN = 8,
    UN = 9,
    INC = 10,
    JMP = 11,
    JF = 12,
    JT = 13,
    CALL = 14,
    NEW = 15,
    RET = 16,
    CLOSURE = 17,
    OBJECT = 18,
    ARRAY = 19,
    INIT = 20,
    HOLE = 21,
    THIS = 22,
    THROW = 23,
    TYPE = 24,
    DEL = 25,
    PRECALL = 26,
    ENUM = 27,
    NEXT = 28,
    CATCH = 29;

// Native functions
var NPRINT = 1,
    NARRAY = 2,
    NOBJECT = 3,
    NNUMBER = 4,
    NSTRING = 5,
    NBOOLEAN = 6,
    NPUSH = 7,
    NPOP = 8,
    NJOIN = 9,
    NSLICE = 10,
    NINDEX = 11,
    NCHAR = 12,
    NKEYS = 13,
    NHAS = 14,
    NISARRAY = 15,
    NFLOOR = 16,
    NCEIL = 17,
    NABS = 18,
    NMAX = 19,
    NMIN = 20,
    NSQRT = 21,
    NPOW = 22,
    NRANDOM = 23,
    NPARSE = 24,
    NISNAN = 25,
    NCALL = 26,
    NAPPLY = 27,
    NFOREACH = 28,
    NMAP = 29,
    NFILTER = 30,
    NREDUCE = 31,
    NREVERSE = 32,
    NCONCAT = 33,
    NCHARCODE = 34,
    NSUBSTRING = 35,
    NLOWER = 36,
    NUPPER = 37,
    NASSERT = 38,
    NCREATE = 39,
    NGETPROTO = 40,
    NTOSTRING = 41,
    NSHIFT = 42,
    NUNSHIFT = 43,
    NSPLIT = 44,
    NSORT = 45,
    NSOME = 46,
    NEVERY = 47,
    NHOST = 48;
/* Faithful record-level port of js.c. Guest objects are not host objects:
 * their properties live in explicitly chained hash buckets. Null pointers are 0.
 * Opcode, token and native function IDs match the C enums. */
var INT_MAX = 2147483647, INT_MIN = -2147483648;
function cint(n) {
    return n < 0 ? Math.ceil(n) : Math.floor(n);
}
function val(t, n, p) {
    return [t, n, p];
}
var undefValue = [U, 0, 0], trueValue = [BOOL, 1, 0], falseValue = [BOOL, 0, 0];
var smallNumbers = [], smallIndex;
for (smallIndex = 0; smallIndex < 256; smallIndex++) {
    smallNumbers[smallIndex] = [NUM, smallIndex, 0];
}
function num(n) {
    return n >= 0 && n < 256 && n === (n | 0) ? smallNumbers[n] : [NUM, n, 0];
}
function boolean(n) {
    return n ? trueValue : falseValue;
}
function object(o) {
    return [OBJ, 0, o];
}
function die(m, s) {
    m.error = s.slice(0, 250);
    m.thrown = 0;
    throw m.signal;
}
function cell(m, c) {
    m.heap = c;
    m.live++;
    return c;
}
function strn(m, s, n) {
    return str(m, s.slice(0, n));
}
function str(m, s) {
    var p, v, k;
    if (s.length <= 32) {
        k = '$' + s;
        v = m.weakStrings[k];
        if (v !== undefined) {
            return v;
        }
    }
    p = cell(m, [
        m.heap, // next
        0, // gray
        CSTR, // kind
        0, // mark
        s, // text
        0, // hash
        s.length, // length
        0 // numeric index
    ]);
    v = [STR, 0, p];
    if (k !== undefined) {
        if (m.weakCount++ >= 512) {
            m.weakStrings = {};
            m.weakCount = 1;
        }
        m.weakStrings[k] = v;
    }
    return v;
}
function chars(v) {
    return v[VAL_CELL][STR_TEXT];
}
function slen(v) {
    return v[VAL_CELL][STR_LEN];
}
function seq(a, b) {
    return a[VAL_CELL] === b[VAL_CELL] || chars(a) === chars(b);
}
function hash(s) {
    var p = s[VAL_CELL], h = p[STR_HASH], i, k;
    if (h) {
        return h;
    }
    h = 5381;
    k = p[STR_TEXT];
    for (i = 0; i < p[STR_LEN]; i++) {
        h = (h * 33 + k.charCodeAt(i)) >>> 0;
    }
    p[STR_HASH] = h;
    return h;
}
function iskey(k, s) {
    return k[VAL_CELL][STR_TEXT] === s;
}
function obj(m, proto) {
    return cell(m, [
        m.heap, // next
        0, // gray
        COBJ, // kind
        0, // mark
        0, // hash capacity
        0, // length
        0, // dense capacity
        0, // dense elements
        [], // hash table
        0, // is array
        proto, // prototype
        0, // function
        0, // scope
        0, // property count
        0, // native ID
        0, // host callback
        0 // host data
    ]);
}
function env(m, up) {
    var vars = obj(m, 0);
    return cell(m, [
        m.heap, // next
        0, // gray
        CENV, // kind
        0, // mark
        0, // catch start
        vars, // variable object
        up, // parent environment
        0, // catch end
        0 // local slots
    ]);
}
function own(o, k) {
    var h = hash(k), p;
    if (!o[OBJ_CAP]) {
        return 0;
    }
    for (p = o[OBJ_TABLE][h % o[OBJ_CAP]]; p; p = p[PROP_NEXT]) {
        if (p[PROP_HASH] === h && (p[PROP_KEY][VAL_CELL] === k[VAL_CELL] || p[PROP_KEY][VAL_CELL][STR_TEXT] === k[VAL_CELL][STR_TEXT])) {
            return p;
        }
    }
    return 0;
}
function resize(m, o) {
    var i, n = o[OBJ_CAP] ? o[OBJ_CAP] * 2 : 8, t = [], p, q;
    for (i = 0; i < n; i++) {
        t[i] = 0;
    }
    for (i = 0; i < o[OBJ_CAP]; i++) {
        for (p = o[OBJ_TABLE][i]; p; p = q) {
            q = p[PROP_NEXT];
            p[PROP_NEXT] = t[p[PROP_HASH] % n];
            t[p[PROP_HASH] % n] = p;
        }
    }
    o[OBJ_TABLE] = t;
    o[OBJ_CAP] = n;
}
function indexof(k) {
    var p = k[VAL_CELL], s = p[STR_TEXT], n = 0, i, c;
    if (p[STR_INDEX]) {
        return p[STR_INDEX] - 2;
    }
    if (!p[STR_LEN] || (s.charAt(0) === '0' && p[STR_LEN] > 1)) {
        p[STR_INDEX] = 1;
        return -1;
    }
    for (i = 0; i < p[STR_LEN]; i++) {
        c = s.charCodeAt(i);
        if (c < 48 || c > 57 || n > 214748363) {
            p[STR_INDEX] = 1;
            return -1;
        }
        n = n * 10 + c - 48;
    }
    p[STR_INDEX] = n + 2;
    return n;
}
var holeValue = [-1, 0, 0];
function denseindex(o, k) {
    if (!o[OBJ_ARRAY]) {
        return -1;
    }
    var i = indexof(k);
    return i >= 0 && i < o[OBJ_DENSE_CAP] ? i : -1;
}
function ownkey(o, k) {
    var i = denseindex(o, k);
    return (i >= 0 && o[OBJ_DENSE][i][VAL_TAG] !== -1) || own(o, k) !== 0;
}
function del(o, k) {
    var p, q = 0, j, i = denseindex(o, k);
    if (i >= 0) {
        o[OBJ_DENSE][i] = holeValue;
    }
    if (!o[OBJ_CAP]) {
        return 1;
    }
    j = hash(k) % o[OBJ_CAP];
    for (p = o[OBJ_TABLE][j]; p; q = p, p = p[PROP_NEXT]) {
        if (seq(p[PROP_KEY], k)) {
            if (q) {
                q[PROP_NEXT] = p[PROP_NEXT];
            }
            else {
                o[OBJ_TABLE][j] = p[PROP_NEXT];
            }
            o[OBJ_COUNT]--;
            return 1;
        }
    }
    return 1;
}
function denseput(m, o, i, k, v) {
    var n, j;
    if (i >= o[OBJ_LENGTH] && i < INT_MAX) {
        o[OBJ_LENGTH] = i + 1;
    }
    if (i < o[OBJ_DENSE_CAP] && o[OBJ_DENSE][i][VAL_TAG] !== -1) {
        o[OBJ_DENSE][i] = v;
        return 1;
    }
    if (i > (o[OBJ_DENSE_CAP] ? o[OBJ_DENSE_CAP] : 3) || (o[OBJ_COUNT] && own(o, k))) {
        return 0;
    }
    if (i >= o[OBJ_DENSE_CAP]) {
        n = o[OBJ_DENSE_CAP] ? o[OBJ_DENSE_CAP] * 2 : 4;
        if (!o[OBJ_DENSE]) {
            o[OBJ_DENSE] = [];
        }
        for (j = o[OBJ_DENSE_CAP]; j < n; j++) {
            o[OBJ_DENSE][j] = holeValue;
        }
        o[OBJ_DENSE_CAP] = n;
    }
    o[OBJ_DENSE][i] = v;
    return 1;
}
function put(m, o, k, v) {
    var p, i, j, q, nextp, n;
    if (o[OBJ_ARRAY]) {
        if (iskey(k, 'length')) {
            if (v[VAL_TAG] !== NUM || !(v[VAL_NUM] >= 0 && v[VAL_NUM] <= INT_MAX) || v[VAL_NUM] !== cint(v[VAL_NUM])) {
                die(m, 'invalid array length');
            }
            o[OBJ_LENGTH] = v[VAL_NUM];
            if (!o[OBJ_LENGTH]) {
                o[OBJ_DENSE] = 0;
                o[OBJ_DENSE_CAP] = 0;
            }
            else {
                n = o[OBJ_DENSE_CAP];
                while (n > 4 && o[OBJ_LENGTH] <= n / 4) {
                    n /= 2;
                }
                if (n < o[OBJ_DENSE_CAP]) {
                    o[OBJ_DENSE].length = n;
                    o[OBJ_DENSE_CAP] = n;
                }
                for (j = o[OBJ_LENGTH]; j < o[OBJ_DENSE_CAP]; j++) {
                    o[OBJ_DENSE][j] = holeValue;
                }
            }
            for (j = 0; j < o[OBJ_CAP]; j++) {
                q = 0;
                p = o[OBJ_TABLE][j];
                while (p) {
                    nextp = p[PROP_NEXT];
                    i = indexof(p[PROP_KEY]);
                    if (i >= o[OBJ_LENGTH]) {
                        if (q) {
                            q[PROP_NEXT] = nextp;
                        }
                        else {
                            o[OBJ_TABLE][j] = nextp;
                        }
                        o[OBJ_COUNT]--;
                    }
                    else {
                        q = p;
                    }
                    p = nextp;
                }
            }
            return;
        }
        i = indexof(k);
        if (i >= 0 && denseput(m, o, i, k, v)) {
            return;
        }
    }
    p = own(o, k);
    if (!p) {
        if (o[OBJ_COUNT] >= o[OBJ_CAP] * 2 || !o[OBJ_CAP]) {
            resize(m, o);
        }
        p = [0, undefValue, 0, hash(k), k];
        j = p[PROP_HASH] % o[OBJ_CAP];
        p[PROP_NEXT] = o[OBJ_TABLE][j];
        o[OBJ_TABLE][j] = p;
        o[OBJ_COUNT]++;
    }
    p[PROP_VALUE] = v;
}
function nanval() {
    return 0 / 0;
}
function whitespace(c) {
    return c === 32 || (c >= 9 && c <= 13);
}
function trimASCII(s) {
    var a = 0, b = s.length;
    while (a < b && whitespace(s.charCodeAt(a))) {
        a++;
    }
    while (b > a && whitespace(s.charCodeAt(b - 1))) {
        b--;
    }
    return s.slice(a, b);
}
function number(v) {
    var s;
    switch (v[VAL_TAG]) {
        case 3: /* NUM */
        case 2: /* BOOL */
            return v[VAL_NUM];
        case 1: /* NIL */
            return 0;
        case 4: /* STR */
            s = trimASCII(chars(v));
            return s.length ? Number(s) : 0;
        default:
            return nanval();
    }
}
function tostring(m, v) {
    switch (v[VAL_TAG]) {
        case 4: /* STR */
            return v;
        case 0: /* U */
            return str(m, 'undefined');
        case 1: /* NIL */
            return str(m, 'null');
        case 2: /* BOOL */
            return str(m, v[VAL_NUM] ? 'true' : 'false');
        case 3: /* NUM */
            if (v[VAL_NUM] !== v[VAL_NUM]) {
                return str(m, 'NaN');
            }
            if (v[VAL_NUM] === 0) {
                return str(m, '0');
            }
            if (v[VAL_NUM] === 1 / 0) {
                return str(m, 'inf');
            }
            if (v[VAL_NUM] === -1 / 0) {
                return str(m, '-inf');
            }
            return str(m, String(v[VAL_NUM]));
        default:
            return str(m, '[object Object]');
    }
}
function mark(m, c) {
    if (c && !c[CELL_MARK]) {
        c[CELL_MARK] = 1;
        c[CELL_GRAY] = m.gray;
        m.gray = c;
    }
}
function mv(m, v) {
    if (v[VAL_CELL]) {
        mark(m, v[VAL_CELL]);
    }
}
function gc(m) {
    var c, f, r, i, prev, nextp;
    mv(m, m.exception);
    mark(m, m.global);
    mark(m, m.op);
    mark(m, m.ap);
    mark(m, m.fp);
    mark(m, m.sp);
    for (i = 0; i < m.top; i++) {
        mv(m, m.stack[i]);
    }
    for (r = m.frame; r; r = r.prev) {
        mark(m, r.env);
        mv(m, r.self);
        mv(m, r.callee);
        markfun(m, r.code);
    }
    while (m.gray) {
        c = m.gray;
        m.gray = c[CELL_GRAY];
        c[CELL_GRAY] = 0;
        scan(m, c);
    }
    m.weakStrings = {};
    m.weakCount = 0;
    prev = 0;
    c = m.heap;
    while (c) {
        nextp = c[CELL_NEXT];
        if (!c[CELL_MARK]) {
            if (prev) {
                prev[CELL_NEXT] = nextp;
            }
            else {
                m.heap = nextp;
            }
            c[CELL_NEXT] = 0;
            m.live--;
        }
        else {
            c[CELL_MARK] = 0;
            prev = c;
        }
        c = nextp;
    }
    prev = 0;
    f = m.funs;
    while (f) {
        nextp = f.next;
        if (!f.mark) {
            if (prev) {
                prev.next = nextp;
            }
            else {
                m.funs = nextp;
            }
            f.next = 0;
        }
        else {
            f.mark = 0;
            prev = f;
        }
        f = nextp;
    }
    m.threshold = m.live * 2 + 8192;
    /* JS owns physical memory, but the guest heap/fun lists above are swept
       explicitly. Drop stale operand roots that the C GC would not trace. */
    m.stack.length = m.top;
}
function syntax(p, s) {
    die(p.m, 'line ' + p.l.line + ': ' + s);
}
function ident(c) {
    return c >= 128 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
}
function digit(c) {
    return c >= 48 && c <= 57;
}
function hex(c) {
    if (digit(c)) {
        return c - 48;
    }
    if (c >= 97 && c <= 102) {
        return c - 87;
    }
    if (c >= 65 && c <= 70) {
        return c - 55;
    }
    return -1;
}
/* Build byte characters without needing String.fromCharCode in the C host.
   The C host exposes bytes of UTF-8, whereas Node exposes UTF-16. */
var asciiChars = "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\x7f";
function byteChar(c) {
    if (c < 128) {
        return asciiChars.charAt(c);
    }
    if (typeof byteCharHost === "function") {
        return byteCharHost(c);
    }
    /* The port's verified domain is ASCII source/string escapes. */
    if (typeof String.fromCharCode === 'function') {
        return String.fromCharCode(c);
    }
    return '?';
}
var keywords = ['var', 'function', 'return', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'true', 'false', 'null', 'this', 'new', 'typeof', 'void', 'delete', 'in', 'instanceof', 'throw', 'switch', 'case', 'default', 'try', 'catch'];
var keywordMap = {}, kwIndex;
for (kwIndex = 0; kwIndex < keywords.length; kwIndex++) {
    keywordMap["$" + keywords[kwIndex]] = KVAR + kwIndex;
}
var operators = ["==", "!=", "===", "!==", "<=", ">=", "&&", "||", "++", "--",
    "+=", "-=", "*=", "/=", "%=", "<<", ">>", ">>>", "&=", "|=", "^="];
var operatorMap = {}, operatorIndex;
for (operatorIndex = 0; operatorIndex < operators.length; operatorIndex++) {
    operatorMap[operators[operatorIndex]] = KEQ + operatorIndex;
}
var charClass = [], ci;
for (ci = 0; ci < 256; ci++) {
    charClass[ci] = whitespace(ci) ? 1 : digit(ci) ? 2 : ident(ci) ? 3 : 0;
}
function next(p) {
    var l = p.l, s = l.s, pos = l.pos, a, b, c, q, i, j, h, escaped, d, ep;
    l.previous = l.line;
    for (;;) {
        while (charClass[s.charCodeAt(pos)] === 1) {
            if ((s.charCodeAt(pos) || 0) === 10) {
                l.line++;
            }
            pos++;
        }
        if (s.slice(pos, pos + 2) === '//') {
            while ((s.charCodeAt(pos) || 0) && (s.charCodeAt(pos) || 0) !== 10) {
                pos++;
            }
            continue;
        }
        if (s.slice(pos, pos + 2) === '/*') {
            pos += 2;
            while ((s.charCodeAt(pos) || 0) && s.slice(pos, pos + 2) !== '*/') {
                if ((s.charCodeAt(pos) || 0) === 10) {
                    l.line++;
                }
                pos++;
            }
            if (!(s.charCodeAt(pos) || 0)) {
                syntax(p, 'unterminated comment');
            }
            pos += 2;
            continue;
        }
        break;
    }
    l.v = undefValue;
    c = (s.charCodeAt(pos) || 0);
    if (!c) {
        l.t = KEND;
        l.pos = pos;
        return;
    }
    a = pos++;
    l.t = c;
    if (charClass[c] === 2 || (c === 46 && (charClass[s.charCodeAt(pos)] === 2))) {
        if (c === 48 && ((s.charCodeAt(pos) || 0) === 120 || (s.charCodeAt(pos) || 0) === 88)) {
            d = 0;
            pos++;
            if (hex((s.charCodeAt(pos) || 0)) < 0) {
                syntax(p, 'bad hex literal');
            }
            while ((h = hex((s.charCodeAt(pos) || 0))) >= 0) {
                d = d * 16 + h;
                pos++;
            }
            l.v = num(d);
        }
        else {
            pos = a;
            while ((charClass[s.charCodeAt(pos)] === 2)) {
                pos++;
            }
            if ((s.charCodeAt(pos) || 0) === 46) {
                pos++;
                while ((charClass[s.charCodeAt(pos)] === 2)) {
                    pos++;
                }
            }
            if ((s.charCodeAt(pos) || 0) === 101 || (s.charCodeAt(pos) || 0) === 69) {
                ep = pos++;
                if ((s.charCodeAt(pos) || 0) === 43 || (s.charCodeAt(pos) || 0) === 45) {
                    pos++;
                }
                if (!(charClass[s.charCodeAt(pos)] === 2)) {
                    pos = ep;
                }
                else {
                    while ((charClass[s.charCodeAt(pos)] === 2)) {
                        pos++;
                    }
                }
            }
            l.v = num(Number(s.slice(a, pos)));
        }
        l.t = KNUM;
    }
    else if (charClass[c] >= 2) {
        while (charClass[s.charCodeAt(pos)] >= 2) {
            pos++;
        }
        l.v = str(p.m, s.slice(a, pos));
        l.t = KID;
        i = keywordMap["$" + l.v[VAL_CELL][STR_TEXT]];
        if (i !== undefined) {
            l.t = i;
        }
    }
    else if (c === 39 || c === 34) {
        q = c;
        b = '';
        while ((s.charCodeAt(pos) || 0) && (s.charCodeAt(pos) || 0) !== q) {
            escaped = 0;
            c = (s.charCodeAt(pos++) || 0);
            if (c === 10 || c === 13) {
                syntax(p, 'unterminated string');
            }
            if (c === 92) {
                escaped = 1;
                if (!(s.charCodeAt(pos) || 0)) {
                    syntax(p, 'unterminated escape');
                }
                c = (s.charCodeAt(pos++) || 0);
                i = "nrtbfv0".indexOf(s.charAt(pos - 1));
                if (i >= 0) {
                    c = "\n\r\t\b\f\v\x00".charCodeAt(i);
                }
                else {
                    switch (c) {
                        case 10:
                            l.line++;
                            continue;
                        case 120:
                        case 117:
                            j = c === 120 ? 2 : 4;
                            c = 0;
                            for (i = 0; i < j; i++) {
                                h = hex((s.charCodeAt(pos) || 0));
                                if (h < 0) {
                                    syntax(p, 'bad escape');
                                }
                                pos++;
                                c = c * 16 + h;
                            }
                            break;
                        default:
                            break;
                    }
                }
            }
            if (!escaped && c >= 128) {
                b += s.charAt(pos - 1);
            }
            else if (c < 128) {
                b += byteChar(c);
            }
            else if (c < 2048) {
                b += byteChar(192 | (c >> 6)) + byteChar(128 | (c & 63));
            }
            else {
                b += byteChar(224 | (c >> 12)) + byteChar(128 | ((c >> 6) & 63)) + byteChar(128 | (c & 63));
            }
        }
        if (!(s.charCodeAt(pos) || 0)) {
            syntax(p, 'unterminated string');
        }
        pos++;
        l.v = str(p.m, b);
        l.t = KSTR;
    }
    else {
        i = operatorMap[s.slice(a, pos + 1)];
        if (i !== undefined) {
            pos++;
            if (i === KEQ || i === KNE || i === KSHR) {
                j = operatorMap[s.slice(a, pos + 1)];
                if (j !== undefined) {
                    i = j;
                    pos++;
                }
            }
            l.t = i;
        }
    }
    l.pos = pos;
}
function fun(m) {
    var f = {
        next: m.funs, n: 0, code: [], mark: 0, cap: 0, vars: [], name: undefValue, handlers: [], argc: 0, nv: 0, nh: 0, nhd: 0, params: [], names: [], cv: 0, ch: 0, cache: 0, hoist: [], needsargs: 0, reusable: 0
    };
    m.funs = f;
    return f;
}
function emit(p, op, a, v) {
    var f = p.f;
    if (f.n === f.cap) {
        f.cap = f.cap ? f.cap * 2 : 64;
    }
    f.code[f.n] = [op, a, v, 0];
    return f.n++;
}
function variable(p, v) {
    var f = p.f;
    if (f.nv === f.cv) {
        f.cv = f.cv ? 2 * f.cv : 8;
    }
    f.vars[f.nv++] = v;
}
function hoist(p, name, f) {
    var g = p.f;
    if (g.nh === g.ch) {
        g.ch = g.ch ? 2 * g.ch : 8;
    }
    g.names[g.nh] = name;
    g.hoist[g.nh++] = f;
}
function forin(p) {
    var l = p.l, saved = {
        t: l.t, pos: l.pos, v: l.v, line: l.line, s: l.s, previous: l.previous
    }, yes;
    if (p.l.t === KVAR) {
        next(p);
    }
    if (p.l.t !== KID) {
        p.l = saved;
        return 0;
    }
    next(p);
    yes = p.l.t === KIN;
    p.l = saved;
    return yes;
}
function compile(m, s) {
    var p = {
        l: {
            t: 0, pos: 0, v: undefValue, line: 1, s: s, previous: 0
        }, f: fun(m), depth: 0, loop: 0, m: m, iters: 0, serial: 0
    };
    next(p);
    while (p.l.t !== KEND) {
        stmt(p);
    }
    out(p, PUSH, 0);
    out(p, RET, 0);
    return p.f;
}
function push(m, v) {
    m.stack[m.top++] = v;
}
function bits(d) {
    return d >>> 0;
}
function signedbits(u) {
    return u | 0;
}
function binary(m, t, a, b) {
    var x, y, u, v, s, o, c;
    if (t === KEQ || t === KNE || t === KSE || t === KSNE) {
        return boolean(equal(a, b, t === KSE || t === KSNE) ^ (t === KNE || t === KSNE));
    }
    if (t === KIN) {
        if (b[VAL_TAG] !== OBJ) {
            die(m, 'in requires object');
        }
        return boolean(has(b[VAL_CELL], tostring(m, a)));
    }
    if (t === KINSTANCE) {
        if (!callable(b)) {
            die(m, 'instanceof requires function');
        }
        s = property(m, b, str(m, 'prototype'));
        if (s[VAL_TAG] !== OBJ) {
            die(m, 'invalid prototype');
        }
        if (a[VAL_TAG] !== OBJ) {
            return boolean(0);
        }
        for (o = a[VAL_CELL][OBJ_PROTO]; o; o = o[OBJ_PROTO]) {
            if (o === s[VAL_CELL]) {
                return boolean(1);
            }
        }
        return boolean(0);
    }
    if (t === 43 && (a[VAL_TAG] === STR || b[VAL_TAG] === STR || a[VAL_TAG] === OBJ || b[VAL_TAG] === OBJ)) {
        return str(m, chars(tostring(m, a)) + chars(tostring(m, b)));
    }
    if (a[VAL_TAG] === STR && b[VAL_TAG] === STR && (t === 60 || t === 62 || t === KLE || t === KGE)) {
        x = chars(a);
        y = chars(b);
        return boolean(t === 60 ? x < y : t === 62 ? x > y : t === KLE ? x <= y : x >= y);
    }
    x = a[VAL_TAG] === NUM ? a[VAL_NUM] : number(a);
    y = b[VAL_TAG] === NUM ? b[VAL_NUM] : number(b);
    switch (t) {
        case 43 /* "+" */:
            return num(x + y);
        case 45 /* "-" */:
            return num(x - y);
        case 42 /* "*" */:
            return num(x * y);
        case 47 /* "/" */:
            return num(x / y);
        case 37 /* "%" */:
            return num(x % y);
        case 60 /* "<" */:
            return boolean(x < y);
        case 62 /* ">" */:
            return boolean(x > y);
        case KLE:
            return boolean(x <= y);
        case KGE:
            return boolean(x >= y);
        case 38 /* "&" */:
            return num(x & y);
        case 124 /* "|" */:
            return num(x | y);
        case 94 /* "^" */:
            return num(x ^ y);
        case KSHL:
            return num(x << y);
        case KUSHR:
            return num(x >>> y);
        case KSHR:
            return num(x >> y);
        default:
            die(m, 'unknown operator');
    }
    return undefValue;
}
function get(o, k) {
    var p, i;
    for (; o; o = o[OBJ_PROTO]) {
        if (o[OBJ_ARRAY]) {
            if (iskey(k, "length")) {
                return num(o[OBJ_LENGTH]);
            }
            i = indexof(k);
            if (i >= 0 && i < o[OBJ_DENSE_CAP] && o[OBJ_DENSE][i][VAL_TAG] !== -1) {
                return o[OBJ_DENSE][i];
            }
        }
        p = own(o, k);
        if (p) {
            return p[PROP_VALUE];
        }
    }
    return undefValue;
}
function has(o, k) {
    for (; o; o = o[OBJ_PROTO]) {
        if (ownkey(o, k) || (o[OBJ_ARRAY] && iskey(k, "length"))) {
            return 1;
        }
    }
    return 0;
}
function named(m, o, k, v) {
    put(m, o, str(m, k), v);
}
function hidden(m, o, k, v) {
    var key = str(m, k);
    put(m, o, key, v);
    own(o, key)[PROP_HIDDEN] = 1;
}
function binding(e, k) {
    var p;
    for (; e; e = e[ENV_UP]) {
        p = own(e[ENV_VARS], k);
        if (p) {
            return p;
        }
    }
    return 0;
}
function lookup(m, e, k) {
    var p = binding(e, k);
    if (!p) {
        die(m, "undefined identifier");
    }
    return p[PROP_VALUE];
}
function truth(v) {
    switch (v[VAL_TAG]) {
        case 0: /* U */
        case 1: /* NIL */
            return 0;
        case 3: /* NUM */
        case 2: /* BOOL */
            return (v[VAL_NUM] != 0) && (v[VAL_NUM] == v[VAL_NUM]);
        case 4: /* STR */
            return slen(v) != 0;
        default:
            return 1;
    }
}
function property(m, b, k) {
    var i, o;
    if (k[VAL_TAG] === NUM && k[VAL_NUM] >= 0 && k[VAL_NUM] <= INT_MAX && k[VAL_NUM] === Math.floor(k[VAL_NUM])) {
        i = k[VAL_NUM];
        if (b[VAL_TAG] === OBJ) {
            o = b[VAL_CELL];
            if (i < o[OBJ_DENSE_CAP] && o[OBJ_DENSE][i][VAL_TAG] !== -1) {
                return o[OBJ_DENSE][i];
            }
        }
        if (b[VAL_TAG] === STR && i < b[VAL_CELL][STR_LEN]) {
            return str(m, b[VAL_CELL][STR_TEXT].charAt(i));
        }
    }
    if (k[VAL_TAG] !== STR) {
        k = tostring(m, k);
    }
    if (b[VAL_TAG] == OBJ) {
        return get((b[VAL_CELL]), k);
    }
    if (b[VAL_TAG] == STR) {
        if (iskey(k, "length")) {
            return num((slen(b)));
        }
        i = indexof(k);
        if ((i >= 0) && (((i)) < slen(b))) {
            return strn(m, chars(b).slice(i), 1);
        }
        return get(m.sp, k);
    }
    if ((b[VAL_TAG] == U) || (b[VAL_TAG] == NIL)) {
        die(m, "property access on null/undefined");
    }
    return undefValue;
}
function reference(m, e, b, k) {
    var r = cell(m, [
        m.heap, // next
        0, // gray
        CREF, // kind
        0, // mark
        e, // environment
        b, // base value
        k, // key
        b[VAL_TAG] === OBJ ? b[VAL_CELL] : 0 // object
    ]);
    return [REF, 0, r];
}
function readval(m, v) {
    var r;
    if (v[VAL_TAG] === LREF) {
        return v[VAL_CELL][ENV_SLOTS][v[VAL_NUM]][PROP_VALUE];
    }
    if (v[VAL_TAG] === AREF) {
        return property(m, object(v[VAL_CELL]), num(v[VAL_NUM]));
    }
    if (v[VAL_TAG] !== REF) {
        return v;
    }
    r = v[VAL_CELL];
    if (r[REF_ENV]) {
        return lookup(m, r[REF_ENV], r[REF_KEY]);
    }
    return property(m, r[REF_BASE], r[REF_KEY]);
}
function store(m, v, x) {
    var r;
    var e;
    if (v[VAL_TAG] === LREF) {
        v[VAL_CELL][ENV_SLOTS][v[VAL_NUM]][PROP_VALUE] = x;
        return;
    }
    if (v[VAL_TAG] === AREF) {
        var o = v[VAL_CELL], k = o[OBJ_COUNT] ? tostring(m, num(v[VAL_NUM])) : undefValue;
        if (!denseput(m, o, v[VAL_NUM], k, x)) {
            put(m, o, tostring(m, num(v[VAL_NUM])), x);
        }
        return;
    }
    if (v[VAL_TAG] != REF) {
        die(m, "invalid assignment");
    }
    r = (v[VAL_CELL]);
    if (r[REF_ENV]) {
        e = binding(r[REF_ENV], r[REF_KEY]);
        if (e) {
            e[PROP_VALUE] = x;
        }
        else {
            put(m, m.global[ENV_VARS], r[REF_KEY], x);
        }
    }
    else if (r[REF_OBJ]) {
        put(m, r[REF_OBJ], r[REF_KEY], x);
    }
    else if ((r[REF_BASE][VAL_TAG] == U) || (r[REF_BASE][VAL_TAG] == NIL)) {
        die(m, "invalid property assignment");
    }
}
function equal(a, b, strict) {
    if (a[VAL_TAG] == b[VAL_TAG]) {
        switch (a[VAL_TAG]) {
            case 0: /* U */
            case 1: /* NIL */
                return 1;
            case 4: /* STR */
                return seq(a, b);
            case 5: /* OBJ */
                return a[VAL_CELL] == b[VAL_CELL];
            default:
                return a[VAL_NUM] == b[VAL_NUM];
        }
    }
    if (strict) {
        return 0;
    }
    if (((a[VAL_TAG] == U) || (a[VAL_TAG] == NIL)) && ((b[VAL_TAG] == U) || (b[VAL_TAG] == NIL))) {
        return 1;
    }
    if (a[VAL_TAG] == BOOL) {
        a = num(a[VAL_NUM]);
    }
    if (b[VAL_TAG] == BOOL) {
        b = num(b[VAL_NUM]);
    }
    if (((a[VAL_TAG] == STR) && (b[VAL_TAG] == NUM)) || ((a[VAL_TAG] == NUM) && (b[VAL_TAG] == STR))) {
        return number(a) == number(b);
    }
    if ((a[VAL_TAG] == NUM) && (b[VAL_TAG] == NUM)) {
        return a[VAL_NUM] == b[VAL_NUM];
    }
    return 0;
}
function markfun(m, f) {
    var i;
    if ((!f) || f.mark) {
        return;
    }
    f.mark = 1;
    mark(m, f.cache);
    mv(m, f.name);
    for (i = 0; i < f.n; i++) {
        mv(m, f.code[i][INS_VALUE]);
        markfun(m, f.code[i][INS_FN]);
    }
    for (i = 0; i < f.nhd; i++) {
        mv(m, f.handlers[i].name);
    }
    for (i = 0; i < f.argc; i++) {
        mv(m, f.params[i]);
    }
    for (i = 0; i < f.nv; i++) {
        mv(m, f.vars[i]);
    }
    for (i = 0; i < f.nh; i++) {
        mv(m, f.names[i]);
        markfun(m, f.hoist[i]);
    }
}
function scan(m, c) {
    var i;
    var p;
    var o;
    var e;
    var r;
    switch (c[CELL_KIND]) {
        case 1: /* COBJ */
            o = (c);
            mark(m, (o[OBJ_PROTO]));
            mark(m, (o[OBJ_SCOPE]));
            markfun(m, o[OBJ_FUN]);
            for (i = 0; i < o[OBJ_DENSE_CAP]; i++) {
                mv(m, o[OBJ_DENSE][i]);
            }
            for (i = 0; i < o[OBJ_CAP]; i++) {
                for (p = o[OBJ_TABLE][i]; p; p = p[PROP_NEXT]) {
                    mv(m, p[PROP_KEY]);
                    mv(m, p[PROP_VALUE]);
                }
            }
            break;
        case 2: /* CENV */
            e = (c);
            mark(m, (e[ENV_UP]));
            mark(m, (e[ENV_VARS]));
            break;
        case 3: /* CREF */
            r = (c);
            mark(m, (r[REF_ENV]));
            mv(m, r[REF_BASE]);
            mv(m, r[REF_KEY]);
            break;
        default:
            break;
    }
}
function accept(p, t) {
    if (p.l.t != t) {
        return 0;
    }
    next(p);
    return 1;
}
function need(p, t) {
    if (!accept(p, t)) {
        syntax(p, "unexpected token");
    }
}
function id(p) {
    var v = p.l.v;
    need(p, KID);
    return v;
}
function out(p, op, a) {
    return emit(p, op, a, undefValue);
}
function patch(p, i) {
    p.f.code[i][INS_ARG] = p.f.n;
}
function chain(p, i, target) {
    var j;
    while (i >= 0) {
        j = p.f.code[i][INS_ARG];
        p.f.code[i][INS_ARG] = target;
        i = j;
    }
}
function localhints(m, f) {
    var map = {}, i, ins, n;
    for (i = 0; i < f.argc; i++) {
        map["$" + f.params[i][VAL_CELL][STR_TEXT]] = i + 1;
    }
    for (i = 0; i < f.nv; i++) {
        map["$" + f.vars[i][VAL_CELL][STR_TEXT]] = f.argc + i + 1;
    }
    for (i = 0; i < f.nh; i++) {
        map["$" + f.names[i][VAL_CELL][STR_TEXT]] = f.argc + f.nv + i + 1;
    }
    for (i = 0; i < f.n; i++) {
        ins = f.code[i];
        if (ins[INS_OP] === NAME) {
            n = map["$" + ins[INS_VALUE][VAL_CELL][STR_TEXT]];
            if (n !== undefined) {
                ins[INS_ARG] = n;
            }
        }
    }
}
function parseFunction(p, name) {
    var old = p.f;
    var f = fun(p.m);
    var loop = p.loop;
    var iters = p.iters;
    p.f = f;
    p.loop = 0;
    p.iters = 0;
    f.name = name;
    need(p, 40 /* '(' */);
    if (p.l.t != 41) {
        do {
            f.params[f.argc++] = id(p);
        } while (accept(p, 44 /* ',' */));
    }
    need(p, 41 /* ')' */);
    need(p, 123 /* '{' */);
    while ((p.l.t != 125) && (p.l.t != KEND)) {
        stmt(p);
    }
    need(p, 125 /* '}' */);
    out(p, PUSH, 0);
    out(p, RET, 0);
    localhints(p.m, f);
    p.f = old;
    p.loop = loop;
    p.iters = iters;
    return f;
}
var precedence = [], precGroups = [",", "=", "?", "", "", "|", "^", "&", "", "<>", "", "+-", "*/%"], precExtended = [9, 9, 9, 9, 10, 10, 5, 4, 0, 0, 2, 2, 2, 2, 2, 11, 11, 11, 2, 2, 2], pi, pj;
for (pi = 0; pi <= KCATCH; pi++) {
    precedence[pi] = 0;
}
for (pi = 0; pi < precGroups.length; pi++) {
    for (pj = 0; pj < precGroups[pi].length; pj++) {
        precedence[precGroups[pi].charCodeAt(pj)] = pi + 1;
    }
}
for (pi = 0; pi < precExtended.length; pi++) {
    precedence[KEQ + pi] = precExtended[pi];
}
precedence[KIN] = precedence[KINSTANCE] = 10;
function args(p) {
    var n = 0;
    need(p, 40 /* '(' */);
    if (p.l.t != 41) {
        do {
            expr(p, 2);
            out(p, GET, 0);
            n++;
        } while (accept(p, 44 /* ',' */));
    }
    need(p, 41 /* ')' */);
    return n;
}
function member(p, calls) {
    var k;
    for (;;) {
        if (accept(p, 46 /* '.' */)) {
            out(p, GET, 0);
            k = p.l.v;
            if (k[VAL_TAG] != STR) {
                syntax(p, "expected property name");
            }
            next(p);
            emit(p, PUSH, 0, k);
            out(p, PROP, 0);
        }
        else if (accept(p, 91 /* '[' */)) {
            out(p, GET, 0);
            expr(p, 1);
            need(p, 93 /* ']' */);
            out(p, PROP, 0);
        }
        else if (calls && (p.l.t == 40)) {
            out(p, PRECALL, 0);
            out(p, CALL, args(p));
        }
        else {
            break;
        }
    }
}
function primary(p) {
    var t = p.l.t;
    var n;
    var v = p.l.v;
    var k;
    var f;
    next(p);
    switch (t) {
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
        case 40 /* "(" */:
            expr(p, 1);
            need(p, 41 /* ')' */);
            break;
        case KFUNCTION:
            k = undefValue;
            if (p.l.t == KID) {
                k = id(p);
            }
            f = parseFunction(p, k);
            n = out(p, CLOSURE, 0);
            p.f.code[n][INS_FN] = f;
            break;
        case 123 /* "{" */:
            out(p, OBJECT, 0);
            if (p.l.t != 125) {
                do {
                    k = p.l.v;
                    if ((k[VAL_TAG] != STR) && (k[VAL_TAG] != NUM)) {
                        syntax(p, "expected object key");
                    }
                    next(p);
                    need(p, 58 /* ':' */);
                    out(p, DUP, 0);
                    emit(p, PUSH, 0, tostring(p.m, k));
                    out(p, PROP, 0);
                    expr(p, 2);
                    out(p, SET, 0);
                    out(p, DROP, 0);
                } while (accept(p, 44 /* ',' */) && (p.l.t != 125));
            }
            need(p, 125 /* '}' */);
            break;
        case 91 /* "[" */:
            out(p, ARRAY, 0);
            n = 0;
            while (p.l.t != 93) {
                if (p.l.t == 44) {
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
                if (!accept(p, 44 /* ',' */)) {
                    break;
                }
            }
            need(p, 93 /* ']' */);
            break;
        case KNEW:
            if ((++p.depth) > 512) {
                syntax(p, "new nesting limit");
            }
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
    if ((++p.depth) > 512) {
        syntax(p, "prefix nesting limit");
    }
    if (((((((((t == 33) || (t == 126)) || (t == 43)) || (t == 45)) || (t == KTYPEOF)) || (t == KVOID)) || (t == KDELETE)) || (t == KINC)) || (t == KDEC)) {
        next(p);
        prefix(p);
        if ((t == KINC) || (t == KDEC)) {
            out(p, INC, (t == KINC) ? (1) : (-1));
        }
        else if (t == KTYPEOF) {
            out(p, TYPE, 0);
        }
        else if (t == KDELETE) {
            out(p, DEL, 0);
        }
        else {
            out(p, UN, t);
        }
    }
    else {
        primary(p);
        member(p, 1);
        t = p.l.t;
        if (((t == KINC) || (t == KDEC)) && (p.l.previous == p.l.line)) {
            next(p);
            out(p, INC, (t == KINC) ? (2) : (-2));
        }
    }
    p.depth--;
}
function compound(t) {
    switch (t) {
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
function expr(p, min) {
    var t;
    var k;
    var j;
    var h;
    if ((++p.depth) > 512) {
        syntax(p, "expression nesting limit");
    }
    prefix(p);
    while ((k = precedence[p.l.t] || 0) >= min) {
        t = p.l.t;
        next(p);
        if (t == 44) {
            out(p, GET, 0);
            out(p, DROP, 0);
            expr(p, k + 1);
            out(p, GET, 0);
        }
        else if (k == 2) {
            if (t != 61) {
                out(p, DUP, 0);
                out(p, GET, 0);
            }
            expr(p, k);
            if (t != 61) {
                out(p, BIN, compound(t));
            }
            out(p, SET, 0);
        }
        else if (t == 63) {
            out(p, GET, 0);
            j = out(p, JF, 0);
            expr(p, 2);
            out(p, GET, 0);
            need(p, 58 /* ':' */);
            h = out(p, JMP, 0);
            patch(p, j);
            expr(p, 2);
            out(p, GET, 0);
            patch(p, h);
        }
        else if ((t == KAND) || (t == KOR)) {
            out(p, GET, 0);
            out(p, DUP, 0);
            j = out(p, (t == KAND) ? (JF) : (JT), 0);
            out(p, DROP, 0);
            expr(p, k + 1);
            out(p, GET, 0);
            patch(p, j);
        }
        else {
            out(p, GET, 0);
            expr(p, k + 1);
            out(p, BIN, t);
        }
    }
    p.depth--;
}
function semi(p) {
    if ((((!accept(p, 59 /* ';' */)) && (p.l.t != 125)) && (p.l.t != KEND)) && (p.l.previous == p.l.line)) {
        syntax(p, "expected semicolon");
    }
}
function vars(p) {
    var v;
    do {
        v = id(p);
        variable(p, v);
        if (accept(p, 61 /* '=' */)) {
            emit(p, NAME, 0, v);
            expr(p, 2);
            out(p, SET, 0);
            out(p, DROP, 0);
        }
    } while (accept(p, 44 /* ',' */));
}
function switchtable(p, start, entry, end, def) {
    var map = [], lo = 512, hi = -1, n = 0, j, k, target, c = p.f.code;
    for (j = c[entry][INS_ARG]; j < end;) {
        if (c[j][INS_OP] === JMP) {
            j = c[j][INS_ARG];
            continue;
        }
        if (j + 4 >= end || c[j][INS_OP] !== NAME || c[j + 1][INS_OP] !== GET || c[j + 2][INS_OP] !== PUSH ||
            c[j + 3][INS_OP] !== BIN || c[j + 3][INS_ARG] !== KSE || c[j + 4][INS_OP] !== JF || c[j + 2][INS_VALUE][VAL_TAG] !== NUM) {
            return;
        }
        k = c[j + 2][INS_VALUE][VAL_NUM];
        if (!(k >= 0 && k < 512 && k === (k | 0))) {
            return;
        }
        if (!map[k]) {
            map[k] = j + 5;
            if (k < lo) {
                lo = k;
            }
            if (k > hi) {
                hi = k;
            }
            n++;
        }
        j = c[j + 4][INS_ARG];
    }
    if (n < 3 || hi - lo + 1 > 4 * n) {
        return;
    }
    c[start][INS_OP] = c[entry - 2][INS_OP] = JMP;
    c[start][INS_ARG] = start + 1;
    c[entry - 2][INS_ARG] = entry - 1;
    c[entry - 1][INS_OP] = JMP;
    c[entry - 1][INS_ARG] = p.f.n;
    target = def >= 0 ? def : p.f.n + hi - lo + 3;
    emit(p, INIT, hi - lo + 1, num(lo));
    for (k = lo; k <= hi; k++) {
        out(p, JMP, map[k] ? map[k] : target);
    }
    out(p, JMP, target);
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
    var l = { br: 0, co: 0, is_switch: 0, up: 0 };
    if ((++p.depth) > 512) {
        syntax(p, "statement nesting limit");
    }
    switch (t) {
        case 59 /* ";" */:
            next(p);
            break;
        case 123 /* "{" */:
            next(p);
            while ((p.l.t != 125) && (p.l.t != KEND)) {
                stmt(p);
            }
            need(p, 125 /* '}' */);
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
            if ((((p.l.t == 59) || (p.l.t == 125)) || (p.l.t == KEND)) || (p.l.previous != p.l.line)) {
                out(p, PUSH, 0);
            }
            else {
                expr(p, 1);
                out(p, GET, 0);
            }
            out(p, RET, 0);
            semi(p);
            break;
        case KTHROW:
            next(p);
            if (p.l.previous != p.l.line) {
                syntax(p, "newline after throw");
            }
            expr(p, 1);
            out(p, THROW, 0);
            semi(p);
            break;
        case KIF:
            next(p);
            need(p, 40 /* '(' */);
            expr(p, 1);
            need(p, 41 /* ')' */);
            j = out(p, JF, 0);
            stmt(p);
            if (accept(p, KELSE)) {
                h = out(p, JMP, 0);
                patch(p, j);
                stmt(p);
                patch(p, h);
            }
            else {
                patch(p, j);
            }
            break;
        case KTRY:
            {
                var h = p.f.nhd++;
                var skip;
                var g = p.f;
                g.handlers[h] = {
                    target: 0, finish: 0, iter: 0, start: 0, name: undefValue, end: 0
                };
                g.handlers[h].start = g.n;
                g.handlers[h].iter = p.iters;
                next(p);
                if (p.l.t != 123) {
                    syntax(p, "expected try block");
                }
                stmt(p);
                g.handlers[h].end = g.n;
                skip = out(p, JMP, 0);
                need(p, KCATCH);
                need(p, 40 /* '(' */);
                g.handlers[h].name = id(p);
                need(p, 41 /* ')' */);
                g.handlers[h].target = g.n;
                out(p, CATCH, h);
                if (p.l.t != 123) {
                    syntax(p, "expected catch block");
                }
                stmt(p);
                g.handlers[h].finish = g.n;
                patch(p, skip);
                break;
            }
        case KSWITCH:
            {
                var test = -1;
                var entry;
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
                need(p, 40 /* '(' */);
                buf = "\x01switch" + p.serial++;
                v = str(p.m, buf);
                variable(p, v);
                start = emit(p, NAME, 0, v);
                expr(p, 1);
                out(p, SET, 0);
                out(p, DROP, 0);
                need(p, 41 /* ')' */);
                need(p, 123 /* '{' */);
                entry = test = out(p, JMP, 0);
                while ((p.l.t != 125) && (p.l.t != KEND)) {
                    if (p.l.t == KCASE) {
                        next(p);
                        patch(p, test);
                        emit(p, NAME, 0, v);
                        out(p, GET, 0);
                        expr(p, 2);
                        need(p, 58 /* ':' */);
                        out(p, BIN, KSE);
                        test = out(p, JF, 0);
                    }
                    else if (p.l.t == KDEFAULT) {
                        if (def >= 0) {
                            syntax(p, "duplicate default");
                        }
                        next(p);
                        need(p, 58 /* ':' */);
                        patch(p, test);
                        test = out(p, JMP, 0);
                        def = p.f.n;
                    }
                    else {
                        syntax(p, "expected case/default");
                    }
                    bodypc = p.f.n;
                    if (fall >= 0) {
                        p.f.code[fall][INS_ARG] = bodypc;
                    }
                    while ((((p.l.t != KCASE) && (p.l.t != KDEFAULT)) && (p.l.t != 125)) && (p.l.t != KEND)) {
                        stmt(p);
                    }
                    fall = out(p, JMP, 0);
                }
                need(p, 125 /* '}' */);
                patch(p, test);
                skip = out(p, JMP, (def >= 0) ? (def) : (p.f.n + 1));
                switchtable(p, start, entry, skip, def);
                if (def < 0) {
                    patch(p, skip);
                }
                if (fall >= 0) {
                    patch(p, fall);
                }
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
            if (t == KFOR) {
                need(p, 40 /* '(' */);
                if (forin(p)) {
                    var declare = accept(p, KVAR);
                    v = id(p);
                    if (declare) {
                        variable(p, v);
                    }
                    need(p, KIN);
                    expr(p, 1);
                    need(p, 41 /* ')' */);
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
                if (accept(p, KVAR)) {
                    vars(p);
                }
                else if (p.l.t != 59) {
                    expr(p, 1);
                    out(p, GET, 0);
                    out(p, DROP, 0);
                }
                need(p, 59 /* ';' */);
                start = p.f.n;
                if (p.l.t != 59) {
                    expr(p, 1);
                    j = out(p, JF, 0);
                }
                need(p, 59 /* ';' */);
                body = out(p, JMP, 0);
                update = p.f.n;
                if (p.l.t != 41) {
                    expr(p, 1);
                    out(p, GET, 0);
                    out(p, DROP, 0);
                }
                need(p, 41 /* ')' */);
                out(p, JMP, start);
                patch(p, body);
                stmt(p);
                out(p, JMP, update);
            }
            else if (t == KWHILE) {
                start = p.f.n;
                update = start;
                need(p, 40 /* '(' */);
                expr(p, 1);
                need(p, 41 /* ')' */);
                j = out(p, JF, 0);
                stmt(p);
                out(p, JMP, start);
            }
            else {
                start = p.f.n;
                stmt(p);
                update = p.f.n;
                need(p, KWHILE);
                need(p, 40 /* '(' */);
                expr(p, 1);
                need(p, 41 /* ')' */);
                out(p, JT, start);
                semi(p);
            }
            if (j >= 0) {
                patch(p, j);
            }
            chain(p, l.br, p.f.n);
            chain(p, l.co, update);
            p.loop = l.up;
            break;
        case KBREAK:
        case KCONTINUE:
            next(p);
            if (!p.loop) {
                syntax(p, "not inside loop");
            }
            if (t == KBREAK) {
                p.loop.br = out(p, JMP, p.loop.br);
            }
            else {
                var q = p.loop;
                while (q && q.is_switch) {
                    q = q.up;
                }
                if (!q) {
                    syntax(p, "continue outside loop");
                }
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
    if (!m.top) {
        die(m, "stack underflow");
    }
    return m.stack[--m.top];
}
function take(m) {
    if (!m.top) {
        die(m, "stack underflow");
    }
    var v = m.stack[--m.top];
    return v[VAL_TAG] >= REF ? readval(m, v) : v;
}
function arr(m) {
    var o = obj(m, m.ap);
    o[OBJ_ARRAY] = 1;
    return object(o);
}
function keynum(m, i) {
    return tostring(m, num(i));
}
function append(m, a, v) {
    var o = (a[VAL_CELL]);
    if (o[OBJ_LENGTH] == INT_MAX) {
        die(m, "array too long");
    }
    store(m, [AREF, o[OBJ_LENGTH], o], v);
}
function callable(v) {
    return (v[VAL_TAG] == OBJ) && (((v[VAL_CELL]))[OBJ_FUN] || ((v[VAL_CELL]))[OBJ_NATIVE]);
}
function closure(m, f, e) {
    var o = obj(m, m.fp);
    var p = obj(m, m.op);
    var v = object(o);
    o[OBJ_FUN] = f;
    o[OBJ_SCOPE] = e;
    hidden(m, o, "prototype", object(p));
    hidden(m, p, "constructor", v);
    hidden(m, o, "length", num(f.argc));
    return v;
}
function arg(m, base, argc, i) {
    return (i < argc) ? (m.stack[base + i]) : (undefValue);
}
function integer(a) {
    var n = number(a);
    if (n != n) {
        return 0;
    }
    if (n >= INT_MAX) {
        return INT_MAX;
    }
    if (n <= INT_MIN) {
        return INT_MIN;
    }
    return cint(n);
}
function bound(i, n) {
    if (i < 0) {
        i = (i < (-n)) ? (0) : (i + n);
    }
    return (i > n) ? (n) : (i);
}
function native(m, idn, self, argc, base) {
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
    switch (idn) {
        case 48: /* NHOST */
            o = (m.frame.callee[VAL_CELL]);
            m.host_base = base;
            m.host_argc = argc;
            m.host_result = undefValue;
            if (!o[OBJ_HOST](m, argc, o[OBJ_USER])) {
                die(m, "host callback failed");
            }
            r = m.host_result;
            m.host_result = undefValue;
            return r;
        case 1: /* NPRINT */
            s = '';
            for (i = 0; i < argc; i++) {
                s += (i ? ' ' : '') + chars(tostring(m, arg(m, base, argc, i)));
            }
            m.output(s);
            return undefValue;
        case 38: /* NASSERT */
            if (!truth(a)) {
                die(m, (b[VAL_TAG] == STR) ? (chars(b)) : ("assertion failed"));
            }
            return undefValue;
        case 2: /* NARRAY */
            r = arr(m);
            if ((argc == 1) && (a[VAL_TAG] == NUM)) {
                put(m, (r[VAL_CELL]), str(m, "length"), a);
            }
            else {
                for (i = 0; i < argc; i++) {
                    append(m, r, arg(m, base, argc, i));
                }
            }
            return r;
        case 3: /* NOBJECT */
            return (a[VAL_TAG] == OBJ) ? (a) : (object(obj(m, m.op)));
        case 4: /* NNUMBER */
            return num((argc) ? (number(a)) : (0));
        case 5: /* NSTRING */
            return (argc) ? (tostring(m, a)) : (str(m, ""));
        case 6: /* NBOOLEAN */
            return boolean(truth(a));
        case 15: /* NISARRAY */
            return boolean((a[VAL_TAG] == OBJ) && ((a[VAL_CELL]))[OBJ_ARRAY]);
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
            if (!argc) {
                var zero = 0;
                return num(((idn == NMAX) ? (-1.0) : (1.0)) / zero);
            }
            d = number(a);
            for (i = 1; i < argc; i++) {
                var q = number(arg(m, base, argc, i));
                if (q != q) {
                    return num(q);
                }
                if (((idn == NMAX) && (q > d)) || ((idn == NMIN) && (q < d))) {
                    d = q;
                }
            }
            return num(d);
        case 24: /* NPARSE */
            s = tostring(m, a);
            i = integer(b);
            if (i && (i < 2 || i > 36)) {
                return num(nanval());
            }
            end = trimASCII(chars(s));
            if (!i) {
                k = end.charAt(0);
                if (k === '+' || k === '-') {
                    end = end.slice(1);
                }
                i = end.slice(0, 2) === '0x' || end.slice(0, 2) === '0X' ? 16 : 10;
            }
            return num(parseInt(chars(s), i));
        case 39: /* NCREATE */
            if ((a[VAL_TAG] != NIL) && (a[VAL_TAG] != OBJ)) {
                die(m, "invalid prototype");
            }
            return object(obj(m, (a[VAL_TAG] == OBJ) ? ((a[VAL_CELL])) : (0)));
        case 40: /* NGETPROTO */
            if (a[VAL_TAG] != OBJ) {
                die(m, "object required");
            }
            o = ((a[VAL_CELL]))[OBJ_PROTO];
            return (o) ? (object(o)) : (val(NIL, 0, 0));
        case 41: /* NTOSTRING */
            return str(m, (self[VAL_TAG] == U) ? ("[object Undefined]") : ((self[VAL_TAG] == NIL) ? ("[object Null]") : ((self[VAL_TAG] == STR) ? ("[object String]") : ((self[VAL_TAG] == NUM) ? ("[object Number]") : ((self[VAL_TAG] == BOOL) ? ("[object Boolean]") : ((callable(self)) ? ("[object Function]") : ((((self[VAL_CELL]))[OBJ_ARRAY]) ? ("[object Array]") : ("[object Object]"))))))));
        case 13: /* NKEYS */
            if (a[VAL_TAG] != OBJ) {
                die(m, "Object.keys requires object");
            }
            r = arr(m);
            o = (a[VAL_CELL]);
            for (u = 0; u < o[OBJ_DENSE_CAP]; u++) {
                if (o[OBJ_DENSE][u][VAL_TAG] !== -1) {
                    append(m, r, keynum(m, u));
                }
            }
            for (u = 0; u < o[OBJ_CAP]; u++) {
                for (p = o[OBJ_TABLE][u]; p; p = p[PROP_NEXT]) {
                    if (!p[PROP_HIDDEN]) {
                        append(m, r, p[PROP_KEY]);
                    }
                }
            }
            return r;
        case 14: /* NHAS */
            if (self[VAL_TAG] != OBJ) {
                return boolean(0);
            }
            o = (self[VAL_CELL]);
            k = tostring(m, a);
            return boolean(ownkey(o, k) || (o[OBJ_ARRAY] && iskey(k, "length")));
        case 26: /* NCALL */
            at = m.top;
            for (i = 1; i < argc; i++) {
                push(m, arg(m, base, argc, i));
            }
            r = invoke(m, self, a, (argc) ? (argc - 1) : (0), at, 0);
            m.top = at;
            return r;
        case 27: /* NAPPLY */
            at = m.top;
            n = 0;
            if ((b[VAL_TAG] != NIL) && (b[VAL_TAG] != U)) {
                n = integer(property(m, b, str(m, "length")));
                if ((n < 0) || (n > 1000000)) {
                    die(m, "apply argument limit");
                }
                for (i = 0; i < n; i++) {
                    push(m, property(m, b, keynum(m, i)));
                }
            }
            r = invoke(m, self, a, n, at, 0);
            m.top = at;
            return r;
        default:
            break;
    }
    if (self[VAL_TAG] == STR) {
        s = self;
        n = cint(slen(s));
        i = integer(a);
        switch (idn) {
            case 44: /* NSPLIT */
                r = arr(m);
                if (b[VAL_TAG] == U) {
                    d = 4294967295.0;
                }
                else {
                    d = (bits(number(b)));
                }
                if (!d) {
                    return r;
                }
                if (a[VAL_TAG] == U) {
                    append(m, r, s);
                    return r;
                }
                k = tostring(m, a);
                if (!slen(k)) {
                    for (i = 0; (i < n) && (i < d); i++) {
                        append(m, r, strn(m, chars(s).slice(i), 1));
                    }
                    return r;
                }
                j = 0;
                for (i = 0; i <= (n - (cint(slen(k))));) {
                    if (!(chars(s).slice(i, i + slen(k)) === chars(k) ? 0 : 1)) {
                        append(m, r, strn(m, chars(s).slice(j), i - j));
                        if (((r[VAL_CELL]))[OBJ_LENGTH] >= d) {
                            return r;
                        }
                        i += cint(slen(k));
                        j = i;
                    }
                    else {
                        i++;
                    }
                }
                append(m, r, strn(m, chars(s).slice(j), n - j));
                return r;
            case 12: /* NCHAR */
                return ((i >= 0) && (i < n)) ? (strn(m, chars(s).slice(i), 1)) : (str(m, ""));
            case 34: /* NCHARCODE */
                return num(((i >= 0) && (i < n)) ? (chars(s).charCodeAt(i)) : (nanval()));
            case 10: /* NSLICE */
            case 35: /* NSUBSTRING */
                j = ((argc > 1) && (b[VAL_TAG] != U)) ? (integer(b)) : (n);
                if (idn == NSLICE) {
                    i = bound(i, n);
                    j = bound(j, n);
                }
                else {
                    i = (i < 0) ? (0) : ((i > n) ? (n) : (i));
                    j = (j < 0) ? (0) : ((j > n) ? (n) : (j));
                    if (i > j) {
                        h = i;
                        i = j;
                        j = h;
                    }
                }
                return strn(m, chars(s).slice(i), j > i ? j - i : 0);
            case 11: /* NINDEX */
                k = tostring(m, a);
                i = integer(b);
                if (i < 0) {
                    i = 0;
                }
                if (i > n) {
                    i = n;
                }
                for (; i <= (n - (cint(slen(k)))); i++) {
                    if (!(chars(s).slice(i, i + slen(k)) === chars(k) ? 0 : 1)) {
                        return num(i);
                    }
                }
                return num(-1);
            case 36: /* NLOWER */
            case 37: /* NUPPER */
                return str(m, idn === NLOWER ? chars(s).toLowerCase() : chars(s).toUpperCase());
            case 33: /* NCONCAT */
                r = s;
                for (i = 0; i < argc; i++) {
                    r = binary(m, 43, r, tostring(m, arg(m, base, argc, i)));
                }
                return r;
            default:
                die(m, "unsupported string method");
        }
    }
    if ((self[VAL_TAG] != OBJ) || (!((self[VAL_CELL]))[OBJ_ARRAY])) {
        die(m, "array method requires array");
    }
    o = (self[VAL_CELL]);
    n = o[OBJ_LENGTH];
    switch (idn) {
        case 7: /* NPUSH */
            for (i = 0; i < argc; i++) {
                append(m, self, arg(m, base, argc, i));
            }
            return num(o[OBJ_LENGTH]);
        case 42: /* NSHIFT */
            if (!n) {
                return undefValue;
            }
            r = get(o, keynum(m, 0));
            for (i = 1; i < n; i++) {
                k = keynum(m, i);
                s = keynum(m, i - 1);
                if (has(o, k)) {
                    put(m, o, s, get(o, k));
                }
                else {
                    del(o, s);
                }
            }
            del(o, keynum(m, n - 1));
            o[OBJ_LENGTH] = n - 1;
            return r;
        case 43: /* NUNSHIFT */
            if (argc > (INT_MAX - n)) {
                die(m, "array too long");
            }
            for (i = n - 1; i >= 0; i--) {
                k = keynum(m, i);
                s = keynum(m, i + argc);
                if (has(o, k)) {
                    put(m, o, s, get(o, k));
                }
                else {
                    del(o, s);
                }
            }
            for (i = 0; i < argc; i++) {
                put(m, o, keynum(m, i), arg(m, base, argc, i));
            }
            o[OBJ_LENGTH] = n + argc;
            return num(o[OBJ_LENGTH]);
        case 8: /* NPOP */
            if (!n) {
                return undefValue;
            }
            k = keynum(m, n - 1);
            r = get(o, k);
            del(o, k);
            o[OBJ_LENGTH]--;
            return r;
        case 11: /* NINDEX */
            i = integer(b);
            if (i < 0) {
                i = bound(i, n);
            }
            for (; i < n; i++) {
                k = keynum(m, i);
                if (has(o, k) && equal(get(o, k), a, 1)) {
                    return num(i);
                }
            }
            return num(-1);
        case 10: /* NSLICE */
            r = arr(m);
            i = bound(integer(a), n);
            j = ((argc > 1) && (b[VAL_TAG] != U)) ? (bound(integer(b), n)) : (n);
            for (; i < j; i++) {
                k = keynum(m, i);
                if (has(o, k)) {
                    append(m, r, get(o, k));
                }
                else {
                    ((r[VAL_CELL]))[OBJ_LENGTH]++;
                }
            }
            return r;
        case 9: /* NJOIN */
            s = a[VAL_TAG] === U ? str(m, ',') : tostring(m, a);
            buf = '';
            for (i = 0; i < n; i++) {
                x = get(o, keynum(m, i));
                x = x[VAL_TAG] === U || x[VAL_TAG] === NIL ? str(m, '') : tostring(m, x);
                buf += (i ? chars(s) : '') + chars(x);
            }
            return str(m, buf);
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
                if ((a[VAL_TAG] != U) && (!callable(a))) {
                    die(m, "invalid sort comparator");
                }
                at = m.top;
                src = arr(m);
                dst = arr(m);
                push(m, src);
                push(m, dst);
                for (i = 0; i < n; i++) {
                    k = keynum(m, i);
                    if (has(o, k)) {
                        x = get(o, k);
                        if (x[VAL_TAG] == U) {
                            undefineds++;
                        }
                        else {
                            append(m, src, x);
                            count++;
                        }
                    }
                }
                for (width = 1; width < count; width = (width > (count / 2)) ? (count) : (width * 2)) {
                    for (left = 0; left < count; left = right) {
                        mid = (width > (count - left)) ? (count) : (left + width);
                        right = (width > (count - mid)) ? (count) : (mid + width);
                        ia = left;
                        ib = mid;
                        for (outidx = left; outidx < right; outidx++) {
                            if (ia >= mid) {
                                j = 0;
                            }
                            else if (ib >= right) {
                                j = 1;
                            }
                            else {
                                va = get((src[VAL_CELL]), keynum(m, ia));
                                vb = get((src[VAL_CELL]), keynum(m, ib));
                                if (a[VAL_TAG] == U) {
                                    s = tostring(m, va);
                                    k = tostring(m, vb);
                                    j = !truth(binary(m, 62, s, k));
                                }
                                else {
                                    h = m.top;
                                    push(m, va);
                                    push(m, vb);
                                    x = invoke(m, a, undefValue, 2, h, 0);
                                    m.top = h;
                                    d = number(x);
                                    j = !(d > 0);
                                }
                            }
                            x = get((src[VAL_CELL]), keynum(m, (j) ? (ia++) : (ib++)));
                            put(m, (dst[VAL_CELL]), keynum(m, outidx), x);
                        }
                    }
                    tmp = src;
                    src = dst;
                    dst = tmp;
                }
                for (i = 0; i < count; i++) {
                    put(m, o, keynum(m, i), get((src[VAL_CELL]), keynum(m, i)));
                }
                for (; i < (count + undefineds); i++) {
                    put(m, o, keynum(m, i), undefValue);
                }
                for (; i < n; i++) {
                    del(o, keynum(m, i));
                }
                m.top = at;
                return self;
            }
        case 32: /* NREVERSE */
            for (i = 0; i < Math.floor(n / 2); i++) {
                k = keynum(m, i);
                s = keynum(m, (n - i) - 1);
                x = get(o, k);
                y = get(o, s);
                j = has(o, k);
                h = has(o, s);
                if (h) {
                    put(m, o, k, y);
                }
                else {
                    del(o, k);
                }
                if (j) {
                    put(m, o, s, x);
                }
                else {
                    del(o, s);
                }
            }
            return self;
        case 33: /* NCONCAT */
            r = arr(m);
            for (i = -1; i < argc; i++) {
                x = (i < 0) ? (self) : (arg(m, base, argc, i));
                if ((x[VAL_TAG] == OBJ) && ((x[VAL_CELL]))[OBJ_ARRAY]) {
                    var q = (x[VAL_CELL]);
                    for (j = 0; j < q[OBJ_LENGTH]; j++) {
                        k = keynum(m, j);
                        if (has(q, k)) {
                            append(m, r, get(q, k));
                        }
                        else {
                            ((r[VAL_CELL]))[OBJ_LENGTH]++;
                        }
                    }
                }
                else {
                    append(m, r, x);
                }
            }
            return r;
        case 46: /* NSOME */
        case 47: /* NEVERY */
        case 28: /* NFOREACH */
        case 29: /* NMAP */
        case 30: /* NFILTER */
        case 31: /* NREDUCE */
            if (!callable(a)) {
                die(m, "callback required");
            }
            at = m.top;
            push(m, self);
            r = (idn == NREDUCE) ? (b) : (arr(m));
            push(m, r);
            i = 0;
            if ((idn == NREDUCE) && (argc < 2)) {
                while ((i < n) && (!has(o, keynum(m, i)))) {
                    i++;
                }
                if (i == n) {
                    die(m, "reduce of empty array");
                }
                m.stack[at + 1] = get(o, keynum(m, i++));
            }
            for (; i < n; i++) {
                k = keynum(m, i);
                if (!has(o, k)) {
                    if (idn == NMAP) {
                        ((m.stack[at + 1][VAL_CELL]))[OBJ_LENGTH]++;
                    }
                    continue;
                }
                x = get(o, k);
                j = m.top;
                if (idn == NREDUCE) {
                    push(m, m.stack[at + 1]);
                }
                push(m, x);
                push(m, num(i));
                push(m, self);
                y = invoke(m, a, (idn == NREDUCE) ? (undefValue) : (b), m.top - j, j, 0);
                m.top = j;
                r = m.stack[at + 1];
                if (((idn == NSOME) && truth(y)) || ((idn == NEVERY) && (!truth(y)))) {
                    m.top = at;
                    return boolean(idn == NSOME);
                }
                if (idn == NMAP) {
                    append(m, r, y);
                }
                else if ((idn == NFILTER) && truth(y)) {
                    append(m, r, x);
                }
                else if (idn == NREDUCE) {
                    m.stack[at + 1] = y;
                }
            }
            r = m.stack[at + 1];
            m.top = at;
            return ((idn == NSOME) || (idn == NEVERY)) ? (boolean(idn == NEVERY)) : ((idn == NFOREACH) ? (undefValue) : (r));
        default:
            die(m, "unknown native method");
    }
    return undefValue;
}
function invoke(m, callee, self, argc, base, construct) {
    var o;
    var r;
    var p;
    var fr = {
        self: 0, prev: 0, code: 0, callee: 0, env: 0, base: 0
    }, f, e, i, q;
    var saved = m.top;
    if (!callable(callee)) {
        die(m, "not a function");
    }
    if ((++m.depth) > 512) {
        die(m, "call depth limit");
    }
    o = (callee[VAL_CELL]);
    if (construct) {
        p = get(o, str(m, "prototype"));
        self = object(obj(m, (p[VAL_TAG] == OBJ) ? ((p[VAL_CELL])) : (m.op)));
    }
    else if ((self[VAL_TAG] == U) || (self[VAL_TAG] == NIL)) {
        self = object(m.global[ENV_VARS]);
    }
    fr.prev = m.frame;
    fr.env = o[OBJ_SCOPE];
    fr.code = o[OBJ_FUN];
    fr.self = self;
    fr.callee = callee;
    fr.base = base;
    m.frame = (fr);
    if (o[OBJ_NATIVE]) {
        r = native(m, o[OBJ_NATIVE], self, argc, base);
    }
    else {
        f = o[OBJ_FUN];
        e = f.cache;
        f.cache = 0;
        if (!e) {
            e = env(m, o[OBJ_SCOPE]);
        }
        else {
            e[ENV_UP] = o[OBJ_SCOPE];
        }
        fr.env = e;
        r = run(m, f, e, self, callee, argc, base);
        if (f.reusable && !f.cache) {
            for (i = 0; i < e[ENV_VARS][OBJ_CAP]; i++) {
                for (q = e[ENV_VARS][OBJ_TABLE][i]; q; q = q[PROP_NEXT]) {
                    q[PROP_VALUE] = undefValue;
                }
            }
            e[ENV_UP] = 0;
            f.cache = e;
        }
    }
    m.frame = fr.prev;
    m.depth--;
    m.top = saved;
    return (construct && (r[VAL_TAG] != OBJ)) ? (self) : (r);
}
function run(m, f, e, self, callee, argc, base) {
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
    if (callee[VAL_TAG] === OBJ && f.name[VAL_TAG] === STR) {
        put(m, e[ENV_VARS], f.name, callee);
    }
    for (i = 0; i < f.argc; i++) {
        put(m, e[ENV_VARS], f.params[i], arg(m, base, argc, i));
    }
    if (callee[VAL_TAG] == OBJ) {
        if (!f.needsargs) {
            f.needsargs = 1;
            f.reusable = !f.nh;
            for (i = 0; i < f.n; i++) {
                if (f.code[i][INS_OP] === NAME && iskey(f.code[i][INS_VALUE], "arguments")) {
                    f.needsargs = 2;
                }
                if (f.code[i][INS_OP] === CLOSURE) {
                    f.reusable = 0;
                }
            }
        }
        if (f.needsargs === 2) {
            r = arr(m);
            for (i = 0; i < argc; i++) {
                append(m, r, arg(m, base, argc, i));
            }
            named(m, e[ENV_VARS], "arguments", r);
        }
    }
    for (i = 0; i < f.nv; i++) {
        if (!own(e[ENV_VARS], f.vars[i])) {
            put(m, e[ENV_VARS], f.vars[i], undefValue);
            if (chars(f.vars[i]).charCodeAt(0) == 1) {
                own(e[ENV_VARS], f.vars[i])[PROP_HIDDEN] = 1;
            }
        }
    }
    for (i = 0; i < f.nh; i++) {
        put(m, e[ENV_VARS], f.names[i], closure(m, f.hoist[i], e));
    }
    if (callee[VAL_TAG] === OBJ && !e[ENV_SLOTS]) {
        e[ENV_SLOTS] = [];
        for (i = 0; i < f.argc; i++) {
            e[ENV_SLOTS][i] = own(e[ENV_VARS], f.params[i]);
        }
        for (i = 0; i < f.nv; i++) {
            e[ENV_SLOTS][f.argc + i] = own(e[ENV_VARS], f.vars[i]);
        }
        for (i = 0; i < f.nh; i++) {
            e[ENV_SLOTS][f.argc + f.nv + i] = own(e[ENV_VARS], f.names[i]);
        }
    }
    while (pc < f.n) {
        try {
            if (m.limit && (!(m.remaining--))) {
                m.error = "instruction limit exceeded";
                throw m.budgetSignal;
            }
            while ((fr.env != e) && ((pc < fr.env[ENV_START]) || (pc >= fr.env[ENV_END]))) {
                fr.env = fr.env[ENV_UP];
            }
            if (m.live > m.threshold) {
                gc(m);
            }
            ins = (f.code[pc++]);
            t = ins[INS_ARG];
            switch (ins[INS_OP]) {
                case 0: /* PUSH */
                    m.stack[m.top++] = ins[INS_VALUE];
                    break;
                case 1: /* NAME */
                    if (t > 0 && fr.env === e && e[ENV_SLOTS]) {
                        if (!m.limit && pc < f.n && (f.code[pc][INS_OP] === GET || f.code[pc][INS_OP] === PRECALL)) {
                            i = f.code[pc++][INS_OP];
                            m.stack[m.top++] = e[ENV_SLOTS][t - 1][PROP_VALUE];
                            if (i === PRECALL) {
                                m.stack[m.top++] = undefValue;
                            }
                        }
                        else {
                            m.stack[m.top++] = [LREF, t - 1, e];
                        }
                        break;
                    }
                    if (!m.limit && pc < f.n && (f.code[pc][INS_OP] === GET || f.code[pc][INS_OP] === PRECALL)) {
                        i = f.code[pc++][INS_OP];
                        m.stack[m.top++] = lookup(m, fr.env, ins[INS_VALUE]);
                        if (i === PRECALL) {
                            m.stack[m.top++] = undefValue;
                        }
                    }
                    else {
                        m.stack[m.top++] = reference(m, fr.env, undefValue, ins[INS_VALUE]);
                    }
                    break;
                case 2: /* GET */
                    if (!m.top) {
                        die(m, "stack underflow");
                    }
                    a = m.stack[m.top - 1];
                    if (a[VAL_TAG] >= REF) {
                        m.stack[m.top - 1] = readval(m, a);
                    }
                    break;
                case 3: /* PROP */
                    b = take(m);
                    a = take(m);
                    if (!m.limit && pc < f.n && (f.code[pc][INS_OP] === GET || f.code[pc][INS_OP] === PRECALL)) {
                        i = f.code[pc++][INS_OP];
                        m.stack[m.top++] = property(m, a, b);
                        if (i === PRECALL) {
                            m.stack[m.top++] = a;
                        }
                    }
                    else if (a[VAL_TAG] === OBJ && a[VAL_CELL][OBJ_ARRAY] && b[VAL_TAG] === NUM && b[VAL_NUM] >= 0 && b[VAL_NUM] < INT_MAX && b[VAL_NUM] === (b[VAL_NUM] | 0)) {
                        m.stack[m.top++] = [AREF, b[VAL_NUM], a[VAL_CELL]];
                    }
                    else {
                        m.stack[m.top++] = reference(m, 0, a, tostring(m, b));
                    }
                    break;
                case 4: /* SET */
                    b = take(m);
                    a = pop(m);
                    store(m, a, b);
                    m.stack[m.top++] = b;
                    break;
                case 5: /* DUP */
                    a = m.stack[m.top - 1];
                    m.stack[m.top++] = a;
                    break;
                case 6: /* DROP */
                    pop(m);
                    break;
                case 7: /* SWAP */
                    a = pop(m);
                    b = pop(m);
                    m.stack[m.top++] = a;
                    m.stack[m.top++] = b;
                    break;
                case 8: /* BIN */
                    b = take(m);
                    a = take(m);
                    m.stack[m.top++] = binary(m, t, a, b);
                    break;
                case 9: /* UN */
                    a = take(m);
                    switch (t) {
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
                    m.stack[m.top++] = r;
                    break;
                case 10: /* INC */
                    a = pop(m);
                    b = num(number(readval(m, a)));
                    c = num(b[VAL_NUM] + ((t > 0) ? (1) : (-1)));
                    store(m, a, c);
                    m.stack[m.top++] = ((t == 2) || (t == (-2))) ? (b) : (c);
                    break;
                case 11: /* JMP */
                    pc = t;
                    break;
                case 12: /* JF */
                    a = take(m);
                    if (!truth(a)) {
                        pc = t;
                    }
                    break;
                case 13: /* JT */
                    a = take(m);
                    if (truth(a)) {
                        pc = t;
                    }
                    break;
                case 14: /* CALL */
                case 15: /* NEW */
                    at = (m.top - t) - 2;
                    a = m.stack[at];
                    b = m.stack[at + 1];
                    r = invoke(m, a, b, t, at + 2, ins[INS_OP] == NEW);
                    m.top = at;
                    m.stack[m.top++] = r;
                    break;
                case 16: /* RET */
                    r = take(m);
                    m.top = saved;
                    return r;
                case 17: /* CLOSURE */
                    m.stack[m.top++] = closure(m, ins[INS_FN], fr.env);
                    break;
                case 20: /* INIT */
                    a = take(m);
                    i = a[VAL_NUM] - ins[INS_VALUE][VAL_NUM];
                    if (a[VAL_TAG] !== NUM || !(i >= 0 && i < t && i === (i | 0))) {
                        i = t;
                    }
                    pc = f.code[pc + i][INS_ARG];
                    break;
                case 18: /* OBJECT */
                    m.stack[m.top++] = object(obj(m, m.op));
                    break;
                case 19: /* ARRAY */
                    m.stack[m.top++] = arr(m);
                    break;
                case 21: /* HOLE */
                    ((m.stack[m.top - 1][VAL_CELL]))[OBJ_LENGTH]++;
                    break;
                case 22: /* THIS */
                    m.stack[m.top++] = self;
                    break;
                case 23: /* THROW */
                    a = take(m);
                    b = tostring(m, a);
                    m.error = chars(b).slice(0, 250);
                    m.exception = a;
                    m.thrown = 1;
                    throw m.signal;
                    break;
                case 24: /* TYPE */
                    a = pop(m);
                    if (((a[VAL_TAG] == REF) && ((a[VAL_CELL]))[REF_ENV]) && (!binding(((a[VAL_CELL]))[REF_ENV], ((a[VAL_CELL]))[REF_KEY]))) {
                        a = undefValue;
                    }
                    else {
                        a = readval(m, a);
                    }
                    m.stack[m.top++] = str(m, (a[VAL_TAG] == U) ? ("undefined") : ((a[VAL_TAG] == BOOL) ? ("boolean") : ((a[VAL_TAG] == NUM) ? ("number") : ((a[VAL_TAG] == STR) ? ("string") : ((callable(a)) ? ("function") : ("object"))))));
                    break;
                case 25: /* DEL */
                    a = pop(m);
                    i = a[VAL_TAG] !== LREF;
                    if (a[VAL_TAG] === AREF) {
                        i = del(a[VAL_CELL], tostring(m, num(a[VAL_NUM])));
                    }
                    if (a[VAL_TAG] == REF) {
                        ref = (a[VAL_CELL]);
                        if (ref[REF_ENV]) {
                            i = 0;
                        }
                        else if (ref[REF_OBJ]) {
                            i = del(ref[REF_OBJ], ref[REF_KEY]);
                        }
                    }
                    m.stack[m.top++] = boolean(i);
                    break;
                case 26: /* PRECALL */
                    a = pop(m);
                    b = a[VAL_TAG] === AREF ? object(a[VAL_CELL]) : undefValue;
                    if (a[VAL_TAG] == REF) {
                        ref = (a[VAL_CELL]);
                        if (!ref[REF_ENV]) {
                            b = ref[REF_BASE];
                        }
                    }
                    m.stack[m.top++] = readval(m, a);
                    m.stack[m.top++] = b;
                    break;
                case 27: /* ENUM */
                    a = take(m);
                    r = arr(m);
                    if (a[VAL_TAG] == OBJ) {
                        var seen = obj(m, 0);
                        var u;
                        for (o = (a[VAL_CELL]); o; o = o[OBJ_PROTO]) {
                            for (u = 0; u < o[OBJ_DENSE_CAP]; u++) {
                                if (o[OBJ_DENSE][u][VAL_TAG] !== -1) {
                                    b = keynum(m, u);
                                    if (!own(seen, b)) {
                                        put(m, seen, b, boolean(1));
                                        append(m, r, b);
                                    }
                                }
                            }
                            for (u = 0; u < o[OBJ_CAP]; u++) {
                                for (p = o[OBJ_TABLE][u]; p; p = p[PROP_NEXT]) {
                                    if (!own(seen, p[PROP_KEY])) {
                                        put(m, seen, p[PROP_KEY], boolean(1));
                                        if (!p[PROP_HIDDEN]) {
                                            append(m, r, p[PROP_KEY]);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    else if (a[VAL_TAG] == STR) {
                        for (i = 0; i < (cint(slen(a))); i++) {
                            append(m, r, keynum(m, i));
                        }
                    }
                    m.stack[m.top++] = r;
                    m.stack[m.top++] = num(0);
                    break;
                case 28: /* NEXT */
                    i = cint(m.stack[m.top - 1][VAL_NUM]);
                    o = (m.stack[m.top - 2][VAL_CELL]);
                    if (i >= o[OBJ_LENGTH]) {
                        pc = t;
                    }
                    else {
                        m.stack[m.top - 1] = num(i + 1);
                        m.stack[m.top++] = get(o, keynum(m, i));
                    }
                    break;
                case 29: /* CATCH */
                    hd = (f.handlers[t]);
                    fr.env = env(m, fr.env);
                    fr.env[ENV_START] = hd.target;
                    fr.env[ENV_END] = hd.finish;
                    put(m, fr.env[ENV_VARS], hd.name, m.exception);
                    m.exception = undefValue;
                    m.thrown = 0;
                    break;
                default:
                    die(m, "bad bytecode");
            }
        }
        catch (caught) {
            if (caught !== m.signal) {
                throw caught;
            }
            m.frame = fr;
            m.depth = depth;
            var best = -1;
            for (i = 0; i < f.nhd; i++) {
                if (pc - 1 >= f.handlers[i].start && pc - 1 < f.handlers[i].end && (best < 0 || f.handlers[i].start >= f.handlers[best].start)) {
                    best = i;
                }
            }
            if (best < 0) {
                throw caught;
            }
            hd = f.handlers[best];
            pc = hd.target;
            m.top = saved + 2 * hd.iter;
            if (!m.thrown) {
                m.exception = str(m, m.error);
            }
            m.thrown = 1;
        }
    }
    m.top = saved;
    return undefValue;
}
function builtin(m, target, name, idn) {
    var o = obj(m, m.fp);
    var r = object(o);
    o[OBJ_NATIVE] = idn;
    hidden(m, target, name, r);
    return r;
}
function init(m) {
    var g;
    var math;
    var o;
    var v;
    m.threshold = 8192;
    m.op = obj(m, 0);
    m.ap = obj(m, m.op);
    m.ap[OBJ_ARRAY] = 1;
    m.fp = obj(m, m.op);
    m.sp = obj(m, m.op);
    m.global = env(m, 0);
    g = m.global[ENV_VARS];
    g[OBJ_PROTO] = m.op;
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
    o = obj(m, m.op);
    named(m, g, "console", object(o));
    builtin(m, o, "log", NPRINT);
    v = builtin(m, g, "Object", NOBJECT);
    hidden(m, (v[VAL_CELL]), "prototype", object(m.op));
    hidden(m, m.op, "constructor", v);
    builtin(m, (v[VAL_CELL]), "keys", NKEYS);
    builtin(m, m.op, "hasOwnProperty", NHAS);
    builtin(m, m.op, "toString", NTOSTRING);
    builtin(m, (v[VAL_CELL]), "create", NCREATE);
    builtin(m, (v[VAL_CELL]), "getPrototypeOf", NGETPROTO);
    v = builtin(m, g, "Array", NARRAY);
    hidden(m, (v[VAL_CELL]), "prototype", object(m.ap));
    hidden(m, m.ap, "constructor", v);
    builtin(m, (v[VAL_CELL]), "isArray", NISARRAY);
    v = builtin(m, g, "String", NSTRING);
    hidden(m, (v[VAL_CELL]), "prototype", object(m.sp));
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
    var m = {
        op: 0, gray: 0, depth: 0, top: 0, cap: 0, stack: [], ap: 0, frame: 0, sp: 0, global: 0, host_result: undefValue, fp: 0, error: '', thrown: 0, exception: undefValue, limit: 0, heap: 0, live: 0, funs: 0, signal: {}, threshold: 0, remaining: 0, host_base: 0, host_argc: 0, budgetSignal: {}, output: output, weakStrings: {}, weakCount: 0
    };
    if (!output) {
        m.output = function (s) {
            print(s);
        };
    }
    init(m);
    return m;
}
function js_eval(m, source) {
    var f, fr;
    if (!m || m.frame) {
        return 0;
    }
    m.remaining = m.limit;
    m.error = '';
    try {
        f = compile(m, source);
        fr = {
            self: object(m.global[ENV_VARS]), prev: 0, code: f, callee: undefValue, env: m.global, base: 0
        };
        m.frame = fr;
        run(m, f, m.global, fr.self, undefValue, 0, 0);
        m.frame = 0;
        gc(m);
        return 1;
    }
    catch (caught) {
        if (caught !== m.signal && caught !== m.budgetSignal) {
            throw caught;
        }
        m.frame = 0;
        m.exception = undefValue;
        m.host_result = undefValue;
        m.thrown = 0;
        m.top = 0;
        m.depth = 0;
        gc(m);
        return 0;
    }
}
function js_error(m) {
    return m.error;
}
function js_set_budget(m, n) {
    if (m && !m.frame) {
        m.limit = n;
    }
}
function js_register(m, name, callback, user) {
    var v;
    if (!m || m.frame || !name || !callback) {
        return 0;
    }
    v = builtin(m, m.global[ENV_VARS], name, NHOST);
    v[VAL_CELL][OBJ_HOST] = callback;
    v[VAL_CELL][OBJ_USER] = user;
    return 1;
}
function hostarg(m, i) {
    return i >= 0 && i < m.host_argc ? m.stack[m.host_base + i] : undefValue;
}
function js_arg_type(m, i) {
    return hostarg(m, i)[VAL_TAG];
}
function js_arg_number(m, i) {
    return number(hostarg(m, i));
}
function js_arg_string(m, i) {
    var v = hostarg(m, i);
    return v[VAL_TAG] === STR ? chars(v) : null;
}
function js_return_number(m, n) {
    m.host_result = num(n);
}
function js_return_boolean(m, n) {
    m.host_result = boolean(n);
}
function js_return_string(m, s, n) {
    m.host_result = strn(m, s, n);
}
function js_return_null(m) {
    m.host_result = val(NIL, 0, 0);
}
function js_free(m) {
    m.heap = 0;
    m.gray = 0;
    m.funs = 0;
    m.global = 0;
    m.op = 0;
    m.ap = 0;
    m.fp = 0;
    m.sp = 0;
    m.stack = [];
    m.frame = 0;
    m.live = 0;
}
/* JBC1 portable binary codec, using length-aware byte strings. */
var bcChars = asciiChars, bcIndex;
for (bcIndex = 128; bcIndex < 256; bcIndex++) {
    bcChars += byteChar(bcIndex);
}
function bcBytes(w, s) {
    w.buf += s;
    if (w.buf.length >= 4096) {
        bcFlush(w);
    }
}
function bcByte(w, n) {
    bcBytes(w, bcChars.charAt(n & 255));
}
function bcFlush(w) {
    if (fwrite(w.fd, w.buf) !== w.buf.length) {
        throw 'bytecode write failed';
    }
    w.buf = '';
}
function bcWord(w, n) {
    bcBytes(w, bcChars.charAt(n & 255) + bcChars.charAt((n >>> 8) & 255) + bcChars.charAt((n >>> 16) & 255) + bcChars.charAt(n >>> 24));
}
function bcValue(w, v) {
    var i, d, e = 0, hi;
    bcByte(w, v[VAL_TAG]);
    if (v[VAL_TAG] === STR) {
        bcWord(w, slen(v));
        bcBytes(w, chars(v));
    }
    else if (v[VAL_TAG] === BOOL) {
        bcByte(w, v[VAL_NUM]);
    }
    else if (v[VAL_TAG] === NUM) {
        d = v[VAL_NUM];
        if (d !== d) {
            bcByte(w, 3);
            return;
        }
        if (d > 0 && d === d / 2) {
            bcByte(w, 2);
            return;
        }
        if (d < 0 && d === d / 2) {
            bcByte(w, 4);
            return;
        }
        bcByte(w, d < 0 ? 1 : 0);
        d = Math.abs(d);
        if (d) {
            while (d >= 1) {
                d = d / 2;
                e++;
            }
            while (d < 0.5) {
                d = d * 2;
                e--;
            }
        }
        d = d * 9007199254740992;
        hi = Math.floor(d / 4294967296);
        bcWord(w, e);
        bcWord(w, hi);
        bcWord(w, d - hi * 4294967296);
    }
}
function bcFun(w, f) {
    var i, h, ins;
    bcValue(w, f.name);
    bcWord(w, f.argc);
    bcWord(w, f.nv);
    bcWord(w, f.nh);
    bcWord(w, f.nhd);
    bcWord(w, f.n);
    for (i = 0; i < f.argc; i++) {
        bcValue(w, f.params[i]);
    }
    for (i = 0; i < f.nv; i++) {
        bcValue(w, f.vars[i]);
    }
    for (i = 0; i < f.nh; i++) {
        bcValue(w, f.names[i]);
        bcFun(w, f.hoist[i]);
    }
    for (i = 0; i < f.nhd; i++) {
        h = f.handlers[i];
        bcWord(w, h.start);
        bcWord(w, h.end);
        bcWord(w, h.target);
        bcWord(w, h.finish);
        bcWord(w, h.iter);
        bcValue(w, h.name);
    }
    for (i = 0; i < f.n; i++) {
        ins = f.code[i];
        bcByte(w, ins[INS_OP]);
        bcWord(w, ins[INS_ARG]);
        bcValue(w, ins[INS_VALUE]);
        if (ins[INS_OP] === CLOSURE) {
            bcFun(w, ins[INS_FN]);
        }
    }
}
function bcReadByte(r) {
    if (r.pos >= r.s.length) {
        throw 'truncated bytecode';
    }
    return r.s.charCodeAt(r.pos++);
}
function bcReadWord(r) {
    return bcReadByte(r) + bcReadByte(r) * 256 + bcReadByte(r) * 65536 + bcReadByte(r) * 16777216;
}
function bcReadInt(r) {
    return bcReadWord(r) | 0;
}
function bcCount(r) {
    var n = bcReadInt(r);
    if (n < 0 || n > 1000000) {
        throw 'invalid bytecode count';
    }
    return n;
}
function bcReadValue(m, r) {
    var t = bcReadByte(r), k, n, e, d;
    if (t === STR) {
        n = bcCount(r);
        if (r.pos + n > r.s.length) {
            throw 'truncated string';
        }
        d = r.s.slice(r.pos, r.pos + n);
        r.pos += n;
        return str(m, d);
    }
    if (t === BOOL) {
        return boolean(bcReadByte(r));
    }
    if (t === NUM) {
        k = bcReadByte(r);
        if (k === 2) {
            return num(1 / 0);
        }
        if (k === 3) {
            return num(0 / 0);
        }
        if (k === 4) {
            return num(-1 / 0);
        }
        e = bcReadInt(r);
        d = bcReadWord(r) * 4294967296 + bcReadWord(r);
        d = d / 9007199254740992;
        while (e > 0) {
            d = d * 2;
            e--;
        }
        while (e < 0) {
            d = d / 2;
            e++;
        }
        return num(k ? -d : d);
    }
    if (t !== U && t !== NIL) {
        throw 'invalid value';
    }
    return val(t, 0, 0);
}
function readHandler(m, r) {
    var start = bcCount(r), end = bcCount(r), target = bcCount(r), finish = bcCount(r), iter = bcCount(r), name = bcReadValue(m, r);
    return {
        target: target, finish: finish, iter: iter, start: start, name: name, end: end
    };
}
function readInstruction(m, r) {
    var op = bcReadByte(r), a = bcReadInt(r), v = bcReadValue(m, r);
    return [op, a, v, 0];
}
function bcReadFun(m, r, depth) {
    var f = fun(m), i, h, ins;
    if (depth > 512) {
        throw 'bytecode nesting limit';
    }
    f.name = bcReadValue(m, r);
    f.argc = bcCount(r);
    f.nv = f.cv = bcCount(r);
    f.nh = f.ch = bcCount(r);
    f.nhd = bcCount(r);
    f.n = f.cap = bcCount(r);
    for (i = 0; i < f.argc; i++) {
        f.params[i] = bcReadValue(m, r);
    }
    for (i = 0; i < f.nv; i++) {
        f.vars[i] = bcReadValue(m, r);
    }
    for (i = 0; i < f.nh; i++) {
        f.names[i] = bcReadValue(m, r);
        f.hoist[i] = bcReadFun(m, r, depth + 1);
    }
    for (i = 0; i < f.nhd; i++) {
        h = readHandler(m, r);
        f.handlers[i] = h;
    }
    for (i = 0; i < f.n; i++) {
        ins = readInstruction(m, r);
        if (ins[INS_OP] === CLOSURE) {
            ins[INS_FN] = bcReadFun(m, r, depth + 1);
        }
        f.code[i] = ins;
    }
    return f;
}
function bcLoad(m, s) {
    var r = { pos: 4, s: s }, f;
    if (s.slice(0, 4) !== 'JBC1') {
        throw 'invalid magic';
    }
    f = bcReadFun(m, r, 0);
    if (r.pos !== s.length) {
        throw 'trailing bytes';
    }
    return f;
}
function bcCompile(source, path) {
    var m = js_new(), f = compile(m, source), w = { buf: 'JBC1', fd: fopen(path, 'wb') };
    if (!w.fd) {
        throw 'cannot open output';
    }
    bcFun(w, f);
    bcFlush(w);
    if (fclose(w.fd) !== 0) {
        throw 'close failed';
    }
}
function bcRun(m, f) {
    var fr = {
        self: object(m.global[ENV_VARS]), prev: 0, code: f, callee: undefValue, env: m.global, base: 0
    };
    m.frame = fr;
    run(m, f, m.global, fr.self, undefValue, 0, 0);
    m.frame = 0;
    gc(m);
}
/* Only generic host services cross the interpreter boundary. */
function forward(m, name, fn) {
    js_register(m, name, function (vm, argc) {
        var a = [], i, v, r;
        for (i = 0; i < argc; i++) {
            v = hostarg(vm, i);
            a.push(v[VAL_TAG] === STR ? chars(v) : v[VAL_NUM]);
        }
        r = fn.apply(null, a);
        if (typeof r === 'string') {
            js_return_string(vm, r, r.length);
        }
        else if (typeof r === 'number') {
            js_return_number(vm, r);
        }
        return 1;
    }, 0);
}
function cliVM(args) {
    var m = js_new(), a = arr(m), i;
    forward(m, 'readFile', readFile);
    forward(m, 'byteCharHost', byteCharHost);
    forward(m, 'fopen', fopen);
    forward(m, 'fclose', fclose);
    forward(m, 'fgetc', fgetc);
    forward(m, 'fputc', fputc);
    forward(m, 'fread', fread);
    forward(m, 'fwrite', fwrite);
    for (i = 0; i < args.length; i++) {
        append(m, a, str(m, args[i]));
    }
    named(m, m.global[ENV_VARS], 'scriptArgs', a);
    return m;
}
function cliMain(args) {
    var m, f, i, j;
    if (args[0] === '-c' && args.length === 4 && args[2] === '-o') {
        bcCompile(readFile(args[1]), args[3]);
        return;
    }
    if (args[0] === '-b' && args.length >= 2) {
        m = cliVM(args.slice(2));
        f = bcLoad(m, readFile(args[1]));
        bcRun(m, f);
        return;
    }
    if (args.length && args[0] !== '-c' && args[0] !== '-b') {
        for (i = 1; i < args.length; i++) {
            if (args[i].charAt(0) === '-') {
                break;
            }
        }
        if (i < args.length) {
            m = cliVM(args.slice(1));
            if (!js_eval(m, readFile(args[0]))) {
                throw js_error(m);
            }
        }
        else {
            m = cliVM([]);
            for (j = 0; j < args.length; j++) {
                if (!js_eval(m, readFile(args[j]))) {
                    throw js_error(m);
                }
            }
        }
        return;
    }
    throw 'usage: jsvm.js -c source -o output | -b bytecode [args...] | source [args...]';
}
if (typeof scriptArgs !== 'undefined' && scriptArgs.length) {
    cliMain(scriptArgs);
}
