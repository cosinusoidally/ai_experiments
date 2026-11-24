/* Self-hosting subset compiler and stack VM. No eval or Function constructor. */
function compile(source) {
    var pos = 0, tok = '', val, code = [], funcs = [];
    function digit(c) { return c >= '0' && c <= '9' && c !== ''; }
    function letter(c) { return c !== '' && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'); }
    function next() {
        var c = source.charAt(pos), start, q, pair;
        while (true) {
            while (c !== '' && c <= ' ') { pos++; c = source.charAt(pos); }
            if (source.slice(pos,pos+2) !== '/*') { break; }
            pos = source.indexOf('*/',pos+2)+2; c = source.charAt(pos);
        }
        start = pos; pos++;
        if (letter(c)) {
            while (letter(source.charAt(pos)) || digit(source.charAt(pos))) { pos++; }
            tok = 'id'; val = source.slice(start,pos);
            if ('|var|function|if|else|while|return|break|true|false|null|undefined|'.indexOf('|'+val+'|') >= 0) { tok = val; }
        } else if (digit(c)) {
            while (digit(source.charAt(pos))) { pos++; }
            tok = 'num'; val = Number(source.slice(start,pos));
        } else if (c === "'" || c === '"') {
            q = c; val = ''; c = source.charAt(pos++);
            while (c !== q) {
                if (c === '') { fail('unterminated string'); }
                if (c === '\\') { c = source.charAt(pos++); if (c === 'n') { c = '\n'; } }
                val = val+c; c = source.charAt(pos++);
            }
            tok = 'str';
        } else {
            tok = c; pair = source.slice(start,start+2);
            if (pair === '==' || pair === '!=' || pair === '<=' || pair === '>=' || pair === '&&' || pair === '||' || pair === '++') {
                tok = pair; pos++;
                if ((pair === '==' || pair === '!=') && source.charAt(pos) === '=') { tok = pair+'='; pos++; }
            }
        }
    }
    function fail(msg) { print('selfvm compile error: '+msg+' at '+pos+' token '+tok); assert(false); }
    function eat(t) { if (tok === t) { next(); return true; } return false; }
    function need(t) { if (!eat(t)) { fail('expected '+t); } }
    function name() { var n = val; need('id'); return n; }
    function emit(op,a) { code.push([op,a]); return code.length-1; }
    function patch(i) { code[i][1] = code.length; }
    function fun() {
        var outer = code, params = [], body, id, oldbreak = breaks;
        code = []; breaks = [];
        need('(');
        if (tok !== ')') { params.push(name()); while (eat(',')) { params.push(name()); } }
        need(')'); block(); emit('const',undefined); emit('ret');
        body = code; code = outer; breaks = oldbreak;
        id = funcs.length; funcs.push([params,body]); emit('fn',id);
    }
    function primary() {
        var n, count = 0;
        if (tok === 'num' || tok === 'str') { emit('const',val); next(); }
        else if (eat('true')) { emit('const',true); }
        else if (eat('false')) { emit('const',false); }
        else if (eat('null')) { emit('const',null); }
        else if (eat('undefined')) { emit('const',undefined); }
        else if (tok === 'id') { emit('ref',name()); }
        else if (eat('function')) { fun(); }
        else if (eat('(')) { expr(1); need(')'); }
        else if (eat('[')) {
            if (tok !== ']') { expr(1); count++; while (eat(',')) { expr(1); count++; } }
            need(']'); emit('array',count);
        } else if (eat('{')) {
            emit('object');
            if (tok !== '}') {
                while (true) {
                    n = val; if (tok !== 'id' && tok !== 'str') { fail('object key'); } next();
                    need(':'); expr(1); emit('field',n); if (!eat(',')) { break; }
                }
            }
            need('}');
        } else { fail('expression'); }
        while (true) {
            if (eat('.')) { emit('const',name()); emit('prop'); }
            else if (eat('[')) { expr(1); need(']'); emit('prop'); }
            else if (eat('(')) {
                count = 0;
                if (tok !== ')') { expr(1); count++; while (eat(',')) { expr(1); count++; } }
                need(')'); emit('call',count);
            } else if (eat('++')) { emit('inc'); }
            else { break; }
        }
    }
    function unary() {
        var op = tok;
        if (eat('!') || eat('-')) { unary(); emit('unary',op); }
        else { primary(); }
    }
    function precedence(t) {
        if (t === '=') { return 1; }
        if (t === '||') { return 2; }
        if (t === '&&') { return 3; }
        if (t === '===' || t === '!==' || t === '==' || t === '!=') { return 4; }
        if (t === '<' || t === '>' || t === '<=' || t === '>=') { return 5; }
        if (t === '+' || t === '-') { return 6; }
        if (t === '*' || t === '/' || t === '%') { return 7; }
        return 0;
    }
    function expr(min) {
        var p, op, j;
        unary(); p = precedence(tok);
        while (p >= min) {
            op = tok; next();
            if (op === '=') { expr(p); emit('set'); }
            else if (op === '&&' || op === '||') {
                j = emit(op); expr(p+1); emit('value'); patch(j);
            } else { emit('value'); expr(p+1); emit('bin',op); }
            p = precedence(tok);
        }
    }
    var breaks = [];
    function block() { need('{'); while (tok !== '}') { stmt(); } need('}'); }
    function stmt() {
        var n, j, k, start, old, i;
        if (eat(';')) { return; }
        if (tok === '{') { block(); }
        else if (eat('var')) {
            while (true) {
                n = name(); emit('declare',n);
                if (eat('=')) { emit('ref',n); expr(1); emit('set'); emit('pop'); }
                if (!eat(',')) { break; }
            }
            need(';');
        } else if (eat('function')) { n = name(); emit('declare',n); emit('ref',n); fun(); emit('set'); emit('pop'); }
        else if (eat('if')) {
            need('('); expr(1); need(')'); j = emit('jf'); stmt();
            if (eat('else')) { k = emit('jump'); patch(j); stmt(); patch(k); } else { patch(j); }
        } else if (eat('while')) {
            start = code.length; old = breaks; breaks = [];
            need('('); expr(1); need(')'); j = emit('jf'); stmt(); emit('jump',start); patch(j);
            i = 0; while (i < breaks.length) { patch(breaks[i++]); } breaks = old;
        } else if (eat('break')) { breaks.push(emit('jump')); need(';'); }
        else if (eat('return')) { if (tok === ';') { emit('const',undefined); } else { expr(1); } emit('ret'); need(';'); }
        else { expr(1); emit('pop'); need(';'); }
    }
    next(); while (tok !== '') { stmt(); } emit('const',undefined); emit('ret');
    return [code,funcs];
}
function execute(program, globals) {
    /* Every operand is a reference or an explicitly boxed value. */
    function box(v) { return [0,v]; }
    function read(r) { if (r[0] === 0) { return r[1]; } return r[1][r[2]]; }
    function scope(parent) { return [parent,{}]; }
    function ref(e,n) {
        var root = e;
        while (e !== null) { if (e[1].hasOwnProperty(n)) { return [1,e[1],n]; } root = e; e = e[0]; }
        return [1,root[1],n];
    }
    function binary(op,a,b) {
        if (op === '+') { return a+b; } if (op === '-') { return a-b; }
        if (op === '*') { return a*b; } if (op === '/') { return a/b; } if (op === '%') { return a%b; }
        if (op === '===') { return a===b; } if (op === '!==') { return a!==b; }
        if (op === '==') { return a==b; } if (op === '!=') { return a!=b; }
        if (op === '<') { return a<b; } if (op === '>') { return a>b; }
        if (op === '<=') { return a<=b; } if (op === '>=') { return a>=b; }
        assert(false);
    }
    function run(code,e) {
        var s = [], pc = 0, ins, op, a, b, r, n, args, f, def, child, i;
        while (true) {
            ins = code[pc++]; op = ins[0]; a = ins[1];
            if (op === 'const') { s.push(box(a)); }
            else if (op === 'ref') { s.push(ref(e,a)); }
            else if (op === 'declare') { if (!e[1].hasOwnProperty(a)) { e[1][a] = undefined; } }
            else if (op === 'value') { s.push(box(read(s.pop()))); }
            else if (op === 'prop') { b = read(s.pop()); r = read(s.pop()); s.push([1,r,b]); }
            else if (op === 'set') { b = read(s.pop()); r = s.pop(); r[1][r[2]] = b; s.push(box(b)); }
            else if (op === 'inc') { r = s.pop(); b = read(r); r[1][r[2]] = b+1; s.push(box(b)); }
            else if (op === 'bin') { b = read(s.pop()); r = read(s.pop()); s.push(box(binary(a,r,b))); }
            else if (op === 'unary') { b = read(s.pop()); if (a === '!') { s.push(box(!b)); } else { s.push(box(-b)); } }
            else if (op === 'pop') { s.pop(); }
            else if (op === 'jump') { pc = a; }
            else if (op === 'jf') { if (!read(s.pop())) { pc = a; } }
            else if (op === '&&' || op === '||') { b = read(s.pop()); if ((op === '&&' && !b) || (op === '||' && b)) { s.push(box(b)); pc = a; } }
            else if (op === 'object') { s.push(box({})); }
            else if (op === 'field') { b = read(s.pop()); read(s[s.length-1])[a] = b; }
            else if (op === 'array' || op === 'call') {
                args = []; i = a; while (i > 0) { i = i-1; args[i] = read(s.pop()); }
                if (op === 'array') { s.push(box(args)); }
                else {
                    r = s.pop(); f = read(r);
                    if (f && f.vmClosure === true) {
                        def = program[1][f.id]; child = scope(f.env); i = 0;
                        while (i < def[0].length) { child[1][def[0][i]] = args[i]; i++; }
                        b = run(def[1],child);
                    } else { b = f.apply(r[1],args); }
                    s.push(box(b));
                }
            } else if (op === 'fn') { s.push(box({vmClosure:true,id:a,env:e})); }
            else if (op === 'ret') { return read(s.pop()); }
            else { assert(false); }
        }
    }
    return run(program[0],[null,globals]);
}
function selfRun(source) { return execute(compile(source),{print:print,assert:assert,Number:Number}); }
